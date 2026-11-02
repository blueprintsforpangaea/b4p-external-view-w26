// Search suggestions, Google style: supply names and categories that start with what was
// typed, then ones with a word starting with it, then ones containing it, then close spellings
// ("glvoes" finds Gloves). No library; a few thousand names take well under a millisecond a word.

const lower = (t) => t.toLowerCase();

// Words with their positions, so a match can be bolded in the original text.
function wordsOf(text) {
  const out = [];
  const re = /[a-z0-9]+/g;
  let m;
  while ((m = re.exec(text))) out.push({ w: m[0], at: m.index });
  return out;
}

// [{ label, kind: 'supply' | 'category', low, words }], one per distinct label.
export function buildIndex(names, categories) {
  const seen = new Set();
  const out = [];
  const add = (label, kind) => {
    const low = lower(label.trim());
    if (!low || seen.has(`${kind}|${low}`)) return;
    seen.add(`${kind}|${low}`);
    out.push({ label: label.trim(), kind, low, words: wordsOf(low) });
  };
  categories.forEach((c) => add(c, 'category'));
  names.forEach((n) => add(n, 'supply'));
  return out;
}

// Edit distance with swaps counted as one ("glvoes"/"gloves" is 1), giving up past `max`.
export function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

const allowed = (n) => (n < 4 ? 0 : n < 7 ? 1 : 2);

// Up to `max` suggestions: [{ label, kind, start, end }], where start..end is the part to bold.
export function suggest(query, index, max = 8) {
  const q = lower(query.trim().replace(/\s+/g, ' '));
  if (!q) return [];
  const typo = allowed(q.length);
  const scored = [];
  for (const entry of index) {
    let score;
    let start = entry.low.indexOf(q);
    let len = q.length;
    if (start === 0) score = 0;
    else if (start > 0 && !/[a-z0-9]/.test(entry.low[start - 1])) score = 1;
    else if (start > 0) score = 2;
    else if (typo && !q.includes(' ')) {
      // A close spelling of a whole word, or of the start of a longer word ("syring" in progress).
      for (const { w, at } of entry.words) {
        const d = Math.min(distance(q, w, typo), w.length > q.length ? distance(q, w.slice(0, q.length), typo) : typo + 1);
        if (d <= typo && (score === undefined || 3 + d < score)) {
          score = 3 + d;
          start = at;
          len = w.length;
        }
      }
    }
    if (score !== undefined) scored.push({ entry, score, start, len });
  }
  scored.sort((a, b) => a.score - b.score
    || (a.entry.kind === 'category' ? -1 : 0) - (b.entry.kind === 'category' ? -1 : 0)
    || a.entry.label.length - b.entry.label.length
    || a.entry.low.localeCompare(b.entry.low));
  return scored.slice(0, max).map(({ entry, start, len }) => ({ label: entry.label, kind: entry.kind, start, end: start + len }));
}
