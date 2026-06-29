import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => (iso || '').slice(0, 7); // YYYY-MM
const CAT_SUGGESTIONS = ['Salary', 'Freelance', 'Rent', 'Groceries', 'Transport', 'Utilities', 'Dining', 'Health', 'Shopping', 'Subscriptions', 'Savings', 'Other'];

const blankDraft = () => ({ id: null, type: 'expense', amount: '', category: '', date: todayISO(), account: '', note: '' });

export default function FinanceApp() {
  const [tx, setTx] = useEncryptedState('finance/tx', []);
  const [settings, setSettings] = useEncryptedState('finance/settings', { currency: 'MAD' });
  const [draft, setDraft] = useState(blankDraft());
  const [filter, setFilter] = useState({ month: monthKey(todayISO()), type: 'all', q: '' });

  const cur = settings.currency || 'MAD';
  const fmtMoney = (n) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
    catch { return `${Math.round(n || 0)} ${cur}`; }
  };

  // Month options from data + current month.
  const months = useMemo(() => {
    const set = new Set(tx.map((t) => monthKey(t.date)).filter(Boolean));
    set.add(monthKey(todayISO()));
    return Array.from(set).sort().reverse();
  }, [tx]);

  const categories = useMemo(() => {
    const set = new Set(CAT_SUGGESTIONS);
    tx.forEach((t) => t.category && set.add(t.category));
    return Array.from(set);
  }, [tx]);

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

  // Expenses by category for the selected period.
  const byCategory = useMemo(() => {
    const map = {};
    inPeriod.filter((t) => t.type === 'expense').forEach((t) => { const c = t.category || 'Uncategorized'; map[c] = (map[c] || 0) + (+t.amount || 0); });
    const arr = Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    const max = arr.reduce((m, c) => Math.max(m, c.amount), 0);
    return { arr: arr.slice(0, 8), max };
  }, [inPeriod]);

  // Last 6 months income vs expense.
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
    const rec = {
      type: draft.type, amount, category: draft.category.trim() || 'Uncategorized',
      date: draft.date || todayISO(), account: draft.account.trim(), note: draft.note.trim()
    };
    if (draft.id) setTx(tx.map((t) => (t.id === draft.id ? { ...t, ...rec } : t)));
    else setTx([...tx, { id: newId(), createdAt: new Date().toISOString(), ...rec }]);
    setDraft({ ...blankDraft(), type: draft.type, category: draft.category, account: draft.account });
  };
  const editTx = (t) => setDraft({ id: t.id, type: t.type, amount: String(t.amount), category: t.category, date: t.date, account: t.account || '', note: t.note || '' });
  const removeTx = (id) => { setTx(tx.filter((t) => t.id !== id)); if (draft.id === id) setDraft(blankDraft()); };

  const exportCsv = () => {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'Note']];
    [...tx].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .forEach((t) => rows.push([t.date, t.type, t.amount, cur, t.category, t.account || '', t.note || '']));
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `finance-${filter.month === 'all' ? 'all' : filter.month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pct = (v, max) => (max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0);
  const monthLabel = filter.month === 'all' ? 'All time' : new Date(filter.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
        </div>
      </section>

      {/* Summary + filters */}
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
                <option value="all">All</option>
                <option value="income">Income</option>
                <option value="expense">Expenses</option>
              </select>
            </div>
            <div className="toolbar">
              <label className="pill">Currency&nbsp;
                <input value={cur} onChange={(e) => setSettings({ ...settings, currency: e.target.value.toUpperCase() })} style={{ width: 60, padding: '2px 6px', borderRadius: 6 }} />
              </label>
              <button onClick={exportCsv}>⬇ Export CSV</button>
            </div>
          </div>

          <div className="fin-summary">
            <div className="fin-stat income"><span className="lbl">Income · {monthLabel}</span><strong>{fmtMoney(totals.income)}</strong></div>
            <div className="fin-stat expense"><span className="lbl">Expenses</span><strong>{fmtMoney(totals.expense)}</strong></div>
            <div className={'fin-stat ' + (totals.net >= 0 ? 'income' : 'expense')}><span className="lbl">Net</span><strong>{fmtMoney(totals.net)}</strong></div>
            <div className="fin-stat balance"><span className="lbl">Balance (all time)</span><strong>{fmtMoney(totals.balance)}</strong></div>
          </div>
        </div>
      </section>

      {/* Charts */}
      <div className="grid-2">
        <section className="card">
          <h2>Spending by category · {monthLabel}</h2>
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
