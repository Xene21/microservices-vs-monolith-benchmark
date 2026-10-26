// Mock external payment gateway.
// Stands in for a provider such as Paystack so that load tests are repeatable
// and do not depend on a third-party network. Latency and failure rate are
// configurable so the same conditions apply to both architectures.
const crypto = require('node:crypto');
const express = require('express');

const PORT = Number(process.env.PORT || 4000);
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 150);
const FAILURE_RATE = Number(process.env.MOCK_FAILURE_RATE || 0); // 0..1

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'mock-payment-gateway' }));

app.post('/charge', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!req.body?.invoiceId || !(amount > 0)) {
    return res.status(400).json({ error: 'invoiceId and a positive amount are required' });
  }
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  if (Math.random() < FAILURE_RATE) {
    return res.status(402).json({ status: 'declined', reference: null, amount });
  }
  return res.json({
    status: 'success',
    reference: `MOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    amount,
  });
});

app.listen(PORT, () => console.log(`mock-payment-gateway listening on ${PORT} (latency ${LATENCY_MS}ms, failure rate ${FAILURE_RATE})`));
