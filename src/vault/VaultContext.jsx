import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as backend from '../sync/supabase.js';
import {
  deriveAuthSecret, deriveKekFromPassword, deriveKekFromRecovery,
  generateMasterKey, generateRecoveryCode,
  unwrapMasterKey, wrapMasterKey
} from './crypto.js';

const VaultCtx = createContext(null);

const CACHE_PREFIX = 'mytools.cache.';

function clearLocalCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  }
}

export function VaultProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [masterKey, setMasterKey] = useState(null);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState(null);
  const [autoLockMin, setAutoLockMin] = useState(() => {
    const v = Number(localStorage.getItem('mytools.autolock'));
    return Number.isFinite(v) && v > 0 ? v : 30;
  });

  // Subscribe to Supabase auth state.
  useEffect(() => {
    let mounted = true;
    backend.getSession().then((s) => {
      if (!mounted) return;
      setSession(s);
      setAuthReady(true);
    });
    return backend.onAuthChange((s) => {
      setSession(s);
      if (!s) {
        setMasterKey(null);
        clearLocalCache();
      }
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('mytools.autolock', String(autoLockMin));
  }, [autoLockMin]);

  // Auto-lock on idle (clears master_key but keeps Supabase session).
  useEffect(() => {
    if (!masterKey || autoLockMin <= 0) return;
    let t;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => setMasterKey(null), autoLockMin * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [masterKey, autoLockMin]);

  // ── Sign up ─────────────────────────────────────────────────────────
  const signUp = useCallback(async (email, password) => {
    const authSecret = await deriveAuthSecret(email, password);
    await backend.signUp(email, authSecret);
    // If email confirmation is on, no session is returned. Try sign-in to detect.
    let s = await backend.getSession();
    if (!s) {
      try {
        await backend.signIn(email, authSecret);
        s = await backend.getSession();
      } catch {
        const err = new Error('Account created. Confirm your email, then sign in.');
        err.code = 'CONFIRM_EMAIL';
        throw err;
      }
    }
    if (!s) {
      const err = new Error('Account created. Confirm your email, then sign in.');
      err.code = 'CONFIRM_EMAIL';
      throw err;
    }

    // First-time setup: generate master_key, recovery code, store wraps.
    const master = await generateMasterKey();
    const kekPass = await deriveKekFromPassword(email, password);
    const recoveryCode = generateRecoveryCode();
    const kekRec = await deriveKekFromRecovery(email, recoveryCode);
    const wrapPass = await wrapMasterKey(kekPass, master);
    const wrapRec = await wrapMasterKey(kekRec, master);
    await backend.putMeta({
      wrap_pass_iv: wrapPass.iv,
      wrap_pass_ct: wrapPass.ct,
      wrap_recovery_iv: wrapRec.iv,
      wrap_recovery_ct: wrapRec.ct
    });
    setMasterKey(master);
    setPendingRecoveryCode(recoveryCode);
  }, []);

  // ── Sign in ─────────────────────────────────────────────────────────
  const signIn = useCallback(async (email, password) => {
    const authSecret = await deriveAuthSecret(email, password);
    await backend.signIn(email, authSecret);
    await unlockWithPassword(email, password);
  }, []);

  // Re-derive master_key for an already-authed Supabase session.
  const unlockWithPassword = useCallback(async (email, password) => {
    const meta = await backend.getMeta();
    const kekPass = await deriveKekFromPassword(email, password);
    if (!meta) {
      // No meta yet (legacy session or partial setup). Initialize now.
      const master = await generateMasterKey();
      const recoveryCode = generateRecoveryCode();
      const kekRec = await deriveKekFromRecovery(email, recoveryCode);
      const wrapPass = await wrapMasterKey(kekPass, master);
      const wrapRec = await wrapMasterKey(kekRec, master);
      await backend.putMeta({
        wrap_pass_iv: wrapPass.iv,
        wrap_pass_ct: wrapPass.ct,
        wrap_recovery_iv: wrapRec.iv,
        wrap_recovery_ct: wrapRec.ct
      });
      setMasterKey(master);
      setPendingRecoveryCode(recoveryCode);
      return;
    }
    let master;
    try {
      master = await unwrapMasterKey(kekPass, { iv: meta.wrap_pass_iv, ct: meta.wrap_pass_ct });
    } catch {
      throw new Error('Wrong password (vault key did not unwrap).');
    }
    setMasterKey(master);
  }, []);

  // ── Recovery flow ───────────────────────────────────────────────────
  // 1. User receives Supabase password-reset email and follows the link.
  //    That sets a Supabase session (any new auth_secret they pick).
  // 2. They open the app while authed and call this with their recovery code
  //    + a NEW password. We unwrap master_key with the recovery code, then
  //    re-wrap with kek(new_password) and update Supabase auth_secret.
  const recoverWithCode = useCallback(async (recoveryCode, newPassword) => {
    const s = await backend.getSession();
    if (!s) throw new Error('Sign in (or use the email reset link) first.');
    const email = s.user.email;
    const meta = await backend.getMeta();
    if (!meta || !meta.wrap_recovery_iv) {
      throw new Error('No recovery wrap stored. Contact support.');
    }
    const kekRec = await deriveKekFromRecovery(email, recoveryCode);
    let master;
    try {
      master = await unwrapMasterKey(kekRec, { iv: meta.wrap_recovery_iv, ct: meta.wrap_recovery_ct });
    } catch {
      throw new Error('Invalid recovery code.');
    }

    // Re-wrap with new password and rotate Supabase auth_secret.
    const newAuthSecret = await deriveAuthSecret(email, newPassword);
    const newKekPass = await deriveKekFromPassword(email, newPassword);
    const newWrap = await wrapMasterKey(newKekPass, master);
    await backend.putMeta({
      wrap_pass_iv: newWrap.iv,
      wrap_pass_ct: newWrap.ct,
      wrap_recovery_iv: meta.wrap_recovery_iv,
      wrap_recovery_ct: meta.wrap_recovery_ct
    });
    await backend.updatePassword(newAuthSecret);
    setMasterKey(master);
  }, []);

  // ── Change password ─────────────────────────────────────────────────
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const s = await backend.getSession();
    if (!s || !masterKey) throw new Error('Sign in first.');
    const email = s.user.email;
    // Verify current password by unwrapping
    const currentKek = await deriveKekFromPassword(email, currentPassword);
    const meta = await backend.getMeta();
    try {
      await unwrapMasterKey(currentKek, { iv: meta.wrap_pass_iv, ct: meta.wrap_pass_ct });
    } catch {
      throw new Error('Current password is wrong.');
    }
    const newKek = await deriveKekFromPassword(email, newPassword);
    const newWrap = await wrapMasterKey(newKek, masterKey);
    const newAuthSecret = await deriveAuthSecret(email, newPassword);
    await backend.putMeta({
      wrap_pass_iv: newWrap.iv,
      wrap_pass_ct: newWrap.ct,
      wrap_recovery_iv: meta.wrap_recovery_iv,
      wrap_recovery_ct: meta.wrap_recovery_ct
    });
    await backend.updatePassword(newAuthSecret);
  }, [masterKey]);

  // ── Lock / sign out ─────────────────────────────────────────────────
  const lock = useCallback(() => setMasterKey(null), []);

  const signOut = useCallback(async () => {
    setMasterKey(null);
    clearLocalCache();
    await backend.signOut();
  }, []);

  const sendPasswordResetEmail = useCallback(async (email) => {
    await backend.sendPasswordResetEmail(email);
  }, []);

  const dismissRecoveryCode = useCallback(() => setPendingRecoveryCode(null), []);

  const value = {
    session,
    authReady,
    unlocked: !!masterKey,
    masterKey,
    autoLockMin,
    setAutoLockMin,
    pendingRecoveryCode,
    dismissRecoveryCode,
    // Auth ops
    signUp,
    signIn,
    unlockWithPassword,
    recoverWithCode,
    changePassword,
    sendPasswordResetEmail,
    lock,
    signOut
  };

  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export const useVault = () => useContext(VaultCtx);
