// Category classification (political / economic / geopolitical) and the
// left-right bias lookup. Both are deterministic and keyless — no AI call
// needed, matching the collector's "fails open / no dependencies" design.

// Builds one combined matcher per category from config.categories[].patterns.
export function buildCategoryMatchers(categories) {
  return categories.map((c) => ({
    key: c.key,
    re: new RegExp(c.patterns.join("|"), "i"),
  }));
}

// Priority order matters when a title matches more than one category:
// geopolitical > economic > political, since war/conflict language is the
// most specific signal and political language ("president", "sanctions")
// often also appears in geopolitical stories.
const PRIORITY = ["geopolitical", "economic", "political"];

export function classifyCategory(title, matchers, fallback) {
  const byKey = new Map(matchers.map((m) => [m.key, m]));
  for (const key of PRIORITY) {
    const m = byKey.get(key);
    if (m && m.re.test(title)) return key;
  }
  return fallback ?? "political";
}

// Normalizes a raw source label (outlet name, or a Google News "source" tag)
// to the sourceBias map's lowercase keys. Google News occasionally appends
// site suffixes ("The Guardian US") which won't exact-match; fall back to a
// substring check both ways.
export function lookupBias(sourceName, sourceBias) {
  const key = String(sourceName ?? "").trim().toLowerCase();
  if (sourceBias[key]) return { ...sourceBias[key], source: sourceName };
  for (const [name, bias] of Object.entries(sourceBias)) {
    if (key.includes(name) || name.includes(key)) return { ...bias, source: sourceName };
  }
  return null; // unknown outlet — rendered as "Not rated" rather than guessed
}
