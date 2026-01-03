/**
 * Type definitions for the Refund Helper Extension
 */

import type { PaymentOption } from "@x402/core/http";

/**
 * Extension identifier constant for the refund extension
 */
export const REFUND_EXTENSION_KEY = "refund";

/**
 * Constant for the refund marker key (internal marker)
 * Used to identify refundable payment options
 * The merchantPayout is read directly from the option's payTo field when processing
 */
export const REFUND_MARKER_KEY = "_x402_refund";

/**
 * Refund extension info structure
 *
 * merchantPayouts: Map of proxy address -> merchantPayout
 * This allows multiple refundable options with different merchantPayouts
 */
export interface RefundExtensionInfo {
  factoryAddress: string;
  merchantPayouts: Record<string, string>; // proxyAddress -> merchantPayout
}

/**
 * Refund extension structure (matches extension pattern with info and schema)
 */
export interface RefundExtension {
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
export function isRefundableOption(option: PaymentOption): boolean {
  // Check for marker in extra
  return (
    option.extra !== undefined &&
    typeof option.extra === "object" &&
    option.extra !== null &&
    REFUND_MARKER_KEY in option.extra &&
    option.extra[REFUND_MARKER_KEY] === true
  );
}
