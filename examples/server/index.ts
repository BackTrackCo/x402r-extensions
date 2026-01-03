import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { refundable, withRefund } from "@x402r/extensions/refund";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

config();

// Configuration - validate required environment variables
const evmAddress = process.env.EVM_ADDRESS as `0x${string}`;
if (!evmAddress) {
  console.error("Missing EVM_ADDRESS");
  process.exit(1);
}

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("Missing FACILITATOR_URL");
  process.exit(1);
}

const factoryAddress = process.env.X402_DEPOSIT_RELAY_FACTORY_ADDRESS as `0x${string}`;
if (!factoryAddress) {
  console.error("Missing X402_DEPOSIT_RELAY_FACTORY_ADDRESS");
  process.exit(1);
}

const app = express();

// CORS middleware - expose payment headers and allow cross-origin requests
app.use((req, res, next) => {
  const existingExposed = res.getHeader("Access-Control-Expose-Headers") as string | undefined;
  const exposedHeaders = existingExposed
    ? `${existingExposed}, PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE`
    : "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE";

  res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Payment, x-payment, PAYMENT-SIGNATURE, payment-signature, Payment-Signature");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

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

// Route configuration with payment requirements
// Use refundable() to mark payment options that support refunds and dispute resolution
const routes = {
  "GET /weather": {
    accepts: [
      // Refundable option - will be routed to DepositRelay
      refundable({
        scheme: "exact",
        price: "$0.001",
        network: network,
        payTo: evmAddress, // Merchant address (stored in extra, will receive funds after escrow)
      }),
      // Non-refundable option - works normally
      {
        scheme: "exact",
        price: "$0.001",
        network: network,
        payTo: evmAddress,
      },
    ],
    description: "Weather data (refundable option available)",
    mimeType: "application/json",
  },
  "GET /premium": {
    accepts: refundable({
      scheme: "exact",
      price: "$0.01",
      network: network,
      payTo: evmAddress,
    }),
    description: "Premium content (refundable)",
    mimeType: "application/json",
  },
};

// Process routes with refund helper - routes refundable payments to DepositRelay
const processedRoutes = withRefund(routes, factoryAddress);

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "x402 Refund Server",
    testnet: true,
  })
  .build();

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme(),
);

// Response logging middleware - log 402 payment failures
app.use((req, res, next) => {
  const originalSend = res.send;
  const originalJson = res.json;
  let hasLoggedResponse = false;

  const logResponse = (body: any) => {
    if (hasLoggedResponse) return;
    hasLoggedResponse = true;
    
    if (res.statusCode === 402) {
      // Skip logging HTML responses (paywall UI)
      if (typeof body === "string" && (body.trim().startsWith("<!DOCTYPE") || body.trim().startsWith("<html"))) {
        return;
      }

      let errorBody: any = body;
      
      if (typeof body === "string") {
        if (body.startsWith("{")) {
          try {
            errorBody = JSON.parse(body);
          } catch {
            errorBody = body.substring(0, 200);
          }
        } else {
          errorBody = body.substring(0, 200);
        }
      }

      const errorMessage = errorBody?.error || errorBody?.details || (typeof errorBody === "string" ? errorBody : "Payment required");
      const details = errorBody?.details;

      console.error(`402 Payment Failed: ${req.method} ${req.path}`, {
        error: errorMessage,
        ...(details && details !== errorMessage && { details }),
      });
    }
  };

  res.send = function (body: any) {
    logResponse(body);
    return originalSend.call(this, body);
  };

  res.json = function (body: any) {
    logResponse(body);
    return originalJson.call(this, body);
  };

  next();
});

app.use(paymentMiddleware(
  processedRoutes,
  resourceServer,
  undefined,
  paywall,
) as unknown as express.RequestHandler);

// Example endpoints
app.get("/weather", (req, res) => {
  res.send({
    report: {
      weather: "sunny",
      temperature: 70,
      note: "This endpoint has both refundable and non-refundable payment options",
    },
  });
});

app.get("/premium", (req, res) => {
  res.send({
    content: "This is premium content protected by refund-enabled payments",
    note: "Payments go through DepositRelay into escrow for dispute resolution",
  });
});

const PORT = process.env.PORT || "4021";
app.listen(parseInt(PORT), () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
