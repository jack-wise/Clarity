// The periodic collector. Fetches every configured source (Google News +
// direct outlet feeds), classifies each story into political / economic /
// geopolitical, tags it with its source's left-right bias rating, dedupes,
// and writes docs/data/news.json (which the static site renders) plus a
// per-day archive. Designed to ALWAYS produce a payload: individual source
// failures are recorded in sourceErrors, never fatal.
//
// Run locally: node scripts/collect.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGoogleNews, fetchFeed } from "./sources.mjs";
import { buildCategoryMatchers, classifyCategory, lookupBias } from "./classify.mjs";
import { updateDayArchive } from "./archive.mjs";
import { generateBrief } from "./brief.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const categoryMatchers = buildCategoryMatchers(config.categories);

// Google News hides the real publisher in the title suffix (" - Publisher");
// resolve it so the bias lookup and display source are the outlet, not
// "Google News".
function resolveGoogleSource(item) {
  if (item.source && item.source !== "Google News") return item.source;
  const m = /-\s*([^-]+)$/.exec(item.title);
  return m ? m[1].trim() : item.source;
}

// Dedupe key: normalized title with any " - Publisher" suffix and
// punctuation stripped, so wire reprints across outlets cluster to one item.
function dedupeKey(item) {
  return item.title
    .replace(/\s+-\s+[^-]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// Left / center / right bucket for the balancing pass below. Unrated items
// count as center rather than being excluded — an unknown outlet shouldn't
// be penalized, but it also shouldn't quietly pad out one side.
function bucketOf(item) {
  const s = item.bias?.score;
  if (s == null) return "center";
  if (s <= -6) return "left";
  if (s >= 6) return "right";
  return "center";
}

function freshnessScore(publishedAt) {
  if (!publishedAt) return 0;
  const hours = (Date.now() - Date.parse(publishedAt)) / 3_600_000;
  if (hours < 1) return 40;
  if (hours < 6) return 30;
  if (hours < 24) return 20;
  if (hours < 72) return 10;
  return 0;
}

const MAX_ITEM_AGE_MS = 5 * 24 * 60 * 60 * 1000;

async function main() {
  const tasks = [];
  const sourceErrors = [];
  const run = (label, promise) =>
    tasks.push(
      promise.then(
        (items) => ({ label, items }),
        (e) => {
          sourceErrors.push({ source: label, error: String(e?.message ?? e) });
          return { label, items: [] };
        },
      ),
    );

  for (const q of config.googleNewsQueries ?? []) {
    run(`google-news:${q.category}`, fetchGoogleNews(q.query, q.category));
  }
  for (const f of config.feeds ?? []) {
    run(`${f.source}:${f.category}`, fetchFeed(f.url, f.source, f.category));
  }

  const settled = await Promise.all(tasks);

  // Normalize, resolve source, classify, tag bias, dedupe (best copy wins:
  // prefer the one carrying a summary and a real title-suffix category match
  // over a bare feed default).
  const byKey = new Map();
  for (const { items } of settled) {
    for (const raw of items ?? []) {
      const source = resolveGoogleSource(raw);
      const category = classifyCategory(raw.title, categoryMatchers, raw.category);
      const bias = lookupBias(source, config.sourceBias);
      const item = { ...raw, source, category, bias };
      const key = dedupeKey(item);
      if (!key) continue;
      const prev = byKey.get(key);
      const better = !prev || (Boolean(item.summary) && !prev.summary);
      if (better) byKey.set(key, item);
    }
  }

  const all = [...byKey.values()]
    .filter((i) => {
      const t = Date.parse(i.publishedAt);
      return Number.isFinite(t) && Date.now() - t < MAX_ITEM_AGE_MS;
    })
    .map((item) => ({ ...item, score: freshnessScore(item.publishedAt) + (item.bias ? 5 : 0) }));

  const byScore = (a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt));

  // Per-source cap applied BEFORE the category cap: without it, whichever
  // outlet's feed happens to be busiest that cycle can fill most of a
  // category, which defeats the point of a left-right spectrum view.
  const perSource = config.limits?.perSource ?? 12;
  const perCategory = config.limits?.perCategory ?? 60;
  const byCategory = {};
  for (const c of config.categories) {
    const sourceCounts = new Map();
    const buckets = { left: [], center: [], right: [] };
    for (const item of all.filter((i) => i.category === c.key).sort(byScore)) {
      const n = sourceCounts.get(item.source) ?? 0;
      if (n >= perSource) continue;
      sourceCounts.set(item.source, n + 1);
      buckets[bucketOf(item)].push(item);
    }

    // Balance pass: round-robin across left/center/right instead of picking
    // by freshness alone. Freshness-only selection lets whichever side
    // happens to publish more, or publish faster, dominate a category
    // regardless of how many sources are configured on each side — which is
    // exactly the "everything is left-leaning" complaint this exists to fix.
    // A side with less available supply just contributes fewer items; it
    // never blocks the other buckets from filling the remaining slots.
    const capped = [];
    const idx = { left: 0, center: 0, right: 0 };
    let addedAny = true;
    while (capped.length < perCategory && addedAny) {
      addedAny = false;
      for (const b of ["left", "center", "right"]) {
        if (capped.length >= perCategory) break;
        if (idx[b] < buckets[b].length) {
          capped.push(buckets[b][idx[b]++]);
          addedAny = true;
        }
      }
    }

    // Selection was round-robin; display order is still newest-first.
    capped.sort(byScore);
    byCategory[c.key] = capped.map(({ score, ...rest }) => rest);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    siteTitle: config.siteTitle,
    tagline: config.tagline,
    categories: config.categories.map((c) => ({ key: c.key, label: c.label })),
    articles: byCategory,
    sourceErrors,
  };

  const dataDir = join(root, "docs", "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "news.json"), JSON.stringify(payload, null, 2));

  const day = payload.generatedAt.slice(0, 10);
  updateDayArchive(join(dataDir, "archive"), day, Object.values(byCategory).flat(), dedupeKey);

  const brief = await generateBrief({ byCategory, categories: config.categories, now: Date.parse(payload.generatedAt) });
  writeFileSync(join(dataDir, "brief.json"), JSON.stringify(brief, null, 2));

  const counts = config.categories.map((c) => `${c.label}=${byCategory[c.key].length}`).join(" ");
  console.log(`collected: ${counts} (${sourceErrors.length} source errors)`);
  for (const c of config.categories) {
    const b = { left: 0, center: 0, right: 0 };
    for (const item of byCategory[c.key]) b[bucketOf(item)]++;
    console.log(`  ${c.label} spectrum: left=${b.left} center=${b.center} right=${b.right}`);
  }
  for (const e of sourceErrors) console.warn(`  source error: ${e.source}: ${e.error}`);
}

await main();
