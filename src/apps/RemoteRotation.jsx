import { useCallback, useEffect, useState } from 'react';
import { useVault } from '../vault/VaultContext.jsx';
import { useEncryptedState } from '../vault/useEncryptedState.js';
import * as backend from '../sync/supabase.js';

const DEFAULT_CONFIG = {
  startDate: '2026-01-19',
  cycleDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  people: [{ name: 'Me', startDayIndex: 0 }],
  weeksAhead: 8
};

function normalizeConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    startDate: c.startDate || DEFAULT_CONFIG.startDate,
    cycleDays: Array.isArray(c.cycleDays) && c.cycleDays.length ? c.cycleDays : DEFAULT_CONFIG.cycleDays,
    people: Array.isArray(c.people) ? c.people : [],
    weeksAhead: c.weeksAhead || DEFAULT_CONFIG.weeksAhead
  };
}

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function addDays(date, days) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }
function weeksBetween(fromMonday, toMonday) {
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  return Math.round((toMonday.getTime() - fromMonday.getTime()) / ONE_WEEK);
}

// Build the visible weeks for a given viewer (canonical schedule + the
// viewer's own local override applied, current week pinned first).
function buildWeeks(config, overlay) {
  const cfg = normalizeConfig(config);
  const cycleLength = Math.max(1, cfg.cycleDays.length);

  // Effective people = canonical, with the viewer's own local override applied.
  const effectivePeople = cfg.people.map((p) => {
    if (overlay && overlay.meName && p.name === overlay.meName && overlay.startDayOverride != null) {
      return { ...p, startDayIndex: overlay.startDayOverride, _overridden: true };
    }
    return p;
  });
  const mePerson = overlay?.meName
    ? effectivePeople.find((p) => p.name === overlay.meName)
    : null;

  const referenceMonday = getMonday(new Date(cfg.startDate)); referenceMonday.setHours(0, 0, 0, 0);
  const realMonday = getMonday(new Date()); realMonday.setHours(0, 0, 0, 0);
  const todayIso = new Date().toISOString().slice(0, 10);

  const weeks = [];
  for (let i = 0; i < cfg.weeksAhead; i++) {
    const ws = addDays(realMonday, i * 7); ws.setHours(0, 0, 0, 0);
    const shift = weeksBetween(referenceMonday, ws);
    const norm = (idx) => ((idx + (shift % cycleLength) + cycleLength) % cycleLength);
    const myCycleIndex = mePerson ? norm(mePerson.startDayIndex) : -1;

    const dayAssignments = cfg.cycleDays.map((dayName, cycleIndex) => {
      const assigned = effectivePeople
        .filter((p) => norm(p.startDayIndex) === cycleIndex)
        .map((p) => ({ name: p.name, overridden: !!p._overridden }));
      const dayIso = addDays(ws, cycleIndex).toISOString().slice(0, 10);
      return { dayName, assigned, isMyDay: cycleIndex === myCycleIndex, isToday: dayIso === todayIso };
    });
    weeks.push({
      formatted: ws.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
      shift, isCurrent: i === 0, dayAssignments
    });
  }
  return weeks;
}

export default function RemoteRotationApp() {
  const { session } = useVault();
  const myEmail = session?.user?.email || '';

  const [role, setRole] = useState(null);      // 'admin' | 'team' | 'none'
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canonical, setCanonical] = useState(null);

  // Per-viewer, private & encrypted: which person I am + my local-only override.
  const [overlay, setOverlay] = useEncryptedState('remote/localOverlay', { meName: '', startDayOverride: null });
  // Legacy single-user config (pre-sharing), used to seed the admin editor once.
  const [legacy] = useEncryptedState('remote/config', null);

  const reload = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const { role: r, missing } = await backend.getMyRole();
      setRole(r); setMigrationMissing(missing);
      if (!missing && (r === 'admin' || r === 'team')) {
        const row = await backend.getSharedRotation();
        setCanonical(normalizeConfig(row?.config));
      }
    } catch (e) {
      setLoadError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (session) reload(); }, [session, reload]);

  // ── Loading / access states ─────────────────────────────────────────
  if (loading) return <div className="card"><div className="content muted">Loading rotation…</div></div>;

  if (migrationMissing) {
    return (
      <section className="card">
        <h2>Team rotation not set up</h2>
        <div className="content">
          <p className="hint">
            The team-sharing tables aren’t in the database yet. Run
            <code> supabase/migrations/0002_team_rotation.sql </code>
            in your Supabase SQL editor, then reload.
          </p>
          <button onClick={reload}>Reload</button>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="card">
        <h2>Couldn’t load rotation</h2>
        <div className="content">
          <div className="err">{loadError}</div>
          <button onClick={reload} style={{ marginTop: 8 }}>Retry</button>
        </div>
      </section>
    );
  }

  if (role === 'none') {
    return (
      <section className="card">
        <h2>🗓️ Remote Rotation</h2>
        <div className="content">
          <p className="hint">
            You don’t have access to the shared rotation yet. Ask the admin to add
            your email (<strong>{myEmail}</strong>) to the team.
          </p>
        </div>
      </section>
    );
  }

  const weeks = buildWeeks(canonical, overlay);
  const peopleNames = normalizeConfig(canonical).people.map((p) => p.name);

  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🗓️ Remote Rotation</h2>
        <span className="pill">{role === 'admin' ? '👑 Admin' : '👁️ Team view'}</span>
      </div>

      {role === 'admin'
        ? <AdminPanels canonical={canonical} setCanonical={setCanonical} legacy={legacy} onReload={reload} />
        : <TeamViewerPanel canonical={canonical} overlay={overlay} setOverlay={setOverlay} peopleNames={peopleNames} />}

      {/* "Who am I" highlight selector — available to everyone */}
      <section className="card">
        <h2>Highlight my day</h2>
        <div className="content toolbar">
          <label>I am</label>
          <select
            value={overlay.meName || ''}
            onChange={(e) => setOverlay({ ...overlay, meName: e.target.value })}
          >
            <option value="">— nobody —</option>
            {peopleNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="hint">Highlights your column. Stored only on your device.</span>
        </div>
      </section>

      {weeks.map((w, i) => (
        <div key={i} className={'week-card' + (w.isCurrent ? ' current' : '')}>
          <div className="week-header">
            Week of {w.formatted}{' '}
            <span style={{ fontWeight: 400, fontSize: '.9em', color: 'var(--muted)' }}>
              (Shift {w.shift >= 0 ? '+' : ''}{w.shift})
            </span>
          </div>
          <div className="day-grid">
            {w.dayAssignments.map((d) => {
              const cls = ['day-column'];
              if (d.isMyDay) cls.push('my-day');
              if (d.isToday) cls.push('is-today');
              return (
                <div key={d.dayName} className={cls.join(' ')}>
                  <div className="day-header">
                    {d.dayName}{d.isMyDay && <span className="my-pill" title="Your turn">👤</span>}
                  </div>
                  <div className="day-content">
                    {d.assigned.length
                      ? d.assigned.map((a) => (
                          <span key={a.name} className="person-tag" title={a.overridden ? 'Local preview' : ''}>
                            {a.name}{a.overridden ? ' *' : ''}
                          </span>
                        ))
                      : <span style={{ color: 'var(--muted)', fontSize: '0.8em' }}>No one</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ── Team viewer: read-only + local-only override of their own entry ───────
function TeamViewerPanel({ canonical, overlay, setOverlay, peopleNames }) {
  const cfg = normalizeConfig(canonical);
  const hasOverride = overlay.startDayOverride != null;
  return (
    <section className="card">
      <h2>Your local preview</h2>
      <div className="content">
        <p className="hint">
          The schedule below is managed by the admin (read-only). You can preview a
          change to <em>your own</em> day here — it’s saved only on your device and is
          <strong> not shared</strong> with the team.
        </p>
        <div className="toolbar">
          <label>Preview my start day as</label>
          <select
            value={hasOverride ? overlay.startDayOverride : ''}
            onChange={(e) => setOverlay({
              ...overlay,
              startDayOverride: e.target.value === '' ? null : Number(e.target.value)
            })}
            disabled={!overlay.meName}
          >
            <option value="">{overlay.meName ? '— no change —' : 'pick who you are first'}</option>
            {cfg.cycleDays.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          {hasOverride && (
            <button className="ghost" onClick={() => setOverlay({ ...overlay, startDayOverride: null })}>
              Clear preview
            </button>
          )}
        </div>
        {hasOverride && <div className="hint" style={{ color: 'var(--warn)', marginTop: 6 }}>
          Local preview active — entries marked <strong>*</strong> are your unsaved view.
        </div>}
      </div>
    </section>
  );
}

// ── Admin: edit the canonical rotation + manage the team allowlist ────────
function AdminPanels({ canonical, setCanonical, legacy, onReload }) {
  const cfg = normalizeConfig(canonical);
  const [draft, setDraft] = useState(cfg);
  const [showConfig, setShowConfig] = useState(false);
  const [newDay, setNewDay] = useState('');
  const [newPerson, setNewPerson] = useState({ name: '', startDayIndex: '' });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => { setDraft(normalizeConfig(canonical)); }, [canonical]);

  const canImportLegacy = legacy && Array.isArray(legacy.people) && legacy.people.length > 0
    && cfg.people.length === 0;

  const save = async () => {
    setSaving(true); setSaveMsg('');
    try {
      await backend.saveSharedRotation(draft);
      setCanonical(normalizeConfig(draft));
      setSaveMsg('Saved & shared ✓');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg('Error: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const addCycleDay = () => {
    if (!newDay.trim()) return;
    setDraft({ ...draft, cycleDays: [...draft.cycleDays, newDay.trim()] });
    setNewDay('');
  };
  const removeCycleDay = (i) => setDraft({ ...draft, cycleDays: draft.cycleDays.filter((_, idx) => idx !== i) });
  const addPerson = () => {
    if (!newPerson.name.trim() || newPerson.startDayIndex === '') return;
    setDraft({ ...draft, people: [...draft.people, { name: newPerson.name.trim(), startDayIndex: parseInt(newPerson.startDayIndex, 10) }] });
    setNewPerson({ name: '', startDayIndex: '' });
  };
  const removePerson = (i) => setDraft({ ...draft, people: draft.people.filter((_, idx) => idx !== i) });

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button onClick={() => setShowConfig((s) => !s)}>⚙️ {showConfig ? 'Close editor' : 'Edit rotation'}</button>
        {saveMsg && <span className="pill" style={{ color: 'var(--ok)' }}>{saveMsg}</span>}
      </div>

      {showConfig && (
        <section className="card">
          <h2>Edit shared rotation</h2>
          <div className="content">
            {canImportLegacy && (
              <div className="row" style={{ marginBottom: 12 }}>
                <div className="hint">Found your previous local setup ({legacy.people.length} people).</div>
                <button onClick={() => setDraft(normalizeConfig(legacy))}>Import it</button>
              </div>
            )}

            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label>Reference start date (cycle anchor)</label>
              <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </div>

            <hr />
            <label>Rotation days cycle</label>
            <div className="toolbar" style={{ marginTop: 6 }}>
              {draft.cycleDays.map((d, i) => (
                <span key={d + i} className="chip">
                  {d} <button className="ghost" onClick={() => removeCycleDay(i)} style={{ padding: '0 6px', marginLeft: 6 }}>×</button>
                </span>
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <input type="text" placeholder="e.g. Thursday" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
              <button className="primary" onClick={addCycleDay}>Add day</button>
            </div>

            <hr />
            <label>Team members</label>
            <div className="list" style={{ marginTop: 6 }}>
              {draft.people.map((p, i) => (
                <div className="row" key={p.name + i}>
                  <div><strong>{p.name}</strong> starts on <strong>{draft.cycleDays[p.startDayIndex] || 'Unknown'}</strong></div>
                  <button onClick={() => removePerson(i)}>Remove</button>
                </div>
              ))}
              {draft.people.length === 0 && <div className="hint">No one yet — add people below.</div>}
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <input type="text" placeholder="Name" value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
              <select value={newPerson.startDayIndex} onChange={(e) => setNewPerson({ ...newPerson, startDayIndex: e.target.value })}>
                <option value="" disabled>Select initial day</option>
                {draft.cycleDays.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <button className="primary" onClick={addPerson}>Add person</button>
            </div>

            <hr />
            <div className="toolbar">
              <label>Weeks to display</label>
              <input type="number" min="1" max="26" value={draft.weeksAhead}
                onChange={(e) => setDraft({ ...draft, weeksAhead: Math.max(1, Number(e.target.value) || 8) })}
                style={{ width: 80 }} />
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save & share'}</button>
              <button onClick={() => setDraft(normalizeConfig(canonical))} disabled={saving}>Revert</button>
            </div>
          </div>
        </section>
      )}

      <TeamAllowlistPanel onReload={onReload} />
    </>
  );
}

// ── Admin: who can view the rotation ──────────────────────────────────────
function TeamAllowlistPanel() {
  const [team, setTeam] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setTeam(await backend.listTeam()); } catch (e) { setErr(e.message || String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true); setErr('');
    try { await backend.addTeamMember(email); setNewEmail(''); await load(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  const remove = async (email) => {
    setBusy(true); setErr('');
    try { await backend.removeTeamMember(email); await load(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Team access</h2>
      <div className="content">
        <p className="hint">Authenticated users with these emails can view the rotation (read-only).</p>
        {err && <div className="err">{err}</div>}
        <div className="list" style={{ marginTop: 8 }}>
          {team === null && <div className="hint">Loading…</div>}
          {team && team.length === 0 && <div className="hint">No team members yet.</div>}
          {team && team.map((m) => (
            <div className="row" key={m.email}>
              <div>{m.email}</div>
              <button className="ghost" onClick={() => remove(m.email)} disabled={busy}>Remove</button>
            </div>
          ))}
        </div>
        <form className="toolbar" onSubmit={add} style={{ marginTop: 10 }} autoComplete="off">
          <input type="email" placeholder="teammate@email.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required style={{ flex: 1, minWidth: 220 }} />
          <button className="primary" type="submit" disabled={busy}>Add member</button>
        </form>
      </div>
    </section>
  );
}
