// Clarity front end: fetches docs/data/news.json and docs/data/brief.json
// (both written by scripts/collect.mjs on a schedule), renders the Brief and
// the per-category feed panels, and drives tab switching + "Show more"
// pagination. No build step, no dependencies — plain fetch + DOM.

const PAGE_SIZE = 12;

const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");
const briefUpdatedEl = document.getElementById("brief-updated");
const briefBodyEl = document.getElementById("brief-body");
const briefCountsEl = document.getElementById("brief-counts");
const tabsEl = document.getElementById("tabs");
const template = document.getElementById("card-template");

// One entry per <section class="panel" data-panel="...">: its DOM refs plus
// the full (already-fetched) item list and how many are currently shown.
const panels = {};
for (const el of document.querySelectorAll(".panel")) {
  const key = el.dataset.panel;
  panels[key] = {
    el,
    gridEl: el.querySelector("[data-grid]"),
    moreBtn: el.querySelector("[data-more]"),
    emptyEl: el.querySelector("[data-empty]"),
    items: [], // [{ item, label }]
    shown: 0,
  };
}

let payload = null;
let currentTab = "all";

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

  node.querySelector(".card-summary").textContent = item.summary ?? "";
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

function renderPanel(key) {
  const panel = panels[key];
  if (!panel) return;
  const slice = panel.items.slice(0, panel.shown);

  panel.gridEl.replaceChildren();
  panel.emptyEl.hidden = panel.items.length !== 0;

  const frag = document.createDocumentFragment();
  for (const { item, label } of slice) frag.append(renderCard(item, label));
  panel.gridEl.append(frag);

  const remaining = panel.items.length - slice.length;
  panel.moreBtn.hidden = remaining <= 0;
  panel.moreBtn.textContent = remaining > 0 ? `Show more (${remaining} left)` : "Show more";
}

function loadPanelItems() {
  if (!payload) return;
  const categories = payload.categories ?? [];
  const labelByKey = new Map(categories.map((c) => [c.key, c.label]));

  for (const c of categories) {
    const panel = panels[c.key];
    if (!panel) continue;
    panel.items = (payload.articles?.[c.key] ?? []).map((item) => ({ item, label: c.label }));
    panel.shown = Math.min(PAGE_SIZE, panel.items.length);
  }

  const all = panels.all;
  if (all) {
    all.items = categories
      .flatMap((c) => (payload.articles?.[c.key] ?? []).map((item) => ({ item, label: c.label })))
      .sort((a, b) => String(b.item.publishedAt).localeCompare(String(a.item.publishedAt)));
    all.shown = Math.min(PAGE_SIZE, all.items.length);
  }

  for (const key of Object.keys(panels)) renderPanel(key);
}

function setActiveTab(key) {
  if (!panels[key]) return;
  currentTab = key;
  for (const btn of tabsEl.querySelectorAll(".tab")) {
    btn.classList.toggle("active", btn.dataset.tab === key);
  }
  for (const [k, panel] of Object.entries(panels)) panel.el.hidden = k !== key;
}

document.addEventListener("click", (e) => {
  const showMoreBtn = e.target.closest("[data-more]");
  if (showMoreBtn) {
    const panel = showMoreBtn.closest(".panel");
    const key = panel?.dataset.panel;
    if (key && panels[key]) {
      panels[key].shown = Math.min(panels[key].shown + PAGE_SIZE, panels[key].items.length);
      renderPanel(key);
    }
    return;
  }
  const tabLink = e.target.closest("[data-tab]");
  if (tabLink) setActiveTab(tabLink.dataset.tab);
});

function renderBriefCounts(counts, categories) {
  briefCountsEl.replaceChildren();
  if (!counts) return;
  const labelByKey = new Map((categories ?? []).map((c) => [c.key, c.label]));
  const frag = document.createDocumentFragment();
  for (const [key, n] of Object.entries(counts)) {
    const pill = document.createElement("span");
    pill.className = "count-pill";
    pill.textContent = `${labelByKey.get(key) ?? key}: ${n}`;
    frag.append(pill);
  }
  briefCountsEl.append(frag);
}

function renderBrief(brief, categories) {
  briefBodyEl.replaceChildren();
  if (!brief) {
    briefBodyEl.innerHTML = '<p class="brief-loading">The brief isn\'t available right now.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const para of brief.paragraphs ?? []) {
    const p = document.createElement("p");
    p.textContent = para;
    frag.append(p);
  }
  briefBodyEl.append(frag);
  briefUpdatedEl.textContent = brief.generatedAt ? `Updated ${timeAgo(brief.generatedAt)}` : "";
  renderBriefCounts(brief.counts, categories);
}

async function loadJson(url) {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function load() {
  try {
    payload = await loadJson("data/news.json");
    updatedEl.textContent = payload.generatedAt ? `Updated ${timeAgo(payload.generatedAt)}` : "Live";
    statusEl.hidden = true;
    loadPanelItems();
  } catch (err) {
    updatedEl.textContent = "Offline";
    statusEl.hidden = false;
    statusEl.textContent = "Couldn't load the latest stories. The feed may still be generating its first run.";
    console.error("Clarity: failed to load news.json", err);
  }

  try {
    const brief = await loadJson("data/brief.json");
    renderBrief(brief, payload?.categories);
  } catch (err) {
    renderBrief(null, payload?.categories);
    console.error("Clarity: failed to load brief.json", err);
  }
}

setActiveTab("all");
load();
// Refresh the in-page data every 5 minutes so a tab left open picks up new
// stories without a manual reload.
setInterval(load, 5 * 60 * 1000);
