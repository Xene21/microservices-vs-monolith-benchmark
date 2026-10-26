// Auth Service: registration, login and user lookup.
// Data store: PostgreSQL (users table).
const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { authenticate, requireRole, signToken } = require('./shared/auth');
const { HttpError, errorHandler, notFound, requireFields, paging, retry } = require('./shared/http');
const { ROLES } = require('./shared/domain');

const PORT = Number(process.env.PORT || 3001);
const ADMIN_SIGNUP_KEY = process.env.ADMIN_SIGNUP_KEY || 'admin-key-change-me';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/auth_db',
  max: Number(process.env.DB_POOL_SIZE || 20),
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name     TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('student','lecturer','admin')),
      matric_number TEXT UNIQUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

const toUser = (r) => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  role: r.role,
  matricNumber: r.matric_number,
});

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'auth-service' });
});

// Register a user. Staff accounts (lecturer/admin) need the admin signup key.
app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password, matricNumber, adminKey } = req.body || {};
  const role = req.body?.role || 'student';
  requireFields(req.body, ['fullName', 'email', 'password']);
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
  if (role !== 'student' && adminKey !== ADMIN_SIGNUP_KEY) throw new HttpError(403, 'Invalid admin signup key');
  if (role === 'student' && !matricNumber) throw new HttpError(400, 'Students need a matricNumber');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, matric_number)
     VALUES ($1, lower($2), $3, $4, $5) RETURNING *`,
    [fullName, email, hash, role, role === 'student' ? matricNumber : null]
  );
  const user = toUser(rows[0]);
  res.status(201).json({ token: signToken(user), user });
});

app.post('/api/auth/login', async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const { rows } = await pool.query('SELECT * FROM users WHERE email = lower($1)', [req.body.email]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(String(req.body.password), row.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const user = toUser(row);
  res.json({ token: signToken(user), user });
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  res.json(toUser(rows[0]));
});

// Staff: list users, optionally filtered by role.
app.get('/api/auth/users', authenticate, requireRole('admin', 'lecturer'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const params = [limit, offset];
  let where = '';
  if (req.query.role) {
    params.push(req.query.role);
    where = 'WHERE role = $3';
  }
  const { rows } = await pool.query(
    `SELECT * FROM users ${where} ORDER BY created_at LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows.map(toUser));
});

app.use(notFound);
app.use(errorHandler);

retry(initDb, { label: 'auth-db connection' }).then(() => {
  app.listen(PORT, () => console.log(`auth-service listening on ${PORT}`));
});
