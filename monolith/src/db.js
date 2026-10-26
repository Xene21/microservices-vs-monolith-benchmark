// One shared PostgreSQL database for every module of the monolith.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/monolith_db',
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
    );

    CREATE TABLE IF NOT EXISTS courses (
      code          TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      unit_load     INT  NOT NULL CHECK (unit_load BETWEEN 1 AND 6),
      semester      TEXT NOT NULL,
      prerequisites TEXT[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id    UUID NOT NULL REFERENCES users(id),
      course_code   TEXT NOT NULL REFERENCES courses(code),
      semester      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'registered',
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (student_id, course_code)
    );
    CREATE INDEX IF NOT EXISTS registrations_course_idx ON registrations (course_code);

    CREATE TABLE IF NOT EXISTS results (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id  UUID NOT NULL REFERENCES users(id),
      course_code TEXT NOT NULL,
      score       NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
      grade       CHAR(1) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (student_id, course_code)
    );
    CREATE INDEX IF NOT EXISTS results_course_idx ON results (course_code);

    CREATE TABLE IF NOT EXISTS invoices (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id  UUID NOT NULL REFERENCES users(id),
      amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      description TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS invoices_student_idx ON invoices (student_id);

    CREATE TABLE IF NOT EXISTS payments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id  UUID NOT NULL UNIQUE REFERENCES invoices(id),
      student_id  UUID NOT NULL REFERENCES users(id),
      amount_paid NUMERIC(12,2) NOT NULL,
      reference   TEXT NOT NULL,
      status      TEXT NOT NULL,
      paid_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payments_student_idx ON payments (student_id);
  `);
}

module.exports = { pool, initDb };
