#!/usr/bin/env node
// Loads the same test data into either backend through the public API,
// so both databases start from identical content before load testing.
//
//   node scripts/seed.js http://localhost:8080 --students 200
//   node scripts/seed.js http://localhost:3000 --students 200
//
// Writes scripts/output/students-<host>-<port>.csv (email,password,studentId,invoiceId)
// for the JMeter test plans to read.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const STUDENTS = opt('students', 200);
const CONCURRENCY = opt('concurrency', 10);
const ADMIN_KEY = process.env.ADMIN_SIGNUP_KEY || 'admin-key-change-me';
const PASSWORD = 'Password123';

// 100-level courses have no prerequisites; 200-level courses require the matching 100-level course.
// Course titles follow a typical Computer Science programme. Replace them with
// your department's handbook list if you want the catalogue to match it exactly.
const COURSES = [
  ['CSC101', 'Introduction to Computer Science', 3, 'first', []],
  ['CSC103', 'Introduction to Programming I', 3, 'first', []],
  ['MTH101', 'Elementary Mathematics I', 3, 'first', []],
  ['PHY101', 'General Physics I', 3, 'first', []],
  ['STA101', 'Introduction to Probability and Statistics', 2, 'first', []],
  ['GST101', 'Use of English', 2, 'first', []],
  ['GST103', 'Nigerian Peoples and Culture', 2, 'first', []],
  ['CSC201', 'Data Structures and Algorithms', 3, 'second', ['CSC103']],
  ['CSC202', 'Computer Architecture', 3, 'second', ['CSC101']],
  ['CSC203', 'Discrete Mathematics for Computing', 3, 'second', []],
  ['CSC204', 'Operating Systems I', 3, 'second', ['CSC101']],
  ['MTH201', 'Linear Algebra', 3, 'second', ['MTH101']],
  ['STA201', 'Probability Theory', 2, 'second', ['STA101']],
  ['GST102', 'Philosophy, Logic and Human Existence', 2, 'second', []],
];

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Register, or log in if the account already exists (makes the script re-runnable).
async function account(body) {
  const r = await call('POST', '/api/auth/register', { body });
  if (r.status === 201) return r.data;
  if (r.status === 409) {
    const l = await call('POST', '/api/auth/login', { body: { email: body.email, password: body.password } });
    if (l.status === 200) return l.data;
  }
  throw new Error(`Could not create ${body.email}: ${r.status} ${JSON.stringify(r.data)}`);
}

async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, items.length)}/${items.length}`);
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  console.log(`Seeding ${BASE} with ${STUDENTS} students`);
  const admin = await account({ fullName: 'Portal Admin', email: 'admin@portal.test', password: PASSWORD, role: 'admin', adminKey: ADMIN_KEY });
  const lecturer = await account({ fullName: 'Dr Lecturer', email: 'lecturer@portal.test', password: PASSWORD, role: 'lecturer', adminKey: ADMIN_KEY });

  console.log('Courses');
  for (const [code, title, unitLoad, semester, prerequisites] of COURSES) {
    const r = await call('POST', '/api/courses', { token: admin.token, body: { code, title, unitLoad, semester, prerequisites } });
    if (![201, 409].includes(r.status)) throw new Error(`Course ${code}: ${r.status} ${JSON.stringify(r.data)}`);
  }

  console.log('Students');
  const ids = Array.from({ length: STUDENTS }, (_, i) => String(i + 1).padStart(4, '0'));
  const students = await inBatches(ids, (n) =>
    account({ fullName: `Student ${n}`, email: `student${n}@portal.test`, password: PASSWORD, matricNumber: `23${n}` })
  );

  // Every student has passed (or failed) the first-semester courses, so
  // second-semester registration exercises the prerequisite check.
  console.log('First-semester results');
  const firstSem = COURSES.filter((c) => c[3] === 'first').map((c) => c[0]);
  await inBatches(students, async (s, idx) => {
    for (const [k, code] of firstSem.entries()) {
      const seq = Number(s.user.matricNumber.slice(2)); // the last four digits of the matric number
      const score = 35 + ((seq + k * 7) % 60); // deterministic, 35-94
      await call('POST', '/api/results', { token: lecturer.token, body: { studentId: s.user.id, courseCode: code, score } });
    }
    return idx;
  });

  console.log('Invoices');
  const invoices = await inBatches(students, async (s) => {
    const mine = await call('GET', '/api/invoices/me', { token: s.token });
    const pending = (mine.data || []).find((i) => i.status === 'pending');
    if (pending) return pending.id;
    const r = await call('POST', '/api/invoices', { token: admin.token, body: { studentId: s.user.id, amount: 45000, description: 'Tuition 2026/2027' } });
    return r.data?.id;
  });

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const { hostname, port } = new URL(BASE);
  const file = path.join(outDir, `students-${hostname}-${port || 80}.csv`);
  const lines = ['email,password,studentId,invoiceId', ...students.map((s, i) => `${s.user.email},${PASSWORD},${s.user.id},${invoices[i]}`)];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`Done. Wrote ${students.length} student credentials to ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});