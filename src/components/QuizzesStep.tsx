import { useState } from "react";
import type { AppState, Quiz, QuizQuestion } from "../App";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";

type Props = {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  onNext: () => void;
  onBack: () => void;
};

function makeQ(): QuizQuestion {
  return {
    id: `q-${Math.random().toString(36).slice(2, 9)}`,
    prompt: "",
    choices: ["", ""],
    correctIndex: 0,
    explanation: "",
  };
}

export function QuizzesStep({ state, update, onNext, onBack }: Props) {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(
    state.modules[0]?.id ?? null
  );

  const ensureQuiz = (moduleId: string): Quiz => {
    const existing = state.quizzes.find((q) => q.moduleId === moduleId);
    if (existing) return existing;
    const fresh: Quiz = { moduleId, passingScore: state.passMark, questions: [makeQ()] };
    update({ quizzes: [...state.quizzes, fresh] });
    return fresh;
  };

  const updateQuiz = (moduleId: string, patch: Partial<Quiz>) => {
    const has = state.quizzes.find((q) => q.moduleId === moduleId);
    if (!has) {
      const fresh: Quiz = { moduleId, passingScore: state.passMark, questions: [], ...patch };
      update({ quizzes: [...state.quizzes, fresh] });
      return;
    }
    update({
      quizzes: state.quizzes.map((q) => (q.moduleId === moduleId ? { ...q, ...patch } : q)),
    });
  };

  const active = state.quizzes.find((q) => q.moduleId === activeModuleId) || null;
  const activeModule = state.modules.find((m) => m.id === activeModuleId) || null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">3 · Add quizzes</h2>
        <p className="text-sm text-muted-foreground">
          Attach multiple-choice quizzes to any module. Scores and per-question answers are
          written to the LMS via cmi.interactions.* on submit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {state.modules.map((m) => {
          const hasQuiz = state.quizzes.some(
            (q) => q.moduleId === m.id && q.questions.length > 0
          );
          return (
            <button
              key={m.id}
              onClick={() => {
                setActiveModuleId(m.id);
                ensureQuiz(m.id);
              }}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                activeModuleId === m.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border hover:border-primary/40"
              }`}
            >
              {m.title}
              {hasQuiz && <span className="ml-1 text-xs opacity-70">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        {activeModule && active ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{activeModule.title}</h3>
                <div className="text-xs text-muted-foreground">{activeModule.id}</div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Passing score (%):
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20 bg-input border border-border rounded-md px-2 py-1"
                  value={active.passingScore}
                  onChange={(e) =>
                    updateQuiz(active.moduleId, {
                      passingScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                />
              </label>
            </div>

            {active.questions.map((q, qi) => (
              <div key={q.id} className="border border-border rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Question {qi + 1}
                  </span>
                  <button
                    onClick={() =>
                      updateQuiz(active.moduleId, {
                        questions: active.questions.filter((x) => x.id !== q.id),
                      })
                    }
                    className="p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  placeholder="Question prompt…"
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  value={q.prompt}
                  onChange={(e) =>
                    updateQuiz(active.moduleId, {
                      questions: active.questions.map((x) =>
                        x.id === q.id ? { ...x, prompt: e.target.value } : x
                      ),
                    })
                  }
                />
                <div className="space-y-2">
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${q.id}`}
                        checked={q.correctIndex === ci}
                        onChange={() =>
                          updateQuiz(active.moduleId, {
                            questions: active.questions.map((x) =>
                              x.id === q.id ? { ...x, correctIndex: ci } : x
                            ),
                          })
                        }
                      />
                      <input
                        placeholder={`Choice ${ci + 1}`}
                        className="flex-1 bg-input border border-border rounded-md px-3 py-1.5 text-sm"
                        value={c}
                        onChange={(e) =>
                          updateQuiz(active.moduleId, {
                            questions: active.questions.map((x) => {
                              if (x.id !== q.id) return x;
                              const choices = [...x.choices];
                              choices[ci] = e.target.value;
                              return { ...x, choices };
                            }),
                          })
                        }
                      />
                      {q.choices.length > 2 && (
                        <button
                          onClick={() =>
                            updateQuiz(active.moduleId, {
                              questions: active.questions.map((x) => {
                                if (x.id !== q.id) return x;
                                const choices = x.choices.filter((_, i) => i !== ci);
                                return {
                                  ...x,
                                  choices,
                                  correctIndex:
                                    x.correctIndex >= choices.length
                                      ? Math.max(0, choices.length - 1)
                                      : x.correctIndex,
                                };
                              }),
                            })
                          }
                          className="p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {q.choices.length < 6 && (
                  <button
                    onClick={() =>
                      updateQuiz(active.moduleId, {
                        questions: active.questions.map((x) =>
                          x.id === q.id ? { ...x, choices: [...x.choices, ""] } : x
                        ),
                      })
                    }
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add choice
                  </button>
                )}
                <input
                  placeholder="Optional explanation shown after submission"
                  className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-xs"
                  value={q.explanation || ""}
                  onChange={(e) =>
                    updateQuiz(active.moduleId, {
                      questions: active.questions.map((x) =>
                        x.id === q.id ? { ...x, explanation: e.target.value } : x
                      ),
                    })
                  }
                />
              </div>
            ))}

            <button
              onClick={() =>
                updateQuiz(active.moduleId, {
                  questions: [...active.questions, makeQ()],
                })
              }
              className="bg-card border border-border px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 hover:border-primary/40"
            >
              <Plus className="w-4 h-4" /> Add question
            </button>
          </>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            Pick a module above to add quiz questions.
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="bg-card border border-border px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:border-primary/40"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="bg-primary text-primary-foreground px-5 py-2 rounded-md font-medium flex items-center gap-2"
        >
          Next: build package <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}