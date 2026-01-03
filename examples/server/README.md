# Refund-Enabled Server Example

Express.js server demonstrating how to use the refund helper extension to enable refund and dispute resolution for payments.

## Overview

This example shows how to:
1. Mark payment options as refundable using `refundable()`
2. Process routes with `withRefund()` to route payments to DepositRelay
3. Mix refundable and non-refundable payment options in the same route

## Prerequisites

- Node.js v20+ (install via [nvm](https://github.com/nvm-sh/nvm))
- pnpm v10 (install via [pnpm.io/installation](https://pnpm.io/installation))
- Valid EVM address for receiving payments
- DepositRelay contract deployed on your network
- EscrowFactory contract deployed on your network
- URL of a facilitator supporting the desired payment network

## Setup

1. Create a `.env` file with the following variables:

```bash
FACILITATOR_URL=https://your-facilitator-url.com
EVM_ADDRESS=0xYourEVMAddress
NETWORK=eip155:1  # Format: eip155:chainId (e.g., eip155:1 for Ethereum, eip155:8453 for Base)
X402_DEPOSIT_RELAY_FACTORY_ADDRESS=0xFactoryAddress
```

2. Install dependencies from the repository root:

```bash
cd ../../
pnpm install
cd examples/server
```

3. Run the server:

```bash
pnpm dev
```

## How It Works

### 1. Mark Options as Refundable

Use `refundable()` to mark payment options that should support refunds:

```typescript
import { refundable } from '@x402r/extensions/refund';

const option = refundable({
  scheme: 'exact',
  payTo: evmAddress,
  price: '$0.001',
  network: 'eip155:1', // Format: eip155:chainId
});
```

### 2. Process Routes with DepositRelay

Use `withRefund()` to process route configurations:

```typescript
import { withRefund } from '@x402r/extensions/refund';

const routes = {
  '/weather': {
    accepts: refundable({ ... }),
  },
};

const processedRoutes = withRefund(routes, FACTORY_ADDRESS);
```

### 3. Mixed Payment Options

You can mix refundable and non-refundable options in the same route:

```typescript
accepts: [
  refundable({ ... }), // Refundable - routed to DepositRelay
  { ... },              // Non-refundable - normal flow
]
```

## Example Endpoints

### GET /weather

Has both refundable and non-refundable payment options:
- Refundable option: Payments go to DepositRelay → escrow
- Non-refundable option: Payments go directly to merchant

### GET /premium

Only refundable payment option:
- All payments go to DepositRelay → escrow

## Important Notes

1. **Merchant Registration**: Before using refund functionality, merchants must register with the shared escrow
2. **Facilitator**: Your facilitator must support refund settlements (see facilitator example)
3. **Network**: This example supports any EVM network. Set `NETWORK` to `eip155:chainId` format (e.g., `eip155:1` for Ethereum, `eip155:8453` for Base Mainnet)

## Next Steps

- See the [facilitator example](../facilitator/) to configure facilitator-side refund handling
- Learn more about the refund helper in the [package documentation](../../packages/refund/README.md)
