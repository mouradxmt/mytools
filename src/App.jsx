import { useEffect, useState } from 'react';
import { VaultProvider, useVault } from './vault/VaultContext.jsx';
import LoginScreen from './vault/LoginScreen.jsx';
import Tabs from './components/Tabs.jsx';
import CalendarApp from './apps/Calendar.jsx';
import RemoteRotationApp from './apps/RemoteRotation.jsx';
import TasksApp from './apps/Tasks.jsx';
import InvoicesApp from './apps/Invoices.jsx';

const TABS = [
  { id: 'calendar', label: 'Calendar', icon: '📅', Component: CalendarApp },
  { id: 'remote', label: 'Remote Rotation', icon: '🗓️', Component: RemoteRotationApp },
  { id: 'tasks', label: 'Tasks', icon: '✅', Component: TasksApp },
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

function Shell() {
  const { unlocked, lock, signOut, session, authReady, autoLockMin, setAutoLockMin } = useVault();
  const [active, setActive] = useState(() => localStorage.getItem('mytools.activeTab') || 'calendar');
  const [theme, setTheme] = useState(() => localStorage.getItem('mytools.theme') || 'dark');

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
        <div className="actions">
          {session?.user?.email && (
            <span className="pill" title="Signed in as">{session.user.email}</span>
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
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button className="ghost" onClick={lock}>🔒 Lock</button>
          <button className="ghost" onClick={signOut}>↪ Sign out</button>
        </div>
      </header>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      <main className="app-main">
        <Active />
      </main>
      <RecoveryCodeModal />
    </>
  );
}

export default function App() {
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  );
}
