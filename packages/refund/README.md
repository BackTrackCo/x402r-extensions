# @x402r/extensions/refund

Refund Helper Extension for x402 - enables merchants to route payments to DepositRelay contracts via escrow, providing refund and dispute resolution capabilities.

## Installation

```bash
npm install @x402r/extensions
```

Then import from the subpath:
```typescript
import { refundable, withRefund } from '@x402r/extensions/refund';
```

### Peer Dependencies

This package requires:
- `@x402/core` (^2.0.0)
- `@x402/evm` (^2.0.0)

Install them separately:
```bash
npm install @x402/core @x402/evm
```

## Overview

The refund helper allows merchants to mark payment options as refundable, which routes payments through DepositRelay contracts into escrow accounts. This enables dispute resolution and refunds even if merchants are uncooperative.

## For Merchants (Server-Side)

### Step 1: Mark Payment Options as Refundable

Use `refundable()` to mark payment options that should support refunds:

```typescript
import { refundable } from '@x402r/extensions/refund';

const option = refundable({
  scheme: 'exact',
  payTo: '0xmerchant123...', // Your merchant payout address
  price: '$0.01',
  network: 'eip155:84532',
});
```

### Step 2: Process Routes with DepositRelay

Use `withRefund()` to process route configurations and route refundable payments to DepositRelay:

```typescript
import { refundable, withRefund } from '@x402r/extensions/refund';

const FACTORY_ADDRESS = '0xFactory123...'; // Any CREATE3-compatible factory

const routes = {
  '/api': {
    accepts: refundable({
      scheme: 'exact',
      payTo: '0xmerchant123...',
      price: '$0.01',
      network: 'eip155:84532',
    }),
  },
};

// Process routes to route refundable payments to DepositRelay
const processedRoutes = withRefund(routes, FACTORY_ADDRESS);

// Use processedRoutes with paymentMiddleware
app.use(paymentMiddleware(processedRoutes, server));
```

## For Facilitators

Facilitators use `settleWithRefundHelper()` in hooks to handle refund settlements:

```typescript
import { settleWithRefundHelper } from '@x402r/extensions/refund';
import { x402Facilitator } from '@x402/core/facilitator';

facilitator.onBeforeSettle(async (context) => {
  const result = await settleWithRefundHelper(
    context.paymentPayload,
    context.paymentRequirements,
    signer,
  );

  if (result) {
    // Refund was handled via DepositRelay
    return { abort: true, reason: 'handled_by_refund_helper' };
  }

  return null; // Proceed with normal settlement
});
```

## How It Works

1. **Merchant Setup**: Merchant deploys escrow via EscrowFactory and marks options with `refundable()`
2. **Route Processing**: `withRefund()` sets `payTo` to DepositRelay address, stores original merchantPayout in `extra`
3. **Client Payment**: Client makes payment to DepositRelay address (transparent to client)
4. **Facilitator Settlement**: Facilitator detects refund payment, queries EscrowFactory for escrow, calls DepositRelay.executeDeposit()
5. **Escrow Hold**: Funds are held in escrow, enabling dispute resolution and refunds

## Key Features

- **No Core Changes**: Works entirely through helpers and hooks
- **Client Transparent**: Clients don't need to change anything
- **Flexible**: Mix refundable and non-refundable options in same route
- **Deep Cloning**: All helpers return new objects, don't mutate originals

## API Reference

### `refundable(option: PaymentOption): PaymentOption`

Marks a payment option as refundable. Returns a new PaymentOption with the refund marker set.

### `withRefund(routes: RoutesConfig, factoryAddress: string, createxAddress?: string): RoutesConfig`

Processes route configuration to handle refundable payment options. Computes proxy addresses using CREATE3 and sets `payTo` to proxy for all refundable options.

### `settleWithRefundHelper(paymentPayload, paymentRequirements, signer): Promise<SettleResponse | null>`

Helper for facilitator operators to handle refund settlements via X402DepositRelayProxy. Returns `SettleResponse` on success, `null` if not applicable.

### `extractRefundInfo(paymentPayload, paymentRequirements): { factoryAddress: string; merchantPayouts: Record<string, string> } | null`

Extracts refund extension info from payment payload or requirements.

### `computeRelayAddress(createxAddress: string, factoryAddress: string, merchantPayout: string): string`

Computes the CREATE3 address for a merchant's relay proxy.

## Examples

See the [examples directory](../../examples/) for complete working examples:
- [Server Example](../../examples/server/) - Express.js server with refund-enabled endpoints
- [Facilitator Example](../../examples/facilitator/) - Facilitator with refund settlement handling

## License

BUSL-1.1
