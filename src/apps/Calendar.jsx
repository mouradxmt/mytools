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
  // Click-a-day editor
  const [dayModal, setDayModal] = useState(null);   // ISO date string or null
  const [dayHolName, setDayHolName] = useState('');
  const [dayVacEnd, setDayVacEnd] = useState('');
  const [dayVacTitle, setDayVacTitle] = useState('');

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
  const todayISO = fmtDate(today);
  const shiftMonth = (delta) => {
    let m = ui.month + delta, y = ui.year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setUi({ ...ui, year: y, month: m });
  };

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
  const openDay = (iso) => { setDayModal(iso); setDayHolName(''); setDayVacEnd(iso); setDayVacTitle(''); };
  const addCustomHolidayFor = (date, name) => {
    setYearState((s) => ({ ...s, customHolidays: { ...s.customHolidays, [date]: { name: (name || 'Holiday').trim(), enabled: true } } }));
  };
  const resetHolidays = () => {
    setYearState((s) => ({ ...s, customHolidays: {}, apiOverrides: {} }));
    lastFetchYear.current = null; // force refetch
  };
  const addVacationRange = (start, end, title) => {
    if (!start) return;
    if (!end) end = start;
    if (end < start) { const t = start; start = end; end = t; }
    const id = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
    setYearState((s) => ({ ...s, vacations: [...s.vacations, { id, start, end, title: (title || '').trim() }] }));
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
            <button className="nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month" title="Previous month">‹</button>
            <select value={ui.month} onChange={(e) => setUi({ ...ui, month: Number(e.target.value) })}>
              {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={ui.year} onChange={(e) => setUi({ ...ui, year: Number(e.target.value) })}>
              {range(init.y - 3, init.y + 3).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month" title="Next month">›</button>
            <button onClick={() => setUi({ ...ui, year: init.y, month: init.m })}>Today</button>
          </div>
          <div className="cal-summary" style={{ marginBottom: 10 }}>
            <span className="chip strong">🗓️ {monthStats.working} working days</span>
            <span className="chip">🛌 {monthStats.weekend} weekend</span>
            <span className="chip">🎉 {monthStats.holidays} holiday{monthStats.holidays === 1 ? '' : 's'}</span>
            <span className="chip">🏖️ {monthStats.vacations} vacation{monthStats.vacations === 1 ? '' : 's'}</span>
          </div>
          <div className="legend" style={{ marginBottom: 10 }}>
            <span><span className="dot wknd"></span> Weekend</span>
            <span><span className="dot holiday"></span> Holiday</span>
            <span><span className="dot vacation"></span> Vacation</span>
            {rotationForDate && <span><span className="dot office"></span> Remote day</span>}
            <span className="hint">💡 Click any day to add a holiday or vacation</span>
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
                    const isToday = iso === todayISO;
                    return (
                      <td key={ci} className={('day-cell ' + cls + (isToday ? ' today' : '')).trim()}
                        onClick={() => openDay(iso)} title="Click to add a holiday or vacation">
                        <div className="date"><span className="num">{cell.day}</span></div>
                        {isHol && <div className="badge hol" title="Public holiday">🎉 Holiday</div>}
                        {isVac && <div className="badge vac" title="Vacation">🏖️ Vacation</div>}
                        {rot && (
                          <div className={'badge rot' + (rot.isMine ? ' mine' : '')} title={'Remote: ' + rot.names.join(', ')}>
                            🏢 {rot.display.join(', ')}
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
          <h2>🎉 Public holidays</h2>
          <div className="content">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <span className="hint">Morocco holidays (Nager.Date) + your own. Toggle to include in the workday count.</span>
              <button onClick={resetHolidays}>Reset to API</button>
            </div>
            <div className="list" style={{ marginTop: 10 }}>
              {sortedHolidays.length === 0 && <div className="hint">No holidays loaded.</div>}
              {sortedHolidays.map(({ d, info, source }) => (
                <div className="row" key={d + source} style={{ opacity: info.enabled ? 1 : 0.5 }}>
                  <div>
                    <strong>{info.name}</strong><br />
                    <small>{fmtPretty(d)} • {source}</small>
                  </div>
                  <div className="actions">
                    <button onClick={() => source === 'API' ? toggleApi(d, info.enabled) : toggleCustom(d)}>
                      {info.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {source === 'custom' && <button className="ghost" onClick={() => deleteCustom(d)}>🗑</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>🏖️ Vacations</h2>
          <div className="content">
            <div className="hint">Click a day on the calendar to add one. Vacation days on Mon–Fri count as non-working.</div>
            <div className="list" style={{ marginTop: 10 }}>
              {yearState.vacations.length === 0 && <div className="hint">No vacations yet.</div>}
              {yearState.vacations.map((v) => (
                <div className="row" key={v.id}>
                  <div>
                    <strong>{v.title || 'Vacation'}</strong><br />
                    <small>{fmtPretty(v.start)} → {fmtPretty(v.end)}</small>
                  </div>
                  <div className="actions">
                    <button className="ghost" onClick={() => removeVacation(v.id)}>🗑</button>
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

      {dayModal && (() => {
        const iso = dayModal;
        const dObj = parseISO(iso);
        const api = apiHolidays[iso];
        const custom = yearState.customHolidays[iso];
        const covering = yearState.vacations.filter((v) => v.start <= iso && iso <= v.end);
        return (
          <div className="modal-backdrop" onClick={() => setDayModal(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: 0 }}>{dObj.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
              {isWeekend(dObj) && <div className="hint">Weekend — already a non-working day.</div>}

              <div className="day-sec">
                <strong>🎉 Public holiday</strong>
                {api ? (
                  <div className="row">
                    <div>{api.name} <small className="hint">(Morocco)</small></div>
                    <button onClick={() => toggleApi(iso, api.enabled)}>{api.enabled ? 'Disable' : 'Enable'}</button>
                  </div>
                ) : custom ? (
                  <div className="row">
                    <div>{custom.name} <small className="hint">(custom)</small></div>
                    <div className="actions">
                      <button onClick={() => toggleCustom(iso)}>{custom.enabled ? 'Disable' : 'Enable'}</button>
                      <button className="ghost" onClick={() => deleteCustom(iso)}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (!dayHolName.trim()) return; addCustomHolidayFor(iso, dayHolName); setDayHolName(''); }}>
                    <input type="text" placeholder="Holiday name (e.g. Team off-day)" value={dayHolName} onChange={(e) => setDayHolName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                    <button className="primary" type="submit">Mark as holiday</button>
                  </form>
                )}
              </div>

              <hr />
              <div className="day-sec">
                <strong>🏖️ Vacation</strong>
                {covering.map((v) => (
                  <div className="row" key={v.id}>
                    <div>{v.title || 'Vacation'}<br /><small>{fmtPretty(v.start)} → {fmtPretty(v.end)}</small></div>
                    <button className="ghost" onClick={() => removeVacation(v.id)}>Remove</button>
                  </div>
                ))}
                <form className="toolbar" onSubmit={(e) => { e.preventDefault(); addVacationRange(iso, dayVacEnd || iso, dayVacTitle); setDayModal(null); }}>
                  <span className="hint">From {fmtPretty(iso)} to</span>
                  <input type="date" value={dayVacEnd} min={iso} onChange={(e) => setDayVacEnd(e.target.value)} />
                  <input type="text" placeholder="Reason (optional)" value={dayVacTitle} onChange={(e) => setDayVacTitle(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                  <button className="primary" type="submit">Add vacation</button>
                </form>
              </div>

              <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setDayModal(null)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
