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

import { keccak256, encodePacked, encodeAbiParameters, getAddress } from "viem";
import { predictCreate3Address } from "@whoislewys/predict-deterministic-address";

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
export function computeRelayAddress(
  createxAddress: string,
  factoryAddress: string,
  merchantPayout: string,
): string {
  // Normalize addresses to checksummed format
  const createx = getAddress(createxAddress);
  const factory = getAddress(factoryAddress);
  const merchant = getAddress(merchantPayout);

  // Step 1: salt = keccak256(abi.encodePacked(factoryAddress, merchantPayout))
  const salt = keccak256(encodePacked(["address", "address"], [factory, merchant]));

  // Step 2: guardedSalt = keccak256(abi.encode(salt))
  // Note: abi.encode (not encodePacked) - this adds length prefixes
  const guardedSalt = keccak256(
    encodeAbiParameters([{ type: "bytes32" }], [salt as `0x${string}`]),
  );

  // Step 3: Use predictCreate3Address to compute the CREATE3 address
  // This matches CreateX's computeCreate3Address implementation exactly
  // No on-chain calls needed - computes locally!
  return predictCreate3Address(createx, guardedSalt as `0x${string}`);
}
