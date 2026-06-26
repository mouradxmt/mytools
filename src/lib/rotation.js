// Shared rotation math so the Calendar (month overlay) and the Rotation view
// agree on who is assigned which day.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const r = new Date(d.setDate(diff));
  r.setHours(0, 0, 0, 0);
  return r;
}

export function normalizeRotation(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    startDate: c.startDate || '',
    cycleDays: Array.isArray(c.cycleDays) ? c.cycleDays : [],
    people: Array.isArray(c.people) ? c.people : [],
    weeksAhead: c.weeksAhead || 8
  };
}

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

// Returns a function (Date) -> { names, isMine } | null for the assignment on
// that calendar date, or null if rotation isn't usable.
export function makeRotationLookup(cfg, meName) {
  const n = normalizeRotation(cfg);
  const len = n.cycleDays.length;
  if (!len || !n.startDate || n.people.length === 0) return null;
  const refMon = getMonday(new Date(n.startDate));

  return (date) => {
    const ci = n.cycleDays.indexOf(WEEKDAYS[date.getDay()]);
    if (ci < 0) return null; // this weekday isn't part of the cycle
    const shift = Math.round((getMonday(date).getTime() - refMon.getTime()) / ONE_WEEK);
    const norm = (idx) => ((idx + (shift % len) + len) % len);
    const names = n.people.filter((p) => norm(p.startDayIndex) === ci).map((p) => p.name);
    if (!names.length) return null;
    const isMine = meName ? names.includes(meName) : false;
    // Show everyone assigned that day; render your own name as "You" (first).
    const display = names.map((nm) => (meName && nm === meName ? 'You' : nm));
    if (isMine) display.sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));
    return { names, isMine, display };
  };
}
