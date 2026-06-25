// Resume import helpers: JSON normalization + best-effort PDF text extraction.
// pdf.js is imported dynamically so it never weighs down the main bundle.

const newId = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);

const asArray = (v) => (Array.isArray(v) ? v : []);
const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Coerce arbitrary imported JSON into our exact resume shapes (with ids).
export function normalizeImport(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const p = data.profile || {};
  const profile = {
    name: asStr(p.name), title: asStr(p.title), summary: asStr(p.summary),
    email: asStr(p.email), phone: asStr(p.phone), location: asStr(p.location),
    linksText: asStr(p.linksText ?? (asArray(p.links).map((l) => `${l.label || ''} | ${l.url || ''}`).join('\n')))
  };
  const experiences = asArray(data.experiences).map((e) => ({
    id: e.id || newId(),
    role: asStr(e.role), client: asStr(e.client), location: asStr(e.location),
    start: asStr(e.start), end: asStr(e.end),
    tags: asArray(e.tags).map(asStr), bullets: asArray(e.bullets).map(asStr)
  }));
  const education = asArray(data.education).map((ed) => ({
    id: ed.id || newId(),
    degree: asStr(ed.degree), school: asStr(ed.school), location: asStr(ed.location),
    start: asStr(ed.start), end: asStr(ed.end)
  }));
  const skills = asArray(data.skills).map((s) => ({
    id: s.id || newId(),
    name: asStr(s.name),
    status: ['mastered', 'learning', 'backlog'].includes(s.status) ? s.status : 'mastered',
    proficiency: ['expert', 'advanced', 'intermediate'].includes(s.proficiency) ? s.proficiency : 'advanced',
    tags: asArray(s.tags).map(asStr), notes: asStr(s.notes),
    lastTouched: s.lastTouched || new Date().toISOString(),
    createdAt: s.createdAt || new Date().toISOString()
  })).filter((s) => s.name);
  return { profile, experiences, education, skills };
}

// Extract raw text from a PDF File using pdf.js (loaded on demand).
export async function extractPdfText(file) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines from text items using their y positions.
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it.str);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.join(' ').trim());
    pages.push(lines.filter(Boolean).join('\n'));
  }
  return pages.join('\n\n');
}

// Reliable bits we can pull from raw CV text. Experience structuring is left to
// the user (too unreliable to auto-map), but contact details are easy wins.
export function guessContacts(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '';
  const phone = (text.match(/(?:\+?\d[\d\s().-]{7,}\d)/) || [])[0]?.trim() || '';
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  // First two non-contact lines are usually Name then Title.
  const isContact = (l) => /@|https?:|\d{6,}/.test(l);
  const head = lines.filter((l) => !isContact(l)).slice(0, 2);
  return {
    name: head[0] || '',
    title: head[1] || '',
    email, phone,
    linksText: urls.map((u) => `Link | ${u}`).join('\n')
  };
}
