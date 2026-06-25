import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const STATUSES = [
  { id: 'mastered', label: 'Mastered' },
  { id: 'learning', label: 'Learning' },
  { id: 'backlog', label: 'Backlog' }
];
const PROFICIENCIES = [
  { id: 'expert', label: 'Expert' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'intermediate', label: 'Intermediate' }
];

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const nowISO = () => new Date().toISOString();
const parseTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—');

const blankDraft = () => ({
  id: null, name: '', status: 'backlog', proficiency: 'intermediate', tagsText: '', notes: ''
});

export default function KnowledgeApp() {
  const [skills, setSkills] = useEncryptedState('knowledge/skills', []);
  const [draft, setDraft] = useState(null);   // null = drawer closed
  const [query, setQuery] = useState('');
  const [quickName, setQuickName] = useState('');

  const quickAdd = (e) => {
    e.preventDefault();
    const name = quickName.trim();
    if (!name) return;
    setSkills([...skills, {
      id: newId(), name, status: 'backlog', proficiency: 'intermediate',
      tags: [], notes: '', lastTouched: nowISO(), createdAt: nowISO()
    }]);
    setQuickName('');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.notes || '').toLowerCase().includes(q) ||
      (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [skills, query]);

  const groups = useMemo(() => {
    const out = { mastered: [], learning: [], backlog: [] };
    for (const s of filtered) (out[s.status] || out.backlog).push(s);
    const profRank = (p) => PROFICIENCIES.findIndex((x) => x.id === p);
    Object.values(out).forEach((arr) =>
      arr.sort((a, b) => profRank(a.proficiency) - profRank(b.proficiency) || a.name.localeCompare(b.name))
    );
    return out;
  }, [filtered]);

  const openAdd = () => setDraft(blankDraft());
  const openEdit = (s) => setDraft({
    id: s.id, name: s.name, status: s.status, proficiency: s.proficiency,
    tagsText: (s.tags || []).join(', '), notes: s.notes || ''
  });
  const closeDrawer = () => setDraft(null);

  const save = (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const tags = parseTags(draft.tagsText);
    if (draft.id) {
      setSkills(skills.map((s) => s.id === draft.id
        ? { ...s, name: draft.name.trim(), status: draft.status, proficiency: draft.proficiency, tags, notes: draft.notes, lastTouched: nowISO() }
        : s));
    } else {
      setSkills([...skills, {
        id: newId(), name: draft.name.trim(), status: draft.status, proficiency: draft.proficiency,
        tags, notes: draft.notes, lastTouched: nowISO(), createdAt: nowISO()
      }]);
    }
    closeDrawer();
  };

  const move = (s, status) => setSkills(skills.map((x) => x.id === s.id ? { ...x, status, lastTouched: nowISO() } : x));
  const remove = (id) => setSkills(skills.filter((s) => s.id !== id));

  return (
    <>
      <section className="card">
        <h2>Knowledge & Learning Backlog</h2>
        <div className="content">
          {/* Primary action: type a skill name and press Enter */}
          <form className="toolbar" onSubmit={quickAdd} autoComplete="off">
            <input
              type="text" aria-label="Add a skill"
              placeholder="Add a skill — type a name and press Enter (e.g. Kubernetes)"
              value={quickName} onChange={(e) => setQuickName(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button type="submit" className="primary">＋ Add</button>
            <button type="button" onClick={openAdd}>Add with details…</button>
          </form>
          {/* Secondary: search existing skills */}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <span className="muted">🔍</span>
            <input
              type="search" aria-label="Search skills"
              placeholder="Search existing skills, notes, tags…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            New skills land in <strong>Backlog</strong> — use the status dropdown on a card, or “Add with details…”, to set proficiency, tags and notes.
          </div>
        </div>
      </section>

      <div className="kanban">
        {STATUSES.map((col) => (
          <div className="kanban-col" key={col.id}>
            <div className="kanban-head">
              <span>{col.label}</span>
              <span className="pill">{groups[col.id].length}</span>
            </div>
            <div className="list">
              {groups[col.id].length === 0 && <div className="hint">Nothing here.</div>}
              {groups[col.id].map((s) => (
                <div className={`skill-card prof-${s.proficiency}`} key={s.id}>
                  <div className="toolbar" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <strong>{s.name}</strong>
                    <span className={`prof-badge prof-${s.proficiency}`}>{s.proficiency}</span>
                  </div>
                  {(s.tags || []).length > 0 && (
                    <div className="tag-row">{s.tags.map((t) => <span key={t} className="tag-pill">{t}</span>)}</div>
                  )}
                  {s.notes && <pre className="skill-notes">{s.notes}</pre>}
                  <div className="skill-foot">
                    <small>Last touched {fmtDate(s.lastTouched)}</small>
                  </div>
                  <div className="toolbar" style={{ gap: 6 }}>
                    <select value={s.status} onChange={(e) => move(s, e.target.value)} title="Move">
                      {STATUSES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                    </select>
                    <button onClick={() => openEdit(s)}>Edit</button>
                    <button className="ghost" onClick={() => remove(s.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h2 style={{ marginTop: 0 }}>{draft.id ? 'Edit skill' : 'Add skill'}</h2>
            <label>Skill / technology
              <input type="text" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <div className="toolbar">
              <label style={{ flex: 1 }}>Status
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label style={{ flex: 1 }}>Proficiency
                <select value={draft.proficiency} onChange={(e) => setDraft({ ...draft, proficiency: e.target.value })}>
                  {PROFICIENCIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>
            <label>Tech tags (comma-separated)
              <input type="text" placeholder="kubernetes, argocd, terraform" value={draft.tagsText} onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })} />
            </label>
            <label>Study notes / CLI snippets / gotchas
              <textarea rows={8} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
            </label>
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeDrawer}>Cancel</button>
              <button type="submit" className="primary">{draft.id ? 'Save changes' : 'Add skill'}</button>
            </div>
            {draft.id && <div className="hint">Saving updates the “Last touched” date automatically.</div>}
          </form>
        </div>
      )}
    </>
  );
}
