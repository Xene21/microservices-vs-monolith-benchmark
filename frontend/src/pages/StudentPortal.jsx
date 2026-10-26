import { useState } from 'react';
import { api, naira, useApi } from '../api';
import { Notice, Stat, Status, Table } from '../components';

export default function StudentPortal({ token, user, view, onNavigate }) {
  if (view === 'courses') return <Courses token={token} />;
  if (view === 'registrations') return <MyCourses token={token} />;
  if (view === 'results') return <Results token={token} />;
  if (view === 'fees') return <Fees token={token} />;
  return <Overview token={token} user={user} onNavigate={onNavigate} />;
}

function Overview({ token, user, onNavigate }) {
  const regs = useApi('/api/registrations/me', token);
  const courses = useApi('/api/courses', token);
  const results = useApi('/api/results/me', token);
  const invoices = useApi('/api/invoices/me', token);

  const courseByCode = Object.fromEntries((courses.data || []).map((c) => [c.code, c]));
  const registered = regs.data || [];
  const units = registered.reduce((sum, r) => sum + (courseByCode[r.courseCode]?.unitLoad || 0), 0);
  const scores = (results.data || []).map((r) => r.score);
  const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  const outstanding = (invoices.data || []).filter((i) => i.status === 'pending').reduce((sum, i) => sum + i.amount, 0);
  const firstName = user.fullName.split(' ')[0];

  return (
    <div className="stack-lg">
      <section className="hero">
        <h2>Welcome back, {firstName}.</h2>
        <p>Here is where your semester stands.</p>
      </section>

      {outstanding > 0 && (
        <div className="banner" role="status">
          <div>
            <strong>{naira(outstanding)} is outstanding</strong>
            <p>Pay your invoice to receive a receipt.</p>
          </div>
          <button onClick={() => onNavigate('fees')}>Go to fees</button>
        </div>
      )}

      <div className="stats">
        <Stat label="Courses registered" value={registered.length} />
        <Stat label="Registered units" value={units} />
        <Stat label="Average score" value={average} />
        <Stat label="Fees outstanding" value={naira(outstanding)} />
      </div>

      <section>
        <div className="section-head">
          <h3>Your courses</h3>
          <button className="secondary small" onClick={() => onNavigate('courses')}>Browse courses</button>
        </div>
        <Table
          headers={['Course', 'Title', 'Units', 'Status']}
          rows={registered.map((r) => [
            r.courseCode,
            courseByCode[r.courseCode]?.title || '—',
            courseByCode[r.courseCode]?.unitLoad ?? '—',
            <Status key="s" value={r.status} />,
          ])}
          empty="You have not registered for any courses yet. Browse the catalogue to get started."
        />
      </section>
    </div>
  );
}

function Courses({ token }) {
  const courses = useApi('/api/courses', token);
  const [picked, setPicked] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  const pickedUnits = (courses.data || [])
    .filter((c) => picked.includes(c.code))
    .reduce((sum, c) => sum + c.unitLoad, 0);

  async function register() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const r = await api('POST', '/api/registrations', { token, body: { courseCodes: picked } });
      setMessage(`You are registered for ${r.registered.length} course${r.registered.length === 1 ? '' : 's'}. Total units: ${r.totalUnits}.`);
      setPicked([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Notice tone="error">{courses.error || error}</Notice>
      <Notice tone="ok">{message}</Notice>
      <Table
        headers={['', 'Code', 'Title', 'Units', 'Semester', 'Prerequisites']}
        rows={(courses.data || []).map((c) => [
          <input
            key="pick"
            type="checkbox"
            aria-label={`Select ${c.code}`}
            checked={picked.includes(c.code)}
            onChange={() => toggle(c.code)}
          />,
          c.code,
          c.title,
          c.unitLoad,
          c.semester,
          c.prerequisites.join(', ') || 'None',
        ])}
        empty="The catalogue is empty right now."
      />
      {picked.length > 0 && (
        <div className="action-bar" role="region" aria-label="Registration">
          <span>
            {picked.length} selected · {pickedUnits} units
          </span>
          <button onClick={register} disabled={busy}>
            {busy ? 'Registering…' : 'Register selected courses'}
          </button>
        </div>
      )}
    </div>
  );
}

function MyCourses({ token }) {
  const { data, error } = useApi('/api/registrations/me', token);
  return (
    <div>
      <Notice tone="error">{error}</Notice>
      <Table
        headers={['Course', 'Semester', 'Status', 'Registered on']}
        rows={(data || []).map((r) => [
          r.courseCode,
          r.semester,
          <Status key="s" value={r.status} />,
          new Date(r.registeredAt).toLocaleDateString(),
        ])}
        empty="You have no registrations yet."
      />
    </div>
  );
}

function Results({ token }) {
  const { data, error } = useApi('/api/results/me', token);
  return (
    <div>
      <Notice tone="error">{error}</Notice>
      <Table
        headers={['Course', 'Score', 'Grade']}
        rows={(data || []).map((r) => [r.courseCode, r.score, <span key="g" className="grade">{r.grade}</span>])}
        empty="No results have been published for you yet."
      />
    </div>
  );
}

function Fees({ token }) {
  const invoices = useApi('/api/invoices/me', token);
  const payments = useApi('/api/payments/me', token);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(null);

  async function pay(invoiceId) {
    setError('');
    setMessage('');
    setPaying(invoiceId);
    try {
      const r = await api('POST', '/api/payments', { token, body: { invoiceId } });
      setMessage(`Payment of ${naira(r.amountPaid)} received. Reference: ${r.reference}`);
      invoices.reload();
      payments.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setPaying(null);
    }
  }

  return (
    <div className="stack-lg">
      <Notice tone="ok">{message}</Notice>
      <Notice tone="error">{error || invoices.error}</Notice>

      <section>
        <h3>Invoices</h3>
        <Table
          headers={['Description', 'Amount', 'Status', '']}
          rows={(invoices.data || []).map((i) => [
            i.description,
            naira(i.amount),
            <Status key="s" value={i.status} />,
            i.status === 'pending' ? (
              <button key="p" className="small" disabled={paying === i.id} onClick={() => pay(i.id)}>
                {paying === i.id ? 'Paying…' : 'Pay now'}
              </button>
            ) : (
              ''
            ),
          ])}
          empty="No invoices yet."
        />
      </section>

      <section>
        <h3>Receipts</h3>
        <Table
          headers={['Reference', 'Amount', 'Paid on']}
          rows={(payments.data || []).map((p) => [
            p.reference,
            naira(p.amountPaid),
            p.paidAt ? new Date(p.paidAt).toLocaleString() : '—',
          ])}
          empty="Receipts from your payments will appear here."
        />
      </section>
    </div>
  );
}
