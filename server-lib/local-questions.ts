// Quiz generator tuned for the output of `localEnhance` (the fallback
// enhancer in llm.ts). Reads the enhanced HTML and produces a small set
// of well-formed multiple-choice questions grounded in the lesson.
//
// Strategy:
//   1. Pull <li> items from the "Key takeaways" list → "Which of these is
//      a key takeaway from this lesson?" with the rest as distractors.
//   2. Pull <li> items from the "Common pitfalls" list → "Which of these is
//      listed as a common pitfall?" with the rest as distractors.
//   3. Mine "X is a Y / X means Y" definitions from prose → "What is X?"
//      cloze-style questions with X as the answer.
//   4. Single best true/false-style question: "Which statement is correct?"
//      with one accurate summary sentence and three plausible-but-wrong ones.
//
// Caps at 5 questions. All distractors come from the same lesson so they
// feel plausible but are clearly distinct from the correct answer.

export type LocalQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

// --- HTML helpers ---

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
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getListAfter(html: string, headerRe: RegExp, maxItems = 8): string[] {
  const m = html.match(headerRe);
  if (!m || m.index === undefined) return [];
  const tail = html.slice(m.index + m[0].length);
  // capture up to the next <h2>/<h3>/</ul> at the same level
  const end = tail.search(/<h[23][^>]*>/i);
  const region = end === -1 ? tail : tail.slice(0, end);
  const items: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(region)) !== null) {
    const t = stripTags(lm[1]).replace(/\.$/, "").trim();
    if (t.length >= 8 && t.length <= 200) items.push(t);
    if (items.length >= maxItems) break;
  }
  return items;
}

function getSectionProse(html: string, headerRe: RegExp, maxSentences = 12): string[] {
  const m = html.match(headerRe);
  if (!m || m.index === undefined) return [];
  const tail = html.slice(m.index + m[0].length);
  // Stop at the next section header or end of region
  const end = tail.search(/<h[23][^>]*>/i);
  let region = end === -1 ? tail : tail.slice(0, end);
  // Strip out any inner <h4>/<h5>/<h6> + their inline content so they don't
  // get concatenated with surrounding prose sentences.
  region = region.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ");
  // drop list items; we want prose
  const prose = region.replace(/<li[^>]*>[\s\S]*?<\/li>/gi, " ");
  const text = stripTags(prose);
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 220)
    .slice(0, maxSentences);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeId(prefix: string, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

function makeQ(prompt: string, correct: string, distractors: string[]): LocalQuestion | null {
  const all = [correct, ...distractors.slice(0, 3)];
  if (all.length < 4) return null;
  const uniq = [...new Set(all)];
  if (uniq.length < 4) return null;
  const order = shuffle(uniq);
  const ci = order.indexOf(correct);
  if (ci < 0) return null;
  return {
    id: safeId("q", prompt + "|" + correct),
    prompt,
    choices: order,
    correctIndex: ci,
    explanation: correct,
  };
}

// --- Question builders ---

function keyTakeawayQuestion(html: string): LocalQuestion | null {
  const items = getListAfter(html, /<h3[^>]*>\s*Key takeaways\s*<\/h3>/i, 6);
  if (items.length < 4) return null;
  const correct = items[0];
  const distractors = items.slice(1, 1 + 3);
  return makeQ("Which of the following is a key takeaway from this lesson?", correct, distractors);
}

function pitfallQuestion(html: string): LocalQuestion | null {
  const items = getListAfter(html, /<h3[^>]*>\s*Common pitfalls\s*<\/h3>/i, 6);
  if (items.length < 4) return null;
  const correct = items[0];
  const distractors = items.slice(1, 1 + 3);
  return makeQ("Which of these is listed as a common pitfall in this lesson?", correct, distractors);
}

function definitionQuestion(html: string, allSentences: string[]): LocalQuestion | null {
  // Definitions are content-section prose. Avoid sentence fragments that
  // leaked across heading boundaries (subjects that start with section
  // names like "Key takeaways" or "Common pitfalls").
  const HEADING_BLACKLIST = new Set([
    "Key takeaways",
    "Common pitfalls",
    "What you'll cover",
    "What you'll learn",
    "Worked example",
    "Why this matters",
    "Core concepts",
    "How it works in practice",
    "Putting it together",
    "Going deeper",
    "Common scenarios",
    "What to watch out for",
    "A worked example",
    "Overview",
    "In one line",
  ]);
  // Match definitions: "X is a/an Y", "X means Y", "X refers to Y".
  // Subject can include commas, ", or X", "/" but cannot span past the verb.
  const candidates: { subject: string; body: string }[] = [];
  const re =
    /\b([A-Z][A-Za-z][A-Za-z0-9 \-/&,]{1,60}?)\s+(?:is|means|refers to|is an?|are)\s+(?:a|an|the)?\s*([^.;]+)/g;
  for (const s of allSentences) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      let subject = m[1].trim().replace(/[,;:]$/, "");
      const body = (m[2] || "").trim().replace(/[.,;:]$/, "").trim();
      // Strip ", or X" / "(or X)" trailing definitional expansion
      subject = subject.replace(/,?\s*\(?or\s+[A-Z][a-z]+\)?$/i, "");
      // Strip "the" prefix
      subject = subject.replace(/^the\s+/i, "");
      if (subject.length >= 3 && subject.length <= 50 && body.length >= 12 && body.length <= 160) {
        // Skip meta subjects
        if (/^(this|that|these|those|it|we|you|they|i|when|if|because|while|since|although|after|before|during|here|there|now|today|the|a|an)\b/i.test(subject)) continue;
        if (/^(a|an|the|some|any|all|every|no)\b\s+\w+\s+(is|are|means)/i.test(subject + " " + body)) continue;
        // Skip section-heading-as-subject leaks
        if (HEADING_BLACKLIST.has(subject.trim()) || HEADING_BLACKLIST.has(subject.split(/\s+/)[0])) continue;
        // Subject must contain at least one real word (skip a single capital letter)
        if (!/[a-z]{2,}/.test(subject)) continue;
        candidates.push({ subject, body });
      }
      if (candidates.length >= 8) break;
    }
    if (candidates.length >= 8) break;
  }
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  // Build distractors from OTHER definition bodies in the same lesson so
  // they read like plausible alternative answers.
  const distractorPool = candidates
    .filter((c) => c.body.toLowerCase() !== pick.body.toLowerCase())
    .map((c) => c.body);
  // Backstop with generic well-formed predicates so distractor pool is never
  // empty even on short lessons.
  while (distractorPool.length < 4) {
    distractorPool.push(
      [
        "a recommended best practice for every team",
        "an optional feature for advanced users",
        "something that should be reviewed annually",
        "the most common cause of outages",
      ][distractorPool.length % 4],
    );
  }
  return makeQ(
    `What is "${pick.subject}"?`,
    pick.body.charAt(0).toUpperCase() + pick.body.slice(1),
    distractorPool.slice(0, 3).map((d) => d.charAt(0).toUpperCase() + d.slice(1)),
  );
}

function correctStatementQuestion(html: string, allSentences: string[]): LocalQuestion | null {
  if (allSentences.length < 4) return null;
  // Pick the most "factual" sentence — contains a number or definitive word.
  const factualWords = /(\d+|always|never|must|every|any|effective|important|only)/i;
  const sorted = [...allSentences].sort((a, b) => {
    const aScore = (a.match(factualWords) ? 2 : 0) + (a.length >= 50 && a.length <= 180 ? 1 : 0);
    const bScore = (b.match(factualWords) ? 2 : 0) + (b.length >= 50 && b.length <= 180 ? 1 : 0);
    return bScore - aScore;
  });
  const correct = sorted[0];
  // Distractors: flip or modify small words to make plausible-wrong statements.
  function distort(s: string): string {
    return s
      .replace(/\bis\b/i, "is not")
      .replace(/\bare\b/i, "are not")
      .replace(/\bnever\b/i, "sometimes")
      .replace(/\balways\b/i, "occasionally")
      .replace(/\beffective\b/i, "ineffective")
      .replace(/\bimportant\b/i, "unimportant")
      .replace(/\bonly\b/i, "primarily")
      .replace(/\d+/g, (n) => String(Math.max(1, Number(n) + 1)));
  }
  // Only use a distortion if it actually changed something; otherwise skip.
  const distractors: string[] = [];
  for (const s of sorted.slice(1)) {
    if (distractors.length >= 3) break;
    const d = distort(s);
    if (d !== s && d.toLowerCase() !== correct.toLowerCase()) distractors.push(d);
  }
  if (distractors.length < 3) return null;
  return makeQ("Which of these statements from the lesson is correct?", correct, distractors);
}

// --- Public entrypoint ---

export function generateLocalQuestions(html: string, title: string, seed = Date.now()): LocalQuestion[] {
  // Collect all prose sentences from "Why this matters", "Core concepts",
  // "How it works" type sections to use for definition/mining questions.
  const sectionHeaders = [
    /<h3[^>]*>\s*Why this matters\s*<\/h3>/i,
    /<h3[^>]*>\s*Core concepts\s*<\/h3>/i,
    /<h3[^>]*>\s*How it works in practice\s*<\/h3>/i,
    /<h3[^>]*>\s*A worked example\s*<\/h3>/i,
    /<h3[^>]*>\s*Common scenarios\s*<\/h3>/i,
    /<h3[^>]*>\s*What to watch out for\s*<\/h3>/i,
    /<h3[^>]*>\s*Putting it together\s*<\/h3>/i,
  ];
  const allSentences: string[] = [];
  for (const h of sectionHeaders) {
    for (const s of getSectionProse(html, h, 8)) {
      if (!allSentences.includes(s)) allSentences.push(s);
    }
  }

  const out: LocalQuestion[] = [];
  const seen = new Set<string>();
  function add(q: LocalQuestion | null): void {
    if (!q) return;
    const key = q.prompt.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  }

  add(keyTakeawayQuestion(html));
  add(pitfallQuestion(html));
  add(definitionQuestion(html, allSentences));
  add(correctStatementQuestion(html, allSentences));

  return out.slice(0, 5);
}