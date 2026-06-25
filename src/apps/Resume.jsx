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
const blankExp = () => ({ id: null, client: '', role: '', location: '', start: '', end: '', tagsText: '', bulletsText: '' });
const blankEdu = () => ({ id: null, degree: '', school: '', location: '', start: '', end: '' });

export default function ResumeApp() {
  const [profile, setProfile] = useEncryptedState('resume/profile', blankProfile());
  const [experiences, setExperiences] = useEncryptedState('resume/experiences', []);
  const [education, setEducation] = useEncryptedState('resume/education', []);
  const [skills, setSkills] = useEncryptedState('knowledge/skills', []);

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
    start: e.start || '', end: e.end || '', tagsText: (e.tags || []).join(', '), bulletsText: (e.bullets || []).join('\n')
  });
  const saveExp = (ev) => {
    ev.preventDefault();
    if (!expDraft.client.trim() && !expDraft.role.trim()) return;
    const rec = {
      client: expDraft.client.trim(), role: expDraft.role.trim(), location: expDraft.location.trim(),
      start: expDraft.start, end: expDraft.end, tags: parseTags(expDraft.tagsText), bullets: parseLines(expDraft.bulletsText)
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
            <h2 style={{ marginTop: 0 }}>CV data</h2>

            <h3>Import / export</h3>
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
            <h3>Profile</h3>
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
              <h3 style={{ margin: 0 }}>Experience</h3>
              <button className="primary" onClick={() => setExpDraft(blankExp())}>＋ Add</button>
            </div>
            <div className="list" style={{ marginTop: 8 }}>
              {experiences.map((e) => (
                <div className="row" key={e.id}>
                  <div><strong>{e.role || 'Role'}</strong>{e.client ? ` — ${e.client}` : ''}<br /><small>{fmtMonth(e.start)} – {fmtMonth(e.end)}</small></div>
                  <div className="actions">
                    <button onClick={() => editExp(e)}>Edit</button>
                    <button className="ghost" onClick={() => removeExp(e.id)}>Delete</button>
                  </div>
                </div>
              ))}
              {experiences.length === 0 && <div className="hint">No entries yet.</div>}
            </div>

            {expDraft && (
              <form onSubmit={saveExp} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="toolbar">
                  <label style={{ flex: 1 }}>Role<input value={expDraft.role} onChange={(e) => setExpDraft({ ...expDraft, role: e.target.value })} /></label>
                  <label style={{ flex: 1 }}>Client / company<input value={expDraft.client} onChange={(e) => setExpDraft({ ...expDraft, client: e.target.value })} /></label>
                </div>
                <div className="toolbar">
                  <label>Start<input type="month" value={expDraft.start} onChange={(e) => setExpDraft({ ...expDraft, start: e.target.value })} /></label>
                  <label>End <small className="hint">(blank = Present)</small><input type="month" value={expDraft.end} onChange={(e) => setExpDraft({ ...expDraft, end: e.target.value })} /></label>
                  <label style={{ flex: 1 }}>Location<input value={expDraft.location} onChange={(e) => setExpDraft({ ...expDraft, location: e.target.value })} /></label>
                </div>
                <label>Tech tags (comma-separated)
                  <input value={expDraft.tagsText} onChange={(e) => setExpDraft({ ...expDraft, tagsText: e.target.value })} placeholder="kubernetes, argocd, terraform" />
                </label>
                <label>Bullet points (one per line)
                  <textarea rows={5} value={expDraft.bulletsText} onChange={(e) => setExpDraft({ ...expDraft, bulletsText: e.target.value })} />
                </label>
                <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setExpDraft(null)}>Cancel</button>
                  <button type="submit" className="primary">{expDraft.id ? 'Save' : 'Add'}</button>
                </div>
              </form>
            )}

            <hr />
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Education</h3>
              <button className="primary" onClick={() => setEduDraft(blankEdu())}>＋ Add</button>
            </div>
            <div className="list" style={{ marginTop: 8 }}>
              {education.map((e) => (
                <div className="row" key={e.id}>
                  <div><strong>{e.degree || 'Degree'}</strong>{e.school ? ` — ${e.school}` : ''}<br /><small>{fmtMonth(e.start)} – {fmtMonth(e.end)}</small></div>
                  <div className="actions">
                    <button onClick={() => editEdu(e)}>Edit</button>
                    <button className="ghost" onClick={() => removeEdu(e.id)}>Delete</button>
                  </div>
                </div>
              ))}
              {education.length === 0 && <div className="hint">No education entries yet.</div>}
            </div>
            {eduDraft && (
              <form onSubmit={saveEdu} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="toolbar">
                  <label style={{ flex: 1 }}>Degree<input value={eduDraft.degree} onChange={(e) => setEduDraft({ ...eduDraft, degree: e.target.value })} /></label>
                  <label style={{ flex: 1 }}>School<input value={eduDraft.school} onChange={(e) => setEduDraft({ ...eduDraft, school: e.target.value })} /></label>
                </div>
                <div className="toolbar">
                  <label>Start<input type="month" value={eduDraft.start} onChange={(e) => setEduDraft({ ...eduDraft, start: e.target.value })} /></label>
                  <label>End<input type="month" value={eduDraft.end} onChange={(e) => setEduDraft({ ...eduDraft, end: e.target.value })} /></label>
                  <label style={{ flex: 1 }}>Location<input value={eduDraft.location} onChange={(e) => setEduDraft({ ...eduDraft, location: e.target.value })} /></label>
                </div>
                <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEduDraft(null)}>Cancel</button>
                  <button type="submit" className="primary">{eduDraft.id ? 'Save' : 'Add'}</button>
                </div>
              </form>
            )}

            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => { setShowEditor(false); setExpDraft(null); setEduDraft(null); }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
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
