import { useEffect, useRef, useState } from 'react';
import { useVault } from './VaultContext.jsx';
import { decryptJSON, encryptJSON } from './crypto.js';
import * as backend from '../sync/supabase.js';

const CACHE_PREFIX = 'mytools.cache.';

function readLocal(namespace) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + namespace);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeLocal(namespace, payload) {
  localStorage.setItem(CACHE_PREFIX + namespace, JSON.stringify(payload));
}

// Sync-aware encrypted state.
//   - Reads local cache immediately for offline / fast startup
//   - Pulls from server in background; if newer, hydrates the value
//   - On change: encrypts → writes local cache → debounced push to server
export function useEncryptedState(namespace, initialValue) {
  const { masterKey, session } = useVault();
  const [value, setValue] = useState(initialValue);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const writeTimer = useRef(null);
  const lastUpdatedAt = useRef(null);   // server's updated_at we last saw / wrote
  const skipNextWrite = useRef(true);   // suppress write effect when hydrating

  // Hydrate from local cache, then pull from server.
  useEffect(() => {
    if (!masterKey) return;
    let alive = true;
    skipNextWrite.current = true;
    setLoaded(false);

    (async () => {
      // 1. local first
      const local = readLocal(namespace);
      if (local) {
        try {
          const v = await decryptJSON(masterKey, local);
          if (alive) {
            setValue(v);
            lastUpdatedAt.current = local.updated_at || null;
          }
        } catch (e) {
          console.warn('Local cache decrypt failed for', namespace, e);
        }
      }
      if (alive) setLoaded(true);

      // 2. server pull
      if (!session) return;
      setSyncing(true);
      try {
        const remote = await backend.fetchBlob(namespace);
        if (!alive) return;
        if (remote && remote.updated_at !== local?.updated_at) {
          const remoteIsNewer = !local || (remote.updated_at > (local.updated_at || ''));
          if (remoteIsNewer) {
            const v = await decryptJSON(masterKey, remote);
            skipNextWrite.current = true;
            setValue(v);
            lastUpdatedAt.current = remote.updated_at;
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

  // Debounced encrypt + write local + push remote on value change.
  useEffect(() => {
    if (!masterKey || !loaded) return;
    if (skipNextWrite.current) { skipNextWrite.current = false; return; }

    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      try {
        const blob = await encryptJSON(masterKey, value);
        // Optimistically save local with current timestamp; will be overwritten by server's stamp.
        const localPayload = { ...blob, updated_at: lastUpdatedAt.current };
        writeLocal(namespace, localPayload);
        if (session) {
          setSyncing(true);
          const { updated_at } = await backend.putBlob(namespace, blob);
          lastUpdatedAt.current = updated_at;
          writeLocal(namespace, { ...blob, updated_at });
        }
      } catch (e) {
        console.warn('Encrypted write failed for', namespace, e);
      } finally {
        setSyncing(false);
      }
    }, 250);

    return () => clearTimeout(writeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded, masterKey, namespace, session]);

  return [value, setValue, loaded, syncing];
}
