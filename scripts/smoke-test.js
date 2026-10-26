#!/usr/bin/env node
// End-to-end functional test of the API contract.
// Run it against either backend to show functional parity:
//   node scripts/smoke-test.js http://localhost:8080   (microservices, via the gateway)
//   node scripts/smoke-test.js http://localhost:3000   (monolith)
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_SIGNUP_KEY || 'admin-key-change-me';
const run = Date.now().toString(36).toUpperCase();

let passed = 0;
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}

async function main() {
  console.log(`Smoke test against ${BASE} (run ${run})\n`);

  const h = await call('GET', '/health');
  check('health endpoint responds', h.status === 200, h);

  // Accounts
  const admin = await call('POST', '/api/auth/register', {
    body: { fullName: 'Test Admin', email: `admin.${run}@test.edu`, password: 'secret123', role: 'admin', adminKey: ADMIN_KEY },
  });
  check('admin can register with admin key', admin.status === 201 && admin.data?.user?.role === 'admin', admin);
  const lecturer = await call('POST', '/api/auth/register', {
    body: { fullName: 'Test Lecturer', email: `lect.${run}@test.edu`, password: 'secret123', role: 'lecturer', adminKey: ADMIN_KEY },
  });
  check('lecturer can register', lecturer.status === 201, lecturer);
  const badStaff = await call('POST', '/api/auth/register', {
    body: { fullName: 'Fake Admin', email: `fake.${run}@test.edu`, password: 'secret123', role: 'admin', adminKey: 'wrong' },
  });
  check('staff signup without key is rejected (403)', badStaff.status === 403, badStaff);

  const regA = await call('POST', '/api/auth/register', {
    body: { fullName: 'Student A', email: `a.${run}@test.edu`, password: 'secret123', matricNumber: `A${run}` },
  });
  check('student A registers', regA.status === 201 && regA.data?.user?.role === 'student', regA);
  const regB = await call('POST', '/api/auth/register', {
    body: { fullName: 'Student B', email: `b.${run}@test.edu`, password: 'secret123', matricNumber: `B${run}` },
  });
  check('student B registers', regB.status === 201, regB);
  const dupEmail = await call('POST', '/api/auth/register', {
    body: { fullName: 'Student A again', email: `a.${run}@test.edu`, password: 'secret123', matricNumber: `A2${run}` },
  });
  check('duplicate email is rejected (409)', dupEmail.status === 409, dupEmail);

  const loginA = await call('POST', '/api/auth/login', { body: { email: `a.${run}@test.edu`, password: 'secret123' } });
  check('student A logs in', loginA.status === 200 && !!loginA.data?.token, loginA);
  const badLogin = await call('POST', '/api/auth/login', { body: { email: `a.${run}@test.edu`, password: 'wrongpass' } });
  check('wrong password is rejected (401)', badLogin.status === 401, badLogin);

  const tA = loginA.data?.token;
  const tB = regB.data?.token;
  const tAdmin = admin.data?.token;
  const tLect = lecturer.data?.token;
  const studentA = regA.data?.user;

  const me = await call('GET', '/api/auth/me', { token: tA });
  check('GET /api/auth/me returns the user', me.status === 200 && me.data?.id === studentA?.id, me);

  // Access control
  const noToken = await call('GET', '/api/courses');
  check('protected route without token is rejected (401)', noToken.status === 401, noToken);
  const badToken = await call('GET', '/api/courses', { token: 'not-a-real-token' });
  check('invalid token is rejected (401)', badToken.status === 401, badToken);

  // Course catalogue
  const P = `T${run.slice(-4)}`;
  const c101 = `${P}101`;
  const c201 = `${P}201`;
  const studentCourse = await call('POST', '/api/courses', { token: tA, body: { code: `${P}999`, title: 'Nope', unitLoad: 3, semester: 'first' } });
  check('student cannot create a course (403)', studentCourse.status === 403, studentCourse);
  const mk101 = await call('POST', '/api/courses', { token: tAdmin, body: { code: c101, title: 'Intro to Computing', unitLoad: 3, semester: 'first' } });
  check('admin creates a course', mk101.status === 201 && mk101.data?.code === c101, mk101);
  const mk201 = await call('POST', '/api/courses', {
    token: tAdmin,
    body: { code: c201, title: 'Data Structures', unitLoad: 3, semester: 'first', prerequisites: [c101] },
  });
  check('admin creates a course with a prerequisite', mk201.status === 201 && mk201.data?.prerequisites?.[0] === c101, mk201);
  const heavy = [];
  for (let i = 1; i <= 5; i += 1) {
    const code = `${P}H0${i}`;
    heavy.push(code);
    await call('POST', '/api/courses', { token: tAdmin, body: { code, title: `Heavy ${i}`, unitLoad: 6, semester: 'second' } });
  }
  const list = await call('GET', '/api/courses', { token: tA });
  check('catalogue lists the new courses', list.status === 200 && list.data.some((c) => c.code === c201), list.status);

  // Registration rules
  const prereq = await call('POST', '/api/registrations', { token: tA, body: { courseCodes: [c201] } });
  check('registration blocked when prerequisite not passed (422)', prereq.status === 422, prereq);
  const overload = await call('POST', '/api/registrations', { token: tA, body: { courseCodes: heavy } });
  check('registration blocked above the unit cap (422)', overload.status === 422, overload);
  const unknown = await call('POST', '/api/registrations', { token: tA, body: { courseCodes: ['NOPE000'] } });
  check('registration for unknown course is rejected (404)', unknown.status === 404, unknown);

  // Results
  const upload = await call('POST', '/api/results', { token: tLect, body: { studentId: studentA.id, courseCode: c101, score: 72 } });
  check('lecturer uploads a result; grade computed as A', upload.status === 201 && upload.data?.grade === 'A', upload);
  const studentUpload = await call('POST', '/api/results', { token: tA, body: { studentId: studentA.id, courseCode: c101, score: 100 } });
  check('student cannot upload results (403)', studentUpload.status === 403, studentUpload);
  const edit = await call('PUT', `/api/results/${upload.data?.id}`, { token: tLect, body: { score: 64 } });
  check('lecturer edits a result; grade becomes B', edit.status === 200 && edit.data?.grade === 'B', edit);
  const myResults = await call('GET', '/api/results/me', { token: tA });
  check('student sees own results', myResults.status === 200 && myResults.data?.[0]?.courseCode === c101, myResults);

  const reg = await call('POST', '/api/registrations', { token: tA, body: { courseCodes: [c201] } });
  check('registration succeeds once prerequisite is passed', reg.status === 201 && reg.data?.registered?.length === 1, reg);
  const again = await call('POST', '/api/registrations', { token: tA, body: { courseCodes: [c201] } });
  check('duplicate registration is rejected (409)', again.status === 409, again);
  const myRegs = await call('GET', '/api/registrations/me', { token: tA });
  check('student sees own registrations', myRegs.status === 200 && myRegs.data?.some((r) => r.courseCode === c201), myRegs);
  const report = await call('GET', `/api/registrations?courseCode=${c201}`, { token: tAdmin });
  check('admin enrolment report includes the student', report.status === 200 && report.data?.some((r) => r.studentId === studentA.id), report);

  // Fees
  const inv = await call('POST', '/api/invoices', { token: tAdmin, body: { studentId: studentA.id, amount: 45000, description: 'Tuition' } });
  check('admin generates an invoice', inv.status === 201 && inv.data?.status === 'pending', inv);
  const myInv = await call('GET', '/api/invoices/me', { token: tA });
  check('student sees the invoice', myInv.status === 200 && myInv.data?.some((i) => i.id === inv.data?.id), myInv);
  const stolen = await call('POST', '/api/payments', { token: tB, body: { invoiceId: inv.data?.id } });
  check("student cannot pay another student's invoice (404)", stolen.status === 404, stolen);
  const pay = await call('POST', '/api/payments', { token: tA, body: { invoiceId: inv.data?.id } });
  check('student pays the invoice; receipt returned', pay.status === 201 && /^MOCK-/.test(pay.data?.reference || ''), pay);
  const payTwice = await call('POST', '/api/payments', { token: tA, body: { invoiceId: inv.data?.id } });
  check('paying twice is rejected (409)', payTwice.status === 409, payTwice);
  const history = await call('GET', '/api/payments/me', { token: tA });
  check('payment history shows the payment', history.status === 200 && history.data?.length === 1 && history.data[0].amountPaid === 45000, history);
  const invAfter = await call('GET', '/api/invoices/me', { token: tA });
  check('invoice is now marked paid', invAfter.data?.find((i) => i.id === inv.data?.id)?.status === 'paid', invAfter);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err.message);
  process.exit(1);
});
