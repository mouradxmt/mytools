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

function Shell() {
  const { unlocked, lock, autoLockMin, setAutoLockMin } = useVault();
  const [active, setActive] = useState(() => localStorage.getItem('mytools.activeTab') || 'calendar');
  const [theme, setTheme] = useState(() => localStorage.getItem('mytools.theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mytools.theme', theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem('mytools.activeTab', active); }, [active]);

  if (!unlocked) return <LoginScreen />;

  const Active = TABS.find((t) => t.id === active)?.Component || (() => null);

  return (
    <>
      <header className="app-header">
        <h1>🛠️ mytools</h1>
        <div className="actions">
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
        </div>
      </header>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      <main className="app-main">
        <Active />
      </main>
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
