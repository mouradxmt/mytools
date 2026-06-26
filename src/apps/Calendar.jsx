import { useEffect, useMemo, useRef, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const fmtDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};
const parseISO = (s) => { const [y, m, da] = s.split('-').map(Number); return new Date(y, m - 1, da); };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const isWeekend = (d) => { const day = d.getDay(); return day === 0 || day === 6; };
const mondayIndex = (day0) => (day0 + 6) % 7;
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtMAD(n) {
  try {
    return new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 0 }).format(n || 0);
  } catch { return (n || 0) + ' MAD'; }
}

const todayInfo = () => {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
};

export default function CalendarApp({ rotationForDate = null } = {}) {
  const init = todayInfo();
  const [ui, setUi, uiLoaded] = useEncryptedState('calendar/ui', { year: init.y, month: init.m, tjm: 0 });
  const [yearState, setYearState, yearLoaded] = useEncryptedState(
    `calendar/year/${ui.year}`,
    { customHolidays: {}, vacations: [], apiOverrides: {} }
  );

  const [apiHolidays, setApiHolidays] = useState({});
  const [holidayInputs, setHolidayInputs] = useState({ date: '', name: '' });
  const [vacInputs, setVacInputs] = useState({ start: '', end: '', title: '' });

  // Fetch holidays whenever year changes & overrides ready
  const lastFetchYear = useRef(null);
  useEffect(() => {
    if (!yearLoaded || !uiLoaded) return;
    if (lastFetchYear.current === ui.year) {
      // Re-derive enabled state from existing API holidays + overrides
      setApiHolidays((prev) => {
        const out = {};
        for (const [d, info] of Object.entries(prev)) {
          const ov = yearState.apiOverrides[d];
          out[d] = ov ? { ...info, enabled: !!ov.enabled } : { ...info, enabled: info.enabled };
        }
        return out;
      });
      return;
    }
    lastFetchYear.current = ui.year;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${ui.year}/MA`);
        if (!res.ok) throw new Error('Failed to load holidays');
        const data = await res.json();
        if (!alive) return;
        const hols = {};
        for (const h of data) {
          if (!h.types || h.types.includes('Public')) {
            const date = h.date;
            const base = { name: h.localName || h.name, enabled: true };
            const ov = yearState.apiOverrides[date];
            hols[date] = ov ? { ...base, enabled: !!ov.enabled } : base;
          }
        }
        setApiHolidays(hols);
      } catch (e) {
        console.warn('Holidays fetch failed', e);
      }
    })();
    return () => { alive = false; };
  }, [ui.year, yearLoaded, uiLoaded, yearState.apiOverrides]);

  const activeHolidays = useMemo(() => {
    const set = new Set();
    for (const [d, info] of Object.entries(apiHolidays)) if (info.enabled) set.add(d);
    for (const [d, info] of Object.entries(yearState.customHolidays)) if (info.enabled) set.add(d);
    return set;
  }, [apiHolidays, yearState.customHolidays]);

  const vacationsForMonth = useMemo(() => {
    const set = new Set();
    for (const v of yearState.vacations) {
      const s = parseISO(v.start), e = parseISO(v.end);
      const start = new Date(Math.max(s, new Date(ui.year, ui.month, 1)));
      const end = new Date(Math.min(e, new Date(ui.year, ui.month + 1, 0)));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) set.add(fmtDate(d));
    }
    return set;
  }, [yearState.vacations, ui.year, ui.month]);

  const calcWorkingDays = (y, m, dayFrom = 1, dayTo = null) => {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const to = dayTo || daysInMonth;
    let working = 0, weekend = 0, holidays = 0, vacations = 0;
    for (let day = Math.max(1, dayFrom); day <= Math.min(to, daysInMonth); day++) {
      const d = new Date(y, m, day);
      const iso = fmtDate(d);
      if (isWeekend(d)) { weekend++; continue; }
      if (activeHolidays.has(iso)) { holidays++; continue; }
      if (vacationsForMonth.has(iso)) { vacations++; continue; }
      working++;
    }
    return { working, weekend, holidays, vacations };
  };

  const monthStats = calcWorkingDays(ui.year, ui.month);
  const today = new Date();
  let elapsed = 0;
  if (ui.year < today.getFullYear() || (ui.year === today.getFullYear() && ui.month < today.getMonth())) {
    elapsed = monthStats.working;
  } else if (ui.year === today.getFullYear() && ui.month === today.getMonth()) {
    elapsed = calcWorkingDays(ui.year, ui.month, 1, today.getDate()).working;
  }

  // ── Calendar grid ────────────────────────────────────────────────
  const weeks = useMemo(() => {
    const y = ui.year, m = ui.month;
    const first = new Date(y, m, 1);
    const startOffset = mondayIndex(first.getDay());
    const days = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((startOffset + days) / 7);
    const grid = [];
    let day = 1;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < 7; c++) {
        const idx = r * 7 + c;
        if (idx >= startOffset && day <= days) {
          row.push({ day, date: new Date(y, m, day) });
          day++;
        } else row.push(null);
      }
      grid.push(row);
    }
    return grid;
  }, [ui.year, ui.month]);

  // ── Mutations ────────────────────────────────────────────────────
  const toggleApi = (date, current) => {
    setYearState((s) => ({ ...s, apiOverrides: { ...s.apiOverrides, [date]: { enabled: !current } } }));
    setApiHolidays((h) => ({ ...h, [date]: { ...h[date], enabled: !current } }));
  };
  const toggleCustom = (date) => {
    setYearState((s) => {
      const item = s.customHolidays[date];
      return { ...s, customHolidays: { ...s.customHolidays, [date]: { ...item, enabled: !item.enabled } } };
    });
  };
  const deleteCustom = (date) => {
    setYearState((s) => {
      const c = { ...s.customHolidays }; delete c[date];
      return { ...s, customHolidays: c };
    });
  };
  const addCustomHoliday = (e) => {
    e.preventDefault();
    const { date, name } = holidayInputs;
    if (!date || !name.trim()) return;
    setYearState((s) => ({ ...s, customHolidays: { ...s.customHolidays, [date]: { name: name.trim(), enabled: true } } }));
    setHolidayInputs({ date: '', name: '' });
  };
  const resetHolidays = () => {
    setYearState((s) => ({ ...s, customHolidays: {}, apiOverrides: {} }));
    lastFetchYear.current = null; // force refetch
  };
  const addVacation = (e) => {
    e.preventDefault();
    const { start, end, title } = vacInputs;
    if (!start || !end) return;
    if (end < start) { alert('End date must be after start date'); return; }
    const id = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
    setYearState((s) => ({ ...s, vacations: [...s.vacations, { id, start, end, title: title.trim() }] }));
    setVacInputs({ start: '', end: '', title: '' });
  };
  const removeVacation = (id) => {
    setYearState((s) => ({ ...s, vacations: s.vacations.filter((v) => v.id !== id) }));
  };

  // ── Render ───────────────────────────────────────────────────────
  const fmtPretty = (d) => parseISO(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

  const sortedHolidays = useMemo(() => {
    const items = [];
    for (const [d, info] of Object.entries(apiHolidays)) items.push({ d, info, source: 'API' });
    for (const [d, info] of Object.entries(yearState.customHolidays)) items.push({ d, info, source: 'custom' });
    items.sort((a, b) => a.d.localeCompare(b.d));
    return items;
  }, [apiHolidays, yearState.customHolidays]);

  return (
    <>
      <section className="card">
        <h2>Calendar</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <select value={ui.month} onChange={(e) => setUi({ ...ui, month: Number(e.target.value) })}>
              {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={ui.year} onChange={(e) => setUi({ ...ui, year: Number(e.target.value) })}>
              {range(init.y - 3, init.y + 3).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => setUi({ ...ui, year: init.y, month: init.m })}>Today</button>
            <span className="pill">
              Working Days: {monthStats.working} (weekend {monthStats.weekend}, holidays {monthStats.holidays}, vacations {monthStats.vacations})
            </span>
          </div>
          <div className="legend" style={{ marginBottom: 10 }}>
            <span className="chip">Week starts on Monday</span>
            <span><span className="dot wknd"></span> Weekend</span>
            <span><span className="dot holiday"></span> Public Holiday</span>
            <span><span className="dot vacation"></span> Vacation</span>
            {rotationForDate && <span><span className="dot office"></span> Office rotation</span>}
          </div>
          <table className="calendar">
            <thead>
              <tr>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => <th key={d}>{d}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    if (!cell) return <td key={ci}></td>;
                    const iso = fmtDate(cell.date);
                    const wknd = isWeekend(cell.date);
                    const isHol = activeHolidays.has(iso);
                    const isVac = vacationsForMonth.has(iso);
                    const cls = `${wknd ? 'wknd' : ''} ${isHol && isVac ? 'both' : (isHol ? 'holiday' : (isVac ? 'vacation' : ''))}`.trim();
                    const rot = rotationForDate ? rotationForDate(cell.date) : null;
                    return (
                      <td key={ci} className={cls}>
                        <div className="date">{cell.day}</div>
                        {isHol && <div className="badge" style={{ border: '1px solid var(--danger)' }}>Holiday</div>}
                        {isVac && <div className="badge" style={{ border: '1px solid var(--accent)' }}>Vacation</div>}
                        {rot && (
                          <div className={'badge rot' + (rot.isMine ? ' mine' : '')} title={rot.names.join(', ')}>
                            🏢 {rot.isMine ? 'You' : rot.names.join(', ')}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Public Holidays (API + custom)</h2>
          <div className="content">
            <div className="hint">Source: Nager.Date API. Toggle to include/exclude in workday count. Add your own if needed.</div>
            <div className="list" style={{ marginTop: 10 }}>
              {sortedHolidays.map(({ d, info, source }) => (
                <div className="row" key={d + source}>
                  <div>
                    <strong>{info.name}</strong><br />
                    <small>{fmtPretty(d)} • {source}</small>
                  </div>
                  <div className="actions">
                    <button onClick={() => source === 'API' ? toggleApi(d, info.enabled) : toggleCustom(d)}>
                      {info.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {source === 'custom' && <button onClick={() => deleteCustom(d)}>Delete</button>}
                  </div>
                </div>
              ))}
            </div>
            <hr />
            <form className="toolbar" onSubmit={addCustomHoliday} autoComplete="off">
              <input type="date" value={holidayInputs.date} onChange={(e) => setHolidayInputs({ ...holidayInputs, date: e.target.value })} required />
              <input type="text" placeholder="Custom holiday name" value={holidayInputs.name} onChange={(e) => setHolidayInputs({ ...holidayInputs, name: e.target.value })} required />
              <button className="primary" type="submit">Add Holiday</button>
              <button type="button" onClick={resetHolidays}>Reset to API</button>
            </form>
          </div>
        </section>

        <section className="card">
          <h2>Vacations</h2>
          <div className="content">
            <form className="toolbar" onSubmit={addVacation} autoComplete="off">
              <input type="date" value={vacInputs.start} onChange={(e) => setVacInputs({ ...vacInputs, start: e.target.value })} required />
              <input type="date" value={vacInputs.end} onChange={(e) => setVacInputs({ ...vacInputs, end: e.target.value })} required />
              <input type="text" placeholder="Reason (optional)" value={vacInputs.title} onChange={(e) => setVacInputs({ ...vacInputs, title: e.target.value })} />
              <button className="primary" type="submit">Add Vacation</button>
            </form>
            <div className="hint" style={{ marginTop: 6 }}>Vacation days are treated like non-working days if they fall on Mon–Fri.</div>
            <div className="list" style={{ marginTop: 10 }}>
              {yearState.vacations.map((v) => (
                <div className="row" key={v.id}>
                  <div>
                    <strong>{v.title || 'Vacation'}</strong><br />
                    <small>{fmtPretty(v.start)} → {fmtPretty(v.end)}</small>
                  </div>
                  <div className="actions">
                    <button onClick={() => removeVacation(v.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>TJM & Earnings</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <label htmlFor="tjm">TJM (MAD)</label>
            <input
              id="tjm"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 3000"
              value={ui.tjm || ''}
              onChange={(e) => setUi({ ...ui, tjm: Number(e.target.value) || 0 })}
              style={{ width: 140 }}
            />
            <span className="pill">Working days this month: {monthStats.working}</span>
          </div>
          <div className="toolbar">
            <div className="chip">Expected this month: <strong>{fmtMAD(monthStats.working * (ui.tjm || 0))}</strong></div>
            <div className="chip">Accrued since start of the month: <strong>{fmtMAD(elapsed * (ui.tjm || 0))}</strong></div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Accrued = working days elapsed in the selected month × TJM (excludes weekends, public holidays, and vacations).
          </div>
        </div>
      </section>
    </>
  );
}
