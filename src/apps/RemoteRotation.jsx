import { useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const DEFAULT_CONFIG = {
  startDate: '2026-01-19',
  cycleDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  people: [{ name: 'Me', startDayIndex: 0 }],
  weeksAhead: 8
};

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function addDays(date, days) {
  const r = new Date(date); r.setDate(r.getDate() + days); return r;
}

export default function RemoteRotationApp() {
  const [config, setConfig] = useEncryptedState('remote/config', DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [newDay, setNewDay] = useState('');
  const [newPerson, setNewPerson] = useState({ name: '', startDayIndex: '' });
  const [draftStart, setDraftStart] = useState(config.startDate);

  const cycleLength = Math.max(1, config.cycleDays.length);
  const startDate = new Date(config.startDate);
  const today = new Date();
  const realMonday = getMonday(today); realMonday.setHours(0, 0, 0, 0);

  const weeks = [];
  for (let i = 0; i < (config.weeksAhead || 8); i++) {
    const ws = addDays(startDate, i * 7); ws.setHours(0, 0, 0, 0);
    const shift = i;
    const isCurrent = ws.getTime() === realMonday.getTime();
    const formatted = ws.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const dayAssignments = config.cycleDays.map((dayName, cycleIndex) => {
      const assigned = config.people.filter((p) => (p.startDayIndex + shift) % cycleLength === cycleIndex).map((p) => p.name);
      return { dayName, assigned };
    });
    weeks.push({ formatted, shift, isCurrent, dayAssignments });
  }

  const addCycleDay = () => {
    if (!newDay.trim()) return;
    setConfig({ ...config, cycleDays: [...config.cycleDays, newDay.trim()] });
    setNewDay('');
  };
  const removeCycleDay = (i) => {
    setConfig({ ...config, cycleDays: config.cycleDays.filter((_, idx) => idx !== i) });
  };
  const addPerson = () => {
    if (!newPerson.name.trim() || newPerson.startDayIndex === '') return;
    setConfig({
      ...config,
      people: [...config.people, { name: newPerson.name.trim(), startDayIndex: parseInt(newPerson.startDayIndex, 10) }]
    });
    setNewPerson({ name: '', startDayIndex: '' });
  };
  const removePerson = (i) => {
    setConfig({ ...config, people: config.people.filter((_, idx) => idx !== i) });
  };
  const saveAndClose = () => {
    setConfig({ ...config, startDate: draftStart });
    setShowConfig(false);
  };
  const reset = () => {
    if (!confirm('Reset to default settings?')) return;
    setConfig(DEFAULT_CONFIG);
    setDraftStart(DEFAULT_CONFIG.startDate);
  };

  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🗓️ Remote Rotation</h2>
        <button onClick={() => { setDraftStart(config.startDate); setShowConfig((s) => !s); }}>
          ⚙️ {showConfig ? 'Close settings' : 'Settings'}
        </button>
      </div>

      {showConfig && (
        <section className="card">
          <h2>Configuration</h2>
          <div className="content">
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label>Reference start date (Week 0)</label>
              <input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
              <div className="hint">Schedule is computed from this Monday.</div>
            </div>

            <hr />
            <label>Rotation days cycle</label>
            <div className="toolbar" style={{ marginTop: 6 }}>
              {config.cycleDays.map((d, i) => (
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
              {config.people.map((p, i) => (
                <div className="row" key={p.name + i}>
                  <div><strong>{p.name}</strong> starts on <strong>{config.cycleDays[p.startDayIndex] || 'Unknown'}</strong></div>
                  <button onClick={() => removePerson(i)}>Remove</button>
                </div>
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <input type="text" placeholder="Name" value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
              <select value={newPerson.startDayIndex} onChange={(e) => setNewPerson({ ...newPerson, startDayIndex: e.target.value })}>
                <option value="" disabled>Select initial day</option>
                {config.cycleDays.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <button className="primary" onClick={addPerson}>Add person</button>
            </div>

            <hr />
            <div className="toolbar">
              <label>Weeks to display</label>
              <input
                type="number"
                min="1"
                max="26"
                value={config.weeksAhead || 8}
                onChange={(e) => setConfig({ ...config, weeksAhead: Math.max(1, Number(e.target.value) || 8) })}
                style={{ width: 80 }}
              />
            </div>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="primary" onClick={saveAndClose}>Save & refresh</button>
              <button onClick={reset}>Reset to defaults</button>
            </div>
          </div>
        </section>
      )}

      {weeks.map((w, i) => (
        <div key={i} className={'week-card' + (w.isCurrent ? ' current' : '')}>
          <div className="week-header">
            Week of {w.formatted} <span style={{ fontWeight: 400, fontSize: '.9em', color: 'var(--muted)' }}>(Shift +{w.shift})</span>
          </div>
          <div className="day-grid">
            {w.dayAssignments.map((d) => (
              <div key={d.dayName} className="day-column">
                <div className="day-header">{d.dayName}</div>
                <div className="day-content">
                  {d.assigned.length
                    ? d.assigned.map((n) => <span key={n} className="person-tag">{n}</span>)
                    : <span style={{ color: 'var(--muted)', fontSize: '0.8em' }}>No one</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
