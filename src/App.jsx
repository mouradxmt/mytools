import { useEffect, useState } from 'react';
import { VaultProvider, useVault } from './vault/VaultContext.jsx';
import LoginScreen from './vault/LoginScreen.jsx';
import Tabs from './components/Tabs.jsx';
import HomeApp from './apps/Home.jsx';
import ScheduleApp from './apps/Schedule.jsx';
import TasksApp from './apps/Tasks.jsx';
import InvoicesApp from './apps/Invoices.jsx';
import KnowledgeApp from './apps/Knowledge.jsx';
import ResumeApp from './apps/Resume.jsx';
import PersonalApp from './apps/Personal.jsx';
import { buildBackupFile, restoreBackupFile } from './vault/backup.js';

const TABS = [
  { id: 'home', label: 'Today', icon: '🏠', Component: HomeApp },
  { id: 'calendar', label: 'Calendar', icon: '📅', Component: ScheduleApp },
  { id: 'tasks', label: 'Tasks', icon: '✅', Component: TasksApp },
  { id: 'knowledge', label: 'Knowledge', icon: '🧠', Component: KnowledgeApp },
  { id: 'resume', label: 'Resume', icon: '📄', Component: ResumeApp },
  { id: 'invoices', label: 'Invoices', icon: '🧾', Component: InvoicesApp },
  { id: 'personal', label: 'Personal', icon: '🧰', Component: PersonalApp }
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

function BackupModal({ onClose }) {
  const { masterKey, session } = useVault();
  const email = session?.user?.email || '';
  const [mode, setMode] = useState('export');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fileObj, setFileObj] = useState(null);
  const [importPass, setImportPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const doExport = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (pass.length < 8) { setErr('Passphrase must be at least 8 characters.'); return; }
    if (pass !== confirm) { setErr('Passphrases do not match.'); return; }
    setBusy(true);
    try {
      const { file, count, skipped } = await buildBackupFile({ masterKey, session, email, passphrase: pass });
      const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `mytools-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      setMsg(`Downloaded a backup of ${count} item${count === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} unreadable, skipped)` : ''}. Keep the file and its passphrase safe.`);
      setPass(''); setConfirm('');
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusy(false); }
  };

  const doImport = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!fileObj) { setErr('Choose a backup file first.'); return; }
    if (!confirm0('Restore overwrites your current data for every section in the backup file. Continue?')) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await fileObj.text());
      const { restored, exportedAt } = await restoreBackupFile({ masterKey, session, passphrase: importPass, file: parsed });
      setMsg(`Restored ${restored} item${restored === 1 ? '' : 's'} from ${exportedAt ? new Date(exportedAt).toLocaleString() : 'backup'}. Reloading…`);
      setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      const m = e.message || String(e);
      setErr(/backup file|Unrecognized/.test(m) ? m : 'Could not restore — wrong passphrase or corrupt file.');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>🗄️ Backup &amp; restore</h2>
        <p className="hint">
          A backup is your entire vault encrypted under a <strong>separate passphrase</strong> you choose here.
          It restores even if you lose your password &amp; recovery code — and into any account.
        </p>
        <div className="seg-toggle small" style={{ margin: '4px 0 10px' }}>
          <button type="button" className={mode === 'export' ? 'active' : ''} onClick={() => { setMode('export'); setErr(''); setMsg(''); }}>⬇ Export</button>
          <button type="button" className={mode === 'import' ? 'active' : ''} onClick={() => { setMode('import'); setErr(''); setMsg(''); }}>⬆ Restore</button>
        </div>

        {mode === 'export' ? (
          <form onSubmit={doExport}>
            <input type="password" autoComplete="new-password" placeholder="Backup passphrase (min 8 chars)"
              value={pass} onChange={(e) => setPass(e.target.value)} required minLength={8} autoFocus />
            <input type="password" autoComplete="new-password" placeholder="Confirm passphrase"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            {err && <div className="err">{err}</div>}
            {msg && <div className="hint" style={{ color: 'var(--ok)' }}>{msg}</div>}
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={onClose} disabled={busy}>Close</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? 'Preparing…' : '⬇ Download backup'}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={doImport}>
            <label className="filebtn" style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>
              {fileObj ? `📄 ${fileObj.name}` : '📂 Choose backup file…'}
              <input type="file" accept=".json,application/json" hidden onChange={(e) => { setFileObj(e.target.files[0] || null); setErr(''); setMsg(''); }} />
            </label>
            <input type="password" autoComplete="off" placeholder="Backup passphrase"
              value={importPass} onChange={(e) => setImportPass(e.target.value)} required />
            <div className="hint" style={{ color: 'var(--warn)', marginTop: 6 }}>
              ⚠ Overwrites current data for every section contained in the file.
            </div>
            {err && <div className="err">{err}</div>}
            {msg && <div className="hint" style={{ color: 'var(--ok)' }}>{msg}</div>}
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={onClose} disabled={busy}>Close</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? 'Restoring…' : '⬆ Restore backup'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
const confirm0 = (m) => window.confirm(m);

function Shell() {
  const { unlocked, lock, signOut, session, authReady, autoLockMin, setAutoLockMin } = useVault();
  const [active, setActive] = useState(() => localStorage.getItem('mytools.activeTab') || 'home');
  const [theme, setTheme] = useState(() => localStorage.getItem('mytools.theme') || 'dark');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showBackup, setShowBackup] = useState(false);

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

  const activeTab = TABS.find((t) => t.id === active) || TABS[0];
  const Active = activeTab.Component;

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
          <button className="ghost" onClick={() => { setMenuOpen(false); setShowBackup(true); }}>🗄️ Backup</button>
          <button className="ghost" onClick={() => { setMenuOpen(false); lock(); }}>🔒 Lock</button>
          <button className="ghost" onClick={() => { setMenuOpen(false); signOut(); }}>↪ Sign out</button>
        </div>
      </header>
      <Tabs tabs={TABS} active={activeTab.id} onChange={(id) => { setActive(id); setMenuOpen(false); }} />
      <main className="app-main">
        <Active onNavigate={setActive} />
      </main>
      <RecoveryCodeModal />
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {showBackup && <BackupModal onClose={() => setShowBackup(false)} />}
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
