import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env and fill in your project credentials.'
  );
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mytools.sb.auth' }
});

// ── Auth ─────────────────────────────────────────────────────────────
export async function signUp(email, authSecret) {
  const { data, error } = await supabase.auth.signUp({ email, password: authSecret });
  if (error) throw error;
  return data;
}

export async function signIn(email, authSecret) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: authSecret });
  if (error) throw error;
  return data;
}

export async function updatePassword(authSecret) {
  const { error } = await supabase.auth.updateUser({ password: authSecret });
  if (error) throw error;
}

export async function sendPasswordResetEmail(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// ── Vault meta ───────────────────────────────────────────────────────
export async function getMeta() {
  const { data, error } = await supabase
    .from('vault_meta')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function putMeta(meta) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  const row = { user_id: session.user.id, schema_version: 1, ...meta };
  const { error } = await supabase
    .from('vault_meta')
    .upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

// ── Encrypted blobs ──────────────────────────────────────────────────
export async function fetchAllBlobs() {
  const { data, error } = await supabase
    .from('vault_blobs')
    .select('namespace, iv, ct, updated_at');
  if (error) throw error;
  const out = {};
  for (const b of data || []) {
    out[b.namespace] = { iv: b.iv, ct: b.ct, updated_at: b.updated_at };
  }
  return out;
}

export async function fetchBlob(namespace) {
  const { data, error } = await supabase
    .from('vault_blobs')
    .select('iv, ct, updated_at')
    .eq('namespace', namespace)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function putBlob(namespace, blob) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  const row = {
    user_id: session.user.id,
    namespace,
    iv: blob.iv,
    ct: blob.ct
  };
  const { data, error } = await supabase
    .from('vault_blobs')
    .upsert(row, { onConflict: 'user_id,namespace' })
    .select('updated_at')
    .single();
  if (error) throw error;
  return { updated_at: data.updated_at };
}

export async function deleteBlob(namespace) {
  const { error } = await supabase
    .from('vault_blobs')
    .delete()
    .eq('namespace', namespace);
  if (error) throw error;
}
