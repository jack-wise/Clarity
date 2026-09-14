# Clarity

The day's most important stories, clearly. A self-updating news site that
pulls political, economic, financial, and geopolitical coverage from outlets
across the spectrum and shows each story's source on a left-right bias scale
— so the slant is visible before you click, not hidden inside it.

Built the same way as [jack-wise/AI-Newsletter](https://github.com/jack-wise/AI-Newsletter):
a scheduled GitHub Actions collector writes JSON, GitHub Pages serves a static
site that reads it.

## How it works

```
GitHub Actions (cron */30) ──► scripts/collect.mjs ──► docs/data/news.json  ──► GitHub Pages (docs/)
                                                   ├──► docs/data/brief.json
                                                   └──► docs/data/archive/YYYY-MM-DD.json
```

- **Sources (all keyless — no API keys needed):**
  - Google News RSS — one query per category, plus `site:` queries for
    outlets whose own feeds are unreliable (see note below)
  - Direct outlet section feeds, deliberately spanning the spectrum:
    Bloomberg, Fox News / Fox Business, The New York Times, NPR, BBC News,
    The Guardian, HuffPost, The Hill, New York Post, Breitbart, Washington
    Examiner, Daily Wire, National Review, The Federalist, Washington Times
  - CNN, The Wall Street Journal, and Newsmax are covered via Google News
    `site:` queries rather than a direct feed — CNN's and WSJ's public RSS
    hosts turned out to serve frozen, years-old content (HTTP 200 but dead),
    and Newsmax's direct feed times out from GitHub's runners.
  - The full source/feed list lives in `config.json` — add or remove outlets
    there.
- **Categorization:** each headline is matched against keyword patterns for
  `political` / `economic` / `financial` / `geopolitical` (see
  `config.categories`); a feed's own section (e.g. an outlet's "world" feed)
  is the fallback when no keyword matches. `economic` is macro/policy
  (inflation, the Fed, jobs reports); `financial` is markets/corporate
  (stocks, earnings, IPOs, crypto) — the **Financial** tab also shows daily
  charts for the S&P 500, Nasdaq, and Bitcoin (via TradingView's free embed
  widget, the same source AI-Newsletter uses for its stock chart).
- **Bias scale:** every source has a `-100` (furthest left) to `+100`
  (furthest right) rating in `config.sourceBias`, rendered as a marker on a
  blue-to-red gradient on each card. **These ratings are an editorial
  approximation for illustration** — based on each outlet's general public
  reputation, not a scientific or third-party measurement. An outlet not in
  the map renders as "Not rated" rather than guessing.
- **Ranking:** each category is filled by round-robin across left / center /
  right buckets (by source bias score), not by freshness alone — freshness-
  only selection let whichever side happened to publish more or faster
  dominate a category regardless of how many sources were configured on each
  side. Within that, items are capped per outlet (`limits.perSource`, default
  12) so no single feed fills its own bucket. A side runs out of fresh
  stories some cycles — real-world supply of freely-syndicated right-leaning
  coverage is thinner than center-left — in which case it simply contributes
  fewer items rather than blocking the rest. The final list still displays
  newest-first; only the *selection* is bucketed. Wire reprints across
  outlets are deduped by normalized title, keeping the copy with the richer
  summary.
- **The Brief:** a short read at the top of the page, one paragraph per
  category, generated fresh each collector run from that run's actual top
  stories. Keyless by default (a deterministic template); set the
  `ANTHROPIC_API_KEY` repo secret to upgrade it to an AI-written narrative
  (Claude Haiku) — same fail-open pattern as AI-Newsletter's Brief. Every
  claim is grounded in the collected stories; nothing is invented.
- **Resilience:** every source runs independently (`Promise.allSettled`); a
  failing feed lands in `sourceErrors` in the payload instead of failing the
  run.

## Running it

```
node scripts/collect.mjs
```

Requires Node 20+ (uses the built-in `fetch`). Zero dependencies unless
`ANTHROPIC_API_KEY` is set, in which case `npm install` first for the AI
brief narrative.

## Deployment

- GitHub Pages serves `/docs` on `main`.
- `.github/workflows/update.yml` runs the collector every 30 minutes
  (`workflow_dispatch` also available for a manual run) and commits any
  changed data under `docs/data/`.
- Optional: add the `ANTHROPIC_API_KEY` repo secret (Settings → Secrets and
  variables → Actions) to turn on the AI-written Brief.

## Adding a source

1. Add an entry to `config.feeds` (`url`, `source`, `category`) in
   `config.json` — or, if the outlet's own feed proves unreliable, a
   `site:example.com <topic>` entry in `config.googleNewsQueries` instead.
2. If it's a new outlet, add its bias rating to `config.sourceBias`
   (lowercase key). Without an entry it still shows up, just unrated.
