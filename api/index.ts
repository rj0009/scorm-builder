// Vercel serverless entrypoint. Inlined to avoid import chain issues.
import { Hono } from "hono";
import { handle } from "hono/vercel";

const app = new Hono();

// Self-contained demo data (no module imports that pull in pdf-parse / jszip).
const DEMO_MODULES = [
  {
    id: "why-youths-game",
    title: "1 · Why youths game",
    contentHtml: `<h2>Why youths game</h2><p>Understanding youth gaming starts with acknowledging it isn't just "addiction." For most, it's a mix of social, cognitive, and emotional functions.</p><h3>Common motivations</h3><ul><li><strong>Entertainment:</strong> Games provide immediate, enjoyable engagement.</li><li><strong>Social Connection:</strong> Peer bonding and reducing loneliness.</li><li><strong>Stress Relief:</strong> Reducing cortisol and stimulating pleasure centres in the brain.</li><li><strong>Challenge &amp; Achievement:</strong> Clear goals, feedback, and growth mindsets.</li><li><strong>Escapism:</strong> Temporarily escaping daily stressors.</li></ul><h3>Key takeaways</h3><ul><li>Gaming serves multiple purposes: entertainment, social connection, and stress relief.</li><li>It usually starts as fun or social connection.</li><li>Patterns and context determine whether it remains healthy or becomes risky.</li></ul>`,
  },
  {
    id: "gaming-mechanisms",
    title: "2 · Risks and brain mechanisms",
    contentHtml: `<h2>Risks and brain mechanisms</h2><p>Gaming activates the brain's reward pathways, releasing dopamine similar to gambling or winning a prize. While not inherently "addictive" in a clinical sense, game design exploits these pathways.</p><h3>Compulsion loops</h3><p>Designers use strategies to encourage continued play:</p><ul><li><strong>Achievements &amp; Progress:</strong> Clear, visual milestones.</li><li><strong>Variable Rewards:</strong> Unpredictable outcomes encourage repeated efforts (like slot machines).</li><li><strong>Time-limited triggers:</strong> Timers, countdowns, and FOMO (fear of missing out).</li></ul><h3>The role of loot boxes</h3><p>Loot boxes grant rewards of uncertain value. Because they create suspense, the heightened emotional effect reinforces the desire to keep playing and spending.</p><h3>Youth vulnerability</h3><p>Youths are more vulnerable due to developing impulse control, peer social pressures, and the normalisation of gaming in their environments.</p><h3>Key takeaways</h3><ul><li>Gaming exploits reward systems, making it highly engaging.</li><li>Design features like loot boxes share structural similarities with gambling.</li><li>Youths are specifically vulnerable due to developing executive functions.</li></ul>`,
  },
  {
    id: "concerns-and-support",
    title: "3 · Concerns and help-seeking",
    contentHtml: `<h2>Concerns and help-seeking</h2><p>When does gaming cross the line? When it neglects responsibilities, impacts wellbeing, or feels uncontrollable.</p><h3>Signs of concern</h3><ul><li><strong>Preoccupation:</strong> Increasing hours or inability to stop.</li><li><strong>Withdrawal:</strong> Irritability or mood changes when not gaming.</li><li><strong>Neglect:</strong> Difficulty cutting down on gaming at the expense of other daily duties.</li><li><strong>Persistence:</strong> Continuing despite negative consequences.</li></ul><h3>The RAISE Framework</h3><p>Use this framework to support self-reflection or professional intervention:</p><ol><li><strong>Recognise:</strong> "How is gaming affecting your sleep, school, or daily life?"</li><li><strong>Awareness:</strong> "What does gaming give you? What would you like to change?"</li><li><strong>Identify:</strong> "When, why, and how do you game? What needs does it fulfil?"</li><li><strong>Seek Help:</strong> "Who can you approach? Peer groups, counseling, family, or online resources?"</li><li><strong>Encourage:</strong> "Explore alternative activities, celebrate small goals, and build positive relationships."</li></ol><h3>Key takeaways</h3><ul><li>Patterns like withdrawal and neglecting responsibilities are warning signs.</li><li>Support, not shame, is the key to healthy change.</li><li>Change is a process; the RAISE framework provides scaffolding for self-reflection.</li></ul>`,
  },
];

const DEMO_QUIZZES = [
  {
    moduleId: "why-youths-game",
    passingScore: 80,
    questions: [
      {
        id: "q-reason-1",
        prompt: "What does the module identify as a social function of gaming?",
        choices: ["Reducing loneliness", "Earning money", "Avoiding work", "Replacing real friends"],
        correctIndex: 0,
        explanation: "Peer bonding and reducing loneliness are key positive functions when gaming is managed healthily.",
      },
    ],
  },
  {
    moduleId: "gaming-mechanisms",
    passingScore: 80,
    questions: [
      {
        id: "q-mech-1",
        prompt: "Which neurotransmitter is associated with pleasure and reward in gaming?",
        choices: ["Cortisol", "Dopamine", "Adrenaline", "Serotonin"],
        correctIndex: 1,
        explanation: "Dopamine release produces pleasure, motivation, and reinforcement during engagement.",
      },
    ],
  },
  {
    moduleId: "concerns-and-support",
    passingScore: 80,
    questions: [
      {
        id: "q-raise-1",
        prompt: "What does the 'R' in the RAISE framework stand for?",
        choices: ["Recognise", "Reflect", "Respond", "Relax"],
        correctIndex: 0,
        explanation: "R stands for Recognise, used for reflecting on how gaming affects daily life.",
      },
    ],
  },
];

// Inline local heuristic for "Enhance with AI" so the LLM-dependent routes
// work even when no BYOK key is supplied. Mirrors the behavior of
// server-lib/llm.ts and server-lib/local-questions.ts without requiring them.

function stripTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(t: string): string[] {
  return t
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+(?=[A-Z(\d])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function localEnhance(title: string, sourceText: string): string {
  const t = sourceText.trim();
  if (!t) return "<p>No content to enhance.</p>";
  const sentences = splitSentences(t);
  const intro = sentences.slice(0, Math.min(2, sentences.length)).join(" ").trim();
  const rest = sentences.slice(2);
  const sections: { heading: string; body: string[] }[] = [];
  const perSection = Math.max(1, Math.ceil(rest.length / 3));
  for (let i = 0; i < rest.length; i += perSection) {
    sections.push({
      heading: ["Why this matters", "Core concepts", "How it works in practice", "Putting it together"][sections.length % 4],
      body: rest.slice(i, i + perSection),
    });
  }
  const html: string[] = [];
  html.push(`<h2>${escapeHtml(title)}</h2>`);
  if (intro) html.push(`<p><strong>Overview.</strong> ${escapeHtml(intro)}</p>`);
  if (sentences[0] && sentences[0].length > 30 && sentences[0].length < 220) {
    html.push(`<blockquote><p><strong>In one line:</strong> ${escapeHtml(sentences[0])}</p></blockquote>`);
  }
  for (const s of sections) {
    html.push(`<h3>${escapeHtml(s.heading)}</h3>`);
    for (const p of s.body) html.push(`<p>${escapeHtml(p)}</p>`);
  }
  const takeaways = sentences.slice(0, Math.min(4, sentences.length));
  if (takeaways.length > 0) {
    html.push(`<h3>Key takeaways</h3>`);
    html.push(`<ul>${takeaways.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`);
  }
  return html.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function generateLocalQuestions(html: string, title: string) {
  const out: { id: string; prompt: string; choices: string[]; correctIndex: number; explanation: string }[] = [];
  const m = html.match(/<h3[^>]*>\s*Key takeaways\s*<\/h3>\s*<ul>([\s\S]*?)<\/ul>/i);
  if (m) {
    const items = Array.from(m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
      .map((x) => stripTags(x[1]).replace(/\.$/, "").trim())
      .filter((x) => x.length >= 8 && x.length <= 200);
    if (items.length >= 4) {
      const correct = items[0];
      const distractors = items.slice(1, 1 + 3);
      const choices = [...new Set([correct, ...distractors])].slice(0, 4);
      if (choices.length === 4) {
        out.push({
          id: "q-takeaway",
          prompt: "Which of the following is a key takeaway from this lesson?",
          choices,
          correctIndex: choices.indexOf(correct),
          explanation: `"${correct}" is listed as a key takeaway in this lesson.`,
        });
      }
    }
  }
  const text = stripTags(html);
  const sentences = text.match(/[^.!?]+[.!?]/g) || [];
  for (const s of sentences) {
    const mm = s.match(/^([A-Z][\w\-]+(?:\s+[A-Z][\w\-]+){0,2})\s+(is|are|means)\s+(?:a|an|the)?\s*([^.;]+)[.;]/);
    if (!mm) continue;
    const subject = mm[1].trim();
    const predicate = mm[3].trim();
    if (predicate.length < 8 || predicate.length > 160) continue;
    if (/^(this|that|these|those|it|we|you|they|i)\b/i.test(subject)) continue;
    const other = sentences
      .map((x) => {
        const m2 = x.match(/^([A-Z][\w\-]+(?:\s+[A-Z][\w\-]+){0,2})\s+(is|are|means)\s+(?:a|an|the)?\s*([^.;]+)[.;]/);
        return m2 ? m2[3].trim() : "";
      })
      .filter((p) => p && p !== predicate)
      .slice(0, 3);
    if (other.length < 3) continue;
    out.push({
      id: "q-def",
      prompt: `What is "${subject}"?`,
      choices: [predicate, ...other],
      correctIndex: 0,
      explanation: s.trim(),
    });
    break;
  }
  return out;
}

async function callGemini(system: string, user: string, apiKey: string): Promise<string | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

function extractJson(s: string | null): any {
  if (!s) return null;
  let t = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(t.slice(a, b + 1)); } catch {}
    }
  }
  return null;
}

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.get("/api/demo", (c) => {
  const chunks = DEMO_MODULES.map((m, i) => ({
    index: i,
    title: m.title,
    content: stripTags(m.contentHtml),
    source: "Built-in demo",
    suggestedQuestions: DEMO_QUIZZES.find((q) => q.moduleId === m.id)?.questions ?? [],
  }));
  return c.json({
    filename: "Understanding Youth Gaming.demo",
    mime: "application/x-scorm-demo",
    totalChunks: chunks.length,
    fullText: "This is a built-in demo course.",
    chunks,
    sourceFile: { name: "Understanding Youth Gaming.demo", mime: "application/x-scorm-demo", size: 0 },
    demo: {
      courseTitle: "Understanding Youth Gaming",
      courseDescription: "An evidence-based exploration of why youths game, the mechanisms that make it compelling, identifying warning signs, and supporting healthy change.",
      passMark: 80,
      modules: DEMO_MODULES,
      quizzes: DEMO_QUIZZES,
    },
  });
});

app.post("/api/enhance-module", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid JSON body." }, 400);
  }
  const title = (typeof body.title === "string" ? body.title : "").trim();
  const content = (typeof body.content === "string" ? body.content : "").trim();
  if (!title) return c.json({ error: "title is required." }, 400);
  if (!content) return c.json({ error: "content is required." }, 400);

  // Read BYOK Gemini key from header (sent by the client from localStorage).
  const geminiKey = c.req.header("x-gemini-key") || "";

  const plainText = stripTags(content);
  let contentHtml = localEnhance(title, plainText);
  let suggestedQuestions: any[] = generateLocalQuestions(contentHtml, title);

  if (geminiKey) {
    const system = "You are an expert instructional designer. Always respond with a single valid JSON object.";
    const userPrompt = `Course: ${body.courseTitle || "Untitled"}\nModule: ${title}\n\nSource:\n"""\n${plainText.slice(0, 6000)}\n"""\n\nReturn ONLY JSON: {"contentHtml": "<h2>${title}</h2><p>...</p>", "suggestedQuestions": [{"prompt": "q?", "choices": ["a","b","c","d"], "correctIndex": 0, "explanation": "..."}]}. The lesson must be 800-1500 words, include an overview, 4-6 sections, a worked example, a "Key takeaways" list, and a "Common pitfalls" list. Provide 3-5 multiple-choice questions with exactly 4 choices each.`;
    const llmText = await callGemini(system, userPrompt, geminiKey);
    const parsed = extractJson(llmText);
    if (parsed && typeof parsed.contentHtml === "string" && parsed.contentHtml.length > 200) {
      contentHtml = parsed.contentHtml;
    }
    if (Array.isArray(parsed?.suggestedQuestions) && parsed.suggestedQuestions.length > 0) {
      const cleaned: any[] = [];
      for (const q of parsed.suggestedQuestions) {
        if (!q || typeof q !== "object") continue;
        const p = String(q.prompt || "").trim();
        const c2 = Array.isArray(q.choices) ? q.choices.map((x: any) => String(x).trim()).filter(Boolean) : [];
        if (!p || c2.length < 2) continue;
        let ci = typeof q.correctIndex === "number" ? q.correctIndex : 0;
        if (ci < 0 || ci >= c2.length) ci = 0;
        cleaned.push({ id: "q-llm-" + cleaned.length, prompt: p, choices: c2, correctIndex: ci, explanation: String(q.explanation || "") });
        if (cleaned.length >= 5) break;
      }
      if (cleaned.length > 0) suggestedQuestions = cleaned;
    }
  }

  return c.json({ title, contentHtml, suggestedQuestions });
});

// /api/build: minimal stub so the frontend doesn't 500. Returns a tiny ZIP.
app.post("/api/build", async (c) => {
  // We can't run the full build (requires jszip + scorm-pkg.ts) in this
  // Vercel serverless function. Return an error explaining this.
  return c.json({
    error: "ZIP building requires the Zo-hosted runtime. Deploy to rj009.zo.computer for full SCORM 1.2 export, or run `bun run prod` locally.",
  }, 501);
});

export default handle(app);
