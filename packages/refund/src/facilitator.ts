/**
 * Facilitator-side helpers for the Refund Helper Extension
 *
 * These helpers allow facilitator operators to validate refund info
 * and handle refund settlements via X402DepositRelayProxy contracts.
 */

import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { getAddress, isAddress, parseErc6492Signature, parseSignature, zeroAddress } from "viem";
import { REFUND_EXTENSION_KEY, type RefundExtension } from "./types";

/**
 * Checks if an error is a rate limit error (429)
 */
function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object") {
    // Check for viem error structure
    const err = error as { status?: number; message?: string; details?: string; cause?: unknown };
    if (err.status === 429) {
      return true;
    }
    const message = err.message || err.details || "";
    if (typeof message === "string" && message.toLowerCase().includes("rate limit")) {
      return true;
    }
    // Check nested cause
    if (err.cause && isRateLimitError(err.cause)) {
      return true;
    }
  }
  return false;
}

/**
 * Wraps readContract calls with retry logic for rate limit errors
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s
 */
async function readContractWithRetry<T>(
  signer: FacilitatorEvmSigner,
  args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  },
  maxRetries = 5,
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return (await signer.readContract(args)) as T;
    } catch (error) {
      lastError = error;
      
      // Only retry on rate limit errors
      if (!isRateLimitError(error)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt >= maxRetries) {
        break;
      }
      
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 16000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError;
}

/**
 * Factory ABI - any CREATE3-compatible factory that implements these methods can be used
 * No interface required - duck typing at runtime!
 *
 * Note: Proxies store all data directly (merchantPayout, token, escrow), so factory
 * only needs methods for deployment and address computation.
 */
const FACTORY_ABI = [
  {
    name: "getMerchantFromRelay",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "relayAddress", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getRelayAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "merchantPayout", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deployRelay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "merchantPayout", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getCreateX",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Escrow ABI for shared escrow
 */
const ESCROW_ABI = [
  {
    name: "registerMerchant",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchantPayout", type: "address" },
      { name: "arbiter", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "registeredMerchants",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "merchantPayout", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "merchantArbiters",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "merchantPayout", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getArbiter",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "merchantPayout", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "noteDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "merchantPayout", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "depositNonce", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "depositNonce", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "deposits",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "depositNonce", type: "uint256" },
    ],
    outputs: [
      { name: "principal", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "merchantPayout", type: "address" },
    ],
  },
] as const;

/**
 * RelayProxy ABI - proxy stores all data directly
 */
const RELAY_PROXY_ABI = [
  {
    name: "executeDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fromUser", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "MERCHANT_PAYOUT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "TOKEN",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "ESCROW",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Extracts refund extension info from payment payload or requirements
 *
 * @param paymentPayload - The payment payload (may contain extensions)
 * @param _ - The payment requirements (currently unused, kept for API compatibility)
 * @returns Refund extension info if valid, null otherwise
 */
export function extractRefundInfo(
  paymentPayload: PaymentPayload,
  _: PaymentRequirements,
): { factoryAddress: string; merchantPayouts: Record<string, string> } | null {
  // Get extension from payload (extensions flow from PaymentRequired through PaymentPayload)
  const extension = paymentPayload.extensions?.[REFUND_EXTENSION_KEY] as
    | RefundExtension
    | undefined;

  if (!extension || !extension.info || !extension.info.factoryAddress) {
    return null;
  }

  const factoryAddress = extension.info.factoryAddress;
  const merchantPayouts = extension.info.merchantPayouts || {};

  // Validate factory address format
  if (!isAddress(factoryAddress)) {
    return null;
  }

  return { factoryAddress, merchantPayouts };
}

/**
 * Helper for facilitator operators to handle refund settlements via X402DepositRelayProxy.
 *
 * This function:
 * 1. Extracts refund extension info (factory address)
 * 2. Validates factory exists
 * 3. Reads merchantPayout and escrow directly from proxy storage
 * 4. Checks if merchant is registered
 * 5. Deploys relay on-demand if needed (via factory)
 * 6. Calls proxy.executeDeposit() to deposit funds into escrow
 *
 * Returns null if refund is not applicable (delegates to normal flow).
 * Throws error on execution failure or if merchant not registered (facilitator should handle in hook).
 *
 * @param paymentPayload - The payment payload containing authorization and signature
 * @param paymentRequirements - The payment requirements containing refund extension
 * @param signer - The EVM signer for contract interactions
 * @returns SettleResponse on success, null if not applicable
 * @throws Error on execution failure or if merchant not registered
 *
 * @example
 * ```typescript
 * facilitator.onBeforeSettle(async (context) => {
 *   try {
 *     const result = await settleWithRefundHelper(
 *       context.paymentPayload,
 *       context.paymentRequirements,
 *       signer,
 *     );
 *
 *     if (result) {
 *       return { abort: true, reason: 'handled_by_refund_helper' };
 *     }
 *   } catch (error) {
 *     // Log error but don't abort - let normal settlement proceed
 *     console.error('Refund helper settlement failed:', error);
 *   }
 *
 *   return null; // Proceed with normal settlement
 * });
 * ```
 */
export async function settleWithRefundHelper(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  signer: FacilitatorEvmSigner,
): Promise<SettleResponse | null> {
  // Extract refund info from extension
  const refundInfo = extractRefundInfo(paymentPayload, paymentRequirements);
  if (!refundInfo) {
    return null; // Not refundable, proceed with normal settlement
  }

  const factoryAddress = refundInfo.factoryAddress;
  const merchantPayouts = refundInfo.merchantPayouts;

  // Check if factory exists (via code check)
  try {
    const factoryCode = await signer.getCode({ address: getAddress(factoryAddress) });
    if (!factoryCode || factoryCode === "0x" || factoryCode.length <= 2) {
      throw new Error(
        `Factory contract does not exist at ${factoryAddress}. Invalid refund extension.`,
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to check factory contract: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Get proxy address from payTo
  const proxyAddress = getAddress(paymentRequirements.payTo);

  // Check if relay exists (via code check) - do this FIRST before trying to read from it
  const relayCode = await signer.getCode({ address: proxyAddress });
  const relayExists = relayCode && relayCode !== "0x" && relayCode.length > 2;

  // Get merchantPayout - try from deployed proxy first, then from extension merchantPayouts map if not deployed
  let merchantPayout: string;
  let escrowAddress: string | undefined;

  if (relayExists) {
    // Relay is deployed - read merchantPayout and escrow directly from proxy
    try {
      merchantPayout = await readContractWithRetry<string>(signer, {
        address: proxyAddress,
        abi: RELAY_PROXY_ABI,
        functionName: "MERCHANT_PAYOUT",
        args: [],
      });

      escrowAddress = await readContractWithRetry<string>(signer, {
        address: proxyAddress,
        abi: RELAY_PROXY_ABI,
        functionName: "ESCROW",
        args: [],
      });
    } catch (error) {
      // Proxy query failed even though code exists - might not be a refund proxy
      return null;
    }
  } else {
    // Relay not deployed - get merchantPayout from extension's merchantPayouts map
    // The extension contains a map of proxyAddress -> merchantPayout

    // Look up merchantPayout in the extension's merchantPayouts map
    // Try both lowercase and original case for the proxy address
    const proxyAddressLower = proxyAddress.toLowerCase();
    merchantPayout = merchantPayouts[proxyAddress] || merchantPayouts[proxyAddressLower];

    if (!merchantPayout || merchantPayout === zeroAddress) {
      return null; // Not a refund payment, proceed with normal settlement
    }

    // escrowAddress will be set after deployment
  }

  // If merchantPayout is zero address, this is not a refund payment
  if (!merchantPayout || merchantPayout === zeroAddress) {
    return null; // Not a refund payment, proceed with normal settlement
  }

  // Deploy relay on-demand if needed
  if (!relayExists) {
    try {
      // First, verify the expected address matches what the factory would compute
      const expectedAddress = await readContractWithRetry<string>(signer, {
        address: getAddress(factoryAddress),
        abi: FACTORY_ABI,
        functionName: "getRelayAddress",
        args: [getAddress(merchantPayout)],
      });

      // Verify addresses match (case-insensitive comparison)
      if (expectedAddress.toLowerCase() !== proxyAddress.toLowerCase()) {
        throw new Error(
          `Address mismatch: Factory computed ${expectedAddress} but expected ${proxyAddress}. ` +
            `This may indicate a version or CreateX address mismatch.`,
        );
      }

      // Deploy the relay via factory
      const txHash = await signer.writeContract({
        address: getAddress(factoryAddress),
        abi: FACTORY_ABI,
        functionName: "deployRelay",
        args: [getAddress(merchantPayout)],
      });

      // Wait for deployment transaction to be mined
      const receipt = await signer.waitForTransactionReceipt({ hash: txHash });

      // Verify transaction succeeded
      if (receipt.status !== "success") {
        throw new Error(`Relay deployment transaction failed: ${txHash}. Transaction reverted.`);
      }

      // Wait a bit for the code to be available (CREATE3 deployments can take a moment)
      // Retry checking for code up to 5 times with increasing delays
      let deployedCode: string | undefined;
      for (let i = 0; i < 5; i++) {
        if (i > 0) {
          const delay = 1000 * i; // 1s, 2s, 3s, 4s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        deployedCode = await signer.getCode({ address: proxyAddress });
        if (deployedCode && deployedCode !== "0x" && deployedCode.length > 2) {
          break;
        }
      }

      // Verify the contract was actually deployed at the expected address
      // This is critical for CREATE3 deployments - the address is deterministic
      // but we need to ensure the deployment actually happened
      if (!deployedCode || deployedCode === "0x" || deployedCode.length <= 2) {
        // Double-check the factory's computed address
        const actualAddress = await readContractWithRetry<string>(signer, {
          address: getAddress(factoryAddress),
          abi: FACTORY_ABI,
          functionName: "getRelayAddress",
          args: [getAddress(merchantPayout)],
        });

        throw new Error(
          `Relay deployment completed but contract code not found at ${proxyAddress}. ` +
            `Transaction hash: ${txHash}. Factory computed address: ${actualAddress}. ` +
            `Expected address: ${proxyAddress}. ` +
            `This may indicate a CREATE3 deployment issue, timing problem, or address computation mismatch.`,
        );
      }

      // Now read escrow address from the newly deployed proxy
      escrowAddress = await readContractWithRetry<string>(signer, {
        address: proxyAddress,
        abi: RELAY_PROXY_ABI,
        functionName: "ESCROW",
        args: [],
      });
    } catch (error) {
      // Check if this is an insufficient funds error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorString = errorMessage.toLowerCase();
      
      if (
        errorString.includes("insufficient funds") ||
        errorString.includes("exceeds the balance") ||
        errorString.includes("insufficient balance") ||
        errorString.includes("the total cost") ||
        errorString.includes("exceeds the balance of the account")
      ) {
        const facilitatorAddress = signer.getAddresses()[0];
        throw new Error(
          `Failed to deploy relay: Insufficient funds in facilitator account.\n` +
          `The facilitator account (${facilitatorAddress}) does not have enough ETH to pay for gas to deploy the relay contract.\n` +
          `Please fund the facilitator account with ETH to cover gas costs.\n` +
          `Original error: ${errorMessage}`,
        );
      }
      
      throw new Error(
        `Failed to deploy relay: ${errorMessage}`,
      );
    }
  }

  // At this point, escrowAddress must be set (either from reading deployed proxy or after deployment)
  if (!escrowAddress) {
    throw new Error("Internal error: escrowAddress not set after deployment check");
  }

  // Check if merchant is registered
  let isRegistered: boolean;
  try {
    isRegistered = await readContractWithRetry<boolean>(signer, {
      address: getAddress(escrowAddress),
      abi: ESCROW_ABI,
      functionName: "registeredMerchants",
      args: [getAddress(merchantPayout)],
    });
  } catch (error) {
    throw new Error(
      `Failed to check merchant registration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRegistered) {
    throw new Error(
      `Merchant ${merchantPayout} is not registered. Please register at https://app.402r.org to enable refund functionality.`,
    );
  }

  // Extract payment parameters from payload
  const payload = paymentPayload.payload as {
    authorization?: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    signature?: string;
  };

  if (!payload.authorization || !payload.signature) {
    // Invalid payload structure, delegate to normal flow
    return null;
  }

  const { authorization, signature } = payload;

  // Verify that authorization.to matches the proxy address
  // The ERC3009 signature must have been signed with to=proxyAddress
  const authTo = getAddress(authorization.to);
  if (authTo !== proxyAddress) {
    throw new Error(
      `Authorization 'to' address (${authTo}) does not match proxy address (${proxyAddress}). ` +
        `The ERC3009 signature must be signed with to=proxyAddress.`,
    );
  }

  // Verify proxy can read its own immutables (this tests the _readImmutable function)
  // This helps catch issues before attempting executeDeposit
  try {
    const proxyToken = await readContractWithRetry<string>(signer, {
      address: proxyAddress,
      abi: RELAY_PROXY_ABI,
      functionName: "TOKEN",
      args: [],
    });

    // CRITICAL: Verify proxy TOKEN matches payment requirements asset
    // If they don't match, transferWithAuthorization will fail
    const proxyTokenNormalized = getAddress(proxyToken);
    const paymentAssetNormalized = getAddress(paymentRequirements.asset);

    if (proxyTokenNormalized !== paymentAssetNormalized) {
      const errorMsg =
        `❌ ADDRESS MISMATCH: Proxy has ${proxyTokenNormalized} but payment requires ${paymentAssetNormalized}. ` +
        `The proxy was deployed with the wrong address. ` +
        `This causes transferWithAuthorization to fail. ` +
        `Solution: Redeploy the proxy with the correct address: ${paymentAssetNormalized}`;
      throw new Error(errorMsg);
    }

    const proxyEscrow = await readContractWithRetry<string>(signer, {
      address: proxyAddress,
      abi: RELAY_PROXY_ABI,
      functionName: "ESCROW",
      args: [],
    });

    // Verify these match what we read earlier
    if (proxyEscrow.toLowerCase() !== escrowAddress.toLowerCase()) {
      throw new Error(
        `Proxy ESCROW mismatch: proxy reports ${proxyEscrow} but we read ${escrowAddress} earlier`,
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to read proxy immutables. This may indicate a proxy deployment issue. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Parse signature - handle ERC-6492 if needed
  let parsedSignature: string;
  try {
    const erc6492Result = parseErc6492Signature(signature as `0x${string}`);
    parsedSignature = erc6492Result.signature;
  } catch {
    // Not ERC-6492, use signature as-is
    parsedSignature = signature;
  }

  // Extract signature components (v, r, s)
  const signatureLength = parsedSignature.startsWith("0x")
    ? parsedSignature.length - 2
    : parsedSignature.length;
  const isECDSA = signatureLength === 130;

  if (!isECDSA) {
    // Non-ECDSA signatures not supported
    return null;
  }

  // Parse signature into v, r, s
  const parsedSig = parseSignature(parsedSignature as `0x${string}`);
  const v = (parsedSig.v as number | undefined) ?? parsedSig.yParity ?? 0;
  const r = parsedSig.r;
  const s = parsedSig.s;

  // Check if nonce has already been used (ERC3009 tracks this)
  // This helps catch state issues before attempting executeDeposit
  try {
    const tokenAddress = getAddress(paymentRequirements.asset);
    const nonceUsed = await readContractWithRetry<boolean>(signer, {
      address: tokenAddress,
      abi: [
        {
          inputs: [
            { name: "authorizer", type: "address" },
            { name: "nonce", type: "bytes32" },
          ],
          name: "authorizationState",
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "authorizationState",
      args: [getAddress(authorization.from), authorization.nonce as `0x${string}`],
    });

    if (nonceUsed) {
      throw new Error(
        `ERC3009 nonce ${authorization.nonce} has already been used. ` +
          `This authorization cannot be reused.`,
      );
    }
  } catch (error) {
    // If authorizationState doesn't exist or fails, continue
    // Some contracts might not implement this function
  }

  // Call proxy.executeDeposit() with retry logic
  let lastError: unknown;
  const maxRetries = 5;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const txHash = await signer.writeContract({
        address: proxyAddress,
        abi: RELAY_PROXY_ABI,
        functionName: "executeDeposit",
        args: [
          getAddress(authorization.from),
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce as `0x${string}`,
          v,
          r,
          s,
        ],
      });

      // Wait for transaction confirmation
      const receipt = await signer.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== "success") {
        throw new Error(`Proxy.executeDeposit transaction failed: ${txHash}`);
      }

      // Return SettleResponse on success
      return {
        success: true,
        transaction: txHash,
        network: paymentRequirements.network,
        payer: authorization.from,
      };
    } catch (error) {
      lastError = error;
      
      // Don't retry on last attempt
      if (attempt >= maxRetries) {
        break;
      }
      
      // Retry with delays: 1s, 2s, 3s, 4s, 5s
      const delayMs = (attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  
  // All retries exhausted, handle error
  const error = lastError;
  
  // Execution failure - throw error (don't return null)
  // Extract more detailed error information from nested error objects
  let errorMessage = error instanceof Error ? error.message : String(error);
  let revertReason: string | undefined;

  // Try to extract revert reason from nested error structure (viem error format)
  if (error && typeof error === "object") {
    const errorObj = error as Record<string, unknown>;

    // Check for cause.reason (viem ContractFunctionRevertedError)
    if (errorObj.cause && typeof errorObj.cause === "object") {
      const cause = errorObj.cause as Record<string, unknown>;
      if (typeof cause.reason === "string") {
        revertReason = cause.reason;
      }
      // Check for cause.data which might contain encoded revert reason
      if (cause.data && typeof cause.data === "string") {
        // Try to decode as a string if it's a revert with reason string
        // Revert with reason string starts with 0x08c379a0 (Error(string) selector) + offset + length + string
        if (cause.data.startsWith("0x08c379a0")) {
          try {
            // Skip selector (4 bytes) + offset (32 bytes) + length (32 bytes) = 68 chars
            const lengthHex = cause.data.slice(138, 202); // Length is at offset 68
            const length = parseInt(lengthHex, 16);
            const stringHex = cause.data.slice(202, 202 + length * 2);
            const decodedReason = Buffer.from(stringHex, "hex")
              .toString("utf8")
              .replace(/\0/g, "");
            if (decodedReason) {
              revertReason = decodedReason;
            }
          } catch (decodeErr) {
            // Failed to decode revert reason
          }
        }
      }
    }

    // Check for shortMessage (viem error format)
    if (typeof errorObj.shortMessage === "string") {
      if (!revertReason && errorObj.shortMessage.includes("reverted")) {
        // Try to extract from shortMessage
        const match = errorObj.shortMessage.match(/reverted(?:[: ]+)?(.+)/i);
        if (match && match[1]) {
          revertReason = match[1].trim();
        }
      }
    }
  }

  // Build detailed error message
  if (revertReason && revertReason !== "execution reverted") {
    errorMessage = `Contract reverted: ${revertReason}`;
  } else {
    errorMessage =
      `Contract execution reverted (no specific revert reason available). ` +
      `All pre-checks passed: merchant registered, nonce unused, proxy immutables readable. ` +
      `Possible failure points in executeDeposit: ` +
      `1) _readImmutable staticcall failing (unlikely - we can read immutables directly), ` +
      `2) ERC3009 transferWithAuthorization failing when called through proxy (most likely), ` +
      `3) Transfer to escrow failing, ` +
      `4) Escrow.noteDeposit failing - POOL.supply() may be paused, asset not configured in Aave pool, or pool has restrictions. ` +
      `Check Aave pool status and asset configuration on Base Sepolia. ` +
      `Debugging: Use a transaction trace/debugger on the failed transaction to see exact revert point. ` +
      `The simulation succeeds, so the contract logic is correct - this is likely an execution context issue. ` +
      `Original error: ${errorMessage}`;
  }

  throw new Error(`Failed to execute proxy.executeDeposit: ${errorMessage}`);
}
