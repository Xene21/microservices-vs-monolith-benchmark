// Shared pieces: navigation, icons, status pills, stats, tables and notices.

export const NAV = {
  student: [
    { id: 'dashboard', label: 'Overview', subtitle: 'Your semester at a glance.', icon: 'home' },
    { id: 'courses', label: 'Course registration', subtitle: 'Browse the catalogue and register for courses.', icon: 'book' },
    { id: 'registrations', label: 'My courses', subtitle: 'Courses you are registered for.', icon: 'list' },
    { id: 'results', label: 'Results', subtitle: 'Scores and grades published for you.', icon: 'chart' },
    { id: 'fees', label: 'Fees and receipts', subtitle: 'Invoices, payments and receipts.', icon: 'wallet' },
  ],
  lecturer: [
    { id: 'dashboard', label: 'Overview', subtitle: 'Your courses and students.', icon: 'home' },
    { id: 'results', label: 'Upload results', subtitle: 'Record or correct a student’s score.', icon: 'edit' },
    { id: 'enrolment', label: 'Enrolment', subtitle: 'See who is registered for a course.', icon: 'list' },
    { id: 'students', label: 'Students', subtitle: 'All student accounts.', icon: 'users' },
  ],
  admin: [
    { id: 'dashboard', label: 'Overview', subtitle: 'The portal at a glance.', icon: 'home' },
    { id: 'results', label: 'Upload results', subtitle: 'Record or correct a student’s score.', icon: 'edit' },
    { id: 'enrolment', label: 'Enrolment', subtitle: 'See who is registered for a course.', icon: 'list' },
    { id: 'students', label: 'Students', subtitle: 'All student accounts.', icon: 'users' },
    { id: 'create-course', label: 'Create course', subtitle: 'Add a course to the catalogue.', icon: 'plus' },
    { id: 'invoices', label: 'Invoices', subtitle: 'Issue fee invoices and see payment status.', icon: 'receipt' },
  ],
};

export function navFor(role) {
  return NAV[role] || NAV.student;
}

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  wallet: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H19v4M3 7.5V18a2 2 0 0 0 2 2h14v-4M3 7.5h16M17 14.5h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  plus: 'M12 5v14M5 12h14',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// Each status has a word as well as a colour, so it reads without colour.
const TONES = {
  pending: 'amber',
  processing: 'blue',
  paid: 'green',
  registered: 'green',
  confirmed: 'green',
  declined: 'red',
};

export function Status({ value }) {
  return <span className={`pill ${TONES[value] || 'neutral'}`}>{value}</span>;
}

export function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}

export function Notice({ tone = 'ok', children }) {
  if (!children) return null;
  return <p className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}

export function Table({ headers, rows, empty }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => <td key={j}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
