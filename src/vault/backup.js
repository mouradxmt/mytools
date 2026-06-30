// Gather the whole vault into a portable encrypted file and restore it back.
// Plaintext is collected via the in-memory master key, then re-encrypted under
// a separate passphrase (see crypto.js encryptBackup), so a backup survives a
// lost password and can be restored into any account.

import { decryptJSON, encryptJSON, encryptBackup, decryptBackup } from './crypto.js';
import * as backend from '../sync/supabase.js';
import { CACHE_PREFIX, DIRTY_PREFIX } from './useEncryptedState.js';

function localNamespaces() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) out.push(k.slice(CACHE_PREFIX.length));
  }
  return out;
}
const readCache = (ns) => { try { const r = localStorage.getItem(CACHE_PREFIX + ns); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeCache = (ns, payload) => localStorage.setItem(CACHE_PREFIX + ns, JSON.stringify(payload));
const isDirty = (ns) => localStorage.getItem(DIRTY_PREFIX + ns) === '1';

// Decrypt every namespace (server ∪ local cache). Unpushed local edits win.
export async function collectPlaintext(masterKey, session) {
  const server = session ? await backend.fetchAllBlobs().catch(() => ({})) : {};
  const names = new Set([...Object.keys(server), ...localNamespaces()]);
  const namespaces = {}; const skipped = [];
  for (const ns of names) {
    const blob = (isDirty(ns) ? readCache(ns) : server[ns]) || readCache(ns) || server[ns];
    if (!blob) { skipped.push(ns); continue; }
    try { namespaces[ns] = await decryptJSON(masterKey, blob); }
    catch { skipped.push(ns); }
  }
  return { namespaces, skipped };
}

export async function buildBackupFile({ masterKey, session, email, passphrase }) {
  const { namespaces, skipped } = await collectPlaintext(masterKey, session);
  const payload = {
    app: 'mytools', kind: 'vault-backup', schema: 1,
    exportedAt: new Date().toISOString(), email: email || '', namespaces
  };
  const file = await encryptBackup(passphrase, payload);
  return { file, count: Object.keys(namespaces).length, skipped };
}

// Decrypt a backup and write every namespace back (server + local cache),
// re-encrypted under the CURRENT account's master key.
export async function restoreBackupFile({ masterKey, session, passphrase, file }) {
  const payload = await decryptBackup(passphrase, file); // throws on wrong passphrase / bad file
  if (!payload || payload.app !== 'mytools' || !payload.namespaces) {
    throw new Error('Unrecognized backup contents.');
  }
  let restored = 0;
  for (const [ns, value] of Object.entries(payload.namespaces)) {
    const blob = await encryptJSON(masterKey, value);
    if (session) {
      const { updated_at } = await backend.putBlob(ns, blob);
      writeCache(ns, { ...blob, updated_at });
    } else {
      writeCache(ns, { ...blob, updated_at: new Date().toISOString() });
    }
    localStorage.removeItem(DIRTY_PREFIX + ns);
    restored++;
  }
  return { restored, exportedAt: payload.exportedAt, email: payload.email };
}
