import { useState } from 'react';
import { useVault } from './VaultContext.jsx';

export default function LoginScreen() {
  const { session, signIn, signUp, unlockWithPassword, sendPasswordResetEmail, recoverWithCode } = useVault();
  const sessionEmail = session?.user?.email || '';

  // mode: 'signin' | 'signup' | 'unlock' | 'forgot' | 'recover'
  const initialMode = session ? 'unlock' : 'signin';
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(sessionEmail);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const reset = () => { setPw(''); setPw2(''); setRecoveryCode(''); setErr(''); setInfo(''); };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim().toLowerCase(), pw);
      } else if (mode === 'signup') {
        if (pw !== pw2) throw new Error('Passwords do not match.');
        if (pw.length < 8) throw new Error('Password must be at least 8 characters.');
        await signUp(email.trim().toLowerCase(), pw);
      } else if (mode === 'unlock') {
        await unlockWithPassword(sessionEmail, pw);
      } else if (mode === 'forgot') {
        await sendPasswordResetEmail(email.trim().toLowerCase());
        setInfo('Password reset email sent. Open the link, then return here in recovery mode.');
        setMode('signin');
      } else if (mode === 'recover') {
        if (pw !== pw2) throw new Error('Passwords do not match.');
        if (pw.length < 8) throw new Error('Password must be at least 8 characters.');
        await recoverWithCode(recoveryCode, pw);
      }
      reset();
    } catch (e) {
      if (e?.code === 'CONFIRM_EMAIL') {
        setInfo(e.message);
        setMode('signin');
      } else {
        setErr(e.message || String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    signin: 'Sign in',
    signup: 'Create account',
    unlock: 'Unlock vault',
    forgot: 'Reset password',
    recover: 'Recover with code'
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit} autoComplete="on">
        <h1>🔐 mytools</h1>
        <p className="muted" style={{ margin: 0 }}>{titles[mode]}</p>

        {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
          <input
            type="email"
            placeholder="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}

        {mode === 'unlock' && (
          <div className="hint">Signed in as <strong>{sessionEmail}</strong></div>
        )}

        {mode !== 'forgot' && (
          <input
            type="password"
            placeholder={mode === 'recover' ? 'new password' : 'password'}
            autoComplete={mode === 'signup' || mode === 'recover' ? 'new-password' : 'current-password'}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
            minLength={mode === 'unlock' || mode === 'signin' ? 1 : 8}
          />
        )}

        {(mode === 'signup' || mode === 'recover') && (
          <input
            type="password"
            placeholder="confirm password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            required
            minLength={8}
          />
        )}

        {mode === 'recover' && (
          <input
            type="text"
            placeholder="recovery code (XXXXX-XXXXX-…)"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            required
          />
        )}

        {err && <div className="err">{err}</div>}
        {info && <div className="hint" style={{ color: 'var(--ok)' }}>{info}</div>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Working…' : (
            mode === 'signin' ? 'Sign in'
            : mode === 'signup' ? 'Create account'
            : mode === 'unlock' ? 'Unlock'
            : mode === 'forgot' ? 'Send reset email'
            : 'Recover'
          )}
        </button>

        <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8, flexWrap: 'wrap' }}>
          {mode === 'signin' && (
            <>
              <button type="button" className="ghost" onClick={() => { reset(); setMode('signup'); }}>
                Create account
              </button>
              <button type="button" className="ghost" onClick={() => { reset(); setMode('forgot'); }}>
                Forgot password
              </button>
              <button type="button" className="ghost" onClick={() => { reset(); setMode('recover'); }}>
                Use recovery code
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button type="button" className="ghost" onClick={() => { reset(); setMode('signin'); }}>
              Back to sign in
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="ghost" onClick={() => { reset(); setMode('signin'); }}>
              Back to sign in
            </button>
          )}
          {mode === 'recover' && (
            <button type="button" className="ghost" onClick={() => { reset(); setMode('signin'); }}>
              Back to sign in
            </button>
          )}
          {mode === 'unlock' && (
            <button type="button" className="ghost" onClick={() => { reset(); setMode('recover'); }}>
              Use recovery code
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
