// Results Service: lecturers upload scores, students view their results.
// Data store: PostgreSQL (results table).
const express = require('express');
const { Pool } = require('pg');
const { authenticate, requireRole } = require('./shared/auth');
const { HttpError, errorHandler, notFound, requireFields, paging, retry } = require('./shared/http');
const { gradeFor, PASSING_GRADES } = require('./shared/domain');

const PORT = Number(process.env.PORT || 3003);
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'internal-key-change-me';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/results_db',
  max: Number(process.env.DB_POOL_SIZE || 20),
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id  UUID NOT NULL,
      course_code TEXT NOT NULL,
      score       NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
      grade       CHAR(1) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (student_id, course_code)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS results_course_idx ON results (course_code)');
}

const toResult = (r) => ({
  id: r.id,
  studentId: r.student_id,
  courseCode: r.course_code,
  score: Number(r.score),
  grade: r.grade.trim(),
  updatedAt: r.updated_at.toISOString(),
});

function validScore(score) {
  const grade = gradeFor(score);
  if (!grade) throw new HttpError(400, 'score must be a number from 0 to 100');
  return grade;
}

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'results-service' });
});

// Student: own results.
app.get('/api/results/me', authenticate, requireRole('student'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM results WHERE student_id = $1 ORDER BY course_code',
    [req.user.id]
  );
  res.json(rows.map(toResult));
});

// Staff: list results, optionally for one course.
app.get('/api/results', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const params = [limit, offset];
  let where = '';
  if (req.query.courseCode) {
    params.push(String(req.query.courseCode).toUpperCase());
    where = 'WHERE course_code = $3';
  }
  const { rows } = await pool.query(
    `SELECT * FROM results ${where} ORDER BY course_code, student_id LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows.map(toResult));
});

// Staff: upload a score (creates or replaces the result for that student and course).
app.post('/api/results', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
  requireFields(req.body, ['studentId', 'courseCode', 'score']);
  const grade = validScore(req.body.score);
  const { rows } = await pool.query(
    `INSERT INTO results (student_id, course_code, score, grade)
     VALUES ($1, upper($2), $3, $4)
     ON CONFLICT (student_id, course_code)
     DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade, updated_at = now()
     RETURNING *`,
    [req.body.studentId, req.body.courseCode, req.body.score, grade]
  );
  res.status(201).json(toResult(rows[0]));
});

// Staff: edit an existing result.
app.put('/api/results/:id', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
  requireFields(req.body, ['score']);
  const grade = validScore(req.body.score);
  const { rows } = await pool.query(
    'UPDATE results SET score = $2, grade = $3, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id, req.body.score, grade]
  );
  if (!rows[0]) throw new HttpError(404, 'Result not found');
  res.json(toResult(rows[0]));
});

// Internal (service-to-service): courses a student has passed. Used by the
// Course Registration Service to check prerequisites. Not exposed by the gateway.
app.get('/internal/results/:studentId/passed', async (req, res) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) throw new HttpError(403, 'Internal endpoint');
  const { rows } = await pool.query(
    'SELECT course_code FROM results WHERE student_id = $1 AND grade = ANY($2)',
    [req.params.studentId, PASSING_GRADES]
  );
  res.json(rows.map((r) => r.course_code));
});

app.use(notFound);
app.use(errorHandler);

retry(initDb, { label: 'results-db connection' }).then(() => {
  app.listen(PORT, () => console.log(`results-service listening on ${PORT}`));
});
