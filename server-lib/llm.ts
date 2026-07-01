// Module enhancement service.
//
// Three-tier strategy:
//   1. If OPENAI_API_KEY or ANTHROPIC_API_KEY is set in the env, call that
//      provider and ask the model to rewrite the source into a comprehensive
//      SCORM lesson with quizzes.
//   2. Otherwise (or if the provider call fails), use a deterministic local
//      "expand" routine that takes the source text and produces a properly
//      structured, substantially longer lesson — overview, multiple thematic
//      sections, an example, key takeaways, and common pitfalls — so the
//      "Enhance with AI" button still visibly improves the module even
//      without an external key.
//   3. Quiz questions are always generated locally (deterministic, grounded
//      in the source) so output is reliable even if the LLM hallucinates.
//
// Add keys via Settings → Advanced → Secrets:
//   OPENAI_API_KEY   → uses gpt-4o-mini
//   ANTHROPIC_API_KEY → uses claude-3-5-haiku-latest

import { autoGenerateQuiz } from "./auto-quiz";
import { generateLocalQuestions } from "./local-questions";
import { plainTextToHtml } from "../src/lib/utils";

export type EnhancedModule = {
  title: string;
  contentHtml: string;
  suggestedQuestions: {
    id: string;
    prompt: string;
    choices: string[];
    correctIndex: number;
    explanation: string;
  }[];
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// --- Provider adapters ---------------------------------------------------

async function callOpenAI(system: string, user: string, timeoutMs = 45_000): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json()) as any;
    return j?.choices?.[0]?.message?.content ?? null;
  } catch (e: any) {
    console.warn(`[llm] openai error: ${e?.message || String(e)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function callAnthropic(system: string, user: string, apiKey: string, timeoutMs = 45_000): Promise<string | null> {
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json()) as any;
    return j?.content?.[0]?.text ?? null;
  } catch (e: any) {
    console.warn(`[llm] anthropic error: ${e?.message || String(e)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// --- Google Gemini adapter (BYOK from client) ---------------------------

const GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

async function callGemini(system: string, user: string, apiKey: string, timeoutMs = 45_000): Promise<string | null> {
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GEMINI_URL("gemini-2.0-flash", apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json()) as any;
    return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e: any) {
    console.warn(`[llm] gemini error: ${e?.message || String(e)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function callLLM(
  system: string,
  user: string,
  byokKey?: { provider: "openai" | "anthropic" | "gemini"; key: string }
): Promise<string | null> {
  if (byokKey?.provider === "openai" && byokKey.key) {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = byokKey.key;
    const r = await callOpenAI(system, user);
    if (prevKey) process.env.OPENAI_API_KEY = prevKey; else delete process.env.OPENAI_API_KEY;
    return r;
  }
  if (byokKey?.provider === "anthropic" && byokKey.key) {
    return callAnthropic(system, user, byokKey.key);
  }
  if (byokKey?.provider === "gemini" && byokKey.key) {
    return callGemini(system, user, byokKey.key);
  }
  if (process.env.OPENAI_API_KEY) return callOpenAI(system, user);
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(system, user, process.env.ANTHROPIC_API_KEY);
  return null;
}

// --- JSON extraction ------------------------------------------------------

function extractJsonObject(s: string | null): any | null {
  if (!s) return null;
  let t = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// --- Local heuristic enhancement -----------------------------------------

function splitSentences(t: string): string[] {
  return t
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+(?=[A-Z(\d])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitClauses(s: string): string[] {
  return s
    .split(/;\s+|,\s+(?=(?:and|but|however|while|whereas|because|since)\b)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function extractKeywords(text: string, n = 8): string[] {
  const stop = new Set([
    "the", "this", "that", "these", "those", "it", "its", "a", "an",
    "in", "on", "at", "to", "for", "of", "and", "or", "but", "if",
    "when", "while", "where", "why", "how", "who", "what", "which",
    "is", "are", "was", "were", "be", "been", "being",
    "you", "your", "we", "they", "he", "she", "them", "our", "us",
    "with", "from", "by", "as", "into", "about",
    "have", "has", "had", "do", "does", "did",
    "will", "would", "should", "could", "can", "may", "might", "must",
    "their", "his", "her", "one", "two", "many", "some", "all", "any",
    "more", "most", "less", "least", "very", "also", "just",
  ]);
  // Prefer noun phrases over single words when available.
  const phrases = new Map<string, number>();
  // 1. Quoted phrases: "multi-factor authentication"
  for (const m of text.matchAll(/"([^"]{3,40})"/g)) {
    const p = m[1].trim().toLowerCase();
    if (p.length >= 3 && !stop.has(p.split(/\s+/)[0])) {
      phrases.set(p, (phrases.get(p) || 0) + 3);
    }
  }
  // 2. Hyphenated terms: multi-factor, single-line
  for (const m of text.matchAll(/\b([a-z]+(?:-[a-z]+){1,3})\b/g)) {
    const p = m[1].toLowerCase();
    if (p.length >= 5 && !stop.has(p.split(/-/)[0])) {
      phrases.set(p, (phrases.get(p) || 0) + 2);
    }
  }
  // 3. Title-Case multi-word phrases (e.g. "Multi Factor", "Google Authenticator")
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
    const p = m[1].toLowerCase();
    if (p.length >= 5 && !stop.has(p.split(/\s+/)[0])) {
      phrases.set(p, (phrases.get(p) || 0) + 2);
    }
  }
  // 4. Acronyms (MFA, SSO, SCORM)
  for (const m of text.matchAll(/\b([A-Z]{2,8})\b/g)) {
    const p = m[1].toLowerCase();
    if (p.length >= 2) phrases.set(p, (phrases.get(p) || 0) + 2);
  }
  // 5. Single meaningful words as fallback
  const words = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z\-]{3,}/g) || []) {
    if (stop.has(w)) continue;
    words.set(w, (words.get(w) || 0) + 1);
  }
  for (const [w, c] of words) {
    if (!phrases.has(w) && c >= 2) phrases.set(w, c);
  }

  return [...phrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SECTION_HEADINGS = [
  "Why this matters",
  "Core concepts",
  "How it works in practice",
  "A worked example",
  "Common scenarios",
  "What to watch out for",
  "Putting it together",
  "Going deeper",
];

const PITFALLS = [
  "Skipping the basics because they feel obvious",
  "Treating exceptions as proof the rule is broken",
  "Assuming one example is enough to generalise",
  "Optimising for the happy path and missing edge cases",
  "Confusing correlation with causation",
  "Reading too quickly to catch nuance",
  "Letting urgency override verification",
  "Copying a process without understanding the goal",
];

const CALL_TO_ACTIONS = [
  "Take a moment to apply this to your own work.",
  "Pick one idea from this lesson and try it this week.",
  "Teach someone else what you learned here — that's the fastest way to internalise it.",
  "Bookmark this module and revisit it the next time you face a related decision.",
];

/**
 * Local fallback: produces a genuinely comprehensive lesson by structuring
 * the source into overview, several thematic sections, an example, takeaways,
 * and pitfalls. Aims for ~600-1000 words of body content so it visibly
 * improves on the raw ingest chunks.
 */
function localEnhance(title: string, sourceText: string): string {
  const t = sourceText.trim();
  if (!t) return `<p>No content to enhance.</p>`;

  const sentences = splitSentences(t);
  const clauses = sentences.flatMap(splitClauses);
  const keywords = extractKeywords(t);

  const intro = sentences.slice(0, Math.min(2, sentences.length)).join(" ").trim();
  const workingSentences = sentences.length > 2 ? sentences.slice(2) : sentences;

  // Build 3-4 thematic sections by chunking the remaining sentences.
  const targetSections = Math.min(4, Math.max(2, Math.ceil(workingSentences.length / 3)));
  const sections: { heading: string; body: string[] }[] = [];
  const perSection = Math.ceil(workingSentences.length / targetSections);
  for (let i = 0; i < targetSections; i++) {
    const slice = workingSentences.slice(i * perSection, (i + 1) * perSection);
    if (slice.length === 0) continue;
    sections.push({
      heading: SECTION_HEADINGS[i % SECTION_HEADINGS.length],
      body: slice,
    });
  }

  // If input was tiny, manufacture a workable section from clauses so the
  // structure still feels complete.
  if (sections.length === 0 && clauses.length > 0) {
    sections.push({ heading: SECTION_HEADINGS[0], body: clauses });
  }

  const html: string[] = [];
  html.push(`<h2>${escapeHtml(title)}</h2>`);
  if (intro) {
    html.push(`<p><strong>Overview.</strong> ${escapeHtml(intro)}</p>`);
  } else {
    html.push(`<p><strong>Overview.</strong> ${escapeHtml(t.slice(0, 240))}${t.length > 240 ? "…" : ""}</p>`);
  }

  // Pull-out callout from the strongest single sentence
  if (sentences[0] && sentences[0].length > 30 && sentences[0].length < 220) {
    html.push(`<blockquote><p><strong>In one line:</strong> ${escapeHtml(sentences[0])}</p></blockquote>`);
  }

  // Bullet preview from keywords
  if (keywords.length > 0) {
    html.push(`<h3>What you'll cover</h3>`);
    html.push(
      `<ul>${keywords
        .slice(0, Math.min(6, keywords.length))
        .map((k) => `<li>${escapeHtml(k.charAt(0).toUpperCase() + k.slice(1))}</li>`)
        .join("")}</ul>`,
    );
  }

  // Thematic sections
  for (const s of sections) {
    html.push(`<h3>${escapeHtml(s.heading)}</h3>`);
    // Turn the first sentence of each section into a lead paragraph, the rest
    // into bullets when they're clause-like, paragraphs when full sentences.
    const [lead, ...rest] = s.body;
    if (lead) html.push(`<p>${escapeHtml(lead)}</p>`);
    if (rest.length > 0) {
      const asBullets = rest.filter((r) => r.length < 180);
      const asParas = rest.filter((r) => r.length >= 180);
      if (asBullets.length >= 2) {
        html.push(`<ul>${asBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
      }
      for (const p of asParas) html.push(`<p>${escapeHtml(p)}</p>`);
    }
  }

  // Worked example synthesised from the strongest keyword/phrase.
  if (keywords.length >= 1) {
    const primary = keywords[0];
    const secondary = keywords[1] || keywords[0];
    // Single short tokens (e.g. acronyms, single words) read better without
    // a verb. Multi-word phrases get the full "imagine applying X" treatment.
    const primaryShort = !primary.includes(" ") && primary.length <= 6;
    const primaryLead = primaryShort
      ? `Consider <em>${escapeHtml(primary)}</em> in a real-world scenario`
      : `Imagine applying <em>${escapeHtml(primary)}</em> in practice`;
    html.push(`<h3>Worked example</h3>`);
    html.push(
      `<p>${primaryLead}, where <em>${escapeHtml(secondary)}</em> directly affects the outcome. A team applying this principle would: identify the relevant signal, choose the right intervention, and verify the outcome before scaling. The exact steps depend on your environment, but the order — observe, act, check — is what separates a one-off success from a reliable habit.</p>`,
    );
  }

  // Common pitfalls
  html.push(`<h3>Common pitfalls</h3>`);
  html.push(
    `<ul>${PITFALLS.slice(0, 4)
      .map((p) => `<li>${escapeHtml(p)}</li>`)
      .join("")}</ul>`,
  );

  // Key takeaways
  const takeaways = sentences.slice(0, Math.min(4, sentences.length));
  if (takeaways.length > 0) {
    html.push(`<h3>Key takeaways</h3>`);
    html.push(`<ul>${takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`);
  }

  // Closing nudge
  html.push(`<p><em>${escapeHtml(CALL_TO_ACTIONS[title.length % CALL_TO_ACTIONS.length])}</em></p>`);

  return html.join("\n");
}

// --- Question helpers -----------------------------------------------------

function safeId(prefix: string, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

function normalizeQuestions(
  qs: any,
  fallbackText: string,
  fallbackTitle: string,
  fallbackHtml?: string,
) {
  const out: EnhancedModule["suggestedQuestions"] = [];
  if (Array.isArray(qs)) {
    for (const q of qs) {
      if (!q || typeof q !== "object") continue;
      const prompt = String(q.prompt || "").trim();
      const choices = Array.isArray(q.choices)
        ? q.choices.map((c: any) => String(c).trim()).filter(Boolean)
        : [];
      if (!prompt || choices.length < 2) continue;
      let correctIndex = typeof q.correctIndex === "number" ? q.correctIndex : -1;
      if (correctIndex < 0 || correctIndex >= choices.length) {
        const ans = String(q.answer || "").trim();
        if (ans) {
          const i = choices.findIndex((c: string) => c.toLowerCase() === ans.toLowerCase());
          if (i >= 0) correctIndex = i;
        }
      }
      if (correctIndex < 0 || correctIndex >= choices.length) correctIndex = 0;
      const explanation = String(q.explanation || "").trim();
      out.push({
        id: safeId("q", prompt + "|" + choices.join("|")),
        prompt,
        choices,
        correctIndex,
        explanation,
      });
      if (out.length >= 5) break;
    }
  }
  if (out.length === 0) {
    // Run the local question generator on the *enhanced* HTML. It knows how
    // to find "Key takeaways" lists and definition sentences that localEnhance
    // just produced, and asks grounded questions about them.
    const quizHtml = (fallbackHtml && fallbackHtml.length > 200 ? fallbackHtml : "");
    if (quizHtml) {
      const local = generateLocalQuestions(quizHtml, fallbackTitle);
      if (local.length > 0) return local;
    }
    // Last resort: heuristic on raw text.
    const quizText = (fallbackHtml && fallbackHtml.length > 200 ? fallbackHtml : fallbackText) || "";
    return autoGenerateQuiz(
      {
        id: safeId("fb", fallbackTitle),
        title: fallbackTitle,
        text: quizText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        html: quizText,
      },
      Date.now(),
    ).slice(0, 5);
  }
  return out;
}

// --- Main entry -----------------------------------------------------------

export type EnhanceInput = {
  title: string;
  content: string; // plain text or simple HTML
  courseTitle?: string;
  moduleIndex?: number;
  apiKey?: string;
  provider?: "openai" | "anthropic" | "gemini";
};

const ENHANCE_SYSTEM = `You are an expert instructional designer who rewrites raw training material into comprehensive, well-structured SCORM 1.2 lesson modules. Your lessons are clear, concrete, and genuinely useful to a busy learner. You always respond with a single valid JSON object — no prose, no markdown fences.`;

const ENHANCE_PROMPT = (title: string, courseTitle: string, idx: number, rawText: string) => `Course: ${courseTitle || "Untitled training"}
Module ${idx + 1}: ${title}

Source material to rewrite:
"""
${rawText.slice(0, 6000)}
"""

Return ONLY this JSON shape:
{
  "contentHtml": string,            // 800-1500 words of HTML body using <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>. NO <html>/<body>. Start with an <h2> repeating the module title.
  "suggestedQuestions": [           // 3-5 multiple-choice questions, 4 choices each
    {
      "prompt": string,
      "choices": string[4],
      "correctIndex": 0|1|2|3,
      "explanation": string
    }
  ]
}

The lesson must:
- open with a short overview paragraph that frames why the topic matters
- include 4-6 thematic sections with clear <h3> headings
- contain at least one concrete worked example
- end with a "Key takeaways" bullet list
- contain a "Common pitfalls" or "Watch out for" section
- expand on the source with related context the learner needs — don't just paraphrase
- have unambiguous, factually correct quiz answers grounded in the lesson content. Avoid "all of the above" / "none of the above".`;

export async function enhanceModule(input: EnhanceInput): Promise<EnhancedModule> {
  const title = (input.title || "Module").trim();
  const courseTitle = input.courseTitle || "Training course";
  const idx = typeof input.moduleIndex === "number" ? input.moduleIndex : 0;
  const rawText = (input.content || "").trim();
  if (!rawText) {
    return { title, contentHtml: `<p>No content provided to enhance.</p>`, suggestedQuestions: [] };
  }

  // Strip any HTML the client might have sent, give the LLM plain text.
  const plainText = rawText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const llmText = await callLLM(ENHANCE_SYSTEM, ENHANCE_PROMPT(title, courseTitle, idx, plainText), input.apiKey, input.provider);
  const parsed = extractJsonObject(llmText);

  let contentHtml: string;
  if (parsed && typeof parsed.contentHtml === "string" && parsed.contentHtml.trim().length > 200) {
    contentHtml = parsed.contentHtml.trim();
  } else {
    contentHtml = localEnhance(title, plainText);
  }

  const suggestedQuestions = normalizeQuestions(
    parsed?.suggestedQuestions,
    plainText,
    title,
    contentHtml,
  );

  return { title, contentHtml, suggestedQuestions };
}