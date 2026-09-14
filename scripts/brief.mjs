// Builds "The Brief" — a short daily read summarizing the top political,
// economic, financial, and geopolitical stories currently on the site,
// written to docs/data/brief.json each collector run.
//
// Two producers (mirrors AI Newsletter's brief.mjs fail-open pattern):
//   - generateBrief(): an AI narrative via the Anthropic SDK (Claude Haiku),
//     gated on the ANTHROPIC_API_KEY repo secret. Falls back to the template
//     on any failure — a missing key, a missing SDK, or an API error never
//     breaks the collector.
//   - buildBrief(): a deterministic, keyless synthesis of the same
//     already-collected stories. Always available; also the fallback.
// Every claim is grounded in the stories collect.mjs already gathered; no
// producer invents a headline, source, or figure.

// Strips a Google-News " - Publisher" suffix for cleaner in-brief quoting.
function cleanTitle(item) {
  const m = /^(.*\S)\s+-\s+[^-]{2,60}$/.exec(item.title ?? "");
  return (m ? m[1] : item.title ?? "").trim();
}

function paragraphFor(label, items) {
  if (!items.length) return `No fresh ${label.toLowerCase()} stories are in the current window.`;
  const [lead, second] = items;
  let p = `${label}: "${cleanTitle(lead)}"${lead.source ? ` (${lead.source})` : ""} leads the coverage.`;
  if (second) p += ` Also notable: "${cleanTitle(second)}"${second.source ? ` (${second.source})` : ""}.`;
  return p;
}

export function buildBrief({ byCategory = {}, categories = [], now = Date.now() } = {}) {
  const paragraphs = categories.map((c) => paragraphFor(c.label, byCategory[c.key] ?? []));
  const counts = Object.fromEntries(categories.map((c) => [c.key, (byCategory[c.key] ?? []).length]));
  return {
    generatedAt: new Date(now).toISOString(),
    generator: "template",
    counts,
    paragraphs,
  };
}

// --- AI narrative (Claude Haiku) --------------------------------------------
// Gated on ANTHROPIC_API_KEY. The SDK is imported dynamically so a missing
// dependency degrades to the deterministic template instead of crashing the
// keyless cron. Never throws.

const BRIEF_MODEL = process.env.BRIEF_MODEL || "claude-haiku-4-5";

const BRIEF_SYSTEM =
  "You write \"The Brief\" for Clarity, a news site that shows political, economic, " +
  "financial, and geopolitical stories from outlets across the spectrum. You are given " +
  "a JSON object of the CURRENT top stories in each of those four categories (title, " +
  "source, publish time). Write one short paragraph per category (4 total, in the order " +
  "given), each 1-2 sentences, summarizing what's happening in that category right now " +
  "based ONLY on the headlines provided. Ground every statement only in the provided " +
  "data — never invent a headline, source, date, or fact not present; if a category has " +
  "no stories, say so plainly in one sentence. Neutral, factual, plain prose — do not " +
  "editorialize about any political side. Output plain text only: no markdown, no " +
  "headings, no bullet points, no preamble, no title. Separate the four paragraphs with " +
  "a single blank line.";

function factsForPrompt({ byCategory, categories }) {
  const clip = (s, n) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : null);
  return categories.map((c) => ({
    category: c.label,
    stories: (byCategory[c.key] ?? []).slice(0, 5).map((i) => ({
      headline: cleanTitle(i),
      source: i.source ?? null,
      publishedAt: i.publishedAt ?? null,
      summary: clip(i.summary, 200),
    })),
  }));
}

function toParagraphs(text, expected) {
  const paragraphs = (text ?? "")
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paragraphs.length === expected ? paragraphs : null;
}

let _anthropic; // lazily constructed, reused across a run
async function getAnthropic() {
  if (_anthropic !== undefined) return _anthropic;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropic = new Anthropic({ maxRetries: 2 });
  } catch {
    _anthropic = null; // SDK not installed — degrade to the template
  }
  return _anthropic;
}

async function narrateViaAnthropic(facts) {
  const client = await getAnthropic();
  if (!client) {
    console.log("[brief] @anthropic-ai/sdk not available — using template");
    return null;
  }
  try {
    const stream = client.messages.stream({
      model: BRIEF_MODEL,
      max_tokens: 700,
      system: BRIEF_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts, null, 2) }],
    });
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text ? { text, model: BRIEF_MODEL } : null;
  } catch (e) {
    console.warn(`[brief] Haiku generation failed (${e?.message ?? e}) — using template`);
    return null;
  }
}

// Returns the brief object. Uses an AI narrative (Claude Haiku) when
// ANTHROPIC_API_KEY is set and returns usable prose; otherwise the
// deterministic template — which is what runs with zero configuration.
export async function generateBrief({ byCategory = {}, categories = [], now = Date.now() } = {}) {
  const base = buildBrief({ byCategory, categories, now });
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[brief] ANTHROPIC_API_KEY not set — using deterministic template");
    return base;
  }
  const facts = factsForPrompt({ byCategory, categories });
  const result = await narrateViaAnthropic(facts);
  if (result) {
    const paragraphs = toParagraphs(result.text, categories.length);
    if (paragraphs) {
      console.log(`[brief] AI narrative via ${result.model}`);
      return { ...base, generator: "ai", model: result.model, paragraphs };
    }
    console.log(`[brief] ${result.model} returned unusable output — using template`);
  }
  return base;
}
