# Refund-Enabled Facilitator Example

Facilitator server demonstrating how to use the refund helper extension to handle refund settlements via DepositRelay contracts.

## Overview

This example shows how to:
1. Validate refund info in `onBeforeVerify` hook
2. Handle refund settlements in `onBeforeSettle` hook using `settleWithRefundHelper()`
3. Fall back to normal settlement if refund is not applicable

## Prerequisites

- Node.js v20+ (install via [nvm](https://github.com/nvm-sh/nvm))
- pnpm v10 (install via [pnpm.io/installation](https://pnpm.io/installation))
- EVM private key for signing transactions
- EscrowFactory contract deployed on your network
- DepositRelay contract deployed on your network

## Setup

1. Create a `.env` file with the following variables:

```bash
EVM_PRIVATE_KEY=0xYourPrivateKey
PORT=4022
NETWORK=base-sepolia  # or base-mainnet
```

**Note**: The facilitator automatically extracts the factory address from the payment extension, so no factory address configuration is needed.

2. Install dependencies from the repository root:

```bash
cd ../../
pnpm install
cd examples/facilitator
```

3. Run the facilitator:

```bash
pnpm dev
```

## How It Works

### 1. Validate Refund Info

The facilitator validates refund info in the `onBeforeVerify` hook:

```typescript
.onBeforeVerify(async (context) => {
  const refundInfo = extractRefundInfo(context.paymentPayload, context.requirements);
  if (refundInfo) {
    console.log("Refund-enabled payment detected");
  }
})
```

### 2. Handle Refund Settlements

The facilitator handles refund settlements in the `onBeforeSettle` hook:

```typescript
.onBeforeSettle(async (context) => {
  const refundResult = await settleWithRefundHelper(
    context.paymentPayload,
    context.paymentRequirements,
    evmSigner,
  );

  if (refundResult) {
    return { abort: true, reason: 'handled_by_refund_helper' };
  }

  return null; // Proceed with normal settlement
})
```

## What `settleWithRefundHelper()` Does

1. **Checks if refund is applicable** - Looks for refund extension in payment requirements
2. **Validates Factory** - Checks if factory contract exists
3. **Gets Merchant Info** - Reads merchantPayout from proxy or extension
4. **Validates Registration** - Checks if merchant is registered with shared escrow
5. **Deploys Relay** - Deploys relay proxy on-demand if needed
6. **Extracts signature components** - Parses signature into v, r, s components
7. **Calls Proxy** - Calls `X402DepositRelayProxy.executeDeposit()` to deposit funds into escrow
8. **Returns result** - Returns `SettleResponse` on success, `null` if not applicable

## Testing

You can test the facilitator with the refund-enabled server example:

1. Start the refund facilitator:
```bash
cd examples/facilitator
pnpm dev
```

2. Start the refund server (in another terminal):
```bash
cd examples/server
pnpm dev
```

3. Use a client to make payments to the refund-enabled endpoints

## Important Notes

1. **Merchant Registration**: Merchants must register with the shared escrow before using refund functionality
2. **Network**: This example supports both Base Sepolia (`eip155:84532`) and Base Mainnet (`eip155:8453`)
3. **Factory Address**: Automatically extracted from payment extension - no configuration needed

## API Endpoints

### POST /verify

Verifies a payment against requirements. Refund info is validated in the hook.

### POST /settle

Settles a payment on-chain. Refund-enabled payments are automatically handled via DepositRelay.

### GET /supported

Returns supported payment kinds and extensions.

## Next Steps

- See the [server example](../server/) to configure server-side refund functionality
- Learn more about the refund helper in the [package documentation](../../packages/refund/README.md)
