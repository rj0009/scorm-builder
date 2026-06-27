import { useState } from "react";
import type { AppState, Module, Chunk } from "../App";
import { plainTextToHtml, slugify } from "../lib/utils";
import { ArrowLeft, ArrowRight, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";

type Props = {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  onNext: () => void;
  onBack: () => void;
};

export function ModulesStep({ state, update, onNext, onBack }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(0);

  const autoFromChunks = () => {
    const mods: Module[] = state.chunks.map((c) => ({
      id: slugify(c.title || `section-${c.index + 1}`),
      title: c.title || `Module ${c.index + 1}`,
      contentHtml: plainTextToHtml(c.content),
      sourceChunkIndex: c.index,
    }));
    update({ modules: mods, quizzes: [] });
    setEditingIdx(0);
  };

  const addBlank = () => {
    const m: Module = {
      id: slugify(`module-${state.modules.length + 1}`),
      title: `Module ${state.modules.length + 1}`,
      contentHtml: "<p>Edit this module content…</p>",
    };
    update({ modules: [...state.modules, m], quizzes: state.quizzes });
    setEditingIdx(state.modules.length);
  };

  const remove = (i: number) => {
    const id = state.modules[i].id;
    update({
      modules: state.modules.filter((_, idx) => idx !== i),
      quizzes: state.quizzes.filter((q) => q.moduleId !== id),
    });
    if (editingIdx === i) setEditingIdx(0);
    else if (editingIdx !== null && editingIdx > i) setEditingIdx(editingIdx - 1);
  };

  const updateModule = (i: number, patch: Partial<Module>) => {
    update({
      modules: state.modules.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= state.modules.length) return;
    const arr = [...state.modules];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update({ modules: arr });
    if (editingIdx === i) setEditingIdx(j);
    else if (editingIdx === j) setEditingIdx(i);
  };

  const cur = editingIdx !== null ? state.modules[editingIdx] : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">2 · Organize modules</h2>
        <p className="text-sm text-muted-foreground">
          Reorder, edit, or add modules. Each module becomes one SCO in the SCORM package.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {state.chunks.length > 0 && state.modules.length === 0 && (
            <button
              onClick={autoFromChunks}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium"
            >
              Auto-generate from {state.chunks.length} chunks
            </button>
          )}
          <button
            onClick={addBlank}
            className="bg-card border border-border px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 hover:border-primary/40"
          >
            <Plus className="w-4 h-4" /> Add blank module
          </button>
        </div>
        <div className="text-sm text-muted-foreground">
          {state.modules.length} module{state.modules.length === 1 ? "" : "s"}
        </div>
      </div>

      {state.modules.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No modules yet. Auto-generate from the ingested content or add a blank module.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-1">
          {state.modules.map((m, i) => (
            <div
              key={m.id}
              className={`bg-card border rounded-md p-3 flex items-center justify-between gap-2 cursor-pointer ${
                editingIdx === i ? "border-primary" : "border-border hover:border-primary/40"
              }`}
              onClick={() => setEditingIdx(i)}
            >
              <div className="text-sm font-medium truncate flex-1">
                {i + 1}. {m.title || "(untitled)"}
              </div>
              <div className="flex gap-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, -1);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title="Move up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, 1);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title="Move down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(i);
                  }}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          {cur ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Module title</span>
                <input
                  className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2"
                  value={cur.title}
                  onChange={(e) => updateModule(editingIdx!, { title: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Module ID (slug)</span>
                <input
                  className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2 font-mono text-sm"
                  value={cur.id}
                  onChange={(e) => updateModule(editingIdx!, { id: slugify(e.target.value) })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Content (HTML — basic Markdown is supported)
                </span>
                <textarea
                  className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2 font-mono text-sm min-h-[260px]"
                  value={cur.contentHtml}
                  onChange={(e) => updateModule(editingIdx!, { contentHtml: e.target.value })}
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Supports: <code>#</code> / <code>##</code> / <code>###</code> headings,
                  paragraphs, <code>-</code> bullets, <code>1.</code> numbered lists, **bold**.
                </div>
              </label>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Preview</div>
                <div
                  className="prose prose-sm max-w-none bg-background border border-border rounded-md p-4"
                  dangerouslySetInnerHTML={{ __html: cur.contentHtml }}
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground p-8 text-center">
              Select a module on the left to edit it.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="bg-card border border-border px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:border-primary/40"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          disabled={state.modules.length === 0}
          onClick={onNext}
          className="bg-primary text-primary-foreground px-5 py-2 rounded-md font-medium disabled:opacity-40 flex items-center gap-2"
        >
          Next: add quizzes <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}