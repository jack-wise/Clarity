# Clarity

The day's most important stories, clearly. A self-updating news site that
pulls political, economic, and geopolitical coverage from outlets across the
spectrum and shows each story's source on a left-right bias scale — so the
slant is visible before you click, not hidden inside it.

Built the same way as [jack-wise/AI-Newsletter](https://github.com/jack-wise/AI-Newsletter):
a scheduled GitHub Actions collector writes JSON, GitHub Pages serves a static
site that reads it.

## How it works

```
GitHub Actions (cron */30) ──► scripts/collect.mjs ──► docs/data/news.json ──► GitHub Pages (docs/)
                                                   └──► docs/data/archive/YYYY-MM-DD.json
```

- **Sources (all keyless — no API keys needed):**
  - Google News RSS — one query per category (politics, economy, geopolitics)
  - Direct outlet section feeds: The Wall Street Journal, CNN, Fox News, The
    New York Times, NPR, BBC News, The Guardian, HuffPost, The Hill, Newsmax
  - The full source/feed list lives in `config.json` — add or remove outlets
    there.
- **Categorization:** each headline is matched against keyword patterns for
  `political` / `economic` / `geopolitical` (see `config.categories` in
  `config.json`); a feed's own section (e.g. an outlet's "world" feed) is the
  fallback when no keyword matches.
- **Bias scale:** every source has a `-100` (furthest left) to `+100`
  (furthest right) rating in `config.sourceBias`, rendered as a marker on a
  blue-to-red gradient on each card. **These ratings are an editorial
  approximation for illustration** — based on each outlet's general public
  reputation, not a scientific or third-party measurement. An outlet not in
  the map renders as "Not rated" rather than guessing.
- **Ranking:** freshness only, within each category. Wire reprints across
  outlets are deduped by normalized title, keeping the copy with the richer
  summary.
- **Resilience:** every source runs independently (`Promise.allSettled`); a
  failing feed lands in `sourceErrors` in the payload instead of failing the
  run.

## Running it

```
node scripts/collect.mjs
```

Requires Node 20+ (uses the built-in `fetch`) — no `npm install` needed, the
collector has zero dependencies.

## Deployment

- GitHub Pages serves `/docs` on `main`.
- `.github/workflows/update.yml` runs the collector every 30 minutes
  (`workflow_dispatch` also available for a manual run) and commits any
  changed data under `docs/data/`.

## Adding a source

1. Add an entry to `config.feeds` (`url`, `source`, `category`) in
   `config.json`.
2. If it's a new outlet, add its bias rating to `config.sourceBias`
   (lowercase key). Without an entry it still shows up, just unrated.
