import { useState } from "react";
import type { AppState } from "../App";
import { ArrowLeft, Download, Loader2, Package as PackageIcon } from "lucide-react";

type Props = {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  onBack: () => void;
};

export function BuildStep({ state, update, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string; size: number } | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          courseTitle: state.courseTitle,
          courseDescription: state.courseDescription,
          modules: state.modules,
          quizzes: state.quizzes,
          passMark: state.passMark,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(j.error || `Build failed (HTTP ${r.status})`);
      }
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const filename = m?.[1] || `${state.courseTitle || "course"}.scorm.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone({ filename, size: blob.size });
    } catch (e: any) {
      setError(e?.message || "Build failed");
    } finally {
      setBusy(false);
    }
  };

  const totalQuestions = state.quizzes.reduce((n, q) => n + q.questions.length, 0);
  const modulesWithQuiz = state.quizzes.filter((q) => q.questions.length > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">4 · Build & download</h2>
        <p className="text-sm text-muted-foreground">
          The package is a SCORM 1.2-compliant ZIP with <code>imsmanifest.xml</code>, one SCO
          HTML per module, interactive quizzes, and full LMS API communication.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <h3 className="font-semibold text-sm">Course details</h3>
          <label className="block">
            <span className="text-xs text-muted-foreground">Course title</span>
            <input
              className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2"
              value={state.courseTitle}
              onChange={(e) => update({ courseTitle: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Course description</span>
            <textarea
              className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2 text-sm min-h-[80px]"
              value={state.courseDescription}
              onChange={(e) => update({ courseDescription: e.target.value })}
              placeholder="Optional description shown on the course launcher page."
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Default passing score (%):</span>
            <input
              type="number"
              min={0}
              max={100}
              className="mt-1 w-24 bg-input border border-border rounded-md px-3 py-2"
              value={state.passMark}
              onChange={(e) =>
                update({ passMark: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
              }
            />
          </label>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-sm">Package contents</h3>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modules</span>
              <span className="font-medium">{state.modules.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modules with quiz</span>
              <span className="font-medium">{modulesWithQuiz}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total quiz questions</span>
              <span className="font-medium">{totalQuestions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">SCORM version</span>
              <span className="font-medium">1.2</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pt-2 border-t border-border">
            The ZIP contains:
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li><code>imsmanifest.xml</code> (SCORM 1.2 manifest)</li>
              <li><code>index.html</code> (course launcher)</li>
              <li><code>content/module-N.html</code> (one SCO per module)</li>
              <li><code>scorm_api_wrapper.js</code> + <code>scorm_runtime.js</code></li>
              <li><code>metadata.xml</code> + minimal schema files</li>
            </ul>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {done && (
        <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded-md p-3 text-sm">
          ✓ Package built: <strong>{done.filename}</strong> (
          {(done.size / 1024).toFixed(1)} KB). Upload this ZIP to any SCORM 1.2 LMS
          (Moodle, Canvas, TalentLMS, etc.).
        </div>
      )}

      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="bg-card border border-border px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:border-primary/40"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={build}
          disabled={busy || state.modules.length === 0}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md font-semibold disabled:opacity-40 flex items-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Building…
            </>
          ) : (
            <>
              <PackageIcon className="w-4 h-4" /> Build & Download .zip
            </>
          )}
        </button>
      </div>
    </div>
  );
}