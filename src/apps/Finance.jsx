import { useEffect, useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => (iso || '').slice(0, 7);
const CAT_SUGGESTIONS = ['Salary', 'Freelance', 'Rent', 'Groceries', 'Transport', 'Utilities', 'Dining', 'Health', 'Shopping', 'Subscriptions', 'Savings', 'Other'];
const blankDraft = () => ({ id: null, type: 'expense', amount: '', category: '', date: todayISO(), accountId: null, account: '', note: '' });
const blankRec = () => ({ id: null, type: 'expense', amount: '', category: '', day: 1, account: '', note: '' });
const blankGoal = () => ({ id: null, name: '', target: '', saved: '0', targetDate: '' });
const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'savings', label: 'Savings', icon: '🏛️' },
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'other', label: 'Other', icon: '📦' }
];
const accountIcon = (type) => (ACCOUNT_TYPES.find((t) => t.id === type) || {}).icon || '💳';
const blankAccount = () => ({ id: null, name: '', type: 'bank', opening: '0' });
const FIN_VIEWS = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'accounts', label: '🏦 Accounts' },
  { id: 'budgets', label: '🎯 Budgets' },
  { id: 'recurring', label: '🔁 Recurring' },
  { id: 'goals', label: '🐷 Goals' },
  { id: 'transactions', label: '🧾 Transactions' }
];

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
  const [goals, setGoals] = useEncryptedState('finance/goals', []);
  const [goalDraft, setGoalDraft] = useState(null);
  const [contrib, setContrib] = useState({});
  const [accounts, setAccounts] = useEncryptedState('finance/accounts', []);
  const [transfers, setTransfers] = useEncryptedState('finance/transfers', []);
  const [acctDraft, setAcctDraft] = useState(null);
  const [transfer, setTransfer] = useState({ from: '', to: '', amount: '', date: todayISO(), note: '' });
  const [view, setView] = useState(() => localStorage.getItem('mytools.financeView') || 'overview');
  useEffect(() => { localStorage.setItem('mytools.financeView', view); }, [view]);

  const accName = (id) => (accounts.find((a) => a.id === id) || {}).name || '—';

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

  // Cumulative month-end balance over the last 6 months.
  const trend = useMemo(() => {
    const now = new Date();
    const points = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 0).toISOString().slice(0, 10);
      const bal = tx.filter((t) => (t.date || '') <= end).reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (+t.amount || 0), 0);
      return { label: m.toLocaleDateString(undefined, { month: 'short' }), bal };
    });
    const vals = points.map((p) => p.bal);
    return { points, min: Math.min(0, ...vals), max: Math.max(0, ...vals) };
  }, [tx]);

  // Per-account balances = opening + assigned transactions + transfers in/out.
  const accountBalances = useMemo(() => {
    const map = {};
    accounts.forEach((a) => { map[a.id] = +a.opening || 0; });
    tx.forEach((t) => { if (t.accountId && map[t.accountId] != null) map[t.accountId] += (t.type === 'income' ? 1 : -1) * (+t.amount || 0); });
    transfers.forEach((tr) => { if (map[tr.from] != null) map[tr.from] -= +tr.amount || 0; if (map[tr.to] != null) map[tr.to] += +tr.amount || 0; });
    return map;
  }, [accounts, tx, transfers]);
  const unassigned = useMemo(() => tx.filter((t) => !t.accountId || !accounts.some((a) => a.id === t.accountId))
    .reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (+t.amount || 0), 0), [tx, accounts]);
  const netWorth = useMemo(() => accounts.reduce((s, a) => s + (+a.opening || 0), 0)
    + tx.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (+t.amount || 0), 0), [accounts, tx]);

  // ── Mutations ────────────────────────────────────────────────────
  const save = (e) => {
    e.preventDefault();
    const amount = Number(draft.amount);
    if (!amount || amount <= 0) return;
    const rec = { type: draft.type, amount, category: draft.category.trim() || 'Uncategorized', date: draft.date || todayISO(), accountId: draft.accountId || null, account: draft.account.trim(), note: draft.note.trim() };
    if (draft.id) setTx(tx.map((t) => (t.id === draft.id ? { ...t, ...rec } : t)));
    else setTx([...tx, { id: newId(), createdAt: new Date().toISOString(), ...rec }]);
    setDraft({ ...blankDraft(), type: draft.type, accountId: draft.accountId, account: draft.account });
  };
  const editTx = (t) => setDraft({ id: t.id, type: t.type, amount: String(t.amount), category: t.category, date: t.date, accountId: t.accountId || null, account: t.account || '', note: t.note || '' });
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
  const recToTx = (r) => ({ id: newId(), createdAt: new Date().toISOString(), type: r.type, amount: +r.amount || 0, category: r.category, account: r.account || '', note: r.note || '(recurring)', date: `${periodMonth}-${String(r.day || 1).padStart(2, '0')}` });
  const applyRec = (r) => setTx([...tx, recToTx(r)]);
  const dueRecurring = recurring.filter((r) => !recDoneThisMonth(r));
  const applyAllDue = () => { if (dueRecurring.length) setTx([...tx, ...dueRecurring.map(recToTx)]); };

  // Savings goals
  const saveGoal = (e) => {
    e.preventDefault();
    const target = Number(goalDraft.target);
    if (!goalDraft.name.trim() || !target || target <= 0) return;
    const rec = { name: goalDraft.name.trim(), target, saved: Number(goalDraft.saved) || 0, targetDate: goalDraft.targetDate };
    if (goalDraft.id) setGoals(goals.map((g) => (g.id === goalDraft.id ? { ...g, ...rec } : g)));
    else setGoals([...goals, { id: newId(), ...rec }]);
    setGoalDraft(null);
  };
  const removeGoal = (id) => setGoals(goals.filter((g) => g.id !== id));
  const contribute = (id) => {
    const a = Number(contrib[id]) || 0;
    if (!a) return;
    setGoals(goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, (+g.saved || 0) + a) } : g)));
    setContrib({ ...contrib, [id]: '' });
  };

  // Accounts + transfers
  const saveAccount = (e) => {
    e.preventDefault();
    if (!acctDraft.name.trim()) return;
    const rec = { name: acctDraft.name.trim(), type: acctDraft.type, opening: Number(acctDraft.opening) || 0 };
    if (acctDraft.id) setAccounts(accounts.map((a) => (a.id === acctDraft.id ? { ...a, ...rec } : a)));
    else setAccounts([...accounts, { id: newId(), ...rec }]);
    setAcctDraft(null);
  };
  const removeAccount = (id) => {
    if (!confirm('Delete this account? Its transactions become unassigned and related transfers are removed.')) return;
    setAccounts(accounts.filter((a) => a.id !== id));
    setTx(tx.map((t) => (t.accountId === id ? { ...t, accountId: null } : t)));
    setTransfers(transfers.filter((t) => t.from !== id && t.to !== id));
  };
  const doTransfer = (e) => {
    e.preventDefault();
    const amt = Number(transfer.amount);
    if (!amt || amt <= 0 || !transfer.from || !transfer.to || transfer.from === transfer.to) return;
    setTransfers([...transfers, { id: newId(), from: transfer.from, to: transfer.to, amount: amt, date: transfer.date || todayISO(), note: transfer.note.trim() }]);
    setTransfer({ from: '', to: '', amount: '', date: todayISO(), note: '' });
  };
  const removeTransfer = (id) => setTransfers(transfers.filter((t) => t.id !== id));

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
        const acctName = (c[aci] || '').trim();
        const acctMatch = accounts.find((a) => a.name.toLowerCase() === acctName.toLowerCase());
        added.push({
          id: newId(), createdAt: new Date().toISOString(), type, amount: Math.abs(amount),
          category: (c[ci >= 0 ? ci : 4] || 'Uncategorized').trim() || 'Uncategorized',
          date: normalizeDate(c[di >= 0 ? di : 0]), accountId: acctMatch ? acctMatch.id : null, account: acctName, note: (c[ni] || '').trim()
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
      {dueRecurring.length > 0 && (
        <section className="card due-banner">
          <h2>🔔 Due in {budgetMonthLabel} ({dueRecurring.length})</h2>
          <div className="content">
            <div className="list">
              {dueRecurring.map((r) => (
                <div className="row" key={r.id}>
                  <div><strong className={r.type === 'income' ? 'pos' : 'neg'}>{r.type === 'income' ? '+' : '−'}{fmtMoney(r.amount)}</strong> · {r.category} <small className="hint">day {r.day}</small></div>
                  <button className="primary" onClick={() => applyRec(r)}>＋ Add</button>
                </div>
              ))}
            </div>
            {dueRecurring.length > 1 && (
              <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="primary" onClick={applyAllDue}>Add all {dueRecurring.length}</button>
              </div>
            )}
          </div>
        </section>
      )}

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
            <select value={draft.accountId || ''} onChange={(e) => { const a = accounts.find((x) => x.id === e.target.value); setDraft({ ...draft, accountId: e.target.value || null, account: a ? a.name : '' }); }}>
              <option value="">— account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{accountIcon(a.type)} {a.name}</option>)}
            </select>
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
            <div className="fin-stat balance"><span className="lbl">Net worth</span><strong>{fmtMoney(netWorth)}</strong></div>
          </div>
        </div>
      </section>

      <nav className="subnav">
        {FIN_VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </nav>

      {view === 'accounts' && (
      <section className="card">
        <h2>🏦 Accounts</h2>
        <div className="content">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="pill strong">Net worth · {fmtMoney(netWorth)}</span>
            <button className="primary" onClick={() => setAcctDraft(blankAccount())} disabled={!!acctDraft}>＋ Add account</button>
          </div>
          {acctDraft && (
            <form className="fin-add" onSubmit={saveAccount} style={{ marginBottom: 10 }}>
              <input type="text" placeholder="Account name (e.g. CIH Bank)" value={acctDraft.name} onChange={(e) => setAcctDraft({ ...acctDraft, name: e.target.value })} required style={{ flex: 1, minWidth: 150 }} />
              <select value={acctDraft.type} onChange={(e) => setAcctDraft({ ...acctDraft, type: e.target.value })}>
                {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
              <input type="number" placeholder={`Opening balance (${cur})`} value={acctDraft.opening} onChange={(e) => setAcctDraft({ ...acctDraft, opening: e.target.value })} style={{ width: 170 }} />
              <button type="submit" className="primary">{acctDraft.id ? 'Save' : 'Add'}</button>
              <button type="button" onClick={() => setAcctDraft(null)}>Cancel</button>
            </form>
          )}
          {accounts.length === 0 && !acctDraft && <div className="hint">No accounts yet — add Cash, Bank, Savings… then assign transactions to them.</div>}
          <div className="acct-grid">
            {accounts.map((a) => (
              <div className="acct-card" key={a.id}>
                <div className="acct-top"><span className="acct-icon">{accountIcon(a.type)}</span><span className="acct-name" title={a.name}>{a.name}</span></div>
                <div className={'acct-bal ' + ((accountBalances[a.id] || 0) < 0 ? 'neg' : '')}>{fmtMoney(accountBalances[a.id] || 0)}</div>
                <div className="acct-actions">
                  <button onClick={() => setAcctDraft({ id: a.id, name: a.name, type: a.type, opening: String(a.opening || 0) })}>✎</button>
                  <button className="ghost" onClick={() => removeAccount(a.id)}>🗑</button>
                </div>
              </div>
            ))}
            {unassigned !== 0 && (
              <div className="acct-card">
                <div className="acct-top"><span className="acct-icon">❓</span><span className="acct-name">Unassigned</span></div>
                <div className={'acct-bal ' + (unassigned < 0 ? 'neg' : '')}>{fmtMoney(unassigned)}</div>
              </div>
            )}
          </div>

          {accounts.length >= 2 && (
            <>
              <hr />
              <strong>↔ Transfer between accounts</strong>
              <form className="fin-add" onSubmit={doTransfer} style={{ marginTop: 8 }}>
                <select value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} required>
                  <option value="">From…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span>→</span>
                <select value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} required>
                  <option value="">To…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input type="number" min="0" step="0.01" placeholder={`Amount (${cur})`} value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} required style={{ width: 130 }} />
                <input type="date" value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} />
                <input type="text" placeholder="Note" value={transfer.note} onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} style={{ width: 120 }} />
                <button type="submit" className="primary">Transfer</button>
              </form>
              {transfers.length > 0 && (
                <div className="list" style={{ marginTop: 10 }}>
                  {[...transfers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((tr) => (
                    <div className="row" key={tr.id}>
                      <div>{accName(tr.from)} <strong>→</strong> {accName(tr.to)} · {fmtMoney(tr.amount)}<br /><small>{tr.date}{tr.note ? ` · ${tr.note}` : ''}</small></div>
                      <button className="ghost" onClick={() => removeTransfer(tr.id)}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      )}

      {view === 'budgets' && (
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

      )}

      {view === 'recurring' && (
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

      )}

      {view === 'goals' && (
      <section className="card">
        <h2>🐷 Savings goals</h2>
        <div className="content">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="hint">Track progress toward a target.</span>
            <button className="primary" onClick={() => setGoalDraft(blankGoal())} disabled={!!goalDraft}>＋ Add goal</button>
          </div>
          {goalDraft && (
            <form className="fin-add" onSubmit={saveGoal} style={{ marginBottom: 10 }}>
              <input type="text" placeholder="Goal name (e.g. Emergency fund)" value={goalDraft.name} onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })} required style={{ flex: 1, minWidth: 150 }} />
              <input type="number" min="0" placeholder={`Target (${cur})`} value={goalDraft.target} onChange={(e) => setGoalDraft({ ...goalDraft, target: e.target.value })} required style={{ width: 140 }} />
              <input type="number" min="0" placeholder="Saved so far" value={goalDraft.saved} onChange={(e) => setGoalDraft({ ...goalDraft, saved: e.target.value })} style={{ width: 120 }} />
              <label className="hint">by<input type="date" value={goalDraft.targetDate} onChange={(e) => setGoalDraft({ ...goalDraft, targetDate: e.target.value })} style={{ marginLeft: 6 }} /></label>
              <button type="submit" className="primary">{goalDraft.id ? 'Save' : 'Add'}</button>
              <button type="button" onClick={() => setGoalDraft(null)}>Cancel</button>
            </form>
          )}
          {goals.length === 0 && !goalDraft && <div className="hint">No goals yet — add one to start tracking.</div>}
          <div className="list">
            {goals.map((g) => {
              const saved = +g.saved || 0, target = +g.target || 0;
              const ratio = target ? Math.min(1, saved / target) : 0;
              const done = target > 0 && saved >= target;
              return (
                <div className="goal-card" key={g.id}>
                  <div className="goal-head">
                    <strong>{done ? '🏆 ' : ''}{g.name}</strong>
                    <span className="goal-nums">{fmtMoney(saved)} / {fmtMoney(target)}{g.targetDate ? ` · by ${g.targetDate}` : ''}</span>
                  </div>
                  <div className="goal-track"><div className={'goal-fill' + (done ? ' done' : '')} style={{ width: (ratio * 100) + '%' }} /></div>
                  <div className="goal-foot">
                    <span className="hint">{done ? 'Reached 🎉' : `${fmtMoney(Math.max(0, target - saved))} to go`}</span>
                    <span className="toolbar">
                      <input type="number" min="0" placeholder="+ amount" value={contrib[g.id] || ''} onChange={(e) => setContrib({ ...contrib, [g.id]: e.target.value })} style={{ width: 110 }} />
                      <button onClick={() => contribute(g.id)}>Add</button>
                      <button onClick={() => setGoalDraft({ id: g.id, name: g.name, target: String(g.target), saved: String(g.saved), targetDate: g.targetDate || '' })}>✎</button>
                      <button className="ghost" onClick={() => removeGoal(g.id)}>🗑</button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      )}

      {view === 'overview' && (
      <>
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

      {/* Balance trend */}
      <section className="card">
        <h2>Balance trend · month-end</h2>
        <div className="content">
          {(() => {
            const { points, min, max } = trend;
            const W = 600, H = 140, pad = 10, span = (max - min) || 1;
            const x = (i) => pad + i * ((W - 2 * pad) / (points.length - 1));
            const y = (v) => pad + (1 - (v - min) / span) * (H - 2 * pad);
            const line = points.map((p, i) => `${x(i)},${y(p.bal)}`).join(' ');
            const area = `${x(0)},${y(min)} ${line} ${x(points.length - 1)},${y(min)}`;
            return (
              <svg className="trend" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }}>
                <polygon points={area} fill="var(--accent)" opacity="0.12" />
                {min < 0 && <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="5 5" />}
                <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.bal)} r="3.5" fill="var(--accent)" />)}
              </svg>
            );
          })()}
          <div className="trend-labels">{trend.points.map((p, i) => <span key={i}>{p.label}</span>)}</div>
        </div>
      </section>

      </>
      )}

      {view === 'transactions' && (
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
      )}
    </>
  );
}
