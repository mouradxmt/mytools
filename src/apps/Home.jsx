import { useEffect, useMemo, useState } from 'react';
import { useVault } from '../vault/VaultContext.jsx';
import { useEncryptedState } from '../vault/useEncryptedState.js';
import * as backend from '../sync/supabase.js';
import { makeRotationLookup } from '../lib/rotation.js';
import { fetchMoroccoHolidays, activeHolidaySet, vacationSetForMonth } from '../lib/workdays.js';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const monthKey = (iso) => (iso || '').slice(0, 7);
const invTotal = (i) => (i?.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

// Read-only landing page that pulls a "what matters today" view across every
// tool. Everything is derived from the same encrypted namespaces each tool owns.
export default function HomeApp({ onNavigate }) {
  const { session } = useVault();
  const [tasks] = useEncryptedState('tasks/list', []);
  const [tx] = useEncryptedState('finance/tx', []);
  const [settings] = useEncryptedState('finance/settings', { currency: 'MAD' });
  const [recurring] = useEncryptedState('finance/recurring', []);
  const [goals] = useEncryptedState('finance/goals', []);
  const [accounts] = useEncryptedState('finance/accounts', []);
  const [invoices] = useEncryptedState('invoices/list', []);
  const [calUi] = useEncryptedState('calendar/ui', { tjm: 0 });
  const year = new Date().getFullYear();
  const [calYear] = useEncryptedState(`calendar/year/${year}`, { customHolidays: {}, vacations: [], apiOverrides: {} });
  const [overlay] = useEncryptedState('remote/localOverlay', { meName: '' });

  const cur = settings.currency || 'MAD';
  const fmt = (n) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
    catch { return `${Math.round(n || 0)} ${cur}`; }
  };

  const go = (tab, opts) => {
    if (opts?.personalTool) localStorage.setItem('mytools.personalTool', opts.personalTool);
    if (opts?.financeView) localStorage.setItem('mytools.financeView', opts.financeView);
    onNavigate && onNavigate(tab);
  };

  // ── Calendar: holidays (with names) for the current year ────────────────
  const [hol, setHol] = useState({ set: new Set(), map: {} });
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = await fetchMoroccoHolidays(year);
      if (!alive) return;
      const set = activeHolidaySet({ apiHolidays: api, apiOverrides: calYear.apiOverrides, customHolidays: calYear.customHolidays });
      const map = {};
      Object.entries(api).forEach(([d, info]) => { const ov = (calYear.apiOverrides || {})[d]; if (ov ? !!ov.enabled : true) map[d] = info.name; });
      Object.entries(calYear.customHolidays || {}).forEach(([d, info]) => { if (info.enabled) map[d] = info.name; });
      setHol({ set, map });
    })();
    return () => { alive = false; };
  }, [year, calYear.apiOverrides, calYear.customHolidays]);

  // Working days this month: total, elapsed, remaining (today counts as remaining).
  const work = useMemo(() => {
    const now = new Date(), m = now.getMonth(), fromDay = now.getDate();
    const vac = vacationSetForMonth(calYear.vacations || [], year, m);
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    let total = 0, left = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, m, day), dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const iso = isoOf(d);
      if (hol.set.has(iso) || vac.has(iso)) continue;
      total++; if (day >= fromDay) left++;
    }
    return { total, left, elapsed: total - left };
  }, [hol, calYear.vacations, year]);
  const tjm = +calUi.tjm || 0;

  // ── Finance this month + net worth ──────────────────────────────────────
  const fin = useMemo(() => {
    const mk = monthKey(todayISO());
    let income = 0, expense = 0;
    tx.forEach((t) => { if (monthKey(t.date) === mk) { if (t.type === 'income') income += +t.amount || 0; else expense += +t.amount || 0; } });
    const netWorth = accounts.reduce((s, a) => s + (+a.opening || 0), 0)
      + tx.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (+t.amount || 0), 0);
    return { income, expense, net: income - expense, netWorth };
  }, [tx, accounts]);

  const recDue = useMemo(() => {
    const mk = monthKey(todayISO());
    const done = (r) => tx.some((t) => monthKey(t.date) === mk && t.type === r.type && t.category === r.category && Math.abs((+t.amount || 0) - (+r.amount || 0)) < 0.01);
    return recurring.filter((r) => !done(r));
  }, [recurring, tx]);

  // ── Invoices: outstanding + overdue ─────────────────────────────────────
  const inv = useMemo(() => {
    const td = todayISO();
    let outstanding = 0; const overdue = [];
    invoices.forEach((i) => {
      if (i.status === 'paid' || i.status === 'draft') return;
      const total = invTotal(i); outstanding += total;
      if (i.status === 'overdue' || (i.dueDate && i.dueDate < td)) overdue.push({ id: i.id, number: i.number, client: i.client, total, currency: i.currency });
    });
    return { outstanding, overdue };
  }, [invoices]);

  // ── Tasks: due today / overdue / in-progress ────────────────────────────
  const taskDue = useMemo(() => {
    const td = todayISO();
    const open = tasks.filter((t) => t.status !== 'done');
    return {
      overdue: open.filter((t) => t.due && t.due < td),
      today: open.filter((t) => t.due === td),
      inProgress: open.filter((t) => t.status === 'in_progress').length,
      openCount: open.length
    };
  }, [tasks]);

  const goalsActive = useMemo(() =>
    goals.filter((g) => (+g.saved || 0) < (+g.target || 0))
      .sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999')).slice(0, 3),
    [goals]);

  const upcomingHolidays = useMemo(() => {
    const td = todayISO();
    return Object.entries(hol.map).filter(([d]) => d >= td).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 3);
  }, [hol]);

  // ── Rotation: am I remote today? (shared, server-side; optional) ─────────
  const [rotToday, setRotToday] = useState(undefined); // undefined=loading, null=n/a
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const { role, missing } = await backend.getMyRole();
        if (!alive) return;
        if (missing || role === 'none') return setRotToday(null);
        const row = await backend.getSharedRotation();
        const lookup = makeRotationLookup(row?.config, overlay.meName);
        setRotToday(lookup ? lookup(new Date()) : null);
      } catch { if (alive) setRotToday(null); }
    })();
    return () => { alive = false; };
  }, [session, overlay.meName]);

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const reminderCount = recDue.length + inv.overdue.length + taskDue.overdue.length + taskDue.today.length;

  return (
    <>
      <section className="card home-hero">
        <div className="content">
          <div className="home-hero-row">
            <div>
              <h2 style={{ margin: 0 }}>{greeting} 👋</h2>
              <div className="hint">{dateLabel}</div>
            </div>
            <div className="home-hero-badges">
              {rotToday && rotToday.isMine && <span className="pill strong" title="Your remote rotation day">🏠 Remote today</span>}
              {reminderCount > 0
                ? <span className="pill" style={{ color: 'var(--warn)' }}>🔔 {reminderCount} need{reminderCount === 1 ? 's' : ''} attention</span>
                : <span className="pill" style={{ color: 'var(--ok)' }}>✓ All clear</span>}
            </div>
          </div>
        </div>
      </section>

      {/* At-a-glance stats */}
      <section className="card">
        <h2>📊 This month</h2>
        <div className="content">
          <div className="fin-summary">
            <button className="fin-stat balance home-stat" onClick={() => go('calendar')}>
              <span className="lbl">Working days left</span>
              <strong>{work.left}<small className="hint"> / {work.total}</small></strong>
            </button>
            <button className="fin-stat income home-stat" onClick={() => go('invoices')}>
              <span className="lbl">{tjm ? `Projected (${work.left}d × TJM)` : 'Set your TJM in Calendar'}</span>
              <strong>{tjm ? fmt(work.left * tjm) : '—'}</strong>
            </button>
            <button className={'fin-stat home-stat ' + (fin.net >= 0 ? 'income' : 'expense')} onClick={() => go('personal', { personalTool: 'finance', financeView: 'overview' })}>
              <span className="lbl">Net this month</span>
              <strong>{fmt(fin.net)}</strong>
            </button>
            <button className="fin-stat balance home-stat" onClick={() => go('personal', { personalTool: 'finance', financeView: 'accounts' })}>
              <span className="lbl">Net worth</span>
              <strong>{fmt(fin.netWorth)}</strong>
            </button>
          </div>
        </div>
      </section>

      <div className="grid-2">
        {/* Needs attention */}
        <section className="card">
          <h2>🔔 Needs attention</h2>
          <div className="content">
            {reminderCount === 0 && <div className="hint">Nothing due right now. Enjoy the calm. ☕</div>}
            <div className="list">
              {taskDue.overdue.map((t) => (
                <button className="row home-reminder" key={'to-' + t.id} onClick={() => go('tasks')}>
                  <div><span className="rem-tag danger">Task overdue</span> {t.title}{t.due ? <small className="hint"> · {t.due}</small> : null}</div>
                  <span className="rem-go">→</span>
                </button>
              ))}
              {taskDue.today.map((t) => (
                <button className="row home-reminder" key={'tt-' + t.id} onClick={() => go('tasks')}>
                  <div><span className="rem-tag warn">Task today</span> {t.title}</div>
                  <span className="rem-go">→</span>
                </button>
              ))}
              {inv.overdue.map((i) => (
                <button className="row home-reminder" key={'iv-' + i.id} onClick={() => go('invoices')}>
                  <div><span className="rem-tag danger">Invoice overdue</span> #{i.number || '—'} · {i.client || 'Untitled'} <small className="hint">· {fmt(i.total)}</small></div>
                  <span className="rem-go">→</span>
                </button>
              ))}
              {recDue.map((r) => (
                <button className="row home-reminder" key={'rc-' + r.id} onClick={() => go('personal', { personalTool: 'finance', financeView: 'recurring' })}>
                  <div><span className="rem-tag">Bill due</span> {r.category} <small className="hint">· {fmt(r.amount)} · day {r.day}</small></div>
                  <span className="rem-go">→</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Money snapshot */}
        <section className="card">
          <h2>💵 Money</h2>
          <div className="content">
            <div className="list">
              <button className="row home-reminder" onClick={() => go('personal', { personalTool: 'finance', financeView: 'overview' })}>
                <div>Income this month</div><strong className="pos">{fmt(fin.income)}</strong>
              </button>
              <button className="row home-reminder" onClick={() => go('personal', { personalTool: 'finance', financeView: 'transactions' })}>
                <div>Expenses this month</div><strong className="neg">{fmt(fin.expense)}</strong>
              </button>
              <button className="row home-reminder" onClick={() => go('invoices')}>
                <div>Invoices outstanding{inv.overdue.length ? <small className="hint"> · {inv.overdue.length} overdue</small> : null}</div>
                <strong>{fmt(inv.outstanding)}</strong>
              </button>
            </div>
            {goalsActive.length > 0 && (
              <>
                <div className="hint" style={{ margin: '12px 0 6px' }}>Savings goals</div>
                <div className="list">
                  {goalsActive.map((g) => {
                    const ratio = (+g.target || 0) ? Math.min(1, (+g.saved || 0) / (+g.target || 0)) : 0;
                    return (
                      <button className="goal-card home-reminder" key={g.id} onClick={() => go('personal', { personalTool: 'finance', financeView: 'goals' })}>
                        <div className="goal-head">
                          <strong>{g.name}</strong>
                          <span className="goal-nums">{fmt(+g.saved || 0)} / {fmt(+g.target || 0)}{g.targetDate ? ` · by ${g.targetDate}` : ''}</span>
                        </div>
                        <div className="goal-track"><div className="goal-fill" style={{ width: (ratio * 100) + '%' }} /></div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="grid-2">
        {/* Work / rotation */}
        <section className="card">
          <h2>🗓️ Work</h2>
          <div className="content">
            <div className="list">
              {rotToday && rotToday.display && (
                <div className="row">
                  <div>Remote today</div>
                  <strong>{rotToday.isMine ? '🏠 You' : rotToday.display.join(', ')}</strong>
                </div>
              )}
              <button className="row home-reminder" onClick={() => go('tasks')}>
                <div>Open tasks{taskDue.inProgress ? <small className="hint"> · {taskDue.inProgress} in progress</small> : null}</div>
                <strong>{taskDue.openCount}</strong>
              </button>
              <button className="row home-reminder" onClick={() => go('calendar')}>
                <div>Worked so far this month</div>
                <strong>{work.elapsed} day{work.elapsed === 1 ? '' : 's'}{tjm ? <small className="hint"> · {fmt(work.elapsed * tjm)}</small> : null}</strong>
              </button>
            </div>
          </div>
        </section>

        {/* Upcoming */}
        <section className="card">
          <h2>📅 Upcoming holidays</h2>
          <div className="content">
            {upcomingHolidays.length === 0 && <div className="hint">No upcoming public holidays this year.</div>}
            <div className="list">
              {upcomingHolidays.map(([d, name]) => {
                const days = Math.round((new Date(d) - new Date(todayISO())) / 86400000);
                return (
                  <button className="row home-reminder" key={d} onClick={() => go('calendar')}>
                    <div>{name}<small className="hint"> · {new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</small></div>
                    <span className="pill">{days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
