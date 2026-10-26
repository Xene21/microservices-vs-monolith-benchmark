// Client for the external payment gateway (mocked in this study).
const { HttpError } = require('./http');

const PAYMENT_GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL || 'http://localhost:4000';
const TIMEOUT_MS = Number(process.env.PAYMENT_GATEWAY_TIMEOUT_MS || 5000);

async function chargeInvoice({ invoiceId, amount }) {
  let res;
  try {
    res = await fetch(`${PAYMENT_GATEWAY_URL}/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId, amount }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'Payment gateway unavailable');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) throw new HttpError(502, 'Payment gateway error');
  return body; // { status: 'success' | 'declined', reference, amount }
}

module.exports = { chargeInvoice };
