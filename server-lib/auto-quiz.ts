// Auto-generate MCQ questions from module content.
// Pure heuristic generator — no LLM call. Designed for speed + zero cost per build.
//
// Strategy: produce 3–5 grounded multiple-choice questions per module by leveraging
// definitional sentences, named entities, and bullet lists. Every question is tied
// to a specific span of the source text; distractors come from the same module so
// they are plausible but clearly wrong.

import type { QuizQuestion } from "./scorm-pkg";

export type ModuleForQuiz = {
  id: string;
  title: string;
  // Plain text (HTML stripped) — easier to reason about than HTML
  text: string;
  // Raw HTML — used to extract bullet/list items
  html?: string;
};

const MIN_TEXT_LENGTH = 80;
const MIN_QUESTIONS_PER_MODULE = 3;
const MAX_QUESTIONS_PER_MODULE = 5;
const DEFINITION_CAP = 2;
const CLOZE_CAP = 2;
const CATEGORIZATION_CAP = 1;
const CHOICES_PER_QUESTION = 4;

// --- text utilities ---

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|br|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>(?!$)/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  if (!text) return [];
  const protectedText = text
    .replace(/\b(e\.g|i\.e|Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co)\./g, "$1<DOT>")
    .replace(/\b([A-Z])\./g, "$1<DOT>");
  const raw = protectedText.split(/(?<=[.!?])\s+(?=[A-Z(\d])/);
  return raw
    .map((s) => s.replace(/<DOT>/g, ".").trim())
    .filter((s) => s.length >= 20 && s.length <= 280);
}

const STOPWORDS = new Set([
  "The", "This", "That", "These", "Those", "It", "Its", "A", "An",
  "In", "On", "At", "To", "For", "Of", "And", "Or", "But", "If", "Then",
  "When", "While", "Where", "Why", "How", "Who", "What", "Which", "Whose",
  "I", "You", "We", "They", "He", "She", "There", "Here", "Now",
  "However", "Moreover", "Therefore", "Furthermore", "Additionally",
  "Although", "Because", "Since", "After", "Before", "During",
  "Use", "Make", "Take", "Get", "Set", "Put", "Run", "See", "Let",
  "Never", "Always", "Often", "Sometimes", "Each", "Every", "Any", "Some",
  "Other", "Such", "Many", "Much", "More", "Most", "Less", "Least",
  "First", "Last", "Next", "Previous", "New", "Old", "Good", "Bad",
  "Important", "Key", "Main", "Best", "Worst", "Right", "Wrong",
]);

// Extract Title-Case noun phrases (2+ words). Used to mine "X is a Y" patterns.
function extractTitleCasePhrases(text: string, maxPhrases = 30): string[] {
  const phrases = new Map<string, number>();
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim();
    if (p.length < 5 || p.length > 50) continue;
    if (STOPWORDS.has(p.split(/\s+/)[0])) continue;
    phrases.set(p, (phrases.get(p) ?? 0) + 1);
  }
  return [...phrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([p]) => p);
}

// Extract any "Title Word(s)" that introduces a definition pattern
// (e.g. "Phishing is a technique where..."). Catches 1-word concepts like
// "Phishing", "Ergonomics" that 2+ Title-Case extraction misses.
function extractDefinitionSubjects(text: string): string[] {
  const out: string[] = [];
  // Match: Capitalized word(s) [more capital/lowercase] followed by verb
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3})\s+(is|are|means|refers to|can be|include|includes|describes?|involves?|occurs? when)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim();
    if (p.length < 3 || p.length > 50) continue;
    if (STOPWORDS.has(p.split(/\s+/)[0])) continue;
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= 25) break;
  }
  return out;
}

// Mine meaningful phrases to use as distractors (single capitalized terms,
// quoted terms, numbers with units). Used to ensure the distractor pool is
// always large enough to fill 3 choices.
function extractDistractorPool(text: string): string[] {
  const out = new Set<string>();
  // Capitalized single words (skip first word of sentence)
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/[^A-Za-z\-]/g, "");
      if (/^[A-Z][a-z]{2,}$/.test(w) && !STOPWORDS.has(w)) {
        out.add(w);
      }
    }
    // Title-Case multi-word phrases
    const tm = s.matchAll(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g);
    for (const mm of tm) {
      out.add(mm[1]);
    }
  }
  // Quoted phrases: "X"
  for (const mm of text.matchAll(/"([^"]{3,40})"/g)) {
    out.add(mm[1]);
  }
  // Numbers with units (e.g. 10 minutes, 50 users)
  for (const mm of text.matchAll(/\b(\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|users?|%|percent|times?))\b/gi)) {
    out.add(mm[1]);
  }
  const defnSentences = text.split(/(?<=[.!?]) /);
  for (const s of defnSentences) { const m = s.match(/^([A-Z][a-zA-Z0-9 -]+?) (is|are|means|refers to|can be|include|includes|describes?) ([^.]+)/); if (!m) continue; const subject = m[1].trim(); const rest = m[3].trim(); const answer = subject + " " + rest; if (answer.length >= 30 && answer.length <= 180) out.add(answer); }
  return [...out].slice(0, 60);
}

function extractListItems(html: string): string[] {
  const items: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const text = htmlToText(m[1]);
    if (text.length >= 4 && text.length <= 160) items.push(text);
  }
  // Plain-text numbered/bulleted lines
  const lines = (html ? htmlToText(html) : "").split(/\n|(?<=[.!?])\s+/);
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (/^[\-\*•]\s+\S/.test(trimmed) && trimmed.length <= 160) {
      items.push(trimmed.replace(/^[\-\*•]\s+/, ""));
    }
    if (/^\d+[\.\)]\s+\S/.test(trimmed) && trimmed.length <= 160) {
      items.push(trimmed.replace(/^\d+[\.\)]\s+/, ""));
    }
  }
  return [...new Set(items)].slice(0, 25);
}

// --- randomization ---

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleChoices<T>(arr: T[], correctIndex: number, rng: () => number): T[] {
  const order = arr.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order[0] === correctIndex && order.length > 1) {
    const swapWith = 1 + Math.floor(rng() * (order.length - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }
  return order.map((i) => arr[i]);
}

function pickDistractors(
  pool: string[],
  answer: string,
  count: number,
  rng: () => number,
): string[] {
  const ansLower = answer.toLowerCase();
  const filtered = pool.filter(
    (p) => p.toLowerCase() !== ansLower && p.length >= 2 && !ansLower.includes(p.toLowerCase()) && !p.toLowerCase().includes(ansLower),
  );
  const shuffled = [...filtered];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

let _idCounter = 0;
function makeId(prefix: string): string {
  _idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter}`;
}

// --- question builders ---

// Definition: "What is X?" → cloze "X is/are/means..." → answer = rest of sentence
function buildDefinitionQuestion(
  subject: string,
  sentence: string,
  distractorPool: string[],
  rng: () => number,
): QuizQuestion | null {
  if (!/[.!?]$/.test(sentence.trim())) return null;
  const stripped = sentence
    .replace(subject, "______")
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/^______\s+/, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (stripped.length < 12 || stripped.length > 200) return null;
  const prompt = `What is "${subject}"?`;
  const distractors = pickDistractors(distractorPool, subject, 3, rng);
  if (distractors.length < 3) return null;
  const correctAnswer = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  const choices = [...distractors, correctAnswer];
  const correctIndex = choices.length - 1;
  const shuffled = shuffleChoices(choices, correctIndex, rng);
  return {
    id: makeId("q"),
    prompt,
    choices: shuffled,
    correctIndex: shuffled.indexOf(correctAnswer),
    explanation: sentence,
    type: "definition",
  };
}

// List membership: "Which of these is listed in the module?" with one correct + 3 distractors
function buildListQuestion(
  items: string[],
  allItems: string[],
  rng: () => number,
): QuizQuestion | null {
  if (items.length < 3 || allItems.length < items.length + 3) return null;
  const correctItem = items[Math.floor(rng() * items.length)];
  const otherItems = allItems.filter(
    (x) => x.toLowerCase() !== correctItem.toLowerCase(),
  );
  const distractors = pickDistractors(otherItems, correctItem, 3, rng);
  if (distractors.length < 3) return null;
  const choices = [correctItem, ...distractors];
  const shuffled = shuffleChoices(choices, 0, rng);
  return {
    id: makeId("q"),
    prompt: `Which of the following is mentioned in this module?`,
    choices: shuffled,
    correctIndex: shuffled.indexOf(correctItem),
    explanation: `"${correctItem}" is listed in the module.`,
    type: "list_membership",
  };
}

// List exclusion: "Which of these is NOT mentioned?"
function buildListExclusionQuestion(
  items: string[],
  allItems: string[],
  rng: () => number,
): QuizQuestion | null {
  if (items.length < 3 || allItems.length < items.length + 3) return null;
  const distractors = pickDistractors(allItems, items[0], 3, rng).filter(
    (x) => !items.some((it) => it.toLowerCase() === x.toLowerCase()),
  );
  if (distractors.length < 3) return null;
  const correctItem = distractors[0];
  const wrongItems = pickDistractors(items, correctItem, 3, rng);
  if (wrongItems.length < 3) return null;
  const choices = [correctItem, ...wrongItems];
  const shuffled = shuffleChoices(choices, 0, rng);
  return {
    id: makeId("q"),
    prompt: `Which of the following is NOT mentioned in this module?`,
    choices: shuffled,
    correctIndex: shuffled.indexOf(correctItem),
    explanation: `"${correctItem}" does not appear in this module.`,
    type: "list_exclusion",
  };
}

// Cloze deletion: pick a sentence with a strong factual noun phrase; remove it from the sentence
// and ask the learner to fill the blank. Distractors = other noun phrases from the module.
function buildClozeQuestion(
  sentence: string,
  target: string,
  distractorPool: string[],
  rng: () => number,
): QuizQuestion | null {
  if (sentence.length < 30 || sentence.length > 220) return null;
  if (target.length < 3 || target.length > 40) return null;
  const stripped = sentence
    .replace(target, "______")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped.includes("______")) return null;
const prompt = `Fill in the blank: "${stripped}"?`;
  const distractors = pickDistractors(distractorPool, target, 3, rng);
  if (distractors.length < 3) return null;
  const choices = [target, ...distractors];
  const shuffled = shuffleChoices(choices, 0, rng);
  return {
    id: makeId("q"),
    prompt,
    choices: shuffled,
    correctIndex: shuffled.indexOf(target),
    explanation: sentence,
    type: "cloze",
  };
}

// "What type of X is Y?" — pick a sentence with "is a/an TYPE NOUN" and turn it into MCQ
function buildCategorizationQuestion(
  sentence: string,
  subject: string,
  category: string,
  distractorPool: string[],
  rng: () => number,
): QuizQuestion | null {
  const correctAnswer = category.trim();
  if (correctAnswer.length < 3 || correctAnswer.length > 40) return null;
  const distractors = pickDistractors(distractorPool, correctAnswer, 3, rng);
  if (distractors.length < 3) return null;
  const choices = [correctAnswer, ...distractors];
  const shuffled = shuffleChoices(choices, 0, rng);
  return {
    id: makeId("q"),
    prompt: `Which category best describes "${subject}"?`,
    choices: shuffled,
    correctIndex: shuffled.indexOf(correctAnswer),
    type: "categorization",
    explanation: sentence,
  };
}

// --- main entrypoint ---
const TYPE_CAPS: Record<string, number> = { definition: 2, categorization: 1, cloze: 1, list_membership: 1, list_exclusion: 1 };

export function autoGenerateQuiz(
  module: ModuleForQuiz,
  seed = Date.now(),
): QuizQuestion[] {
  const text = (module.text || "").trim();
  if (text.length < MIN_TEXT_LENGTH) return [];

  const rng = makeRng(seed + hashString(module.id));
  const sentences = splitSentences(text);
  const distractorPool = extractDistractorPool(text);
  const titleCasePhrases = extractTitleCasePhrases(text);
  const definitionSubjects = extractDefinitionSubjects(text);
  const listItems = module.html ? extractListItems(module.html) : [];

  // Combined subject list for definition questions (deduped, longest first)
  const subjects = [...new Set([...titleCasePhrases, ...definitionSubjects])]
    .sort((a, b) => b.length - a.length);

  const questions: QuizQuestion[] = [];
  const usedPrompts = new Set<string>();
  const usedSubjects = new Set<string>();
  const usedAnswers = new Set<string>();
  const typeCounts: Record<string, number> = {};

  const tryAdd = (q: QuizQuestion | null): void => {
    if (!q) return;
    if (q.type && (typeCounts[q.type] ?? 0) >= (TYPE_CAPS[q.type] ?? 99)) return;
    if (usedPrompts.has(q.prompt.toLowerCase())) return;
    const ans = q.choices[q.correctIndex].toLowerCase();
    if (usedAnswers.has(ans)) return;
    usedPrompts.add(q.prompt.toLowerCase());
    usedAnswers.add(ans);
    questions.push(q); if (q.type) typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;
  };

  // 1) Definition questions — one per unique definition subject
  for (const subject of subjects) {
    if (questions.length >= MAX_QUESTIONS_PER_MODULE) break;
    if (usedSubjects.has(subject.toLowerCase())) continue;
    const defnRe = new RegExp(
      `\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+(is|are|means|refers to|can be|include|includes|describes?|involves?|occurs? when)\\b`,
      "i",
    );
    const sentence = sentences.find((s) => defnRe.test(s));
    if (sentence) {
      const q = buildDefinitionQuestion(subject, sentence, distractorPool, rng);
      if (q) {
        tryAdd(q);
        usedSubjects.add(subject.toLowerCase());
      }
    }
  }

  // 2) Categorization questions — "X is a Y" → "What category best describes X?"
  for (const sentence of sentences) {
    if (questions.length >= MAX_QUESTIONS_PER_MODULE) break;
    const m = sentence.match(/^([A-Z][\w\s]+?)\s+is\s+(?:a|an)\s+([\w\s\-]+?)[.,;]/);
    if (!m) continue;
    const [, subject, category] = m;
    const catTrim = category.trim();
    if (catTrim.length < 3 || catTrim.length > 40) continue;
    if (usedSubjects.has(subject.trim().toLowerCase())) continue;
    const q = buildCategorizationQuestion(sentence, subject.trim(), catTrim, distractorPool, rng);
    if (q) {
      tryAdd(q);
      usedSubjects.add(subject.trim().toLowerCase());
    }
  }

  // 3) Cloze questions — pick a sentence with a strong factual noun phrase
  //    (not already used as a definition subject). Use a Title-Case phrase from
  //    the sentence as the cloze target.
  for (const sentence of sentences) {
    if (questions.length >= MAX_QUESTIONS_PER_MODULE) break;
    // Find a Title-Case phrase in the sentence that we haven't used yet
    const candidates = (sentence.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) || []).filter(
      (c) => !usedSubjects.has(c.toLowerCase()) && c.length >= 3 && c.length <= 40,
    );
    if (candidates.length === 0) continue;
    const target = candidates[Math.floor(rng() * candidates.length)];
    const q = buildClozeQuestion(sentence, target, distractorPool, rng);
    if (q) {
      tryAdd(q);
      usedSubjects.add(target.toLowerCase());
    }
  }

  // 4) List membership question
  if (listItems.length >= 3 && questions.length < MAX_QUESTIONS_PER_MODULE) {
    tryAdd(buildListQuestion(listItems, listItems, rng));
  }

  // 5) List exclusion question (only if we still need more)
  if (listItems.length >= 4 && questions.length < MAX_QUESTIONS_PER_MODULE) {
    tryAdd(buildListExclusionQuestion(listItems, listItems, rng));
  }

  return questions;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function autoGenerateQuizzesForModules(
  modules: { id: string; title: string; contentHtml?: string; content?: string }[],
  seed = Date.now(),
): { moduleId: string; questions: QuizQuestion[] }[] {
  return modules.map((m, i) => {
    const text = m.content ?? (m.contentHtml ? htmlToText(m.contentHtml) : "");
    const questions = autoGenerateQuiz(
      {
        id: m.id,
        title: m.title,
        text,
        html: m.contentHtml,
      },
      seed + i * 1000,
    );
    return { moduleId: m.id, questions };
  });
}
