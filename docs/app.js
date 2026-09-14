// Clarity front end: fetches docs/data/news.json (written by scripts/collect.mjs
// on a schedule), renders the feed, and drives the clickable category tabs.
// No build step, no dependencies — plain fetch + DOM, same as the data layer.

const DATA_URL = "data/news.json?ts=" + Date.now();
const feedEl = document.getElementById("feed");
const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");
const tabsEl = document.getElementById("tabs");
const template = document.getElementById("card-template");

let payload = null;
let currentCategory = (location.hash || "#all").slice(1);

// Only an absolute http(s) URL reaches an href — guards against a malformed
// or redirect-wrapped feed link becoming a javascript:/data: sink.
function safeUrl(url) {
  try {
    const u = new URL(url, location.href);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function renderCard(item, categoryLabel) {
  const node = template.content.cloneNode(true);
  node.querySelector(".card-category").textContent = categoryLabel;
  node.querySelector(".card-time").textContent = timeAgo(item.publishedAt);
  node.querySelector(".card-time").dateTime = item.publishedAt ?? "";

  const link = node.querySelector(".card-link");
  const href = safeUrl(item.url);
  link.textContent = item.title;
  if (href) link.href = href;
  else link.removeAttribute("target");

  const summaryEl = node.querySelector(".card-summary");
  summaryEl.textContent = item.summary ?? "";

  node.querySelector(".card-source").textContent = item.source ?? "Unknown source";

  const marker = node.querySelector(".bias-marker");
  const meter = node.querySelector(".bias-meter");
  const label = node.querySelector(".bias-label");
  if (item.bias && Number.isFinite(item.bias.score)) {
    const pct = ((item.bias.score + 100) / 200) * 100;
    marker.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    meter.title = `${item.source}: ${item.bias.label}`;
    label.textContent = item.bias.label;
  } else {
    marker.classList.add("unrated");
    label.textContent = "Not rated";
  }

  return node;
}

function render() {
  if (!payload) return;

  const categories = payload.categories ?? [];
  const active = categories.some((c) => c.key === currentCategory) ? currentCategory : "all";
  for (const btn of tabsEl.querySelectorAll(".tab")) {
    btn.classList.toggle("active", btn.dataset.category === active);
  }

  const labelByKey = new Map(categories.map((c) => [c.key, c.label]));
  const groups = active === "all" ? categories.map((c) => c.key) : [active];

  const items = groups
    .flatMap((key) => (payload.articles?.[key] ?? []).map((item) => ({ item, key })))
    .sort((a, b) => String(b.item.publishedAt).localeCompare(String(a.item.publishedAt)));

  feedEl.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No stories yet — check back after the next refresh.";
    feedEl.append(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const { item, key } of items) frag.append(renderCard(item, labelByKey.get(key) ?? key));
  feedEl.append(frag);
}

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentCategory = btn.dataset.category;
  location.hash = currentCategory;
  render();
});

window.addEventListener("hashchange", () => {
  currentCategory = (location.hash || "#all").slice(1);
  render();
});

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
    updatedEl.textContent = payload.generatedAt ? `Updated ${timeAgo(payload.generatedAt)}` : "Live";
    statusEl.hidden = true;
    render();
  } catch (err) {
    updatedEl.textContent = "Offline";
    statusEl.hidden = false;
    statusEl.textContent = "Couldn't load the latest stories. The feed may still be generating its first run.";
    console.error("Clarity: failed to load news.json", err);
  }
}

load();
// Refresh the in-page data (not just the "Updated Xm ago" label) every 5
// minutes so a tab left open picks up new stories without a manual reload.
setInterval(load, 5 * 60 * 1000);
