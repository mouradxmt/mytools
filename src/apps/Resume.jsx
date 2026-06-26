import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';
import { normalizeImport, extractPdfText, guessContacts } from '../lib/resumeImport.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const parseTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean);
const parseLines = (s) => (s || '').split('\n').map((t) => t.trim()).filter(Boolean);

// 'YYYY-MM' → 'Mon YYYY'; '' → 'Present'
const fmtMonth = (m) => {
  if (!m) return 'Present';
  const [y, mo] = m.split('-').map(Number);
  if (!y) return m;
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const endSortKey = (m) => (m ? Number(m.replace('-', '')) : 999999); // present sorts last/newest

const LAYOUTS = [
  { id: 'chronological', label: 'Chronological SRE' },
  { id: 'project', label: 'Project-Focused DevOps Consultant' }
];
const DENSITIES = [
  { id: 'default', label: 'Default text size' },
  { id: 'compact', label: 'Compact (fit one page)' },
  { id: 'ultra', label: 'Ultra-compact (squash hard)' }
];

const blankProfile = () => ({ name: '', title: '', summary: '', email: '', phone: '', location: '', linksText: '' });
const blankExp = () => ({ id: null, client: '', role: '', location: '', start: '', end: '', tagsText: '', bullets: [''] });
const blankEdu = () => ({ id: null, degree: '', school: '', location: '', start: '', end: '' });

export default function ResumeApp() {
  // Local-first: résumé edits are saved on this device and pushed to the
  // server only when you click "Sync" (autoPush: false).
  const LOCAL = { autoPush: false };
  const [profile, setProfile, , profileSync] = useEncryptedState('resume/profile', blankProfile(), LOCAL);
  const [experiences, setExperiences, , expSync] = useEncryptedState('resume/experiences', [], LOCAL);
  const [education, setEducation, , eduSync] = useEncryptedState('resume/education', [], LOCAL);
  const [skills, setSkills, , skillsSync] = useEncryptedState('knowledge/skills', [], LOCAL);

  const syncParts = [profileSync, expSync, eduSync, skillsSync];
  const isDirty = syncParts.some((s) => s.dirty);
  const isSyncing = syncParts.some((s) => s.syncing);
  const syncError = syncParts.map((s) => s.error).find(Boolean) || '';
  const lastSavedAt = syncParts.map((s) => s.savedAt).filter(Boolean).sort().slice(-1)[0] || null;
  const syncAll = () => Promise.all(syncParts.map((s) => s.pushNow()));

  // Import / export
  const [importMsg, setImportMsg] = useState('');
  const [pdfText, setPdfText] = useState('');
  const [eduDraft, setEduDraft] = useState(null);

  const applyImport = (raw) => {
    const norm = normalizeImport(raw);
    setProfile(norm.profile);
    setExperiences(norm.experiences);
    setEducation(norm.education);
    if (norm.skills.length) setSkills(norm.skills); // only replace skills if the file has them
    setImportMsg(`Imported: ${norm.experiences.length} roles, ${norm.education.length} education, ${norm.skills.length} skills.`);
  };
  const importJsonText = (text) => {
    if (!text.trim()) return;
    try { applyImport(JSON.parse(text)); }
    catch (e) { setImportMsg('Invalid JSON: ' + (e.message || e)); }
  };
  const importFile = async (file) => {
    if (!file) return;
    try { applyImport(JSON.parse(await file.text())); }
    catch (e) { setImportMsg('Invalid JSON file: ' + (e.message || e)); }
  };
  const exportJson = () => {
    const data = { profile, experiences, education, skills };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mytools-cv.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const importPdf = async (file) => {
    if (!file) return;
    setImportMsg('Reading PDF…'); setPdfText('');
    try {
      const text = await extractPdfText(file);
      const c = guessContacts(text);
      setProfile((p) => ({
        ...p,
        name: p.name || c.name, title: p.title || c.title,
        email: p.email || c.email, phone: p.phone || c.phone,
        linksText: p.linksText || c.linksText
      }));
      setPdfText(text);
      setImportMsg('Extracted text + contact details. Add roles/bullets below (auto-structuring CVs reliably isn’t possible).');
    } catch (e) {
      setImportMsg('PDF read failed: ' + (e.message || e));
    }
  };

  // ── Filter state (ephemeral sandbox) ────────────────────────────────
  const [layout, setLayout] = useState('chronological');
  const [density, setDensity] = useState('default');       // text/spacing scale
  const [techFilter, setTechFilter] = useState([]);        // selected keywords (OR match)
  const [offIds, setOffIds] = useState(() => new Set());   // experiences toggled off

  // ── Editor state ────────────────────────────────────────────────────
  const [showEditor, setShowEditor] = useState(false);
  const [expDraft, setExpDraft] = useState(null);

  // ── Derived ─────────────────────────────────────────────────────────
  const techUniverse = useMemo(() => {
    const set = new Set();
    experiences.forEach((e) => (e.tags || []).forEach((t) => set.add(t)));
    skills.forEach((s) => (s.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [experiences, skills]);

  const matchesTech = (tags) => techFilter.length === 0 || (tags || []).some((t) => techFilter.includes(t));

  const visibleExperiences = useMemo(() => {
    const list = experiences.filter((e) => !offIds.has(e.id) && matchesTech(e.tags));
    const sorted = [...list].sort((a, b) => endSortKey(b.end) - endSortKey(a.end));
    if (layout === 'project') {
      // Project-focused: most tech-tagged first, then recency.
      return [...list].sort((a, b) => (b.tags?.length || 0) - (a.tags?.length || 0) || endSortKey(b.end) - endSortKey(a.end));
    }
    return sorted;
  }, [experiences, offIds, techFilter, layout]);

  const visibleSkills = useMemo(() => {
    const rank = { expert: 0, advanced: 1, intermediate: 2 };
    return skills
      .filter((s) => s.status !== 'backlog')
      .filter((s) => matchesTech([...(s.tags || []), s.name]))
      .sort((a, b) => (rank[a.proficiency] ?? 3) - (rank[b.proficiency] ?? 3) || a.name.localeCompare(b.name));
  }, [skills, techFilter]);

  const toggleTech = (t) => setTechFilter((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  const toggleExp = (id) => setOffIds((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Experience CRUD ─────────────────────────────────────────────────
  const editExp = (e) => setExpDraft({
    id: e.id, client: e.client, role: e.role, location: e.location || '',
    start: e.start || '', end: e.end || '', tagsText: (e.tags || []).join(', '),
    bullets: (e.bullets && e.bullets.length) ? [...e.bullets] : ['']
  });
  const saveExp = (ev) => {
    ev.preventDefault();
    if (!expDraft.client.trim() && !expDraft.role.trim()) return;
    const rec = {
      client: expDraft.client.trim(), role: expDraft.role.trim(), location: expDraft.location.trim(),
      start: expDraft.start, end: expDraft.end, tags: parseTags(expDraft.tagsText),
      bullets: expDraft.bullets.map((b) => b.trim()).filter(Boolean)
    };
    if (expDraft.id) setExperiences(experiences.map((e) => e.id === expDraft.id ? { ...e, ...rec } : e));
    else setExperiences([...experiences, { id: newId(), ...rec }]);
    setExpDraft(null);
  };
  const removeExp = (id) => {
    setExperiences(experiences.filter((e) => e.id !== id));
    setOffIds((cur) => { const n = new Set(cur); n.delete(id); return n; });
  };

  const editEdu = (e) => setEduDraft({ id: e.id, degree: e.degree, school: e.school, location: e.location || '', start: e.start || '', end: e.end || '' });
  const saveEdu = (ev) => {
    ev.preventDefault();
    if (!eduDraft.degree.trim() && !eduDraft.school.trim()) return;
    const rec = { degree: eduDraft.degree.trim(), school: eduDraft.school.trim(), location: eduDraft.location.trim(), start: eduDraft.start, end: eduDraft.end };
    if (eduDraft.id) setEducation(education.map((e) => e.id === eduDraft.id ? { ...e, ...rec } : e));
    else setEducation([...education, { id: newId(), ...rec }]);
    setEduDraft(null);
  };
  const removeEdu = (id) => setEducation(education.filter((e) => e.id !== id));

  const profileLinks = parseLines(profile.linksText).map((l) => {
    const [label, url] = l.split('|').map((x) => x.trim());
    return { label: label || url, url: url || label };
  });

  return (
    <div className="cv-layout">
      {/* ── Control panel sidebar ── */}
      <aside className="cv-controls no-print">
        <div className={'card sync-box ' + (isDirty ? 'dirty' : 'clean')}><div className="content">
          <div className="sync-status">
            <span className="sync-dot" />
            <strong>{isDirty ? 'Saved on this device only' : 'Synced to server'}</strong>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {isDirty
              ? 'Your résumé changes are stored locally and are not on the server yet. Push them so they’re backed up and available on your other devices (and the live site).'
              : lastSavedAt
                ? `All changes are on the server (last sync ${new Date(lastSavedAt).toLocaleString()}).`
                : 'No server copy yet — push to back up your résumé.'}
          </div>
          <button
            className="primary" style={{ width: '100%', marginTop: 8 }}
            onClick={syncAll} disabled={isSyncing || (!isDirty && !!lastSavedAt)}
          >
            {isSyncing ? 'Syncing…' : isDirty ? '☁ Sync to server now' : '✓ Up to date'}
          </button>
          {syncError && <div className="err" style={{ marginTop: 6 }}>Sync failed: {syncError}</div>}
        </div></div>

        <div className="card"><div className="content">
          <button className="primary" style={{ width: '100%' }} onClick={() => window.print()}>🖨 Export PDF</button>
          <div className="hint" style={{ marginTop: 6 }}>Uses your browser’s “Save as PDF”. Only the page below prints.</div>

          <hr />
          <label>Layout style
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>

          <label style={{ marginTop: 10 }}>Density
            <select value={density} onChange={(e) => setDensity(e.target.value)}>
              {DENSITIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <div className="hint">Compact/Ultra shrink text &amp; spacing to fit more on one page.</div>

          <hr />
          <label>Filter by tech ({techFilter.length || 'all'})</label>
          <div className="tag-row" style={{ marginTop: 6 }}>
            {techUniverse.length === 0 && <span className="hint">Add tags to skills/experiences first.</span>}
            {techUniverse.map((t) => (
              <button
                type="button" key={t}
                className={'tag-pill selectable' + (techFilter.includes(t) ? ' on' : '')}
                onClick={() => toggleTech(t)}
              >{t}</button>
            ))}
          </div>
          {techFilter.length > 0 && <button className="ghost" style={{ marginTop: 8 }} onClick={() => setTechFilter([])}>Clear tech filter</button>}

          <hr />
          <label>Projects / clients</label>
          <div className="list" style={{ marginTop: 6 }}>
            {experiences.length === 0 && <span className="hint">No experience entries yet.</span>}
            {experiences.map((e) => (
              <label key={e.id} className="check-row">
                <input type="checkbox" checked={!offIds.has(e.id)} onChange={() => toggleExp(e.id)} />
                <span>{e.client || e.role || 'Untitled'}</span>
              </label>
            ))}
          </div>

          <hr />
          <button onClick={() => setShowEditor((s) => !s)} style={{ width: '100%' }}>
            {showEditor ? 'Close data editor' : '✎ Edit CV data'}
          </button>
        </div></div>
      </aside>

      {/* ── Live preview canvas ── */}
      <main className="cv-canvas">
        <div className={`cv-paper layout-${layout} density-${density}`}>
          <header className="cv-head">
            <h1>{profile.name || 'Your Name'}</h1>
            <div className="cv-title">{profile.title || 'Your Title'}</div>
            <div className="cv-contact">
              {[profile.location, profile.email, profile.phone].filter(Boolean).join('  ·  ')}
              {profileLinks.map((l) => <span key={l.url}>  ·  <a href={l.url}>{l.label}</a></span>)}
            </div>
          </header>

          {profile.summary && <section className="cv-section">
            <h2>Summary</h2>
            <p className="cv-summary">{profile.summary}</p>
          </section>}

          {layout === 'project' && visibleSkills.length > 0 && <SkillsBlock skills={visibleSkills} />}

          <section className="cv-section">
            <h2>Experience</h2>
            {visibleExperiences.length === 0 && <p className="cv-muted">No matching experience for the current filters.</p>}
            {visibleExperiences.map((e) => (
              <div className="cv-exp" key={e.id}>
                <div className="cv-exp-head">
                  <div>
                    <span className="cv-role">{e.role || 'Role'}</span>
                    {e.client && <span className="cv-client"> — {e.client}</span>}
                  </div>
                  <div className="cv-dates">{fmtMonth(e.start)} – {fmtMonth(e.end)}{e.location ? `  ·  ${e.location}` : ''}</div>
                </div>
                {(e.bullets || []).length > 0 && (
                  <ul className="cv-bullets">{e.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                )}
                {(e.tags || []).length > 0 && (
                  <div className="cv-exp-tags">{e.tags.map((t) => <span key={t} className="cv-tag">{t}</span>)}</div>
                )}
              </div>
            ))}
          </section>

          {education.length > 0 && (
            <section className="cv-section">
              <h2>Education</h2>
              {education.map((ed) => (
                <div className="cv-exp" key={ed.id}>
                  <div className="cv-exp-head">
                    <div>
                      <span className="cv-role">{ed.degree || 'Degree'}</span>
                      {ed.school && <span className="cv-client"> — {ed.school}</span>}
                    </div>
                    <div className="cv-dates">{fmtMonth(ed.start)} – {fmtMonth(ed.end)}{ed.location ? `  ·  ${ed.location}` : ''}</div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {layout !== 'project' && visibleSkills.length > 0 && <SkillsBlock skills={visibleSkills} />}
        </div>
      </main>

      {/* ── Data editor (off-canvas, never prints) ── */}
      {showEditor && (
        <div className="drawer-backdrop no-print" onClick={() => { setShowEditor(false); setExpDraft(null); }}>
          <div className="drawer wide" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>📄 CV data</h2>

            <h3 className="editor-head">🗂️ Import / export</h3>
            <div className="toolbar">
              <label className="filebtn">
                Import JSON file
                <input type="file" accept="application/json,.json" hidden
                  onChange={(e) => { importFile(e.target.files[0]); e.target.value = ''; }} />
              </label>
              <label className="filebtn">
                Import from PDF
                <input type="file" accept="application/pdf,.pdf" hidden
                  onChange={(e) => { importPdf(e.target.files[0]); e.target.value = ''; }} />
              </label>
              <button type="button" onClick={exportJson}>Export JSON</button>
            </div>
            <details>
              <summary className="hint" style={{ cursor: 'pointer' }}>…or paste JSON</summary>
              <textarea rows={4} placeholder='{"profile":{…},"experiences":[…]}'
                onChange={(e) => setImportMsg('')}
                onBlur={(e) => e.target.value && importJsonText(e.target.value)}
                style={{ width: '100%', marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }} />
              <div className="hint">Paste then click outside the box to import.</div>
            </details>
            {importMsg && <div className="hint" style={{ color: 'var(--ok)', marginTop: 4 }}>{importMsg}</div>}
            {pdfText && (
              <details>
                <summary className="hint" style={{ cursor: 'pointer' }}>Extracted PDF text (copy bullets into roles below)</summary>
                <textarea rows={8} readOnly value={pdfText} style={{ width: '100%', marginTop: 6, fontSize: 12 }} />
              </details>
            )}
            <div className="hint" style={{ marginTop: 4 }}>Importing replaces your current profile, experience and education (and skills, if the file has them).</div>

            <hr />
            <h3 className="editor-head">👤 Profile</h3>
            <div className="toolbar">
              <label style={{ flex: 1 }}>Name<input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
              <label style={{ flex: 1 }}>Title<input value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} /></label>
            </div>
            <div className="toolbar">
              <label style={{ flex: 1 }}>Email<input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
              <label style={{ flex: 1 }}>Phone<input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
              <label style={{ flex: 1 }}>Location<input value={profile.location} onChange={(e) => setProfile({ ...profile, location: e.target.value })} /></label>
            </div>
            <label>Summary<textarea rows={3} value={profile.summary} onChange={(e) => setProfile({ ...profile, summary: e.target.value })} /></label>
            <label>Links (one per line, <code>label | https://url</code>)
              <textarea rows={2} value={profile.linksText} onChange={(e) => setProfile({ ...profile, linksText: e.target.value })} placeholder="GitHub | https://github.com/me" />
            </label>

            <hr />
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h3 className="editor-head" style={{ margin: 0 }}>💼 Experience</h3>
              <button className="primary" onClick={() => setExpDraft(blankExp())} disabled={!!expDraft}>＋ Add experience</button>
            </div>
            <div className="exp-list">
              {/* New entry form (added at the top) */}
              {expDraft && expDraft.id === null && (
                <div className="exp-card editing">
                  <ExperienceForm draft={expDraft} setDraft={setExpDraft} onSave={saveExp} onCancel={() => setExpDraft(null)} isNew />
                </div>
              )}
              {experiences.map((e) => (
                expDraft && expDraft.id === e.id ? (
                  <div className="exp-card editing" key={e.id}>
                    <ExperienceForm draft={expDraft} setDraft={setExpDraft} onSave={saveExp} onCancel={() => setExpDraft(null)} />
                  </div>
                ) : (
                  <div className="exp-card" key={e.id}>
                    <div className="exp-card-head">
                      <div>
                        <strong>💼 {e.role || 'Untitled role'}</strong>{e.client ? ` — ${e.client}` : ''}
                        <div className="hint">
                          {fmtMonth(e.start)} – {fmtMonth(e.end)}{e.location ? ` · ${e.location}` : ''} · {(e.bullets || []).length} bullet{(e.bullets || []).length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="actions">
                        <button onClick={() => editExp(e)} disabled={!!expDraft}>✎ Edit</button>
                        <button className="ghost" onClick={() => removeExp(e.id)} disabled={!!expDraft}>🗑</button>
                      </div>
                    </div>
                  </div>
                )
              ))}
              {experiences.length === 0 && !expDraft && <div className="hint">No experience yet — click “Add experience”.</div>}
            </div>

            <hr />
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h3 className="editor-head" style={{ margin: 0 }}>🎓 Education</h3>
              <button className="primary" onClick={() => setEduDraft(blankEdu())} disabled={!!eduDraft}>＋ Add education</button>
            </div>
            <div className="exp-list">
              {eduDraft && eduDraft.id === null && (
                <div className="exp-card editing">
                  <EducationForm draft={eduDraft} setDraft={setEduDraft} onSave={saveEdu} onCancel={() => setEduDraft(null)} isNew />
                </div>
              )}
              {education.map((e) => (
                eduDraft && eduDraft.id === e.id ? (
                  <div className="exp-card editing" key={e.id}>
                    <EducationForm draft={eduDraft} setDraft={setEduDraft} onSave={saveEdu} onCancel={() => setEduDraft(null)} />
                  </div>
                ) : (
                  <div className="exp-card" key={e.id}>
                    <div className="exp-card-head">
                      <div>
                        <strong>🎓 {e.degree || 'Degree'}</strong>{e.school ? ` — ${e.school}` : ''}
                        <div className="hint">{fmtMonth(e.start)} – {fmtMonth(e.end)}{e.location ? ` · ${e.location}` : ''}</div>
                      </div>
                      <div className="actions">
                        <button onClick={() => editEdu(e)} disabled={!!eduDraft}>✎ Edit</button>
                        <button className="ghost" onClick={() => removeEdu(e.id)} disabled={!!eduDraft}>🗑</button>
                      </div>
                    </div>
                  </div>
                )
              ))}
              {education.length === 0 && !eduDraft && <div className="hint">No education yet — click “Add education”.</div>}
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="primary" onClick={() => { setShowEditor(false); setExpDraft(null); setEduDraft(null); }}>✓ Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExperienceForm({ draft, setDraft, onSave, onCancel, isNew }) {
  const setField = (k, v) => setDraft({ ...draft, [k]: v });
  const setBullet = (i, v) => setDraft({ ...draft, bullets: draft.bullets.map((b, idx) => (idx === i ? v : b)) });
  const addBullet = () => setDraft({ ...draft, bullets: [...draft.bullets, ''] });
  const removeBullet = (i) => setDraft({ ...draft, bullets: draft.bullets.filter((_, idx) => idx !== i) });
  const moveBullet = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= draft.bullets.length) return;
    const b = [...draft.bullets];
    [b[i], b[j]] = [b[j], b[i]];
    setDraft({ ...draft, bullets: b });
  };

  return (
    <form className="exp-edit" onSubmit={onSave}>
      <div className="exp-edit-title">{isNew ? 'New experience' : 'Editing experience'}</div>
      <div className="field-grid">
        <label>Role / title
          <input value={draft.role} autoFocus onChange={(e) => setField('role', e.target.value)} placeholder="DevOps Consultant" />
        </label>
        <label>Client / company
          <input value={draft.client} onChange={(e) => setField('client', e.target.value)} placeholder="TEC" />
        </label>
        <label>Start
          <input type="month" value={draft.start} onChange={(e) => setField('start', e.target.value)} />
        </label>
        <label>End <span className="hint">(blank = Present)</span>
          <input type="month" value={draft.end} onChange={(e) => setField('end', e.target.value)} />
        </label>
        <label className="span2">Location
          <input value={draft.location} onChange={(e) => setField('location', e.target.value)} placeholder="Germany" />
        </label>
        <label className="span2">Tech tags <span className="hint">(comma-separated)</span>
          <input value={draft.tagsText} onChange={(e) => setField('tagsText', e.target.value)} placeholder="kubernetes, argocd, terraform" />
        </label>
      </div>

      <div className="bullets-head">
        <strong>Bullet points</strong>
        <button type="button" onClick={addBullet}>＋ Add bullet</button>
      </div>
      {draft.bullets.length === 0 && <div className="hint">No bullets yet — add achievements, one per bullet.</div>}
      {draft.bullets.map((b, i) => (
        <div className="bullet-row" key={i}>
          <span className="bullet-dot">•</span>
          <textarea
            rows={2} value={b} placeholder="Describe an achievement or responsibility…"
            onChange={(e) => setBullet(i, e.target.value)}
          />
          <div className="bullet-actions">
            <button type="button" title="Move up" onClick={() => moveBullet(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" title="Move down" onClick={() => moveBullet(i, 1)} disabled={i === draft.bullets.length - 1}>↓</button>
            <button type="button" className="ghost" title="Remove bullet" onClick={() => removeBullet(i)}>✕</button>
          </div>
        </div>
      ))}

      <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">{isNew ? 'Add experience' : 'Save changes'}</button>
      </div>
    </form>
  );
}

function EducationForm({ draft, setDraft, onSave, onCancel, isNew }) {
  const setField = (k, v) => setDraft({ ...draft, [k]: v });
  return (
    <form className="exp-edit" onSubmit={onSave}>
      <div className="exp-edit-title">{isNew ? '🎓 New education' : '🎓 Editing education'}</div>
      <div className="field-grid">
        <label className="span2">Degree / programme
          <input value={draft.degree} autoFocus onChange={(e) => setField('degree', e.target.value)} placeholder="Engineering Cycle in Computer Engineering" />
        </label>
        <label className="span2">School
          <input value={draft.school} onChange={(e) => setField('school', e.target.value)} placeholder="ENSA Fès" />
        </label>
        <label>Start
          <input type="month" value={draft.start} onChange={(e) => setField('start', e.target.value)} />
        </label>
        <label>End
          <input type="month" value={draft.end} onChange={(e) => setField('end', e.target.value)} />
        </label>
        <label className="span2">Location
          <input value={draft.location} onChange={(e) => setField('location', e.target.value)} placeholder="Fès, Morocco" />
        </label>
      </div>
      <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">{isNew ? 'Add education' : 'Save changes'}</button>
      </div>
    </form>
  );
}

function SkillsBlock({ skills }) {
  return (
    <section className="cv-section">
      <h2>Skills</h2>
      <div className="cv-skills">
        {skills.map((s) => (
          <span key={s.id} className="cv-skill">
            {s.name}<em> · {s.proficiency}</em>
          </span>
        ))}
      </div>
    </section>
  );
}
