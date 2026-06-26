// Shared working-day math so Invoices can compute a month exactly like the
// Calendar does (Morocco holidays + custom + vacations, excluding weekends).

const fmtDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};
const parseISO = (s) => { const [y, m, da] = s.split('-').map(Number); return new Date(y, m - 1, da); };
const isWeekend = (d) => { const day = d.getDay(); return day === 0 || day === 6; };

export async function fetchMoroccoHolidays(year) {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/MA`);
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const h of data) {
      if (!h.types || h.types.includes('Public')) out[h.date] = { name: h.localName || h.name };
    }
    return out;
  } catch { return {}; }
}

export function activeHolidaySet({ apiHolidays = {}, apiOverrides = {}, customHolidays = {} }) {
  const set = new Set();
  for (const d of Object.keys(apiHolidays)) {
    const ov = apiOverrides[d];
    if (ov ? !!ov.enabled : true) set.add(d);
  }
  for (const [d, info] of Object.entries(customHolidays)) if (info.enabled) set.add(d);
  return set;
}

export function vacationSetForMonth(vacations = [], year, month) {
  const set = new Set();
  for (const v of vacations) {
    const s = parseISO(v.start), e = parseISO(v.end);
    const start = new Date(Math.max(s, new Date(year, month, 1)));
    const end = new Date(Math.min(e, new Date(year, month + 1, 0)));
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) set.add(fmtDate(d));
  }
  return set;
}

export function workingDaysInMonth({ year, month, holidaySet, vacationSet }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let working = 0, weekend = 0, holidays = 0, vacations = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const iso = fmtDate(d);
    if (isWeekend(d)) { weekend++; continue; }
    if (holidaySet.has(iso)) { holidays++; continue; }
    if (vacationSet.has(iso)) { vacations++; continue; }
    working++;
  }
  return { working, weekend, holidays, vacations, daysInMonth };
}
