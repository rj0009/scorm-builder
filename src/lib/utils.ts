import { clsx, type ClassValue } from "clsx";
import type { Chunk, Module, Quiz } from "../App";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `module-${Date.now()}`
  );
}

// Convert plain text or simple markdown to safe HTML for SCORM SCO pages.
// Supports: # / ## / ### headings, paragraphs, - bullets, 1. numbered lists, **bold**.
export function plainTextToHtml(text: string): string {
  if (!text) return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const inline = (s: string) =>
    esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^###\s+/.test(line)) {
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      i++;
      continue;
    }
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trimEnd())) {
        items.push(`<li>${inline(lines[i].replace(/^-\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trimEnd())) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    // paragraph: collect consecutive non-empty non-special lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s+|-\s+|\d+\.\s+)/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

// Convert chunks into modules and seed quizzes from each chunk's suggestedQuestions.
// Used to auto-build the course right after ingest — no manual button needed.
export function buildModulesAndQuizzesFromChunks(
  chunks: Chunk[],
  passMark: number,
  slugifyFn: (s: string) => string,
): { modules: Module[]; quizzes: Quiz[] } {
  const modules: Module[] = [];
  const quizzes: Quiz[] = [];
  for (const c of chunks) {
    const id = slugifyFn(c.title || `section-${c.index + 1}`);
    modules.push({
      id,
      title: c.title || `Module ${c.index + 1}`,
      contentHtml: plainTextToHtml(c.content),
      sourceChunkIndex: c.index,
    });
    const qs = (c.suggestedQuestions || []).map((q) => ({
      ...q,
      id: `q-${id}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    if (qs.length > 0) {
      quizzes.push({ moduleId: id, passingScore: passMark, questions: qs });
    }
  }
  return { modules, quizzes };
}
