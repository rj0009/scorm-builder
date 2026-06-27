#!/usr/bin/env bun
/**
 * Quiz quality evaluator — defaults to doubt, checks each question against a
 * strict rubric. Acts on actual output (runs the generator + verifies), does
 * not just read intent.
 *
 * Usage: bun quiz-eval/evaluate.ts <generator-output.json>
 *   generator-output.json is produced by quiz-eval/run-generator.ts
 *
 * Exit code: 0 = all questions pass, 1 = at least one failure.
 */

type Question = {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
};

type Module = {
  moduleId: string;
  moduleTitle: string;
  sourceText: string;
  questions: Question[];
};

type Issue = {
  moduleId: string;
  questionId: string;
  reason: string;
  severity: "blocker" | "major" | "minor";
};

const VERDICT_THRESHOLD = 1.0; // 100% required per user instruction

function evaluateModule(mod: Module): { questions: Question[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const questions = mod.questions;

  // Module-level checks
  if (questions.length < 3) {
    issues.push({
      moduleId: mod.moduleId,
      questionId: "-",
      reason: `Module has only ${questions.length} question(s) (min 3 required).`,
      severity: "blocker",
    });
  }
  if (questions.length > 6) {
    issues.push({
      moduleId: mod.moduleId,
      questionId: "-",
      reason: `Module has ${questions.length} questions (max 6).`,
      severity: "major",
    });
  }

  const seenPrompts = new Set<string>();
  const seenAnswers = new Set<string>();

  for (const q of questions) {
    const tag = `${mod.moduleId}#${q.id}`;

    // 1) Basic structure
    if (!q.prompt || q.prompt.trim().length < 10) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: "Prompt is empty or too short.", severity: "blocker" });
    }
    if (!Array.isArray(q.choices) || q.choices.length < 3) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Only ${q.choices?.length ?? 0} choices (min 3).`, severity: "blocker" });
    }
    if (q.choices && q.choices.length > 6) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Too many choices (${q.choices.length}).`, severity: "major" });
    }
    if (typeof q.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex >= (q.choices?.length ?? 0)) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Invalid correctIndex ${q.correctIndex}.`, severity: "blocker" });
    }
    // 2) Choices must be non-empty strings
    for (let i = 0; i < (q.choices?.length ?? 0); i++) {
      const c = q.choices[i];
      if (typeof c !== "string" || c.trim().length === 0) {
        issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Choice #${i + 1} is empty.`, severity: "blocker" });
      }
    }
    // 3) No duplicate choices
    const lowerChoices = (q.choices ?? []).map((c) => (c ?? "").trim().toLowerCase());
    const dupes = lowerChoices.filter((v, i) => lowerChoices.indexOf(v) !== i);
    if (dupes.length > 0) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Duplicate choices: ${dupes.join(" | ")}`, severity: "blocker" });
    }
    // 4) Prompt dedup
    const promptKey = q.prompt?.trim().toLowerCase() ?? "";
    if (seenPrompts.has(promptKey)) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: "Duplicate prompt within module.", severity: "blocker" });
    }
    seenPrompts.add(promptKey);
    // 5) Answer dedup
    const answerKey = (q.choices?.[q.correctIndex] ?? "").trim().toLowerCase();
    if (answerKey && seenAnswers.has(answerKey)) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: "Duplicate correct answer within module.", severity: "blocker" });
    }
    if (answerKey) seenAnswers.add(answerKey);

    // 6) Correct answer must appear in source text (factually grounded)
    const sourceLower = mod.sourceText.toLowerCase();
    const correctChoice = (q.choices?.[q.correctIndex] ?? "").trim();
    if (correctChoice.length >= 12) {
      // Allow explanation to substitute if correct answer is short
      const inSource = sourceLower.includes(correctChoice.toLowerCase());
      const explainInSource = q.explanation && sourceLower.includes(q.explanation.toLowerCase());
      if (!inSource && !explainInSource) {
        // Try matching key noun phrases
        const words = correctChoice.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
        const matchedWords = words.filter((w) => sourceLower.includes(w));
        if (matchedWords.length < Math.min(3, Math.floor(words.length * 0.5))) {
          issues.push({
            moduleId: mod.moduleId,
            questionId: q.id,
            reason: `Correct answer "${correctChoice.slice(0, 80)}" not grounded in source text.`,
            severity: "blocker",
          });
        }
      }
    }

    // 7) No vague / placeholder language in prompt
    const vaguePatterns = [
      /best matches the topic/i,
      /rubbish/i,
      /placeholder/i,
      /\btbd\b/i,
      /lorem ipsum/i,
      /which statement/i, // generic recall question
      /mentioned in/i, // lazy list-question template
      /not listed/i, // generic "NOT" question — only valid if very specific
    ];
    for (const re of vaguePatterns) {
      if (re.test(q.prompt)) {
        issues.push({
          moduleId: mod.moduleId,
          questionId: q.id,
          reason: `Prompt uses vague/template language: /${re.source}/`,
          severity: "blocker",
        });
      }
    }

    // 8) Explanation present and meaningful
    if (!q.explanation || q.explanation.trim().length < 10) {
      issues.push({
        moduleId: mod.moduleId,
        questionId: q.id,
        reason: "Explanation missing or too short — learner gets no feedback after submission.",
        severity: "major",
      });
    }

    // 9) Correct answer must NOT appear elsewhere as a distractor (sanity)
    //    — covered by dedup above.

    // 10) Distractors must look like plausible alternatives (not gibberish)
    if (q.choices) {
      for (let i = 0; i < q.choices.length; i++) {
        if (i === q.correctIndex) continue;
        const d = q.choices[i].trim();
        // Detect obvious junk: bare punctuation, single chars, repeated tokens
        if (/^[^a-zA-Z]+$/.test(d) && d.length < 4) {
          issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Distractor #${i + 1} is gibberish: "${d}"`, severity: "major" });
        }
        // Detect leftovers from regex split (e.g. "- -", "-- 2 of 4 --")
        if (/^[-–—_=]{1,4}\s*[-–—_=]{1,4}/.test(d) || /\d+\s+of\s+\d+/.test(d)) {
          issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: `Distractor #${i + 1} contains page-marker garbage: "${d}"`, severity: "major" });
        }
      }
    }

    // 11) Length sanity: prompt should be a real question (ends with ?)
    if (!q.prompt?.trim().endsWith("?")) {
      issues.push({ moduleId: mod.moduleId, questionId: q.id, reason: "Prompt does not end with a question mark.", severity: "minor" });
    }

    // 12) Choices should be of similar length (else correct answer stands out)
    if (q.choices && q.correctIndex >= 0 && q.choices.length >= 3) {
      const lens = q.choices.map((c) => c.trim().length);
      const correctLen = lens[q.correctIndex];
      const otherLens = lens.filter((_, i) => i !== q.correctIndex);
      const avgOther = otherLens.reduce((a, b) => a + b, 0) / otherLens.length;
      if (correctLen > avgOther * 2 && correctLen > 80) {
        issues.push({
          moduleId: mod.moduleId,
          questionId: q.id,
          reason: `Correct answer is much longer than distractors (correct ${correctLen} vs avg ${avgOther.toFixed(0)}) — gives away the answer.`,
          severity: "major",
        });
      }
    }
  }

  return { questions, issues };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: bun quiz-eval/evaluate.ts <generator-output.json>");
    process.exit(2);
  }
  const data = JSON.parse(await Bun.file(path).text()) as { modules: Module[] };
  const allIssues: Issue[] = [];
  const moduleSummaries: { moduleId: string; title: string; qCount: number; blockerCount: number; majorCount: number; minorCount: number; }[] = [];
  let totalQuestions = 0;
  let totalBlockers = 0;
  let totalMajors = 0;
  let totalMinors = 0;

  for (const mod of data.modules) {
    const { issues } = evaluateModule(mod);
    allIssues.push(...issues);
    const blockerCount = issues.filter((i) => i.severity === "blocker").length;
    const majorCount = issues.filter((i) => i.severity === "major").length;
    const minorCount = issues.filter((i) => i.severity === "minor").length;
    moduleSummaries.push({ moduleId: mod.moduleId, title: mod.moduleTitle, qCount: mod.questions.length, blockerCount, majorCount, minorCount });
    totalQuestions += mod.questions.length;
    totalBlockers += blockerCount;
    totalMajors += majorCount;
    totalMinors += minorCount;
  }

  // Report
  console.log("\n=== Module Summary ===");
  console.table(moduleSummaries);
  console.log(`\nTotal: ${totalQuestions} questions, ${totalBlockers} blockers, ${totalMajors} majors, ${totalMinors} minors`);

  if (allIssues.length > 0) {
    console.log("\n=== Issues ===");
    for (const i of allIssues) {
      console.log(`[${i.severity.toUpperCase()}] ${i.moduleId}#${i.questionId}: ${i.reason}`);
    }
  } else {
    console.log("\n=== No issues found ===");
  }

  const score = Math.max(0, 1 - totalBlockers / Math.max(1, totalQuestions));
  console.log(`\nQuality score: ${(score * 100).toFixed(1)}% (${totalBlockers === 0 ? "PASS" : "FAIL"} — need 100%)`);

  process.exit(totalBlockers === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
