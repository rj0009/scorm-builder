import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { autoGenerateQuiz } from "./auto-quiz";

export type IngestedChunk = {
  index: number;
  title: string;
  content: string;
  source: string;
};

export type IngestResult = {
  filename: string;
  mime: string;
  totalChunks: number;
  fullText: string;
  chunks: IngestedChunk[];
};

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Split text into "sections" using heading-like boundaries.
// Falls back to balanced paragraph chunks when no headings are detected.
function splitIntoSections(text: string, filename: string): IngestedChunk[] {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (!cleaned) return [];

  // Heuristic: look for lines that look like headings (short, title-case, no terminal punctuation, all-caps, or starting with "Chapter/Section/Module/Unit/Lesson" or numbers like "1.", "1.2").
  const lines = cleaned.split(/\n/);
  const headingRe =
    /^(\s*)(#{1,3}\s+|chapter\s+\d+|section\s+\d+|module\s+\d+|unit\s+\d+|lesson\s+\d+|\d+(\.\d+)*\.?\s+[A-Z])/i;

  const sections: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m && line.trim().length < 120) {
      if (cur) sections.push(cur);
      const title = line
        .replace(/^\s*#+\s+/, "")
        .replace(/^(chapter|section|module|unit|lesson)\s+\d+:?\s*/i, "")
        .replace(/^\d+(\.\d+)*\.?\s+/, "")
        .trim();
      cur = { title: title || `Section ${sections.length + 1}`, body: [] };
    } else {
      if (!cur) cur = { title: "Introduction", body: [] };
      cur.body.push(line);
    }
  }
  if (cur) sections.push(cur);

  // If we got only one section with no clear heading structure, fall back to per-page chunks for PPTX or ~1500 char chunks for PDF.
  if (sections.length <= 1) {
    const balanced: IngestedChunk[] = [];
    const CHUNK_SIZE = 1800;
    let buf = "";
    let i = 0;
    let idx = 0;
    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if ((buf + " " + s).length > CHUNK_SIZE && buf.trim()) {
        balanced.push({
          index: idx++,
          title: `Section ${idx}`,
          content: buf.trim(),
          source: filename,
        });
        buf = s;
      } else {
        buf = buf ? buf + " " + s : s;
      }
      i++;
    }
    if (buf.trim()) {
      balanced.push({
        index: idx++,
        title: `Section ${idx}`,
        content: buf.trim(),
        source: filename,
      });
    }
    return balanced.length > 0 ? balanced : [{ index: 0, title: "Content", content: cleaned, source: filename }];
  }

  return sections
    .filter((s) => s.body.join("\n").trim().length > 0)
    .map((s, idx) => ({
      index: idx,
      title: s.title,
      content: s.body.join("\n").trim(),
      source: filename,
    }));
}

// --- PDF extraction using pdf-parse ---
async function extractPdf(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

// --- PPTX extraction: PPTX is a ZIP of XML files; slides are ppt/slides/slideN.xml ---
async function extractPptx(buf: Buffer): Promise<{ text: string; perSlide: { index: number; title: string; content: string }[] }> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
      return na - nb;
    });

  const perSlide: { index: number; title: string; content: string }[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const file = zip.files[slideFiles[i]];
    const xml = await file.async("string");
    // Extract <a:t> text runs (the actual text content of a slide)
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
      decodeXmlText(m[1]).trim()
    );
    // Title slide is usually the first shape with placeholder type "title" — best-effort:
    const titleMatch = /<p:ph\s+type="(?:title|ctrTitle)"\s*\/?>/.test(xml);
    const title = titleMatch && texts.length > 0 ? texts[0] : `Slide ${i + 1}`;
    const content = texts.join("\n");
    perSlide.push({ index: i, title, content });
  }

  const fullText = perSlide
    .map((s, i) => `--- Slide ${i + 1}: ${s.title} ---\n${s.content}`)
    .join("\n\n");
  return { text: fullText, perSlide };
}

export async function ingestBuffer(
  filename: string,
  mime: string,
  buf: Buffer
): Promise<IngestResult> {
  const lower = filename.toLowerCase();
  let fullText = "";
  let perSlideChunks: { index: number; title: string; content: string }[] | null = null;

  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    fullText = await extractPdf(buf);
  } else if (
    lower.endsWith(".pptx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    const r = await extractPptx(buf);
    fullText = r.text;
    perSlideChunks = r.perSlide;
  } else {
    throw new Error(
      `Unsupported file type: ${filename}. Only .pdf and .pptx are supported.`
    );
  }

  // Strip pdf-parse page markers ("-- 2 of 4 --" or "– 2 of 4 –") that leak into the text
  fullText = fullText.replace(/[-–—_]\s*\d+\s+of\s+\d+\s*[-–—]?/g, " ").replace(/^\s*--\s*$/gm, "").replace(/--\s*$/gm, "").replace(/^\s*-\s*-\s*$/gm, "");

  let chunks: IngestedChunk[];
  if (perSlideChunks && perSlideChunks.length > 0) {
    // Strip any page markers that leaked into slide text
    perSlideChunks = perSlideChunks.map((s) => ({
      ...s,
      title: s.title.replace(/[-–—]\s*\d+\s+of\s+\d+\s*[-–—]?/g, "").trim(),
      content: s.content.replace(/[-–—]\s*\d+\s+of\s+\d+\s*[-–—]?/g, "").trim(),
    }));
    chunks = perSlideChunks.map((s) => ({
      index: s.index,
      title: s.title || `Slide ${s.index + 1}`,
      content: s.content,
      source: `${filename} (slide ${s.index + 1})`,
    }));
  } else {
    chunks = splitIntoSections(fullText, filename);
  }

  // Auto-generate a quiz for each chunk using plain text only
  chunks = chunks.map((c) => ({
    ...c,
    suggestedQuestions: autoGenerateQuiz({
      id: `ch-${c.index}`,
      title: c.title,
      text: c.content,
    }),
  }));

  return {
    filename,
    mime: mime || "application/octet-stream",
    totalChunks: chunks.length,
    fullText,
    chunks,
  };
}