import { useEffect, useState } from 'react';
import { VaultProvider, useVault } from './vault/VaultContext.jsx';
import LoginScreen from './vault/LoginScreen.jsx';
import Tabs from './components/Tabs.jsx';
import CalendarApp from './apps/Calendar.jsx';
import RemoteRotationApp from './apps/RemoteRotation.jsx';
import TasksApp from './apps/Tasks.jsx';
import InvoicesApp from './apps/Invoices.jsx';
import KnowledgeApp from './apps/Knowledge.jsx';
import ResumeApp from './apps/Resume.jsx';

const TABS = [
  { id: 'calendar', label: 'Calendar', icon: '📅', Component: CalendarApp },
  { id: 'remote', label: 'Remote Rotation', icon: '🗓️', Component: RemoteRotationApp },
  { id: 'tasks', label: 'Tasks', icon: '✅', Component: TasksApp },
  { id: 'knowledge', label: 'Knowledge', icon: '🧠', Component: KnowledgeApp },
  { id: 'resume', label: 'Resume', icon: '📄', Component: ResumeApp },
  { id: 'invoices', label: 'Invoices', icon: '🧾', Component: InvoicesApp }
];

function RecoveryCodeModal() {
  const { pendingRecoveryCode, dismissRecoveryCode } = useVault();
  const [copied, setCopied] = useState(false);
  if (!pendingRecoveryCode) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pendingRecoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2 style={{ margin: 0 }}>🔑 Save your recovery code</h2>
        <p className="hint">
          Write this down somewhere safe. It is the <strong>only</strong> way to recover your
          data if you forget your password. We cannot show it again.
        </p>
        <div className="recovery-code">{pendingRecoveryCode}</div>
        <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <button onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
          <button className="primary" onClick={dismissRecoveryCode}>
            I saved it — continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const { changePassword } = useVault();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setErr('New passwords do not match.'); return; }
    if (next === cur) { setErr('New password must differ from the current one.'); return; }
    setBusy(true);
    try {
      await changePassword(cur, next);
      setDone(true);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ margin: 0 }}>🔑 Change password</h2>
        {done ? (
          <>
            <p className="hint" style={{ color: 'var(--ok)' }}>
              Password changed. Your old password no longer works — for sign-in or decryption —
              so anywhere it was exposed is now harmless.
            </p>
            <button type="button" className="primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="hint">
              Re-encrypts your vault key under a new password and updates your sign-in.
              Your data is preserved and your recovery code stays valid.
            </p>
            <input type="password" autoComplete="current-password" placeholder="Current password"
              value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus />
            <input type="password" autoComplete="new-password" placeholder="New password (min 8 chars)"
              value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
            <input type="password" autoComplete="new-password" placeholder="Confirm new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            {err && <div className="err">{err}</div>}
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Shell() {
  const { unlocked, lock, signOut, session, authReady, autoLockMin, setAutoLockMin } = useVault();
  const [active, setActive] = useState(() => localStorage.getItem('mytools.activeTab') || 'calendar');
  const [theme, setTheme] = useState(() => localStorage.getItem('mytools.theme') || 'dark');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mytools.theme', theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem('mytools.activeTab', active); }, [active]);

  if (!authReady) {
    return <div className="login-wrap"><div className="muted">Loading…</div></div>;
  }

  if (!unlocked) {
    return (
      <>
        <LoginScreen />
        <RecoveryCodeModal />
      </>
    );
  }

  const Active = TABS.find((t) => t.id === active)?.Component || (() => null);

  return (
    <>
      <header className="app-header">
        <h1>🛠️ mytools</h1>
        <button
          className="menu-toggle"
          aria-label="Menu" aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >☰</button>
        <div className={'actions' + (menuOpen ? ' open' : '')}>
          {session?.user?.email && (
            <span className="pill email" title="Signed in as">{session.user.email}</span>
          )}
          <label className="pill" title="Auto-lock idle minutes">
            Lock&nbsp;
            <select
              value={autoLockMin}
              onChange={(e) => setAutoLockMin(Number(e.target.value))}
              style={{ padding: '2px 6px', borderRadius: 6 }}
            >
              <option value={5}>5m</option>
              <option value={15}>15m</option>
              <option value={30}>30m</option>
              <option value={60}>1h</option>
              <option value={0}>Off</option>
            </select>
          </label>
          <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMenuOpen(false); }}>
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button className="ghost" onClick={() => { setMenuOpen(false); setShowChangePw(true); }}>🔑 Password</button>
          <button className="ghost" onClick={() => { setMenuOpen(false); lock(); }}>🔒 Lock</button>
          <button className="ghost" onClick={() => { setMenuOpen(false); signOut(); }}>↪ Sign out</button>
        </div>
      </header>
      <Tabs tabs={TABS} active={active} onChange={(id) => { setActive(id); setMenuOpen(false); }} />
      <main className="app-main">
        <Active />
      </main>
      <RecoveryCodeModal />
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </>
  );
}

function InsecureContextScreen() {
  const httpsUrl = 'https://' + location.host + location.pathname;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>🔒 HTTPS required</h1>
        <p className="muted">
          This app uses browser encryption (Web Crypto), which only works over a
          secure connection. You’re on an insecure <code>http://</code> origin.
        </p>
        <a className="primary" href={httpsUrl} style={{ textAlign: 'center', padding: 12, borderRadius: 10, textDecoration: 'none' }}>
          Open the secure version →
        </a>
      </div>
    </div>
  );
}

export default function App() {
  // Guard: without crypto.subtle the vault can't function (insecure context).
  if (typeof window !== 'undefined' && !window.crypto?.subtle) {
    return <InsecureContextScreen />;
  }
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  );
}
