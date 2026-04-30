import { useMemo, useState } from 'react';
import { useEncryptedState } from '../vault/useEncryptedState.js';

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);

const blankInvoice = () => ({
  id: newId(),
  number: '',
  client: '',
  clientAddress: '',
  date: new Date().toISOString().slice(0, 10),
  dueDate: '',
  currency: 'MAD',
  lines: [{ id: newId(), description: '', qty: 1, rate: 0 }],
  notes: '',
  status: 'draft'
});

const fmtCurrency = (n, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch { return `${(n || 0).toFixed(2)} ${currency}`; }
};

export default function InvoicesApp() {
  const [invoices, setInvoices] = useEncryptedState('invoices/list', []);
  const [profile, setProfile] = useEncryptedState('invoices/profile', {
    name: '', address: '', email: '', taxId: '', defaultCurrency: 'MAD'
  });
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(null);

  const sorted = useMemo(
    () => [...invoices].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [invoices]
  );
  const active = invoices.find((i) => i.id === activeId);

  const startNew = () => {
    const draft = { ...blankInvoice(), currency: profile.defaultCurrency || 'MAD' };
    setEditing(draft);
    setActiveId(null);
  };

  const editExisting = (inv) => {
    setEditing(JSON.parse(JSON.stringify(inv)));
    setActiveId(inv.id);
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = () => {
    const exists = invoices.some((i) => i.id === editing.id);
    setInvoices(exists ? invoices.map((i) => (i.id === editing.id ? editing : i)) : [...invoices, editing]);
    setActiveId(editing.id);
    setEditing(null);
  };

  const remove = (id) => {
    if (!confirm('Delete this invoice?')) return;
    setInvoices(invoices.filter((i) => i.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const setLine = (id, patch) => {
    setEditing({ ...editing, lines: editing.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  };
  const addLine = () => setEditing({ ...editing, lines: [...editing.lines, { id: newId(), description: '', qty: 1, rate: 0 }] });
  const removeLine = (id) => setEditing({ ...editing, lines: editing.lines.filter((l) => l.id !== id) });

  const total = (inv) => (inv?.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  return (
    <>
      <section className="card no-print">
        <h2>Your details</h2>
        <div className="content">
          <div className="invoice-form">
            <label>Name / business
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </label>
            <label>Email
              <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </label>
            <label>Address
              <textarea rows={2} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
            </label>
            <label>Tax ID / ICE
              <input value={profile.taxId} onChange={(e) => setProfile({ ...profile, taxId: e.target.value })} />
            </label>
            <label>Default currency
              <input value={profile.defaultCurrency} onChange={(e) => setProfile({ ...profile, defaultCurrency: e.target.value.toUpperCase() })} />
            </label>
          </div>
        </div>
      </section>

      <section className="card no-print">
        <h2>Invoices ({invoices.length})</h2>
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button className="primary" onClick={startNew}>＋ New invoice</button>
          </div>
          {sorted.length === 0 && <div className="hint">No invoices yet.</div>}
          <div className="list">
            {sorted.map((inv) => (
              <div key={inv.id} className="row">
                <div>
                  <strong>#{inv.number || '—'}</strong> · {inv.client || 'Untitled'}<br />
                  <small>{inv.date} · {fmtCurrency(total(inv), inv.currency)} · {inv.status}</small>
                </div>
                <div className="actions">
                  <button onClick={() => setActiveId(inv.id === activeId ? null : inv.id)}>
                    {activeId === inv.id ? 'Hide' : 'View'}
                  </button>
                  <button onClick={() => editExisting(inv)}>Edit</button>
                  <button className="ghost" onClick={() => remove(inv.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {editing && (
        <section className="card no-print">
          <h2>{invoices.some((i) => i.id === editing.id) ? 'Edit invoice' : 'New invoice'}</h2>
          <div className="content">
            <div className="invoice-form">
              <label>Invoice number
                <input value={editing.number} onChange={(e) => setEditing({ ...editing, number: e.target.value })} />
              </label>
              <label>Status
                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>
              <label>Client name
                <input value={editing.client} onChange={(e) => setEditing({ ...editing, client: e.target.value })} />
              </label>
              <label>Currency
                <input value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
              </label>
              <label>Client address
                <textarea rows={2} value={editing.clientAddress} onChange={(e) => setEditing({ ...editing, clientAddress: e.target.value })} />
              </label>
              <label>Date
                <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              </label>
              <label>Due date
                <input type="date" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} />
              </label>
            </div>

            <table className="invoice-lines">
              <thead>
                <tr><th style={{ width: '60%' }}>Description</th><th>Qty</th><th>Rate</th><th>Total</th><th></th></tr>
              </thead>
              <tbody>
                {editing.lines.map((l) => (
                  <tr key={l.id}>
                    <td><input value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} /></td>
                    <td><input type="number" step="0.5" value={l.qty} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) })} /></td>
                    <td><input type="number" step="1" value={l.rate} onChange={(e) => setLine(l.id, { rate: Number(e.target.value) })} /></td>
                    <td>{fmtCurrency((Number(l.qty) || 0) * (Number(l.rate) || 0), editing.currency)}</td>
                    <td><button className="ghost" onClick={() => removeLine(l.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button onClick={addLine}>＋ Add line</button>
            </div>

            <label style={{ display: 'block', marginTop: 12 }}>
              <span className="hint">Notes</span>
              <textarea rows={3} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} style={{ width: '100%' }} />
            </label>

            <div className="invoice-total">Total: {fmtCurrency(total(editing), editing.currency)}</div>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={cancelEdit}>Cancel</button>
              <button className="primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </section>
      )}

      {active && !editing && (
        <section className="card invoice-print">
          <h2 className="no-print">Invoice preview</h2>
          <div className="content">
            <div className="toolbar no-print" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => window.print()}>🖨 Print / Save PDF</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>{profile.name || 'Your name'}</h3>
                <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{profile.address}</pre>
                {profile.email && <div>{profile.email}</div>}
                {profile.taxId && <div>ICE / Tax ID: {profile.taxId}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <h2 style={{ margin: 0 }}>INVOICE</h2>
                <div>#{active.number || '—'}</div>
                <div>Date: {active.date}</div>
                {active.dueDate && <div>Due: {active.dueDate}</div>}
                <div>Status: {active.status}</div>
              </div>
            </div>

            <hr />
            <div>
              <strong>Bill to:</strong>
              <div>{active.client}</div>
              <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{active.clientAddress}</pre>
            </div>

            <table className="invoice-lines">
              <thead>
                <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {active.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td>{l.qty}</td>
                    <td>{fmtCurrency(l.rate, active.currency)}</td>
                    <td>{fmtCurrency((Number(l.qty) || 0) * (Number(l.rate) || 0), active.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="invoice-total">Total: {fmtCurrency(total(active), active.currency)}</div>
            {active.notes && (
              <div style={{ marginTop: 16 }}>
                <strong>Notes</strong>
                <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{active.notes}</pre>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
