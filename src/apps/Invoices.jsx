import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';
import { fetchMoroccoHolidays, activeHolidaySet, vacationSetForMonth, workingDaysInMonth } from '../lib/workdays.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);

// Category used for the Finance income transaction auto-created from a paid invoice.
const FINANCE_CATEGORY = 'Freelance';

const monthOptions = () => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  });
};

const blankInvoice = () => ({
  id: newId(),
  number: '',
  clientId: '',
  client: '',
  clientAddress: '',
  date: new Date().toISOString().slice(0, 10),
  dueDate: '',
  currency: 'MAD',
  lines: [{ id: newId(), description: '', qty: 1, rate: 0 }],
  notes: '',
  status: 'draft'
});

const blankClient = () => ({ id: null, name: '', address: '' });

// "61 600 MAD" — space-thousands, currency suffix, like the template.
const fmtAmount = (n, currency) =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n || 0)} ${currency || ''}`.trim();
// "30/04/2026"
const fmtDMY = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export default function InvoicesApp() {
  const [invoices, setInvoices] = useEncryptedState('invoices/list', []);
  const [profile, setProfile] = useEncryptedState('invoices/profile', {
    name: '', address: '', email: '', taxId: '', defaultCurrency: 'MAD',
    bankName: '', bankIban: '', bankAccountNumber: '', bankAccountHolder: '', bankSwift: ''
  });
  const [clients, setClients] = useEncryptedState('invoices/clients', []);
  // Shared with the Finance tool: marking an invoice paid records income here.
  const [, setTx] = useEncryptedState('finance/tx', []);
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [clientDraft, setClientDraft] = useState(blankClient());

  // Calendar data → bill a month by working days × TJM.
  const curYear = new Date().getFullYear();
  const [calUi] = useEncryptedState('calendar/ui', { tjm: 0 });
  const [calYearCur] = useEncryptedState(`calendar/year/${curYear}`, { customHolidays: {}, vacations: [], apiOverrides: {} });
  const [calYearPrev] = useEncryptedState(`calendar/year/${curYear - 1}`, { customHolidays: {}, vacations: [], apiOverrides: {} });
  const [monthBusy, setMonthBusy] = useState(false);

  const sorted = useMemo(
    () => [...invoices].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [invoices]
  );
  const active = invoices.find((i) => i.id === activeId);
  const total = (inv) => (inv?.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  // Keep finance/tx in sync with an invoice's paid state. One linked income tx
  // per invoice (tagged invoiceId); created/updated when paid, removed otherwise.
  const reconcileTx = (list, inv) => {
    const linked = list.find((t) => t.invoiceId === inv.id);
    if (inv.status !== 'paid') return linked ? list.filter((t) => t.invoiceId !== inv.id) : list;
    const rec = {
      type: 'income', amount: total(inv), category: FINANCE_CATEGORY,
      date: inv.paidDate || inv.date || todayISO(),
      note: `Invoice #${inv.number || '—'}${inv.client ? ' · ' + inv.client : ''}`,
      invoiceId: inv.id, currency: inv.currency
    };
    if (linked) return list.map((t) => (t.invoiceId === inv.id ? { ...t, ...rec } : t));
    return [...list, { id: newId(), createdAt: new Date().toISOString(), accountId: null, account: '', ...rec }];
  };

  // Accounts-receivable snapshot (assumes the default currency for totals).
  const ar = useMemo(() => {
    const year = String(new Date().getFullYear());
    let outstanding = 0, overdue = 0, paidYtd = 0, openCount = 0;
    invoices.forEach((inv) => {
      const amt = total(inv);
      if (inv.status === 'paid') {
        if ((inv.paidDate || inv.date || '').startsWith(year)) paidYtd += amt;
      } else if (inv.status === 'sent' || inv.status === 'overdue') {
        outstanding += amt; openCount++;
        if (inv.status === 'overdue' || (inv.dueDate && inv.dueDate < todayISO())) overdue += amt;
      }
    });
    return { outstanding, overdue, paidYtd, openCount };
  }, [invoices]);

  // ── Invoice CRUD ─────────────────────────────────────────────────────
  const startNew = () => { setEditing({ ...blankInvoice(), currency: profile.defaultCurrency || 'MAD' }); setActiveId(null); };
  const editExisting = (inv) => { setEditing(JSON.parse(JSON.stringify(inv))); setActiveId(inv.id); };
  const cancelEdit = () => setEditing(null);
  const saveEdit = () => {
    const inv = { ...editing };
    if (inv.status === 'paid' && !inv.paidDate) inv.paidDate = inv.date || todayISO();
    const exists = invoices.some((i) => i.id === inv.id);
    setInvoices(exists ? invoices.map((i) => (i.id === inv.id ? inv : i)) : [...invoices, inv]);
    setTx((cur) => reconcileTx(cur, inv));
    setActiveId(inv.id);
    setEditing(null);
  };
  const remove = (id) => {
    if (!confirm('Delete this invoice?')) return;
    setInvoices(invoices.filter((i) => i.id !== id));
    setTx((cur) => cur.filter((t) => t.invoiceId !== id));
    if (activeId === id) setActiveId(null);
  };
  // One-tap status change from the list (also reconciles the Finance income tx).
  const setStatus = (inv, status) => {
    const updated = { ...inv, status, paidDate: status === 'paid' ? (inv.paidDate || todayISO()) : inv.paidDate };
    setInvoices(invoices.map((i) => (i.id === inv.id ? updated : i)));
    setTx((cur) => reconcileTx(cur, updated));
  };
  const setLine = (id, patch) => setEditing({ ...editing, lines: editing.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const addLine = () => setEditing({ ...editing, lines: [...editing.lines, { id: newId(), description: '', qty: 1, rate: 0 }] });
  const removeLine = (id) => setEditing({ ...editing, lines: editing.lines.filter((l) => l.id !== id) });

  const pickClient = (clientId) => {
    const c = clients.find((x) => x.id === clientId);
    setEditing((ed) => ({ ...ed, clientId, client: c ? c.name : ed.client, clientAddress: c ? c.address : ed.clientAddress }));
  };

  // ── Clients CRUD ─────────────────────────────────────────────────────
  const saveClient = (e) => {
    e.preventDefault();
    if (!clientDraft.name.trim()) return;
    if (clientDraft.id) setClients(clients.map((c) => (c.id === clientDraft.id ? { ...clientDraft } : c)));
    else setClients([...clients, { ...clientDraft, id: newId() }]);
    setClientDraft(blankClient());
  };
  const removeClient = (id) => setClients(clients.filter((c) => c.id !== id));

  // ── Bill a month ─────────────────────────────────────────────────────
  const fromMonth = async (y, m) => {
    setMonthBusy(true);
    try {
      const yearState = y === curYear ? calYearCur : calYearPrev;
      const api = await fetchMoroccoHolidays(y);
      const holidaySet = activeHolidaySet({ apiHolidays: api, apiOverrides: yearState.apiOverrides, customHolidays: yearState.customHolidays });
      const vacationSet = vacationSetForMonth(yearState.vacations, y, m);
      const { working } = workingDaysInMonth({ year: y, month: m, holidaySet, vacationSet });
      const monthName = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      setEditing({
        ...blankInvoice(),
        currency: profile.defaultCurrency || 'MAD',
        lines: [{ id: newId(), description: `Engineering Services for the period of ${monthName}`, qty: working, rate: calUi.tjm || 0 }]
      });
      setActiveId(null);
    } finally {
      setMonthBusy(false);
    }
  };

  const upd = (k, v) => setProfile({ ...profile, [k]: v });

  return (
    <>
      <section className="card no-print">
        <h2>🧾 Your details (the “From” on every invoice)</h2>
        <div className="content">
          <div className="invoice-form">
            <label>Name / business<input value={profile.name || ''} onChange={(e) => upd('name', e.target.value)} /></label>
            <label>Email(s)<input value={profile.email || ''} onChange={(e) => upd('email', e.target.value)} placeholder="a@x.com / b@y.com" /></label>
            <label className="span2">Address<textarea rows={2} value={profile.address || ''} onChange={(e) => upd('address', e.target.value)} /></label>
            <label>Tax ID / ICE<input value={profile.taxId || ''} onChange={(e) => upd('taxId', e.target.value)} /></label>
            <label>Default currency<input value={profile.defaultCurrency || ''} onChange={(e) => upd('defaultCurrency', e.target.value.toUpperCase())} /></label>
          </div>
          <h3 style={{ margin: '14px 0 8px' }}>🏦 Bank details (shown on the invoice)</h3>
          <div className="invoice-form">
            <label>Bank name<input value={profile.bankName || ''} onChange={(e) => upd('bankName', e.target.value)} /></label>
            <label>Accountholder name<input value={profile.bankAccountHolder || ''} onChange={(e) => upd('bankAccountHolder', e.target.value)} /></label>
            <label>IBAN<input value={profile.bankIban || ''} onChange={(e) => upd('bankIban', e.target.value)} placeholder="MA64 ..." /></label>
            <label>Account number<input value={profile.bankAccountNumber || ''} onChange={(e) => upd('bankAccountNumber', e.target.value)} /></label>
            <label>SWIFT / BIC<input value={profile.bankSwift || ''} onChange={(e) => upd('bankSwift', e.target.value)} placeholder="CIHMMAMC" /></label>
          </div>
        </div>
      </section>

      <section className="card no-print">
        <h2>👥 Clients ({clients.length})</h2>
        <div className="content">
          <div className="list">
            {clients.length === 0 && <div className="hint">No clients yet — add one below. You can keep as many as you like.</div>}
            {clients.map((c) => (
              <div className="row" key={c.id}>
                <div><strong>{c.name}</strong><br /><small style={{ whiteSpace: 'pre-wrap' }}>{c.address}</small></div>
                <div className="actions">
                  <button onClick={() => setClientDraft({ ...c })}>✎ Edit</button>
                  <button className="ghost" onClick={() => removeClient(c.id)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
          <form className="invoice-form" style={{ marginTop: 12 }} onSubmit={saveClient}>
            <label>Client name<input value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} placeholder="Hidden Pole Inc" /></label>
            <label className="span2">Address<textarea rows={2} value={clientDraft.address} onChange={(e) => setClientDraft({ ...clientDraft, address: e.target.value })} placeholder="276 5th Avenue Suite 704-004&#10;New York, NY 10001&#10;United States" /></label>
            <div className="toolbar" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
              {clientDraft.id && <button type="button" onClick={() => setClientDraft(blankClient())}>Cancel</button>}
              <button className="primary" type="submit">{clientDraft.id ? 'Save client' : '＋ Add client'}</button>
            </div>
          </form>
        </div>
      </section>

      {invoices.length > 0 && (
        <section className="card no-print">
          <h2>💵 Accounts receivable</h2>
          <div className="content">
            <div className="fin-summary">
              <div className="fin-stat expense"><span className="lbl">Outstanding · {ar.openCount} open</span><strong>{fmtAmount(ar.outstanding, profile.defaultCurrency)}</strong></div>
              <div className={'fin-stat ' + (ar.overdue > 0 ? 'expense' : 'balance')}><span className="lbl">Overdue</span><strong>{fmtAmount(ar.overdue, profile.defaultCurrency)}</strong></div>
              <div className="fin-stat income"><span className="lbl">Paid this year</span><strong>{fmtAmount(ar.paidYtd, profile.defaultCurrency)}</strong></div>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>Marking an invoice <strong>Paid</strong> records a <strong>{FINANCE_CATEGORY}</strong> income entry in Finance automatically.</div>
          </div>
        </section>
      )}

      <section className="card no-print">
        <h2>Invoices ({invoices.length})</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 4 }}>
            <button className="primary" onClick={startNew}>＋ New invoice</button>
            <span className="muted" style={{ marginLeft: 4 }}>or bill a month:</span>
            <select
              defaultValue="" disabled={monthBusy}
              onChange={(e) => { if (e.target.value) { const [y, m] = e.target.value.split('-').map(Number); fromMonth(y, m); e.target.value = ''; } }}
            >
              <option value="" disabled>📅 From a month…</option>
              {monthOptions().map((o) => <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</option>)}
            </select>
            {monthBusy && <span className="hint">Calculating working days…</span>}
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            “From a month” pre-fills a line with that month’s working days × your TJM ({calUi.tjm ? calUi.tjm + ' MAD' : 'set it in Calendar'}).
          </div>
          {sorted.length === 0 && <div className="hint">No invoices yet.</div>}
          <div className="list">
            {sorted.map((inv) => {
              const isOverdue = inv.status !== 'paid' && inv.dueDate && inv.dueDate < todayISO();
              return (
              <div key={inv.id} className="row">
                <div>
                  <strong>#{inv.number || '—'}</strong> · {inv.client || 'Untitled'}<br />
                  <small>
                    {fmtDMY(inv.date)} · {fmtAmount(total(inv), inv.currency)} ·{' '}
                    <span className={'inv-status ' + (isOverdue ? 'overdue' : inv.status)}>{isOverdue ? 'overdue' : inv.status}</span>
                    {inv.status === 'paid' && <span className="inv-status paid" title="Recorded as income in Finance"> ✓ in Finance</span>}
                  </small>
                </div>
                <div className="actions">
                  {inv.status === 'paid'
                    ? <button onClick={() => setStatus(inv, 'sent')} title="Revert to sent and remove the Finance entry">↩ Unpay</button>
                    : <button className="primary" onClick={() => setStatus(inv, 'paid')}>💰 Mark paid</button>}
                  <button onClick={() => setActiveId(inv.id === activeId ? null : inv.id)}>{activeId === inv.id ? 'Hide' : 'View'}</button>
                  <button onClick={() => editExisting(inv)}>✎ Edit</button>
                  <button className="ghost" onClick={() => remove(inv.id)}>🗑</button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {editing && (
        <section className="card no-print">
          <h2>{invoices.some((i) => i.id === editing.id) ? 'Edit invoice' : 'New invoice'}</h2>
          <div className="content">
            <div className="invoice-form">
              <label>Invoice number<input value={editing.number} onChange={(e) => setEditing({ ...editing, number: e.target.value })} placeholder="003" /></label>
              <label>Status
                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="draft">Draft</option><option value="sent">Sent</option>
                  <option value="paid">Paid</option><option value="overdue">Overdue</option>
                </select>
              </label>
              <label>Client
                <select value={editing.clientId || ''} onChange={(e) => pickClient(e.target.value)}>
                  <option value="">— pick a saved client —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Currency<input value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} /></label>
              <label>Client name<input value={editing.client} onChange={(e) => setEditing({ ...editing, client: e.target.value })} /></label>
              <label className="span2">Client address<textarea rows={2} value={editing.clientAddress} onChange={(e) => setEditing({ ...editing, clientAddress: e.target.value })} /></label>
              <label>Invoice date<input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></label>
              <label>Due date<input type="date" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></label>
              {editing.status === 'paid' && (
                <label>Paid date<input type="date" value={editing.paidDate || editing.date || ''} onChange={(e) => setEditing({ ...editing, paidDate: e.target.value })} /></label>
              )}
            </div>

            <table className="invoice-lines">
              <thead><tr><th style={{ width: '52%' }}>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {editing.lines.map((l) => (
                  <tr key={l.id}>
                    <td><input value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} /></td>
                    <td><input type="number" step="0.5" value={l.qty} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) })} /></td>
                    <td><input type="number" step="1" value={l.rate} onChange={(e) => setLine(l.id, { rate: Number(e.target.value) })} /></td>
                    <td>{fmtAmount((Number(l.qty) || 0) * (Number(l.rate) || 0), editing.currency)}</td>
                    <td><button className="ghost" onClick={() => removeLine(l.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar" style={{ marginTop: 8 }}><button onClick={addLine}>＋ Add line</button></div>

            <label style={{ display: 'block', marginTop: 12 }}>
              <span className="hint">Notes (optional)</span>
              <textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} style={{ width: '100%' }} />
            </label>

            <div className="invoice-total">Total: {fmtAmount(total(editing), editing.currency)}</div>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={cancelEdit}>Cancel</button>
              <button className="primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </section>
      )}

      {active && !editing && (
        <>
          <div className="toolbar no-print" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="primary" onClick={() => window.print()}>🖨 Print / Save PDF</button>
          </div>
          <div className="inv-paper">
            <div className="inv-head">
              <h1>Invoice</h1>
              <div className="inv-from">
                <strong>{profile.name || 'Your name'}</strong>
                {profile.address && <div className="inv-pre">{profile.address}</div>}
                {profile.email && <div>{profile.email}</div>}
                {profile.taxId && <div>ICE / Tax ID: {profile.taxId}</div>}
              </div>
            </div>

            <div className="inv-meta">
              <div className="inv-billto">
                <div className="inv-label">Bill to:</div>
                <strong>{active.client || '—'}</strong>
                {active.clientAddress && <div className="inv-pre">{active.clientAddress}</div>}
              </div>
              <table className="inv-meta-table">
                <tbody>
                  <tr><td>Invoice number:</td><td>{active.number || '—'}</td></tr>
                  <tr><td>Invoice date:</td><td>{fmtDMY(active.date)}</td></tr>
                  {active.dueDate && <tr><td>Due date:</td><td>{fmtDMY(active.dueDate)}</td></tr>}
                  <tr><td>Currency:</td><td>{active.currency}</td></tr>
                </tbody>
              </table>
            </div>

            <table className="inv-lines">
              <thead><tr><th>Description</th><th className="amt">Amount</th></tr></thead>
              <tbody>
                {active.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="amt">{fmtAmount((Number(l.qty) || 0) * (Number(l.rate) || 0), active.currency)}</td>
                  </tr>
                ))}
                <tr className="inv-total-row"><td>Total</td><td className="amt">{fmtAmount(total(active), active.currency)}</td></tr>
              </tbody>
            </table>

            {active.notes && <div className="inv-notes inv-pre">{active.notes}</div>}

            {(profile.bankIban || profile.bankAccountNumber || profile.bankSwift || profile.bankName) && (
              <div className="inv-bank">
                <div className="inv-label">Receiver’s Bank Account Details:</div>
                <table className="inv-bank-table"><tbody>
                  {profile.bankIban && <tr><td>IBAN</td><td>{profile.bankIban}</td></tr>}
                  {profile.bankAccountNumber && <tr><td>Account Number</td><td>{profile.bankAccountNumber}</td></tr>}
                  {profile.bankAccountHolder && <tr><td>Accountholder Name</td><td>{profile.bankAccountHolder}</td></tr>}
                  {profile.bankSwift && <tr><td>SWIFT Code</td><td>{profile.bankSwift}</td></tr>}
                  {profile.bankName && <tr><td>Bank Name</td><td>{profile.bankName}</td></tr>}
                </tbody></table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
