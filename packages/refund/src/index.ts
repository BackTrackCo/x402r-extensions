/**
 * Refund Helper Extension for x402
 *
 * Enables merchants to route payments to DepositRelay contracts via escrow,
 * providing refund and dispute resolution capabilities.
 *
 * ## Overview
 *
 * The refund helper allows merchants to mark payment options as refundable,
 * which routes payments through DepositRelay contracts into escrow accounts.
 * This enables dispute resolution and refunds even if merchants are uncooperative.
 *
 * ## For Merchants (Server-Side)
 *
 * ### Step 1: Mark Payment Options as Refundable
 *
 * Use `refundable()` to mark payment options that should support refunds:
 *
 * ```typescript
 * import { refundable } from '@x402r/extensions/refund';
 *
 * const option = refundable({
 *   scheme: 'exact',
 *   payTo: '0xmerchant123...', // Your merchant payout address
 *   price: '$0.01',
 *   network: 'eip155:84532',
 * });
 * ```
 *
 * ### Step 2: Process Routes with DepositRelay
 *
 * Use `withRefund()` to process route configurations and route refundable
 * payments to DepositRelay:
 *
 * ```typescript
 * import { refundable, withRefund } from '@x402r/extensions/refund';
 *
 * const FACTORY_ADDRESS = '0xFactory123...'; // Any CREATE3-compatible factory
 * const CREATEX_ADDRESS = '0xCreateX123...'; // CreateX contract address
 *
 * const routes = {
 *   '/api': {
 *     accepts: refundable({
 *       scheme: 'exact',
 *       payTo: '0xmerchant123...',
 *       price: '$0.01',
 *       network: 'eip155:84532',
 *     }),
 *   },
 * };
 *
 * // Process routes to route refundable payments to DepositRelay
 * // Uses CREATE3 - no bytecode needed! Works with any CREATE3-compatible factory.
 * // Version is optional - defaults to config file value
 * // CreateX address is optional - uses standard address for network if not provided
 * const processedRoutes = withRefund(routes, FACTORY_ADDRESS);
 *
 * // Use processedRoutes with paymentMiddleware
 * app.use(paymentMiddleware(processedRoutes, server));
 * ```
 *
 * ## For Facilitators
 *
 * Facilitators use `settleWithRefundHelper()` in hooks to handle refund settlements:
 *
 * ```typescript
 * import { settleWithRefundHelper } from '@x402r/extensions/refund';
 * import { x402Facilitator } from '@x402/core/facilitator';
 *
 * const ESCROW_FACTORY = '0xEscrowFactory123...';
 *
 * facilitator.onBeforeSettle(async (context) => {
 *   const result = await settleWithRefundHelper(
 *     context.paymentPayload,
 *     context.paymentRequirements,
 *     signer,
 *     ESCROW_FACTORY,
 *   );
 *
 *   if (result) {
 *     // Refund was handled via DepositRelay
 *     return { abort: true, reason: 'handled_by_refund_helper' };
 *   }
 *
 *   return null; // Proceed with normal settlement
 * });
 * ```
 *
 * ## How It Works
 *
 * 1. **Merchant Setup**: Merchant deploys escrow via EscrowFactory and marks options with `refundable()`
 * 2. **Route Processing**: `withRefund()` sets `payTo` to DepositRelay address, stores original merchantPayout in `extra`
 * 3. **Client Payment**: Client makes payment to DepositRelay address (transparent to client)
 * 4. **Facilitator Settlement**: Facilitator detects refund payment, queries EscrowFactory for escrow, calls DepositRelay.executeDeposit()
 * 5. **Escrow Hold**: Funds are held in escrow, enabling dispute resolution and refunds
 *
 * ## Key Features
 *
 * - **No Core Changes**: Works entirely through helpers and hooks
 * - **Client Transparent**: Clients don't need to change anything
 * - **Flexible**: Mix refundable and non-refundable options in same route
 * - **Deep Cloning**: All helpers return new objects, don't mutate originals
 */

// Export types
export {
  REFUND_EXTENSION_KEY,
  REFUND_MARKER_KEY,
  isRefundableOption,
  type RefundExtension,
  type RefundExtensionInfo,
} from "./types";

// Export server-side helpers
export { declareRefundExtension, refundable, withRefund } from "./server";
export { computeRelayAddress } from "./server/computeRelayAddress";

// Export facilitator-side helpers
export { extractRefundInfo, settleWithRefundHelper } from "./facilitator";
