// Course Registration Service: course catalogue and student registrations.
// Data store: MongoDB (courses and registrations collections).
const crypto = require('node:crypto');
const express = require('express');
const { MongoClient } = require('mongodb');
const { authenticate, requireRole } = require('./shared/auth');
const { HttpError, errorHandler, notFound, requireFields, paging, retry } = require('./shared/http');
const { MAX_UNITS_PER_SEMESTER } = require('./shared/domain');

const PORT = Number(process.env.PORT || 3002);
const RESULTS_SERVICE_URL = process.env.RESULTS_SERVICE_URL || 'http://localhost:3003';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'internal-key-change-me';

const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017', {
  maxPoolSize: Number(process.env.DB_POOL_SIZE || 20),
});
let courses;
let registrations;

async function initDb() {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'course_db');
  courses = db.collection('courses');
  registrations = db.collection('registrations');
  await registrations.createIndex({ studentId: 1, courseCode: 1 }, { unique: true });
  await registrations.createIndex({ courseCode: 1 });
}

const toCourse = (c) => ({
  code: c._id,
  title: c.title,
  unitLoad: c.unitLoad,
  semester: c.semester,
  prerequisites: c.prerequisites || [],
});

const toRegistration = (r) => ({
  id: r._id,
  studentId: r.studentId,
  courseCode: r.courseCode,
  semester: r.semester,
  status: r.status,
  registeredAt: r.registeredAt.toISOString(),
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

// Inter-service call: which courses has this student passed?
async function passedCourses(studentId) {
  try {
    const res = await fetch(`${RESULTS_SERVICE_URL}/internal/results/${studentId}/passed`, {
      headers: { 'x-internal-key': INTERNAL_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch {
    throw new HttpError(503, 'Results service unavailable; cannot check prerequisites');
  }
}

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  await client.db('admin').command({ ping: 1 });
  res.json({ status: 'ok', service: 'course-service' });
});

// Course catalogue (any signed-in user).
app.get('/api/courses', authenticate, async (req, res) => {
  const filter = req.query.semester ? { semester: String(req.query.semester) } : {};
  const list = await courses.find(filter).sort({ _id: 1 }).toArray();
  res.json(list.map(toCourse));
});

app.get('/api/courses/:code', authenticate, async (req, res) => {
  const course = await courses.findOne({ _id: req.params.code.toUpperCase() });
  if (!course) throw new HttpError(404, 'Course not found');
  res.json(toCourse(course));
});

// Admin: manage the catalogue.
app.post('/api/courses', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['code', 'title', 'unitLoad', 'semester']);
  const doc = { _id: String(req.body.code).toUpperCase(), ...courseFields(req.body) };
  await courses.insertOne(doc);
  res.status(201).json(toCourse(doc));
});

app.put('/api/courses/:code', authenticate, requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['title', 'unitLoad', 'semester']);
  const updated = await courses.findOneAndUpdate(
    { _id: req.params.code.toUpperCase() },
    { $set: courseFields(req.body) },
    { returnDocument: 'after' }
  );
  if (!updated) throw new HttpError(404, 'Course not found');
  res.json(toCourse(updated));
});

// Student: register for one or more courses.
// Checks: courses exist, not already registered, prerequisites passed, unit cap.
app.post('/api/registrations', authenticate, requireRole('student'), async (req, res) => {
  const codes = [...new Set((req.body?.courseCodes || []).map((c) => String(c).toUpperCase()))];
  if (!codes.length) throw new HttpError(400, 'courseCodes must be a non-empty array');

  const found = await courses.find({ _id: { $in: codes } }).toArray();
  const missing = codes.filter((c) => !found.some((f) => f._id === c));
  if (missing.length) throw new HttpError(404, `Unknown course(s): ${missing.join(', ')}`);

  const existing = await registrations.find({ studentId: req.user.id }).toArray();
  const dupes = codes.filter((c) => existing.some((e) => e.courseCode === c));
  if (dupes.length) throw new HttpError(409, `Already registered for: ${dupes.join(', ')}`);

  if (found.some((c) => (c.prerequisites || []).length)) {
    const passed = await passedCourses(req.user.id);
    const unmet = found.flatMap((c) => (c.prerequisites || []).filter((p) => !passed.includes(p)).map((p) => `${c._id} needs ${p}`));
    if (unmet.length) throw new HttpError(422, `Prerequisites not met: ${unmet.join('; ')}`);
  }

  // Unit cap is checked per semester.
  const unitsBySemester = {};
  const existingCodes = existing.map((e) => e.courseCode);
  const existingCourses = existingCodes.length ? await courses.find({ _id: { $in: existingCodes } }).toArray() : [];
  for (const c of [...existingCourses, ...found]) {
    unitsBySemester[c.semester] = (unitsBySemester[c.semester] || 0) + c.unitLoad;
  }
  const over = Object.entries(unitsBySemester).filter(([, u]) => u > MAX_UNITS_PER_SEMESTER);
  if (over.length) {
    throw new HttpError(422, `Unit load exceeds ${MAX_UNITS_PER_SEMESTER} for semester ${over.map(([s, u]) => `${s} (${u})`).join(', ')}`);
  }

  const now = new Date();
  const docs = found.map((c) => ({
    _id: crypto.randomUUID(),
    studentId: req.user.id,
    courseCode: c._id,
    semester: c.semester,
    status: 'registered',
    registeredAt: now,
  }));
  await registrations.insertMany(docs);
  const totalUnits = [...existingCourses, ...found].reduce((s, c) => s + c.unitLoad, 0);
  res.status(201).json({ registered: docs.map(toRegistration), totalUnits });
});

app.get('/api/registrations/me', authenticate, requireRole('student'), async (req, res) => {
  const list = await registrations.find({ studentId: req.user.id }).sort({ courseCode: 1 }).toArray();
  res.json(list.map(toRegistration));
});

// Staff: enrolment report, optionally for one course.
app.get('/api/registrations', authenticate, requireRole('admin', 'lecturer'), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const filter = req.query.courseCode ? { courseCode: String(req.query.courseCode).toUpperCase() } : {};
  const list = await registrations.find(filter).sort({ courseCode: 1, studentId: 1 }).skip(offset).limit(limit).toArray();
  res.json(list.map(toRegistration));
});

app.use(notFound);
app.use(errorHandler);

retry(initDb, { label: 'course-db connection' }).then(() => {
  app.listen(PORT, () => console.log(`course-service listening on ${PORT}`));
});
