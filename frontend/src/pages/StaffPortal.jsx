import { useState } from 'react';
import { api, naira, useApi } from '../api';
import { Notice, Stat, Status, Table } from '../components';

// Lists students for dropdowns and tables. Limit 1000 is the backend maximum per page.
const useStudents = (token) => useApi('/api/auth/users?role=student&limit=1000', token);
const useCourses = (token) => useApi('/api/courses', token);

export default function StaffPortal({ token, user, role, view }) {
  if (view === 'results') return <UploadResult token={token} />;
  if (view === 'enrolment') return <Enrolment token={token} />;
  if (view === 'students') return <Students token={token} />;
  if (view === 'create-course') return <CreateCourse token={token} />;
  if (view === 'invoices') return <Invoices token={token} />;
  return <Overview token={token} user={user} role={role} />;
}

function Overview({ token, user, role }) {
  const students = useStudents(token);
  const courses = useCourses(token);
  return (
    <div className="stack-lg">
      <section className="hero">
        <h2>Welcome, {user.fullName.split(' ')[0]}.</h2>
        <p>Use the menu to upload results, check enrolment and manage the catalogue.</p>
      </section>
      <div className="stats">
        <Stat label="Student accounts" value={(students.data || []).length} />
        <Stat label="Courses in catalogue" value={(courses.data || []).length} />
        {role === 'admin' && <PendingInvoices token={token} />}
      </div>
    </div>
  );
}

function PendingInvoices({ token }) {
  const invoices = useApi('/api/invoices', token);
  const pending = (invoices.data || []).filter((i) => i.status === 'pending');
  const total = pending.reduce((sum, i) => sum + i.amount, 0);
  return <Stat label="Invoices unpaid" value={`${pending.length} · ${naira(total)}`} />;
}

function UploadResult({ token }) {
  const students = useStudents(token);
  const courses = useCourses(token);
  const [form, setForm] = useState({ studentId: '', courseCode: '', score: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const r = await api('POST', '/api/results', {
        token,
        body: { studentId: form.studentId, courseCode: form.courseCode, score: Number(form.score) },
      });
      setMessage(`Result saved. Grade ${r.grade} for a score of ${r.score}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="form-card stack">
      <label>
        Student
        <select required value={form.studentId} onChange={set('studentId')}>
          <option value="">Choose a student</option>
          {(students.data || []).map((s) => (
            <option key={s.id} value={s.id}>{s.fullName} ({s.matricNumber})</option>
          ))}
        </select>
      </label>
      <label>
        Course
        <select required value={form.courseCode} onChange={set('courseCode')}>
          <option value="">Choose a course</option>
          {(courses.data || []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title}</option>)}
        </select>
      </label>
      <label>
        Score (0 to 100)
        <input required type="number" min="0" max="100" value={form.score} onChange={set('score')} />
      </label>
      <Notice tone="error">{error}</Notice>
      <Notice tone="ok">{message}</Notice>
      <div>
        <button type="submit">Save result</button>
      </div>
    </form>
  );
}

function Enrolment({ token }) {
  const courses = useCourses(token);
  const [code, setCode] = useState('');
  const { data, error } = useApi(
    `/api/registrations?courseCode=${encodeURIComponent(code || 'none')}`,
    token
  );

  return (
    <div className="stack-lg">
      <label style={{ maxWidth: 420 }}>
        Course
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose a course</option>
          {(courses.data || []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title}</option>)}
        </select>
      </label>
      {code && (
        <section>
          <Notice tone="error">{error}</Notice>
          <h3>{(data || []).length} registered</h3>
          <Table
            headers={['Student ID', 'Status', 'Registered on']}
            rows={(data || []).slice(0, 200).map((r) => [
              r.studentId,
              <Status key="s" value={r.status} />,
              new Date(r.registeredAt).toLocaleDateString(),
            ])}
            empty="Nobody has registered for this course yet."
          />
        </section>
      )}
    </div>
  );
}

function Students({ token }) {
  const students = useStudents(token);
  const list = students.data || [];
  return (
    <div>
      <Notice tone="error">{students.error}</Notice>
      <Table
        headers={['Name', 'Email', 'Matric number']}
        rows={list.slice(0, 200).map((s) => [s.fullName, s.email, s.matricNumber])}
        empty="No student accounts yet."
      />
      {list.length > 200 && <p className="empty" style={{ marginTop: 12, border: 0, padding: 0 }}>Showing the first 200 of {list.length}.</p>}
    </div>
  );
}

function CreateCourse({ token }) {
  const [form, setForm] = useState({ code: '', title: '', unitLoad: '3', semester: 'first', prerequisites: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const prerequisites = form.prerequisites.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const c = await api('POST', '/api/courses', {
        token,
        body: { code: form.code, title: form.title, unitLoad: Number(form.unitLoad), semester: form.semester, prerequisites },
      });
      setMessage(`${c.code} has been added to the catalogue.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="form-card stack">
      <label>
        Course code
        <input required value={form.code} onChange={set('code')} />
      </label>
      <label>
        Title
        <input required value={form.title} onChange={set('title')} />
      </label>
      <label>
        Units
        <input required type="number" min="1" value={form.unitLoad} onChange={set('unitLoad')} />
      </label>
      <label>
        Semester
        <select value={form.semester} onChange={set('semester')}>
          <option value="first">First</option>
          <option value="second">Second</option>
        </select>
      </label>
      <label>
        Prerequisites (optional, comma-separated codes)
        <input value={form.prerequisites} onChange={set('prerequisites')} />
      </label>
      <Notice tone="error">{error}</Notice>
      <Notice tone="ok">{message}</Notice>
      <div>
        <button type="submit">Add course</button>
      </div>
    </form>
  );
}

function Invoices({ token }) {
  const students = useStudents(token);
  const invoices = useApi('/api/invoices', token);
  const [form, setForm] = useState({ studentId: '', amount: '45000', description: 'Tuition 2026/2027' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('POST', '/api/invoices', {
        token,
        body: { studentId: form.studentId, amount: Number(form.amount), description: form.description },
      });
      setMessage('Invoice issued.');
      invoices.reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack-lg">
      <form onSubmit={submit} className="form-card stack">
        <label>
          Student
          <select required value={form.studentId} onChange={set('studentId')}>
            <option value="">Choose a student</option>
            {(students.data || []).map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.matricNumber})</option>)}
          </select>
        </label>
        <label>
          Amount (₦)
          <input required type="number" min="1" value={form.amount} onChange={set('amount')} />
        </label>
        <label>
          Description
          <input value={form.description} onChange={set('description')} />
        </label>
        <Notice tone="error">{error}</Notice>
        <Notice tone="ok">{message}</Notice>
        <div>
          <button type="submit">Issue invoice</button>
        </div>
      </form>

      <section>
        <h3>All invoices</h3>
        <Notice tone="error">{invoices.error}</Notice>
        <Table
          headers={['Student ID', 'Description', 'Amount', 'Status']}
          rows={(invoices.data || []).slice(0, 200).map((i) => [
            i.studentId,
            i.description,
            naira(i.amount),
            <Status key="s" value={i.status} />,
          ])}
          empty="No invoices have been issued yet."
        />
      </section>
    </div>
  );
}
