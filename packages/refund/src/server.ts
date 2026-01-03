/**
 * Server-side helpers for the Refund Helper Extension
 *
 * These helpers allow merchants to mark payment options as refundable
 * and process route configurations to route payments to X402DepositRelayProxy contracts.
 */

import type { PaymentOption, RouteConfig, RoutesConfig } from "@x402/core/http";
import {
  REFUND_MARKER_KEY,
  isRefundableOption,
  REFUND_EXTENSION_KEY,
  type RefundExtension,
} from "./types";
import { computeRelayAddress } from "./server/computeRelayAddress";

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
export function declareRefundExtension(
  factoryAddress: string,
  merchantPayouts: Record<string, string>,
): Record<string, RefundExtension> {
  return {
    [REFUND_EXTENSION_KEY]: {
      info: {
        factoryAddress,
        merchantPayouts,
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          factoryAddress: {
            type: "string",
            pattern: "^0x[a-fA-F0-9]{40}$",
            description: "The X402DepositRelayFactory contract address",
          },
          merchantPayouts: {
            type: "object",
            additionalProperties: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{40}$",
            },
            description: "Map of proxy address to merchant payout address",
          },
        },
        required: ["factoryAddress", "merchantPayouts"],
        additionalProperties: false,
      },
    },
  };
}

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
export function refundable(option: PaymentOption): PaymentOption {
  // Deep clone the option to avoid mutation
  const clonedOption: PaymentOption = {
    ...option,
    extra: {
      ...option.extra,
    },
  };

  // Set marker to indicate this option is refundable
  if (!clonedOption.extra) {
    clonedOption.extra = {};
  }

  clonedOption.extra[REFUND_MARKER_KEY] = true;

  return clonedOption;
}

/**
 * Standard CreateX contract addresses per network.
 * These are the official CreateX deployments from https://github.com/pcaversaccio/createx#createx-deployments
 *
 * Note: If a network is not listed here, CreateX may need to be deployed separately.
 * The factory stores the CreateX address and can be queried via factory.getCreateX().
 */
const STANDARD_CREATEX_ADDRESSES: Record<string, string> = {
  // Ethereum Mainnet
  "eip155:1": "0xba5Ed099633D3B313e4D5F7bdc1305d3c32ba066",
  // Base Mainnet
  "eip155:8453": "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
  // Base Sepolia
  "eip155:84532": "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
  // Add more networks as CreateX deployments become available
};

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
export function withRefund(
  routes: RoutesConfig,
  factoryAddress: string,
  createxAddress?: string,
): RoutesConfig {
  // Deep clone to avoid mutation
  if (typeof routes === "object" && routes !== null && !("accepts" in routes)) {
    // Nested RoutesConfig: Record<string, RouteConfig>
    const nestedRoutes = routes as Record<string, RouteConfig>;
    const processedRoutes: Record<string, RouteConfig> = {};

    for (const [pattern, config] of Object.entries(nestedRoutes)) {
      processedRoutes[pattern] = processRouteConfig(config, factoryAddress, createxAddress);
    }

    return processedRoutes;
  } else {
    // Single RouteConfig
    return processRouteConfig(routes as RouteConfig, factoryAddress, createxAddress);
  }
}

/**
 * Gets the CreateX address for a given network.
 * First checks if provided explicitly, then falls back to standard addresses.
 *
 * @param network - The network identifier (e.g., "eip155:84532")
 * @param providedAddress - Optional CreateX address provided by user
 * @returns The CreateX address to use
 * @throws Error if no CreateX address can be determined
 */
function getCreateXAddress(network: string, providedAddress?: string): string {
  if (providedAddress) {
    return providedAddress;
  }

  const standardAddress = STANDARD_CREATEX_ADDRESSES[network];
  if (standardAddress) {
    return standardAddress;
  }

  throw new Error(
    `CreateX address not provided and no standard address found for network ${network}. ` +
      `Please provide createxAddress parameter or check if CreateX is deployed on this network. ` +
      `See https://github.com/pcaversaccio/createx#createx-deployments for standard deployments.`,
  );
}

/**
 * Processes a single RouteConfig to transform refundable payment options.
 *
 * @param config - The route configuration to process
 * @param factoryAddress - The X402DepositRelayFactory contract address
 * @param createxAddress - The CreateX contract address (optional)
 * @returns A new RouteConfig with refundable options transformed
 */
function processRouteConfig(
  config: RouteConfig,
  factoryAddress: string,
  createxAddress?: string,
): RouteConfig {
  // Get the network from the first payment option to determine CreateX address
  const firstOption = Array.isArray(config.accepts) ? config.accepts[0] : config.accepts;
  const network = firstOption?.network;

  if (!network) {
    throw new Error("Payment option must have a network field to determine CreateX address");
  }

  // Get CreateX address (from parameter or standard mapping)
  const resolvedCreatexAddress = getCreateXAddress(network, createxAddress);

  // Check if any option is refundable
  const hasRefundable = Array.isArray(config.accepts)
    ? config.accepts.some(isRefundableOption)
    : isRefundableOption(config.accepts);

  // Build map of proxyAddress -> merchantPayout BEFORE processing options
  // This allows us to store all merchantPayouts even if there are multiple refundable options
  const merchantPayoutsMap: Record<string, string> = {};

  if (hasRefundable) {
    const refundableOptions = Array.isArray(config.accepts)
      ? config.accepts.filter(isRefundableOption)
      : isRefundableOption(config.accepts)
        ? [config.accepts]
        : [];

    // Collect merchantPayouts from original options before processing
    for (const option of refundableOptions) {
      if (typeof option.payTo === "string") {
        const merchantPayout = option.payTo; // Original merchantPayout (before we overwrite it)
        const proxyAddress = computeRelayAddress(
          resolvedCreatexAddress,
          factoryAddress,
          merchantPayout,
        );
        merchantPayoutsMap[proxyAddress.toLowerCase()] = merchantPayout;
      }
    }
  }

  // Deep clone the config and process options
  const processedConfig: RouteConfig = {
    ...config,
    accepts: Array.isArray(config.accepts)
      ? config.accepts.map(option =>
          processPaymentOption(option, factoryAddress, resolvedCreatexAddress),
        )
      : processPaymentOption(config.accepts, factoryAddress, resolvedCreatexAddress),
    extensions: {
      ...config.extensions,
    },
  };

  // Add refund extension if any option is refundable
  if (hasRefundable && Object.keys(merchantPayoutsMap).length > 0) {
    processedConfig.extensions = {
      ...processedConfig.extensions,
      ...declareRefundExtension(factoryAddress, merchantPayoutsMap),
    };
  } else if (hasRefundable) {
    throw new Error(
      "Refundable option must have a string payTo address. DynamicPayTo is not supported for refundable options.",
    );
  }

  return processedConfig;
}

/**
 * Processes a single PaymentOption to transform it if refundable.
 *
 * @param option - The payment option to process
 * @param factoryAddress - The X402DepositRelayFactory contract address
 * @param createxAddress - The CreateX contract address (required)
 * @returns A new PaymentOption (transformed if refundable, unchanged otherwise)
 */
function processPaymentOption(
  option: PaymentOption,
  factoryAddress: string,
  createxAddress: string,
): PaymentOption {
  // Check if option is refundable
  if (isRefundableOption(option)) {
    // Read merchantPayout directly from payTo field (before we overwrite it)
    const merchantPayout = option.payTo;

    // If it's a function (DynamicPayTo), we can't compute the address (would need to call it)
    // For now, require it to be a string
    if (typeof merchantPayout !== "string") {
      throw new Error(
        "DynamicPayTo is not supported for refundable options. Use a static address.",
      );
    }

    // Compute proxy address using CREATE3 (no bytecode needed!)
    const proxyAddress = computeRelayAddress(createxAddress, factoryAddress, merchantPayout);

    // Deep clone the option
    const processedOption: PaymentOption = {
      ...option,
      payTo: proxyAddress, // Set payTo to proxy address
      extra: {
        ...option.extra,
      },
    };

    // Remove the marker since we've processed it
    if (processedOption.extra) {
      delete processedOption.extra[REFUND_MARKER_KEY];
    }

    return processedOption;
  }

  // Not refundable, return as-is (still clone to avoid mutation)
  return { ...option, extra: { ...option.extra } };
}
