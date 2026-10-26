import { useState } from 'react';
import { BACKEND_NAME } from './api';
import { Icon, navFor } from './components';
import Login from './pages/Login';
import StudentPortal from './pages/StudentPortal';
import StaffPortal from './pages/StaffPortal';

const KEY = 'portal-session';

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked. The app still works; the user just logs in again on refresh.
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [view, setView] = useState('dashboard');

  if (!session) {
    const onLogin = (s) => {
      saveSession(s);
      setView('dashboard');
      setSession(s);
    };
    return <Login onLogin={onLogin} />;
  }

  const { user, token } = session;
  const nav = navFor(user.role);
  const current = nav.find((n) => n.id === view) || nav[0];
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const logout = () => {
    saveSession(null);
    setSession(null);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">SP</span>
          <div>
            <strong>Student Portal</strong>
            <span className="brand-sub">{BACKEND_NAME} backend</span>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item${item.id === current.id ? ' active' : ''}`}
              aria-current={item.id === current.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <div className="who">
            <strong>{user.fullName}</strong>
            <span className="role">{user.role}</span>
          </div>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </aside>

      <main className="content">
        <header className="page-head">
          <h1>{current.label}</h1>
          <p>{current.subtitle}</p>
        </header>

        {user.role === 'student' ? (
          <StudentPortal token={token} user={user} view={current.id} onNavigate={setView} />
        ) : (
          <StaffPortal token={token} user={user} role={user.role} view={current.id} />
        )}
      </main>
    </div>
  );
}
