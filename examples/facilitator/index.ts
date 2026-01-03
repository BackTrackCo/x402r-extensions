import { config } from "dotenv";
import express from "express";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { settleWithRefundHelper, extractRefundInfo } from "@x402r/extensions/refund";

config();

// Configuration - validate required environment variables
const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
if (!evmPrivateKey) {
  console.error("Missing EVM_PRIVATE_KEY");
  process.exit(1);
}

const networkEnv = process.env.NETWORK;
if (!networkEnv) {
  console.error("Missing NETWORK");
  process.exit(1);
}

if (!networkEnv.startsWith("eip155:")) {
  console.error("NETWORK must be in format: eip155:chainId");
  process.exit(1);
}

const network = networkEnv as `eip155:${string}`;
const useBaseMainnet = network === "eip155:8453";
const chain = useBaseMainnet ? base : baseSepolia;

// Initialize EVM account and client
const evmAccount = privateKeyToAccount(evmPrivateKey);

const viemClient = createWalletClient({
  account: evmAccount,
  chain: chain,
  transport: http(),
}).extend(publicActions);

// Create EVM signer for facilitator operations
const evmSigner = toFacilitatorEvmSigner({
  getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
  address: evmAccount.address,
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) =>
    viemClient.readContract({
      ...args,
      args: args.args || [],
    }),
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => viemClient.verifyTypedData(args as any),
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) =>
    viemClient.writeContract({
      ...args,
      args: args.args || [],
    }),
  sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
    viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
    viemClient.  waitForTransactionReceipt(args),
});

// Store successful refund settlement results keyed by payment nonce
const refundSettlementResults = new Map<string, SettleResponse>();

// Initialize x402 Facilitator with refund handling hooks
const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    // Optionally extract and validate refund info early
    if (context.paymentPayload && context.requirements) {
      const refundInfo = extractRefundInfo(context.paymentPayload, context.requirements);
      // Refund info extracted and validated
    }
  })
  .onBeforeSettle(async (context) => {
    // Handle refund settlements via X402DepositRelayProxy
    try {
      const refundResult = await settleWithRefundHelper(
        context.paymentPayload,
        context.requirements,
        evmSigner,
      );

      if (refundResult) {
        // Store the successful result keyed by nonce for retrieval in /settle endpoint
        const payload = context.paymentPayload.payload as {
          authorization?: {
            nonce: string;
          };
        };
        if (payload.authorization?.nonce) {
          refundSettlementResults.set(payload.authorization.nonce, refundResult);
        }

        return {
          abort: true,
          reason: "handled_by_refund_helper",
        };
      }
    } catch (error) {
      // Abort settlement if refund helper fails - no fallback to normal settlement
      console.error("Refund helper error:", error);
      return {
        abort: true,
        reason: `refund_helper_failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // No refund applicable or refund helper didn't handle it - proceed with normal settlement
    return undefined;
  });

// Register EVM scheme with facilitator
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: network,
  deployERC4337WithEIP6492: true,
});

const app = express();
app.use(express.json());

// API Endpoints

/**
 * POST /verify
 * Verify a payment against requirements
 */
app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /settle
 * Settle a payment on-chain
 *
 * Refund-enabled payments are automatically handled via DepositRelay in onBeforeSettle hook
 */
app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );

    res.json(response);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      const abortReason = error.message.replace("Settlement aborted: ", "");

      // If this was a successful refund settlement, return the stored result
      if (abortReason === "handled_by_refund_helper") {
        const payload = req.body?.paymentPayload?.payload as {
          authorization?: {
            nonce: string;
          };
        };

        if (payload?.authorization?.nonce) {
          const storedResult = refundSettlementResults.get(payload.authorization.nonce);
          if (storedResult) {
            refundSettlementResults.delete(payload.authorization.nonce);
            return res.json(storedResult);
          }
        }
      }

      // Return a proper SettleResponse for other abort reasons
      return res.json({
        success: false,
        errorReason: abortReason,
        network: req.body?.paymentPayload?.network || req.body?.paymentRequirements?.network || "unknown",
      } as SettleResponse);
    }

    console.error("Settle error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /supported
 * Get supported payment kinds and extensions
 */
app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const PORT = process.env.PORT || "4022";
app.listen(parseInt(PORT), () => {
  console.log(`Facilitator listening at http://localhost:${PORT}`);
});
