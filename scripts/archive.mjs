// Per-day archive: docs/data/archive/<day>.json (merged across the day's runs,
// deduped by title) plus an index.json of every day with its story count, so
// a History view could later navigate the whole archive. No retention cap —
// once a story has appeared on the site, it stays reachable here.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

// Google News keeps re-returning old stories; the live site hides them via
// isFresh(), but this guard keeps them out of the archive's day bucket too —
// a resurfaced March article should not land under today's day file.
const ARCHIVE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function isArchivable(item, day) {
  const t = Date.parse(item.publishedAt);
  if (!Number.isFinite(t)) return false;
  const ref = Date.parse(`${day}T23:59:59.999Z`);
  const age = ref - t;
  return age < ARCHIVE_MAX_AGE_MS && age > -2 * 24 * 60 * 60 * 1000;
}

export function updateDayArchive(archiveDir, day, items, keyFn) {
  mkdirSync(archiveDir, { recursive: true });
  const path = join(archiveDir, `${day}.json`);
  const existing = readJson(path, { day, items: [] });
  const merged = new Map(existing.items.map((i) => [keyFn(i), i]));
  for (const i of items) if (!merged.has(keyFn(i))) merged.set(keyFn(i), i);
  const kept = [...merged.values()].filter((i) => isArchivable(i, day));
  writeFileSync(path, JSON.stringify({ day, items: kept }, null, 2));
  return rebuildDayIndex(archiveDir, { [day]: kept.length });
}

export function rebuildDayIndex(archiveDir, knownCounts = {}) {
  const indexPath = join(archiveDir, "index.json");
  const prev = new Map(readJson(indexPath, []).map((e) => [e.day, e.count]));
  const index = readdirSync(archiveDir)
    .map((f) => DAY_FILE.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .reverse()
    .map((day) => ({
      day,
      count: knownCounts[day] ?? prev.get(day) ?? readJson(join(archiveDir, `${day}.json`), { items: [] }).items.length,
    }));
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return index;
}
