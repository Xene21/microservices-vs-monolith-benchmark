// Course registration module (monolith). Same behaviour as the Course Registration Service,
// but the prerequisite check reads the results table directly instead of calling another service.
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../shared/auth');
const { HttpError, requireFields, paging } = require('../shared/http');
const { MAX_UNITS_PER_SEMESTER, PASSING_GRADES } = require('../shared/domain');

const toCourse = (c) => ({
  code: c.code,
  title: c.title,
  unitLoad: c.unit_load,
  semester: c.semester,
  prerequisites: c.prerequisites || [],
});

const toRegistration = (r) => ({
  id: r.id,
  studentId: r.student_id,
  courseCode: r.course_code,
  semester: r.semester,
  status: r.status,
  registeredAt: r.registered_at.toISOString(),
});

function courseFields(body) {
  const unitLoad = Number(body.unitLoad);
  if (!Number.isInteger(unitLoad) || unitLoad < 1 || unitLoad > 6) throw new HttpError(400, 'unitLoad must be an integer from 1 to 6');
  return {
    title: String(body.title),
    unitLoad,
    semester: String(body.semester),
    prerequisites: (body.prerequisites || []).map((p) => String(p).toUpperCase()),
  };
}

const router = express.Router();

router.get('/courses', authenticate, async (req, res) => {
  const { rows } = req.query.semester
    ? await pool.query('SELECT * FROM courses WHERE semester = $1 ORDER BY code', [String(req.query.semester)])
    : await pool.query('SELECT * FROM courses ORDER BY code');
  res.json(rows.map(toCourse));
});

router.get('/courses/:code', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM courses WHERE code = $1', [req.params.code.toUpperCase()]);
  if (!rows[0]) throw new HttpError(404, 'Course not found');
  res.json(toCourse(rows[0]));
});

router.post('/courses', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['code', 'title', 'unitLoad', 'semester']);
  const f = courseFields(req.body);
  const { rows } = await pool.query(
    'INSERT INTO courses (code, title, unit_load, semester, prerequisites) VALUES (upper($1), $2, $3, $4, $5) RETURNING *',
    [req.body.code, f.title, f.unitLoad, f.semester, f.prerequisites]
  );
  res.status(201).json(toCourse(rows[0]));
});

router.put('/courses/:code', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['title', 'unitLoad', 'semester']);
  const f = courseFields(req.body);
  const { rows } = await pool.query(
    'UPDATE courses SET title = $2, unit_load = $3, semester = $4, prerequisites = $5 WHERE code = $1 RETURNING *',
    [req.params.code.toUpperCase(), f.title, f.unitLoad, f.semester, f.prerequisites]
  );
  if (!rows[0]) throw new HttpError(404, 'Course not found');
  res.json(toCourse(rows[0]));
});

router.post('/registrations', authenticate, requireRole('student'), async (req, res) => {
  const codes = [...new Set((req.body?.courseCodes || []).map((c) => String(c).toUpperCase()))];
  if (!codes.length) throw new HttpError(400, 'courseCodes must be a non-empty array');

  const { rows: found } = await pool.query('SELECT * FROM courses WHERE code = ANY($1)', [codes]);
  const missing = codes.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw new HttpError(404, `Unknown course(s): ${missing.join(', ')}`);

  const { rows: existing } = await pool.query(
    'SELECT r.course_code, c.unit_load, c.semester FROM registrations r JOIN courses c ON c.code = r.course_code WHERE r.student_id = $1',
    [req.user.id]
  );
  const dupes = codes.filter((c) => existing.some((e) => e.course_code === c));
  if (dupes.length) throw new HttpError(409, `Already registered for: ${dupes.join(', ')}`);

  if (found.some((c) => c.prerequisites.length)) {
    const { rows: passedRows } = await pool.query(
      'SELECT course_code FROM results WHERE student_id = $1 AND grade = ANY($2)',
      [req.user.id, PASSING_GRADES]
    );
    const passed = passedRows.map((r) => r.course_code);
    const unmet = found.flatMap((c) => c.prerequisites.filter((p) => !passed.includes(p)).map((p) => `${c.code} needs ${p}`));
    if (unmet.length) throw new HttpError(422, `Prerequisites not met: ${unmet.join('; ')}`);
  }

  const unitsBySemester = {};
  for (const c of [...existing, ...found]) {
    unitsBySemester[c.semester] = (unitsBySemester[c.semester] || 0) + c.unit_load;
  }
  const over = Object.entries(unitsBySemester).filter(([, u]) => u > MAX_UNITS_PER_SEMESTER);
  if (over.length) {
    throw new HttpError(422, `Unit load exceeds ${MAX_UNITS_PER_SEMESTER} for semester ${over.map(([s, u]) => `${s} (${u})`).join(', ')}`);
  }

  const { rows: inserted } = await pool.query(
    `INSERT INTO registrations (student_id, course_code, semester)
     SELECT $1, c.code, c.semester FROM courses c WHERE c.code = ANY($2)
     RETURNING *`,
    [req.user.id, codes]
  );
  const totalUnits = [...existing, ...found].reduce((s, c) => s + c.unit_load, 0);
  res.status(201).json({ registered: inserted.map(toRegistration).sort((a, b) => a.courseCode.localeCompare(b.courseCode)), totalUnits });
});

router.get('/registrations/me', authenticate, requireRole('student'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM registrations WHERE student_id = $1 ORDER BY course_code', [req.user.id]);
  res.json(rows.map(toRegistration));
});

router.get('/registrations', authenticate, requireRole('admin', 'lecturer'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const params = [limit, offset];
  let where = '';
  if (req.query.courseCode) {
    params.push(String(req.query.courseCode).toUpperCase());
    where = 'WHERE course_code = $3';
  }
  const { rows } = await pool.query(
    `SELECT * FROM registrations ${where} ORDER BY course_code, student_id LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows.map(toRegistration));
});

module.exports = router;
