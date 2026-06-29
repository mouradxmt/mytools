import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => (iso || '').slice(0, 7);
const CAT_SUGGESTIONS = ['Salary', 'Freelance', 'Rent', 'Groceries', 'Transport', 'Utilities', 'Dining', 'Health', 'Shopping', 'Subscriptions', 'Savings', 'Other'];
const blankDraft = () => ({ id: null, type: 'expense', amount: '', category: '', date: todayISO(), account: '', note: '' });
const blankRec = () => ({ id: null, type: 'expense', amount: '', category: '', day: 1, account: '', note: '' });

const normalizeDate = (s) => {
  s = (s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? todayISO() : d.toISOString().slice(0, 10);
};

function parseCsv(text) {
  const rows = []; let field = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export default function FinanceApp() {
  const [tx, setTx] = useEncryptedState('finance/tx', []);
  const [settings, setSettings] = useEncryptedState('finance/settings', { currency: 'MAD' });
  const [budgets, setBudgets] = useEncryptedState('finance/budgets', {});
  const [recurring, setRecurring] = useEncryptedState('finance/recurring', []);

  const [draft, setDraft] = useState(blankDraft());
  const [filter, setFilter] = useState({ month: monthKey(todayISO()), type: 'all', q: '' });
  const [importMsg, setImportMsg] = useState('');
  const [recDraft, setRecDraft] = useState(null);
  const [newBudget, setNewBudget] = useState({ category: '', amount: '' });

  const cur = settings.currency || 'MAD';
  const fmtMoney = (n) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
    catch { return `${Math.round(n || 0)} ${cur}`; }
  };

  const periodMonth = filter.month === 'all' ? monthKey(todayISO()) : filter.month;
  const periodLabel = filter.month === 'all' ? 'All time' : new Date(filter.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const budgetMonthLabel = new Date(periodMonth + '-01').toLocaleDateString(undefined, { month: 'long' });

  const months = useMemo(() => {
    const set = new Set(tx.map((t) => monthKey(t.date)).filter(Boolean));
    set.add(monthKey(todayISO()));
    return Array.from(set).sort().reverse();
  }, [tx]);

  const categories = useMemo(() => {
    const set = new Set(CAT_SUGGESTIONS);
    tx.forEach((t) => t.category && set.add(t.category));
    Object.keys(budgets).forEach((c) => set.add(c));
    return Array.from(set);
  }, [tx, budgets]);

  const quickCats = useMemo(() => {
    const counts = {};
    tx.forEach((t) => { if (t.category) counts[t.category] = (counts[t.category] || 0) + 1; });
    recurring.forEach((r) => { if (r.category) counts[r.category] = (counts[r.category] || 0) + 3; });
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    return (ranked.length ? ranked : CAT_SUGGESTIONS).slice(0, 8);
  }, [tx, recurring]);

  const inPeriod = useMemo(() => tx.filter((t) => filter.month === 'all' || monthKey(t.date) === filter.month), [tx, filter.month]);
  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return inPeriod
      .filter((t) => filter.type === 'all' || t.type === filter.type)
      .filter((t) => !q || (t.category || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (t.account || '').toLowerCase().includes(q))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [inPeriod, filter]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    inPeriod.forEach((t) => { if (t.type === 'income') income += +t.amount || 0; else expense += +t.amount || 0; });
    const balance = tx.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (+t.amount || 0), 0);
    return { income, expense, net: income - expense, balance };
  }, [inPeriod, tx]);

  // Spending per category for the budget/selected month.
  const spentByCat = useMemo(() => {
    const map = {};
    tx.filter((t) => t.type === 'expense' && monthKey(t.date) === periodMonth).forEach((t) => {
      const c = t.category || 'Uncategorized'; map[c] = (map[c] || 0) + (+t.amount || 0);
    });
    return map;
  }, [tx, periodMonth]);

  const byCategory = useMemo(() => {
    const arr = Object.entries(spentByCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    const max = arr.reduce((m, c) => Math.max(m, c.amount), 0);
    return { arr: arr.slice(0, 8), max };
  }, [spentByCat]);

  const budgetRows = useMemo(() => {
    const cats = new Set([...Object.keys(budgets), ...Object.keys(spentByCat)]);
    return Array.from(cats).map((c) => ({ category: c, budget: budgets[c] || 0, spent: spentByCat[c] || 0 }))
      .sort((a, b) => (b.budget || b.spent) - (a.budget || a.spent));
  }, [budgets, spentByCat]);
  const totalBudget = useMemo(() => Object.values(budgets).reduce((s, v) => s + (+v || 0), 0), [budgets]);
  const totalSpent = useMemo(() => Object.values(spentByCat).reduce((s, v) => s + v, 0), [spentByCat]);

  const monthly = useMemo(() => {
    const now = new Date();
    const list = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { key, label: d.toLocaleDateString(undefined, { month: 'short' }), income: 0, expense: 0 };
    });
    const idx = Object.fromEntries(list.map((m, i) => [m.key, i]));
    tx.forEach((t) => { const i = idx[monthKey(t.date)]; if (i != null) { if (t.type === 'income') list[i].income += +t.amount || 0; else list[i].expense += +t.amount || 0; } });
    const max = list.reduce((m, x) => Math.max(m, x.income, x.expense), 0);
    return { list, max };
  }, [tx]);

  // ── Mutations ────────────────────────────────────────────────────
  const save = (e) => {
    e.preventDefault();
    const amount = Number(draft.amount);
    if (!amount || amount <= 0) return;
    const rec = { type: draft.type, amount, category: draft.category.trim() || 'Uncategorized', date: draft.date || todayISO(), account: draft.account.trim(), note: draft.note.trim() };
    if (draft.id) setTx(tx.map((t) => (t.id === draft.id ? { ...t, ...rec } : t)));
    else setTx([...tx, { id: newId(), createdAt: new Date().toISOString(), ...rec }]);
    setDraft({ ...blankDraft(), type: draft.type });
  };
  const editTx = (t) => setDraft({ id: t.id, type: t.type, amount: String(t.amount), category: t.category, date: t.date, account: t.account || '', note: t.note || '' });
  const removeTx = (id) => { setTx(tx.filter((t) => t.id !== id)); if (draft.id === id) setDraft(blankDraft()); };

  const setBudget = (cat, amount) => {
    const a = Number(amount) || 0;
    setBudgets((b) => { const nb = { ...b }; if (a > 0) nb[cat] = a; else delete nb[cat]; return nb; });
  };
  const addBudget = (e) => {
    e.preventDefault();
    const c = newBudget.category.trim(); const a = Number(newBudget.amount) || 0;
    if (!c || a <= 0) return;
    setBudget(c, a); setNewBudget({ category: '', amount: '' });
  };

  const saveRec = (e) => {
    e.preventDefault();
    if (!recDraft.amount || Number(recDraft.amount) <= 0) return;
    const rec = { type: recDraft.type, amount: Number(recDraft.amount), category: recDraft.category.trim() || 'Uncategorized', day: Math.min(28, Math.max(1, +recDraft.day || 1)), account: recDraft.account.trim(), note: recDraft.note.trim() };
    if (recDraft.id) setRecurring(recurring.map((r) => (r.id === recDraft.id ? { ...r, ...rec } : r)));
    else setRecurring([...recurring, { id: newId(), ...rec }]);
    setRecDraft(null);
  };
  const removeRec = (id) => setRecurring(recurring.filter((r) => r.id !== id));
  const recDoneThisMonth = (r) => tx.some((t) => monthKey(t.date) === periodMonth && t.type === r.type && t.category === r.category && Math.abs((+t.amount || 0) - (+r.amount || 0)) < 0.01);
  const applyRec = (r) => {
    const date = `${periodMonth}-${String(r.day || 1).padStart(2, '0')}`;
    setTx([...tx, { id: newId(), createdAt: new Date().toISOString(), type: r.type, amount: +r.amount || 0, category: r.category, account: r.account || '', note: r.note || '(recurring)', date }]);
  };

  const exportCsv = () => {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'Note']];
    [...tx].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach((t) => rows.push([t.date, t.type, t.amount, cur, t.category, t.account || '', t.note || '']));
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `finance-${filter.month === 'all' ? 'all' : filter.month}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const importCsv = async (file) => {
    if (!file) return;
    setImportMsg('Reading…');
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) { setImportMsg('Empty file.'); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const col = (name) => header.indexOf(name);
      const di = col('date'), ti = col('type'), ami = col('amount'), ci = col('category'), aci = col('account'), ni = col('note');
      const start = di >= 0 || ami >= 0 ? 1 : 0;
      const added = [];
      for (let r = start; r < rows.length; r++) {
        const c = rows[r];
        const raw = (c[ami >= 0 ? ami : 2] || '').toString().replace(/[^\d.-]/g, '');
        const amount = Number(raw);
        if (!amount) continue;
        const tstr = (c[ti >= 0 ? ti : 1] || '').toLowerCase();
        const type = tstr.includes('inc') ? 'income' : tstr.includes('exp') ? 'expense' : (amount < 0 ? 'expense' : 'income');
        added.push({
          id: newId(), createdAt: new Date().toISOString(), type, amount: Math.abs(amount),
          category: (c[ci >= 0 ? ci : 4] || 'Uncategorized').trim() || 'Uncategorized',
          date: normalizeDate(c[di >= 0 ? di : 0]), account: (c[aci] || '').trim(), note: (c[ni] || '').trim()
        });
      }
      if (added.length) { setTx([...tx, ...added]); setImportMsg(`Imported ${added.length} transaction${added.length === 1 ? '' : 's'}.`); }
      else setImportMsg('No valid rows found.');
    } catch (e) { setImportMsg('Import failed: ' + (e.message || e)); }
  };

  const pct = (v, max) => (max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0);
  const budgetClass = (spent, budget) => { if (!budget) return ''; const r = spent / budget; return r > 1 ? 'over' : r > 0.8 ? 'warn' : 'ok'; };

  return (
    <>
      {/* Quick add */}
      <section className="card">
        <h2>{draft.id ? '✎ Edit transaction' : '＋ Add transaction'}</h2>
        <div className="content">
          <form className="fin-add" onSubmit={save} autoComplete="off">
            <div className="seg-toggle small">
              <button type="button" className={draft.type === 'expense' ? 'active danger-on' : ''} onClick={() => setDraft({ ...draft, type: 'expense' })}>− Expense</button>
              <button type="button" className={draft.type === 'income' ? 'active ok-on' : ''} onClick={() => setDraft({ ...draft, type: 'income' })}>＋ Income</button>
            </div>
            <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={`Amount (${cur})`} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required style={{ width: 150 }} />
            <input type="text" placeholder="Category" list="fin-cats" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={{ width: 150 }} />
            <datalist id="fin-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <input type="text" placeholder="Account (optional)" value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })} style={{ width: 130 }} />
            <input type="text" placeholder="Note (optional)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <button type="submit" className="primary">{draft.id ? 'Update' : 'Add'}</button>
            {draft.id && <button type="button" onClick={() => setDraft(blankDraft())}>Cancel</button>}
          </form>
          <div className="chip-row" style={{ marginTop: 10 }}>
            <span className="hint">Quick category:</span>
            {quickCats.map((c) => (
              <button type="button" key={c} className={'cat-chip' + (draft.category === c ? ' on' : '')} onClick={() => setDraft({ ...draft, category: c })}>{c}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Summary + filters + import/export */}
      <section className="card">
        <h2>💰 Personal finance</h2>
        <div className="content">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="toolbar">
              <select value={filter.month} onChange={(e) => setFilter({ ...filter, month: e.target.value })}>
                <option value="all">All time</option>
                {months.map((m) => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</option>)}
              </select>
              <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                <option value="all">All</option><option value="income">Income</option><option value="expense">Expenses</option>
              </select>
            </div>
            <div className="toolbar">
              <label className="pill">Currency&nbsp;
                <input value={cur} onChange={(e) => setSettings({ ...settings, currency: e.target.value.toUpperCase() })} style={{ width: 60, padding: '2px 6px', borderRadius: 6 }} />
              </label>
              <label className="filebtn">⬆ Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { importCsv(e.target.files[0]); e.target.value = ''; }} /></label>
              <button onClick={exportCsv}>⬇ Export CSV</button>
            </div>
          </div>
          {importMsg && <div className="hint" style={{ color: 'var(--ok)', marginBottom: 8 }}>{importMsg}</div>}

          <div className="fin-summary">
            <div className="fin-stat income"><span className="lbl">Income · {periodLabel}</span><strong>{fmtMoney(totals.income)}</strong></div>
            <div className="fin-stat expense"><span className="lbl">Expenses</span><strong>{fmtMoney(totals.expense)}</strong></div>
            <div className={'fin-stat ' + (totals.net >= 0 ? 'income' : 'expense')}><span className="lbl">Net</span><strong>{fmtMoney(totals.net)}</strong></div>
            <div className="fin-stat balance"><span className="lbl">Balance (all time)</span><strong>{fmtMoney(totals.balance)}</strong></div>
          </div>
        </div>
      </section>

      {/* Budgets */}
      <section className="card">
        <h2>🎯 Budgets · {budgetMonthLabel}</h2>
        <div className="content">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="hint">Set a monthly limit per category. Spending updates live.</span>
            <span className="pill">Spent {fmtMoney(totalSpent)} / {fmtMoney(totalBudget)} budgeted</span>
          </div>
          <div className="list">
            {budgetRows.length === 0 && <div className="hint">No budgets or spending yet. Add one below.</div>}
            {budgetRows.map((b) => {
              const cls = budgetClass(b.spent, b.budget);
              const width = b.budget ? Math.min(100, (b.spent / b.budget) * 100) : (b.spent ? 100 : 0);
              return (
                <div className="budget-row" key={b.category}>
                  <div className="budget-name" title={b.category}>{b.category}</div>
                  <div className="budget-bar">
                    <div className={'budget-track ' + cls}><div className="budget-fill" style={{ width: width + '%' }} /></div>
                    <div className="budget-nums">
                      {fmtMoney(b.spent)}{b.budget ? ` / ${fmtMoney(b.budget)}` : ''}
                      {b.budget ? <span className={'budget-left ' + cls}>{b.spent > b.budget ? `${fmtMoney(b.spent - b.budget)} over` : `${fmtMoney(b.budget - b.spent)} left`}</span> : null}
                    </div>
                  </div>
                  <input type="number" min="0" step="50" placeholder="budget" defaultValue={b.budget || ''} onBlur={(e) => setBudget(b.category, e.target.value)} style={{ width: 90 }} />
                </div>
              );
            })}
          </div>
          <form className="toolbar" onSubmit={addBudget} style={{ marginTop: 10 }}>
            <input type="text" placeholder="Category" list="fin-cats" value={newBudget.category} onChange={(e) => setNewBudget({ ...newBudget, category: e.target.value })} />
            <input type="number" min="0" step="50" placeholder={`Monthly limit (${cur})`} value={newBudget.amount} onChange={(e) => setNewBudget({ ...newBudget, amount: e.target.value })} style={{ width: 160 }} />
            <button className="primary" type="submit">Set budget</button>
          </form>
        </div>
      </section>

      {/* Recurring */}
      <section className="card">
        <h2>🔁 Recurring</h2>
        <div className="content">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="hint">Salary, rent, subscriptions — add this month’s entry with one tap.</span>
            <button className="primary" onClick={() => setRecDraft(blankRec())} disabled={!!recDraft}>＋ Add recurring</button>
          </div>
          {recDraft && (
            <form className="fin-add" onSubmit={saveRec} style={{ marginBottom: 10 }}>
              <div className="seg-toggle small">
                <button type="button" className={recDraft.type === 'expense' ? 'active danger-on' : ''} onClick={() => setRecDraft({ ...recDraft, type: 'expense' })}>− Expense</button>
                <button type="button" className={recDraft.type === 'income' ? 'active ok-on' : ''} onClick={() => setRecDraft({ ...recDraft, type: 'income' })}>＋ Income</button>
              </div>
              <input type="number" min="0" step="0.01" placeholder={`Amount (${cur})`} value={recDraft.amount} onChange={(e) => setRecDraft({ ...recDraft, amount: e.target.value })} required style={{ width: 140 }} />
              <input type="text" placeholder="Category" list="fin-cats" value={recDraft.category} onChange={(e) => setRecDraft({ ...recDraft, category: e.target.value })} style={{ width: 140 }} />
              <label className="hint">on day<input type="number" min="1" max="28" value={recDraft.day} onChange={(e) => setRecDraft({ ...recDraft, day: e.target.value })} style={{ width: 60, marginLeft: 6 }} /></label>
              <input type="text" placeholder="Note (optional)" value={recDraft.note} onChange={(e) => setRecDraft({ ...recDraft, note: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
              <button type="submit" className="primary">{recDraft.id ? 'Save' : 'Add'}</button>
              <button type="button" onClick={() => setRecDraft(null)}>Cancel</button>
            </form>
          )}
          <div className="list">
            {recurring.length === 0 && !recDraft && <div className="hint">No recurring items yet.</div>}
            {recurring.map((r) => {
              const done = recDoneThisMonth(r);
              return (
                <div className="row" key={r.id}>
                  <div>
                    <strong className={r.type === 'income' ? 'pos' : 'neg'}>{r.type === 'income' ? '+' : '−'}{fmtMoney(r.amount)}</strong> · {r.category}
                    <br /><small>day {r.day}{r.note ? ` · ${r.note}` : ''}{done ? ' · ✓ added this month' : ''}</small>
                  </div>
                  <div className="actions">
                    <button className="primary" onClick={() => applyRec(r)} disabled={done} title={done ? 'Already added this month' : ''}>＋ Add to {budgetMonthLabel}</button>
                    <button onClick={() => setRecDraft({ ...r })}>✎</button>
                    <button className="ghost" onClick={() => removeRec(r.id)}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Charts */}
      <div className="grid-2">
        <section className="card">
          <h2>Spending by category · {periodLabel}</h2>
          <div className="content">
            {byCategory.arr.length === 0 && <div className="hint">No expenses in this period.</div>}
            <div className="cat-list">
              {byCategory.arr.map((c) => (
                <div className="cat-row" key={c.category}>
                  <div className="cat-name" title={c.category}>{c.category}</div>
                  <div className="cat-track"><div className="cat-fill" style={{ width: pct(c.amount, byCategory.max) + '%' }} /></div>
                  <div className="cat-amt">{fmtMoney(c.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Income vs expenses · last 6 months</h2>
          <div className="content">
            <div className="bars">
              {monthly.list.map((m) => (
                <div className="bar-col" key={m.key}>
                  <div className="bar-pair">
                    <div className="bar income" style={{ height: pct(m.income, monthly.max) + '%' }} title={`Income: ${fmtMoney(m.income)}`} />
                    <div className="bar expense" style={{ height: pct(m.expense, monthly.max) + '%' }} title={`Expenses: ${fmtMoney(m.expense)}`} />
                  </div>
                  <div className="bar-label">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              <span><span className="dot" style={{ background: 'var(--ok)' }} /> Income</span>
              <span><span className="dot" style={{ background: 'var(--danger)' }} /> Expenses</span>
            </div>
          </div>
        </section>
      </div>

      {/* Transactions */}
      <section className="card">
        <h2>Transactions ({filtered.length})</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <input type="search" placeholder="Search category, note, account…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          </div>
          <div className="list">
            {filtered.length === 0 && <div className="hint">No transactions.</div>}
            {filtered.map((t) => (
              <div className={'tx-row ' + t.type} key={t.id}>
                <div className="tx-main">
                  <strong>{t.category || 'Uncategorized'}</strong>
                  <div className="tx-meta">
                    <span>📅 {t.date}</span>
                    {t.account && <span>🏦 {t.account}</span>}
                    {t.note && <span>📝 {t.note}</span>}
                  </div>
                </div>
                <div className={'tx-amt ' + t.type}>{t.type === 'income' ? '+' : '−'}{fmtMoney(t.amount)}</div>
                <div className="actions">
                  <button onClick={() => editTx(t)}>✎</button>
                  <button className="ghost" onClick={() => removeTx(t.id)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
