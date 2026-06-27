#!/usr/bin/env bun
/**
 * Run the auto-quiz generator against the eval corpus and write the output to
 * /tmp/quiz-eval-output.json. The evaluator (evaluate.ts) consumes this.
 */
import { readFileSync } from "node:fs";
import { autoGenerateQuiz } from "../server-lib/auto-quiz";

const corpusPath = process.argv[2] || "quiz-eval/corpus.json";
const corpus = JSON.parse(readFileSync(corpusPath, "utf-8")) as {
  documents: { name: string; text: string }[];
};

const modules = corpus.documents.map((doc, idx) => {
  const id = `m${idx + 1}`;
  const title = doc.name;
  const text = doc.text;
  const questions = autoGenerateQuiz({ id, title, text }, 12345);
  return {
    moduleId: id,
    moduleTitle: title,
    sourceText: text,
    questions,
  };
});

const output = { modules };
const outPath = process.argv[3] || "/tmp/quiz-eval-output.json";
await Bun.write(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${outPath} (${modules.length} modules, ${modules.reduce((a, m) => a + m.questions.length, 0)} questions)`);
