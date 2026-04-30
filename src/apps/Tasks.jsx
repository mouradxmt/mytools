import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const STATUSES = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' }
];
const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'med', label: 'Medium' },
  { id: 'high', label: 'High' }
];

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);

export default function TasksApp() {
  const [tasks, setTasks] = useEncryptedState('tasks/list', []);
  const [filter, setFilter] = useState({ project: 'all', q: '' });
  const [draft, setDraft] = useState({ title: '', project: '', priority: 'med', due: '' });

  const projects = useMemo(() => {
    const set = new Set();
    tasks.forEach((t) => t.project && set.add(t.project));
    return Array.from(set).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter.project !== 'all' && t.project !== filter.project) return false;
      if (q && !(t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, filter]);

  const groups = useMemo(() => {
    const out = { todo: [], in_progress: [], done: [] };
    for (const t of filtered) (out[t.status] || out.todo).push(t);
    Object.values(out).forEach((arr) => arr.sort((a, b) => {
      const pa = ['high', 'med', 'low'].indexOf(a.priority || 'med');
      const pb = ['high', 'med', 'low'].indexOf(b.priority || 'med');
      if (pa !== pb) return pa - pb;
      return (a.due || '').localeCompare(b.due || '');
    }));
    return out;
  }, [filtered]);

  const add = (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setTasks([
      ...tasks,
      {
        id: newId(),
        title: draft.title.trim(),
        project: draft.project.trim(),
        priority: draft.priority,
        due: draft.due,
        status: 'todo',
        notes: '',
        createdAt: new Date().toISOString()
      }
    ]);
    setDraft({ title: '', project: draft.project, priority: 'med', due: '' });
  };

  const update = (id, patch) => setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const remove = (id) => setTasks(tasks.filter((t) => t.id !== id));
  const cycle = (t) => {
    const next = t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'todo';
    update(t.id, { status: next });
  };

  return (
    <>
      <section className="card">
        <h2>Quick add</h2>
        <div className="content">
          <form className="toolbar" onSubmit={add} autoComplete="off">
            <input
              type="text"
              placeholder="What needs to get done?"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              style={{ flex: 1, minWidth: 220 }}
              required
            />
            <input
              type="text"
              placeholder="Project / client"
              value={draft.project}
              list="projects-datalist"
              onChange={(e) => setDraft({ ...draft, project: e.target.value })}
              style={{ width: 160 }}
            />
            <datalist id="projects-datalist">
              {projects.map((p) => <option key={p} value={p} />)}
            </datalist>
            <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
            <button type="submit" className="primary">Add</button>
          </form>
        </div>
      </section>

      <section className="card">
        <h2>Tasks ({filtered.length})</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search…"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              style={{ flex: 1, minWidth: 220 }}
            />
            <select value={filter.project} onChange={(e) => setFilter({ ...filter, project: e.target.value })}>
              <option value="all">All projects</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="tasks-grid">
            {STATUSES.map((s) => (
              <div key={s.id}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--muted)' }}>
                  {s.label} ({groups[s.id].length})
                </h3>
                <div className="list">
                  {groups[s.id].length === 0 && <div className="hint">Nothing here.</div>}
                  {groups[s.id].map((t) => (
                    <div key={t.id} className={`task priority-${t.priority || 'med'} ${t.status === 'done' ? 'done' : ''}`}>
                      <div className="title">{t.title}</div>
                      <div className="meta">
                        {t.project && <span>📁 {t.project}</span>}
                        {t.due && <span>📅 {t.due}</span>}
                        <span>⚑ {t.priority || 'med'}</span>
                      </div>
                      <div className="toolbar" style={{ marginTop: 6 }}>
                        <button onClick={() => cycle(t)}>{
                          t.status === 'todo' ? '▶ Start'
                          : t.status === 'in_progress' ? '✓ Complete'
                          : '↺ Reopen'
                        }</button>
                        <select value={t.priority || 'med'} onChange={(e) => update(t.id, { priority: e.target.value })}>
                          {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <button className="ghost" onClick={() => remove(t.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
