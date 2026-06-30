import { useRef, useState } from "react";
import type { AppState, Chunk, Module, Quiz } from "../App";
import { Upload, Loader2, FileText, Presentation, ChevronRight, Trash2, Sparkles } from "lucide-react";
import { slugify } from "../lib/utils";

type Props = {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  onNext: () => void;
};

type DemoResponse = {
  filename: string;
  mime: string;
  totalChunks: number;
  chunks: Chunk[];
  sourceFile: { name: string; mime: string; size: number };
  demo: {
    courseTitle: string;
    courseDescription: string;
    passMark: number;
    modules: Module[];
    quizzes: Quiz[];
  };
};

export function IngestStep({ state, update, onNext }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/ingest", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(j.error || `Ingest failed (HTTP ${r.status})`);
      }
      const result = await r.json();
      const chunks = (result.chunks as Chunk[]);
      // Chunks are previewed but NO modules/quizzes are auto-populated until
      // the user clicks "Next" and goes to the Modules step (which adds a
      // blank module per chunk for them to edit).
      update({
        sourceFile: { name: file.name, mime: result.mime, size: file.size },
        chunks,
        courseTitle: file.name.replace(/\.(pdf|pptx)$/i, ""),
        modules: [],
        quizzes: [],
      });
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/demo", { method: "GET" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(j.error || `Demo load failed (HTTP ${r.status})`);
      }
      const result = (await r.json()) as DemoResponse;
      // Demo: hydrate modules + quizzes so the user can immediately see
      // what a finished course looks like. The "Load demo" button is the
      // only way this content enters the wizard — never auto-populated.
      update({
        sourceFile: result.sourceFile,
        chunks: result.chunks,
        courseTitle: result.demo.courseTitle,
        courseDescription: result.demo.courseDescription,
        modules: result.demo.modules,
        quizzes: result.demo.quizzes,
        passMark: result.demo.passMark,
      });
    } catch (e: any) {
      setError(e?.message || "Demo load failed");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | null | undefined) => {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".pptx")) {
      setError("Only .pdf or .pptx files are supported.");
      return;
    }
    upload(f);
  };

  const isDemo = state.sourceFile?.mime === "application/x-scorm-demo";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">1 · Upload training material</h2>
        <p className="text-sm text-muted-foreground">
          Upload a PDF or PowerPoint (.pptx), or load a built-in demo to explore the
          builder. Nothing is pre-populated — your course only appears after you
          choose one of these options.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            onFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 bg-card/30"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.pptx"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {busy ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-6">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Extracting text…</span>
            </div>
          ) : (
            <>
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium">Click or drag a file here</div>
              <div className="text-xs text-muted-foreground mt-1">PDF or PPTX · up to 50 MB</div>
            </>
          )}
        </div>

        <button
          onClick={loadDemo}
          disabled={busy}
          className="border-2 border-dashed border-border rounded-lg p-8 text-left bg-card/30 hover:border-primary/40 transition disabled:opacity-50"
        >
          <Sparkles className="w-10 h-10 mb-3 text-primary" />
          <div className="font-medium">Load demo</div>
          <div className="text-xs text-muted-foreground mt-1">
            Pre-built 3-module course with quizzes — see the full builder flow
            without uploading anything.
          </div>
          <div className="mt-3 text-xs font-medium text-primary">
            {busy ? "Loading…" : "Click to load"}
          </div>
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {state.sourceFile && (
        <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isDemo ? (
              <Sparkles className="w-6 h-6 text-primary" />
            ) : state.sourceFile.name.toLowerCase().endsWith(".pdf") ? (
              <FileText className="w-6 h-6 text-primary" />
            ) : (
              <Presentation className="w-6 h-6 text-primary" />
            )}
            <div>
              <div className="font-medium">{state.sourceFile.name}</div>
              <div className="text-xs text-muted-foreground">
                {isDemo ? "Built-in demo · " : `${(state.sourceFile.size / 1024 / 1024).toFixed(2)} MB · `}
                {state.chunks.length} chunks extracted
              </div>
            </div>
          </div>
          <button
            onClick={() =>
              update({ sourceFile: null, chunks: [], modules: [], quizzes: [] })
            }
            className="p-2 text-muted-foreground hover:text-destructive"
            title="Remove file"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {state.chunks.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold">Extracted content ({state.chunks.length})</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {state.chunks.map((c) => (
              <details key={c.index} className="bg-card border border-border rounded-md">
                <summary className="cursor-pointer p-3 text-sm font-medium flex items-center justify-between">
                  <span>
                    #{c.index + 1} · {c.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.content.length.toLocaleString()} chars
                  </span>
                </summary>
                <div className="px-3 pb-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {c.content.slice(0, 1500)}
                  {c.content.length > 1500 ? "…" : ""}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-4">
        <button
          disabled={state.chunks.length === 0}
          onClick={onNext}
          className="bg-primary text-primary-foreground px-5 py-2 rounded-md font-medium disabled:opacity-40 flex items-center gap-2"
        >
          Next: organize modules <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
