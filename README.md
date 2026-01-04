# x402r-extensions

x402 refund extension - standalone repository for the x402 payment protocol refund functionality.

## Overview

This repository contains the refund extension for x402, which enables merchants to route payments to DepositRelay contracts via escrow, providing refund and dispute resolution capabilities.

## Packages

- **[@x402r/extensions/refund](./packages/refund/)** - Main refund extension package (published to npm)

## Examples

- **[Server Example](./examples/server/)** - Express.js server demonstrating refund-enabled payments
- **[Facilitator Example](./examples/facilitator/)** - Facilitator server demonstrating refund settlement handling

## Installation

### Install the Package

```bash
npm install @x402r/extensions
# or
pnpm add @x402r/extensions
# or
yarn add @x402r/extensions
```

Then import from the subpath:
```typescript
import { refundable, withRefund } from '@x402r/extensions/refund';
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install @x402/core @x402/evm
```

## Quick Start

### For Merchants (Server-Side)

```typescript
import { refundable, withRefund } from '@x402r/extensions/refund';

// Mark payment options as refundable
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
```

### For Facilitators

```typescript
import { settleWithRefundHelper } from '@x402r/extensions/refund';

facilitator.onBeforeSettle(async (context) => {
  const result = await settleWithRefundHelper(
    context.paymentPayload,
    context.paymentRequirements,
    signer,
  );

  if (result) {
    return { abort: true, reason: 'handled_by_refund_helper' };
  }

  return null; // Proceed with normal settlement
});
```

## Documentation

- [Package Documentation](./packages/refund/README.md) - Full API documentation
- [Server Example](./examples/server/README.md) - Server-side usage example
- [Facilitator Example](./examples/facilitator/README.md) - Facilitator-side usage example

## Migration from @x402/extensions/refund

If you're migrating from `@x402/extensions/refund`, simply update your imports:

```typescript
// Before
import { refundable } from '@x402/extensions/refund';

// After
import { refundable } from '@x402r/extensions/refund';
```

The API remains the same, so no other code changes are needed.

## Development

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Run examples
cd examples/server
pnpm dev
```

## License

BUSL-1.1
