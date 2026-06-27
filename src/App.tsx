import { useState } from "react";
import { IngestStep } from "./components/IngestStep";
import { ModulesStep } from "./components/ModulesStep";
import { QuizzesStep } from "./components/QuizzesStep";
import { BuildStep } from "./components/BuildStep";
import { BookOpen, FileUp, ListChecks, Package } from "lucide-react";

export type Chunk = {
  index: number;
  title: string;
  content: string;
  source: string;
  suggestedQuestions?: QuizQuestion[];
};

export type Module = { id: string; title: string; contentHtml: string; sourceChunkIndex?: number };

export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
};

export type Quiz = { moduleId: string; passingScore: number; questions: QuizQuestion[] };

export type AppState = {
  courseTitle: string;
  courseDescription: string;
  sourceFile: { name: string; mime: string; size: number } | null;
  chunks: Chunk[];
  modules: Module[];
  quizzes: Quiz[];
  passMark: number;
};

const initialState: AppState = {
  courseTitle: "Untitled Training",
  courseDescription: "",
  sourceFile: null,
  chunks: [],
  modules: [],
  quizzes: [],
  passMark: 80,
};

const STEPS = [
  { key: "ingest", label: "Ingest", icon: FileUp },
  { key: "modules", label: "Modules", icon: BookOpen },
  { key: "quizzes", label: "Quizzes", icon: ListChecks },
  { key: "build", label: "Build", icon: Package },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [step, setStep] = useState<StepKey>("ingest");

  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }));
  const goTo = (s: StepKey) => setStep(s);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">SCORM Builder</h1>
            <p className="text-xs text-muted-foreground">
              PDF / PPTX → SCORM 1.2 e-learning package
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {state.sourceFile ? `${state.sourceFile.name}` : "No file uploaded"}
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-6 pb-3 flex gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.key;
            const idx = STEPS.findIndex((x) => x.key === step);
            const done = i < idx;
            return (
              <button
                key={s.key}
                onClick={() => goTo(s.key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : done
                    ? "bg-card border-border hover:border-primary/40"
                    : "bg-card/60 border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{s.label}</span>
                <span className="opacity-50 text-xs">{i + 1}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === "ingest" && <IngestStep state={state} update={update} onNext={() => setStep("modules")} />}
        {step === "modules" && (
          <ModulesStep
            state={state}
            update={update}
            onNext={() => setStep("quizzes")}
            onBack={() => setStep("ingest")}
          />
        )}
        {step === "quizzes" && (
          <QuizzesStep
            state={state}
            update={update}
            onNext={() => setStep("build")}
            onBack={() => setStep("modules")}
          />
        )}
        {step === "build" && <BuildStep state={state} update={update} onBack={() => setStep("quizzes")} />}
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-8 text-xs text-muted-foreground border-t border-border mt-8">
        SCORM Builder · generates SCORM 1.2 compliant .zip packages with imsmanifest.xml,
        SCO HTML, interactive quizzes, and full LMS API communication (LMSInitialize /
        LMSSetValue / LMSCommit / LMSFinish).
      </footer>
    </div>
  );
}