// Fee payment module (monolith). Same behaviour as the Fee Payment Service.
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../shared/auth');
const { HttpError, requireFields, paging } = require('../shared/http');
const { chargeInvoice } = require('../shared/payments');

const iso = (d) => (d ? d.toISOString() : null);

const toInvoice = (i) => ({
  id: i.id,
  studentId: i.student_id,
  amount: Number(i.amount),
  description: i.description,
  status: i.status,
  issuedAt: iso(i.issued_at),
  paidAt: iso(i.paid_at),
});

const toPayment = (p) => ({
  id: p.id,
  invoiceId: p.invoice_id,
  studentId: p.student_id,
  amountPaid: Number(p.amount_paid),
  reference: p.reference,
  status: p.status,
  paidAt: iso(p.paid_at),
});

const router = express.Router();

router.post('/invoices', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['studentId', 'amount']);
  const amount = Number(req.body.amount);
  if (!(amount > 0)) throw new HttpError(400, 'amount must be greater than 0');
  const { rows } = await pool.query(
    'INSERT INTO invoices (student_id, amount, description) VALUES ($1, $2, $3) RETURNING *',
    [req.body.studentId, amount, req.body.description || 'School fees']
  );
  res.status(201).json(toInvoice(rows[0]));
});

router.get('/invoices/me', authenticate, requireRole('student'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invoices WHERE student_id = $1 ORDER BY issued_at DESC', [req.user.id]);
  res.json(rows.map(toInvoice));
});

router.get('/invoices', authenticate, requireRole('admin'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const params = [limit, offset];
  let where = '';
  if (req.query.status) {
    params.push(String(req.query.status));
    where = 'WHERE status = $3';
  }
  const { rows } = await pool.query(
    `SELECT * FROM invoices ${where} ORDER BY issued_at DESC LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows.map(toInvoice));
});

router.post('/payments', authenticate, requireRole('student'), async (req, res) => {
  requireFields(req.body, ['invoiceId']);
  // Lock the invoice (pending -> processing) so it cannot be paid twice.
  const { rows: locked } = await pool.query(
    `UPDATE invoices SET status = 'processing'
     WHERE id = $1 AND student_id = $2 AND status = 'pending' RETURNING *`,
    [req.body.invoiceId, req.user.id]
  );
  const invoice = locked[0];
  if (!invoice) {
    const { rows } = await pool.query('SELECT status FROM invoices WHERE id = $1 AND student_id = $2', [req.body.invoiceId, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Invoice not found');
    throw new HttpError(409, `Invoice is already ${rows[0].status}`);
  }

  let charge;
  try {
    charge = await chargeInvoice({ invoiceId: invoice.id, amount: Number(invoice.amount) });
  } catch (err) {
    await pool.query("UPDATE invoices SET status = 'pending' WHERE id = $1", [invoice.id]);
    throw err;
  }
  if (charge.status !== 'success') {
    await pool.query("UPDATE invoices SET status = 'pending' WHERE id = $1", [invoice.id]);
    throw new HttpError(402, 'Payment declined by gateway');
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `INSERT INTO payments (invoice_id, student_id, amount_paid, reference, status)
       VALUES ($1, $2, $3, $4, 'success') RETURNING *`,
      [invoice.id, req.user.id, invoice.amount, charge.reference]
    );
    await db.query("UPDATE invoices SET status = 'paid', paid_at = $2 WHERE id = $1", [invoice.id, rows[0].paid_at]);
    await db.query('COMMIT');
    res.status(201).json(toPayment(rows[0]));
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
});

router.get('/payments/me', authenticate, requireRole('student'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY paid_at DESC', [req.user.id]);
  res.json(rows.map(toPayment));
});

module.exports = router;
