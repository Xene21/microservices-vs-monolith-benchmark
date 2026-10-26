// Fee Payment Service: invoices and payments.
// Data store: MongoDB (invoices and payments collections).
// Talks to the external payment gateway (a mock in this study).
const crypto = require('node:crypto');
const express = require('express');
const { MongoClient } = require('mongodb');
const { authenticate, requireRole } = require('./shared/auth');
const { HttpError, errorHandler, notFound, requireFields, paging, retry } = require('./shared/http');
const { chargeInvoice } = require('./shared/payments');

const PORT = Number(process.env.PORT || 3004);

const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017', {
  maxPoolSize: Number(process.env.DB_POOL_SIZE || 20),
});
let invoices;
let payments;

async function initDb() {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'payment_db');
  invoices = db.collection('invoices');
  payments = db.collection('payments');
  await invoices.createIndex({ studentId: 1 });
  await payments.createIndex({ studentId: 1 });
  await payments.createIndex({ invoiceId: 1 }, { unique: true });
}

const iso = (d) => (d ? d.toISOString() : null);

const toInvoice = (i) => ({
  id: i._id,
  studentId: i.studentId,
  amount: i.amount,
  description: i.description,
  status: i.status,
  issuedAt: iso(i.issuedAt),
  paidAt: iso(i.paidAt),
});

const toPayment = (p) => ({
  id: p._id,
  invoiceId: p.invoiceId,
  studentId: p.studentId,
  amountPaid: p.amountPaid,
  reference: p.reference,
  status: p.status,
  paidAt: iso(p.paidAt),
});

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  await client.db('admin').command({ ping: 1 });
  res.json({ status: 'ok', service: 'payment-service' });
});

// Admin: generate an invoice for a student.
app.post('/api/invoices', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['studentId', 'amount']);
  const amount = Number(req.body.amount);
  if (!(amount > 0)) throw new HttpError(400, 'amount must be greater than 0');
  const doc = {
    _id: crypto.randomUUID(),
    studentId: String(req.body.studentId),
    amount,
    description: req.body.description || 'School fees',
    status: 'pending',
    issuedAt: new Date(),
    paidAt: null,
  };
  await invoices.insertOne(doc);
  res.status(201).json(toInvoice(doc));
});

app.get('/api/invoices/me', authenticate, requireRole('student'), async (req, res) => {
  const list = await invoices.find({ studentId: req.user.id }).sort({ issuedAt: -1 }).toArray();
  res.json(list.map(toInvoice));
});

app.get('/api/invoices', authenticate, requireRole('admin'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const list = await invoices.find(filter).sort({ issuedAt: -1 }).skip(offset).limit(limit).toArray();
  res.json(list.map(toInvoice));
});

// Student: pay an invoice.
// The invoice is locked (pending -> processing) before charging so it cannot be paid twice.
app.post('/api/payments', authenticate, requireRole('student'), async (req, res) => {
  requireFields(req.body, ['invoiceId']);
  const invoice = await invoices.findOneAndUpdate(
    { _id: req.body.invoiceId, studentId: req.user.id, status: 'pending' },
    { $set: { status: 'processing' } },
    { returnDocument: 'after' }
  );
  if (!invoice) {
    const exists = await invoices.findOne({ _id: req.body.invoiceId, studentId: req.user.id });
    if (!exists) throw new HttpError(404, 'Invoice not found');
    throw new HttpError(409, `Invoice is already ${exists.status}`);
  }

  let charge;
  try {
    charge = await chargeInvoice({ invoiceId: invoice._id, amount: invoice.amount });
  } catch (err) {
    await invoices.updateOne({ _id: invoice._id }, { $set: { status: 'pending' } });
    throw err;
  }
  if (charge.status !== 'success') {
    await invoices.updateOne({ _id: invoice._id }, { $set: { status: 'pending' } });
    throw new HttpError(402, 'Payment declined by gateway');
  }

  const paidAt = new Date();
  const payment = {
    _id: crypto.randomUUID(),
    invoiceId: invoice._id,
    studentId: req.user.id,
    amountPaid: invoice.amount,
    reference: charge.reference,
    status: 'success',
    paidAt,
  };
  await payments.insertOne(payment);
  await invoices.updateOne({ _id: invoice._id }, { $set: { status: 'paid', paidAt } });
  res.status(201).json(toPayment(payment));
});

app.get('/api/payments/me', authenticate, requireRole('student'), async (req, res) => {
  const list = await payments.find({ studentId: req.user.id }).sort({ paidAt: -1 }).toArray();
  res.json(list.map(toPayment));
});

app.use(notFound);
app.use(errorHandler);

retry(initDb, { label: 'payment-db connection' }).then(() => {
  app.listen(PORT, () => console.log(`payment-service listening on ${PORT}`));
});
