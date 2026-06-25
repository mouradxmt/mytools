import { useCallback, useEffect, useRef, useState } from 'react';
import { useVault } from './VaultContext.jsx';
import { decryptJSON, encryptJSON } from './crypto.js';
import * as backend from '../sync/supabase.js';

const CACHE_PREFIX = 'mytools.cache.';
const DIRTY_PREFIX = 'mytools.dirty.';

function readLocal(namespace) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + namespace);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeLocal(namespace, payload) {
  localStorage.setItem(CACHE_PREFIX + namespace, JSON.stringify(payload));
}
const getDirtyFlag = (ns) => localStorage.getItem(DIRTY_PREFIX + ns) === '1';
const setDirtyFlag = (ns, v) => {
  if (v) localStorage.setItem(DIRTY_PREFIX + ns, '1');
  else localStorage.removeItem(DIRTY_PREFIX + ns);
};

// Encrypted, locally-cached React state with optional server sync.
//   options.autoPush (default true): push to Supabase automatically (debounced).
//   options.autoPush = false: save locally only; caller pushes via sync.pushNow().
//
// Returns [value, setValue, loaded, sync] where
//   sync = { dirty, syncing, error, savedAt, pushNow }.
export function useEncryptedState(namespace, initialValue, options = {}) {
  const { autoPush = true } = options;
  const { masterKey, session } = useVault();

  const [value, setValue] = useState(initialValue);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const writeTimer = useRef(null);
  const lastUpdatedAt = useRef(null);
  const skipNextWrite = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Hydrate from local cache, then pull from server.
  useEffect(() => {
    if (!masterKey) return;
    let alive = true;
    skipNextWrite.current = true;
    setLoaded(false);
    setError(null);

    (async () => {
      const local = readLocal(namespace);
      if (local) {
        try {
          const v = await decryptJSON(masterKey, local);
          if (alive) {
            setValue(v);
            lastUpdatedAt.current = local.updated_at || null;
            setSavedAt(local.updated_at || null);
          }
        } catch (e) { console.warn('Local cache decrypt failed for', namespace, e); }
      }
      if (alive) {
        setDirty(getDirtyFlag(namespace));
        setLoaded(true);
      }

      if (!session) return;
      setSyncing(true);
      try {
        const remote = await backend.fetchBlob(namespace);
        if (!alive) return;
        const localDirty = getDirtyFlag(namespace);
        // Only let the server overwrite local if local has no unpushed edits.
        if (remote && !localDirty && remote.updated_at !== local?.updated_at) {
          const remoteNewer = !local || remote.updated_at > (local.updated_at || '');
          if (remoteNewer) {
            const v = await decryptJSON(masterKey, remote);
            skipNextWrite.current = true;
            setValue(v);
            lastUpdatedAt.current = remote.updated_at;
            setSavedAt(remote.updated_at);
            writeLocal(namespace, remote);
          }
        }
      } catch (e) {
        console.warn('Server pull failed for', namespace, e);
      } finally {
        if (alive) setSyncing(false);
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterKey, namespace, session]);

  // Force-push the current value to the server.
  const pushNow = useCallback(async () => {
    if (!masterKey) { setError('Vault locked'); return false; }
    if (!session) { setError('Not signed in'); return false; }
    setSyncing(true); setError(null);
    try {
      const blob = await encryptJSON(masterKey, valueRef.current);
      const { updated_at } = await backend.putBlob(namespace, blob);
      lastUpdatedAt.current = updated_at;
      writeLocal(namespace, { ...blob, updated_at });
      setDirtyFlag(namespace, false);
      setSavedAt(updated_at); setDirty(false);
      return true;
    } catch (e) {
      setError(e.message || String(e));
      return false;
    } finally {
      setSyncing(false);
    }
  }, [masterKey, session, namespace]);

  // Persist on change: always cache locally; push to server only if autoPush.
  useEffect(() => {
    if (!masterKey || !loaded) return;
    if (skipNextWrite.current) { skipNextWrite.current = false; return; }

    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      try {
        const blob = await encryptJSON(masterKey, value);
        writeLocal(namespace, { ...blob, updated_at: lastUpdatedAt.current });
        if (autoPush && session) {
          setSyncing(true);
          const { updated_at } = await backend.putBlob(namespace, blob);
          lastUpdatedAt.current = updated_at;
          writeLocal(namespace, { ...blob, updated_at });
          setDirtyFlag(namespace, false);
          setSavedAt(updated_at); setDirty(false);
        } else {
          setDirtyFlag(namespace, true);
          setDirty(true); // saved locally, awaiting manual push
        }
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setSyncing(false);
      }
    }, 250);

    return () => clearTimeout(writeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded, masterKey, namespace, session, autoPush]);

  const sync = { dirty, syncing, error, savedAt, pushNow };
  return [value, setValue, loaded, sync];
}
