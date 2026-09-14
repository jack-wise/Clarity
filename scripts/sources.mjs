// Feed fetchers: Google News RSS + direct outlet section feeds (WSJ, CNN, Fox
// News, NYT, NPR, BBC, The Guardian, HuffPost, The Hill, Newsmax, ...).
// Dependency-free (Node 20+ global fetch); each fetcher returns normalized
// items: { title, url, source, publishedAt, category }
// Failures throw — the collector runs every source under Promise.allSettled
// and records per-source errors instead of failing the whole run.

const UA = "Clarity News jgwise3@gmail.com";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);|&#39;/g, (m) => ENTITIES[m] ?? m);
}

// Minimal forgiving extraction of one tag's inner text from an XML fragment.
function tag(fragment, name) {
  const m = fragment.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

function toIso(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// --- Google News RSS ---------------------------------------------------------
// https://news.google.com/rss/search?q=... — keyless. Each <item> carries the
// publisher in <source>; the <link> is a Google redirect that resolves to the
// publisher, which is fine for a link-out.
export async function fetchGoogleNews(query, category) {
  const url =
    "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=en-US&gl=US&ceid=US:en";
  const xml = await fetchText(url);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = tag(it, "title");
    const link = tag(it, "link");
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      // Google News titles end with " - Publisher"; the collector resolves
      // the real outlet from that suffix.
      source: tag(it, "source") ?? "Google News",
      publishedAt: toIso(tag(it, "pubDate")),
      category,
    });
  }
  return items;
}

// --- Generic RSS 2.0 feed -----------------------------------------------------
// Used for every direct outlet section feed (WSJ, CNN, Fox News, NYT, NPR,
// BBC, The Guardian, HuffPost, The Hill, Newsmax, ...). Each already carries
// a known source name and a pre-assigned category from config.json.
export async function fetchFeed(url, source, category) {
  const xml = await fetchText(url);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = tag(it, "title");
    const link = tag(it, "link");
    if (!title || !link) continue;
    // Only absolute http(s) links reach the site's href sink.
    if (!/^https?:\/\//i.test(link)) continue;
    const desc = tag(it, "description");
    items.push({
      title,
      url: link,
      source,
      publishedAt: toIso(tag(it, "pubDate")),
      category,
      ...(desc && desc.length > 30
        ? { summary: desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320) }
        : {}),
    });
  }
  return items;
}
