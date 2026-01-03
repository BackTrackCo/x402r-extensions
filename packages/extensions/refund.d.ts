import { PaymentOption, RoutesConfig } from '@x402/core/http';
import { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { FacilitatorEvmSigner } from '@x402/evm';

/**
 * Type definitions for the Refund Helper Extension
 */

/**
 * Extension identifier constant for the refund extension
 */
declare const REFUND_EXTENSION_KEY = "refund";
/**
 * Constant for the refund marker key (internal marker)
 * Used to identify refundable payment options
 * The merchantPayout is read directly from the option's payTo field when processing
 */
declare const REFUND_MARKER_KEY = "_x402_refund";
/**
 * Refund extension info structure
 *
 * merchantPayouts: Map of proxy address -> merchantPayout
 * This allows multiple refundable options with different merchantPayouts
 */
interface RefundExtensionInfo {
    factoryAddress: string;
    merchantPayouts: Record<string, string>;
}
/**
 * Refund extension structure (matches extension pattern with info and schema)
 */
interface RefundExtension {
    info: RefundExtensionInfo;
    schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema";
        type: "object";
        properties: {
            factoryAddress: {
                type: "string";
                pattern: "^0x[a-fA-F0-9]{40}$";
                description: "The X402DepositRelayFactory contract address";
            };
            merchantPayouts: {
                type: "object";
                additionalProperties: {
                    type: "string";
                    pattern: "^0x[a-fA-F0-9]{40}$";
                };
                description: "Map of proxy address to merchant payout address";
            };
        };
        required: ["factoryAddress", "merchantPayouts"];
        additionalProperties: false;
    };
}
/**
 * Type guard to check if a payment option is refundable
 * A refundable option has a marker stored in extra
 *
 * @param option - The payment option to check
 * @returns True if the option is refundable
 */
declare function isRefundableOption(option: PaymentOption): boolean;

/**
 * Server-side helpers for the Refund Helper Extension
 *
 * These helpers allow merchants to mark payment options as refundable
 * and process route configurations to route payments to X402DepositRelayProxy contracts.
 */

/**
 * Declares a refund extension with factory address and merchantPayouts map
 *
 * @param factoryAddress - The X402DepositRelayFactory contract address
 * @param merchantPayouts - Map of proxy address to merchant payout address
 * @returns Refund extension object with info and schema
 *
 * @example
 * ```typescript
 * const extension = declareRefundExtension("0xFactory123...", {
 *   "0xProxy1...": "0xMerchant1...",
 *   "0xProxy2...": "0xMerchant2...",
 * });
 * ```
 */
declare function declareRefundExtension(factoryAddress: string, merchantPayouts: Record<string, string>): Record<string, RefundExtension>;
/**
 * Marks a payment option as refundable.
 *
 * This function marks the option as refundable so it can be processed by `withRefund()`.
 * The merchantPayout is read directly from the option's `payTo` field when processing.
 *
 * @param option - The payment option to mark as refundable
 * @returns A new PaymentOption marked as refundable (does not mutate original)
 *
 * @example
 * ```typescript
 * const refundableOption = refundable({
 *   scheme: "exact",
 *   payTo: "0xmerchant123...",
 *   price: "$0.01",
 *   network: "eip155:84532",
 * });
 * // refundableOption.extra._x402_refund = true
 * ```
 */
declare function refundable(option: PaymentOption): PaymentOption;
/**
 * Processes route configuration to handle refundable payment options.
 *
 * This function finds all payment options marked with `refundable()` and:
 * 1. Computes the proxy address using CREATE3 (no bytecode needed!)
 * 2. Sets `payTo` to the proxy address
 * 3. Adds the refund extension with factory address
 *
 * @param routes - Route configuration (single RouteConfig or Record<string, RouteConfig>)
 * @param factoryAddress - The X402DepositRelayFactory contract address (required)
 * @param createxAddress - The CreateX contract address (optional, will use standard address for network if not provided)
 * @returns A new RoutesConfig with refundable options routed to proxy (deep cloned, does not mutate original)
 *
 * @example
 * ```typescript
 * const routes = {
 *   "/api": {
 *     accepts: refundable({
 *       scheme: "exact",
 *       payTo: "0xmerchant123...",
 *       price: "$0.01",
 *       network: "eip155:84532",
 *     }),
 *   },
 * };
 *
 * // Version is optional - defaults to config file value
 * // CreateX address is optional - uses standard address for the network
 * const processedRoutes = withRefund(routes, "0xFactory123...");
 * // processedRoutes["/api"].accepts.payTo = computed proxy address
 * // processedRoutes["/api"].extensions.refund = { info: { factoryAddress: "0xFactory123..." }, schema: {...} }
 * ```
 */
declare function withRefund(routes: RoutesConfig, factoryAddress: string, createxAddress?: string): RoutesConfig;

/**
 * Helper to compute CREATE3 address for RelayProxy
 *
 * Uses the CREATE3 formula via CreateX (matching Solidity implementation):
 *
 * Where:
 * - salt = keccak256(abi.encodePacked(factoryAddress, merchantPayout))
 * - guardedSalt = keccak256(abi.encode(salt))  // CreateX guards the salt
 * - createxDeployer = the CreateX contract address
 *
 * CREATE3 is much simpler than CREATE2 - no bytecode needed!
 * The address depends only on the deployer (CreateX) and salt.
 *
 * IMPORTANT: The CreateX address must match the one used by the factory contract.
 * The factory stores its CreateX address and can be queried via factory.getCreateX().
 * This function computes addresses locally without any on-chain calls.
 */
/**
 * Computes the CREATE3 address for a merchant's relay proxy
 *
 * This matches the Solidity implementation in DepositRelayFactory.getRelayAddress():
 * 1. salt = keccak256(abi.encodePacked(merchantPayout))
 * 2. guardedSalt = keccak256(abi.encode(salt))  // CreateX guards the salt
 * 3. return CREATEX.computeCreate3Address(guardedSalt)
 *
 * Uses the @whoislewys/predict-deterministic-address library which correctly
 * implements the CREATE3 formula used by CreateX (based on Solady's CREATE3).
 * This ensures the computed address matches the factory's on-chain computation
 * without requiring any on-chain calls.
 *
 * @param createxAddress - The CreateX contract address
 * @param factoryAddress - The DepositRelayFactory contract address
 * @param merchantPayout - The merchant's payout address
 * @returns The deterministic proxy address
 *
 * @example
 * ```typescript
 * // No bytecode needed! Computes locally without on-chain calls.
 * const relayAddress = computeRelayAddress(
 *   "0xCreateX123...",
 *   "0xMerchant123...",
 *   0n // version
 * );
 * ```
 */
declare function computeRelayAddress(createxAddress: string, factoryAddress: string, merchantPayout: string): string;

/**
 * Facilitator-side helpers for the Refund Helper Extension
 *
 * These helpers allow facilitator operators to validate refund info
 * and handle refund settlements via X402DepositRelayProxy contracts.
 */

/**
 * Extracts refund extension info from payment payload or requirements
 *
 * @param paymentPayload - The payment payload (may contain extensions)
 * @param _ - The payment requirements (currently unused, kept for API compatibility)
 * @returns Refund extension info if valid, null otherwise
 */
declare function extractRefundInfo(paymentPayload: PaymentPayload, _: PaymentRequirements): {
    factoryAddress: string;
    merchantPayouts: Record<string, string>;
} | null;
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
declare function settleWithRefundHelper(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements, signer: FacilitatorEvmSigner): Promise<SettleResponse | null>;

export { REFUND_EXTENSION_KEY, REFUND_MARKER_KEY, type RefundExtension, type RefundExtensionInfo, computeRelayAddress, declareRefundExtension, extractRefundInfo, isRefundableOption, refundable, settleWithRefundHelper, withRefund };
