// Results module (monolith). Same behaviour as the Results Service.
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../shared/auth');
const { HttpError, requireFields, paging } = require('../shared/http');
const { gradeFor } = require('../shared/domain');

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

const router = express.Router();

router.get('/me', authenticate, requireRole('student'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM results WHERE student_id = $1 ORDER BY course_code', [req.user.id]);
  res.json(rows.map(toResult));
});

router.get('/', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
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

router.post('/', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
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

router.put('/:id', authenticate, requireRole('lecturer', 'admin'), async (req, res) => {
  requireFields(req.body, ['score']);
  const grade = validScore(req.body.score);
  const { rows } = await pool.query(
    'UPDATE results SET score = $2, grade = $3, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id, req.body.score, grade]
  );
  if (!rows[0]) throw new HttpError(404, 'Result not found');
  res.json(toResult(rows[0]));
});

module.exports = router;
