import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);

// Entry: { id, person, dir: 'in'|'out', amount, reason, date, settled }
//   in  = they owe you ; out = you owe them
const blankEntry = () => ({ id: null, person: '', dir: 'in', amount: '', reason: '', date: todayISO() });

export default function DebtsApp() {
  const [entries, setEntries] = useEncryptedState('finance/debts', []);
  const [settings] = useEncryptedState('finance/settings', { currency: 'MAD' });
  const [draft, setDraft] = useState(blankEntry());
  const [showSettled, setShowSettled] = useState(false);
  const [split, setSplit] = useState({ open: false, total: '', reason: '', paidBy: '', people: '' });

  const cur = settings.currency || 'MAD';
  const fmtMoney = (n) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
    catch { return `${Math.round(n || 0)} ${cur}`; }
  };

  const peopleNames = useMemo(() => Array.from(new Set(entries.map((e) => e.person).filter(Boolean))), [entries]);

  // Group unsettled entries by person → net (positive = they owe you).
  const groups = useMemo(() => {
    const map = {};
    entries.filter((e) => !e.settled).forEach((e) => {
      const p = e.person || 'Someone';
      if (!map[p]) map[p] = { person: p, net: 0, items: [] };
      map[p].net += (e.dir === 'in' ? 1 : -1) * (+e.amount || 0);
      map[p].items.push(e);
    });
    return Object.values(map)
      .map((g) => ({ ...g, items: g.items.sort((a, b) => (b.date || '').localeCompare(a.date || '')) }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [entries]);

  const totals = useMemo(() => {
    let owedToYou = 0, youOwe = 0;
    groups.forEach((g) => { if (g.net > 0) owedToYou += g.net; else youOwe += -g.net; });
    return { owedToYou, youOwe, net: owedToYou - youOwe };
  }, [groups]);

  const settledEntries = useMemo(() => entries.filter((e) => e.settled).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [entries]);

  // ── Mutations ────────────────────────────────────────────────────
  const save = (e) => {
    e.preventDefault();
    const amount = Number(draft.amount);
    if (!draft.person.trim() || !amount || amount <= 0) return;
    const rec = { person: draft.person.trim(), dir: draft.dir, amount, reason: draft.reason.trim(), date: draft.date || todayISO() };
    if (draft.id) setEntries(entries.map((x) => (x.id === draft.id ? { ...x, ...rec } : x)));
    else setEntries([...entries, { id: newId(), settled: false, ...rec }]);
    setDraft({ ...blankEntry(), dir: draft.dir, person: draft.person });
  };
  const editEntry = (x) => setDraft({ id: x.id, person: x.person, dir: x.dir, amount: String(x.amount), reason: x.reason || '', date: x.date });
  const removeEntry = (id) => setEntries(entries.filter((x) => x.id !== id));
  const toggleSettle = (id, v) => setEntries(entries.map((x) => (x.id === id ? { ...x, settled: v } : x)));
  const settlePerson = (person) => {
    if (!confirm(`Mark all debts with ${person} as settled?`)) return;
    setEntries(entries.map((x) => (x.person === person && !x.settled ? { ...x, settled: true } : x)));
  };

  const doSplit = (e) => {
    e.preventDefault();
    const total = Number(split.total);
    const others = split.people.split(',').map((s) => s.trim()).filter(Boolean);
    if (!total || total <= 0 || others.length === 0) return;
    const headcount = others.length + 1; // including you
    const share = Math.round((total / headcount) * 100) / 100;
    const reason = split.reason.trim() || 'Split bill';
    const paidBy = split.paidBy.trim();
    let added;
    if (!paidBy || /^(me|you|i)$/i.test(paidBy)) {
      // You paid → each other owes you their share.
      added = others.map((p) => ({ id: newId(), settled: false, person: p, dir: 'in', amount: share, reason, date: todayISO() }));
    } else {
      // Someone else paid → you owe them your share (one entry).
      added = [{ id: newId(), settled: false, person: paidBy, dir: 'out', amount: share, reason, date: todayISO() }];
    }
    setEntries([...entries, ...added]);
    setSplit({ open: false, total: '', reason: '', paidBy: '', people: '' });
  };

  return (
    <>
      {/* Summary */}
      <section className="card">
        <h2>💸 Debts & IOUs</h2>
        <div className="content">
          <div className="fin-summary" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="fin-stat income"><span className="lbl">Owed to you</span><strong>{fmtMoney(totals.owedToYou)}</strong></div>
            <div className="fin-stat expense"><span className="lbl">You owe</span><strong>{fmtMoney(totals.youOwe)}</strong></div>
            <div className={'fin-stat ' + (totals.net >= 0 ? 'income' : 'expense')}><span className="lbl">Net position</span><strong>{fmtMoney(totals.net)}</strong></div>
          </div>
        </div>
      </section>

      {/* Add entry */}
      <section className="card">
        <h2>{draft.id ? '✎ Edit entry' : '＋ Add a debt'}</h2>
        <div className="content">
          <form className="fin-add" onSubmit={save} autoComplete="off">
            <div className="seg-toggle small">
              <button type="button" className={draft.dir === 'in' ? 'active ok-on' : ''} onClick={() => setDraft({ ...draft, dir: 'in' })}>← They owe me</button>
              <button type="button" className={draft.dir === 'out' ? 'active danger-on' : ''} onClick={() => setDraft({ ...draft, dir: 'out' })}>I owe → </button>
            </div>
            <input type="text" placeholder="Person" list="debt-people" value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} required style={{ width: 150 }} />
            <datalist id="debt-people">{peopleNames.map((p) => <option key={p} value={p} />)}</datalist>
            <input type="number" min="0" step="0.01" placeholder={`Amount (${cur})`} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required style={{ width: 140 }} />
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <input type="text" placeholder="Reason (optional)" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <button type="submit" className="primary">{draft.id ? 'Update' : 'Add'}</button>
            {draft.id && <button type="button" onClick={() => setDraft(blankEntry())}>Cancel</button>}
          </form>

          <div className="toolbar" style={{ marginTop: 10 }}>
            <button onClick={() => setSplit({ ...split, open: !split.open })}>🧾 {split.open ? 'Close' : 'Split a bill'}</button>
            <span className="hint">Split a shared expense and create the IOUs automatically.</span>
          </div>
          {split.open && (
            <form className="fin-add" onSubmit={doSplit} style={{ marginTop: 8 }}>
              <input type="number" min="0" step="0.01" placeholder={`Total (${cur})`} value={split.total} onChange={(e) => setSplit({ ...split, total: e.target.value })} required style={{ width: 130 }} />
              <input type="text" placeholder="Paid by (blank = you)" list="debt-people" value={split.paidBy} onChange={(e) => setSplit({ ...split, paidBy: e.target.value })} style={{ width: 160 }} />
              <input type="text" placeholder="Split with (comma names)" value={split.people} onChange={(e) => setSplit({ ...split, people: e.target.value })} required style={{ flex: 1, minWidth: 180 }} />
              <input type="text" placeholder="Reason" value={split.reason} onChange={(e) => setSplit({ ...split, reason: e.target.value })} style={{ width: 140 }} />
              <button type="submit" className="primary">Create IOUs</button>
            </form>
          )}
          {split.open && <div className="hint" style={{ marginTop: 4 }}>You’re counted in the split. e.g. total 600 split with “Ali, Sara” → each owes you 200 (if you paid).</div>}
        </div>
      </section>

      {/* People */}
      <section className="card">
        <h2>By person</h2>
        <div className="content">
          {groups.length === 0 && <div className="hint">No open debts. 🎉</div>}
          <div className="list">
            {groups.map((g) => (
              <div className="debt-person" key={g.person}>
                <div className="debt-head">
                  <div>
                    <strong>{g.person}</strong>
                    <div className={'debt-net ' + (g.net >= 0 ? 'pos' : 'neg')}>
                      {g.net === 0 ? 'settled up' : g.net > 0 ? `owes you ${fmtMoney(g.net)}` : `you owe ${fmtMoney(-g.net)}`}
                    </div>
                  </div>
                  <button className="ghost" onClick={() => settlePerson(g.person)}>Settle up</button>
                </div>
                <div className="debt-items">
                  {g.items.map((it) => (
                    <div className="debt-item" key={it.id}>
                      <span className={'debt-amt ' + (it.dir === 'in' ? 'pos' : 'neg')}>{it.dir === 'in' ? '+' : '−'}{fmtMoney(it.amount)}</span>
                      <span className="debt-reason">{it.reason || (it.dir === 'in' ? 'owes you' : 'you owe')} · <small>{it.date}</small></span>
                      <span className="actions">
                        <button onClick={() => toggleSettle(it.id, true)} title="Mark settled">✓</button>
                        <button onClick={() => editEntry(it)}>✎</button>
                        <button className="ghost" onClick={() => removeEntry(it.id)}>🗑</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {settledEntries.length > 0 && (
            <>
              <div className="toolbar" style={{ marginTop: 12 }}>
                <button onClick={() => setShowSettled((s) => !s)}>{showSettled ? 'Hide' : 'Show'} settled ({settledEntries.length})</button>
              </div>
              {showSettled && (
                <div className="list" style={{ marginTop: 8, opacity: 0.6 }}>
                  {settledEntries.map((it) => (
                    <div className="row" key={it.id}>
                      <div><strong>{it.person}</strong> · {it.dir === 'in' ? 'owed you' : 'you owed'} {fmtMoney(it.amount)}<br /><small>{it.reason} · {it.date}</small></div>
                      <div className="actions">
                        <button onClick={() => toggleSettle(it.id, false)}>↺ Reopen</button>
                        <button className="ghost" onClick={() => removeEntry(it.id)}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
