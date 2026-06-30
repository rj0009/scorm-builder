import JSZip from "jszip";
import { xmlEscape } from "./ingest";

export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
  type?: string;
};

export type Quiz = {
  moduleId: string;
  passingScore: number;
  questions: QuizQuestion[];
};

export type ModuleInput = {
  id: string;
  title: string;
  contentHtml: string;
};

export type BuildInput = {
  courseTitle: string;
  courseDescription: string;
  modules: ModuleInput[];
  quizzes: Quiz[];
  passMark: number;
};

// --- Minimal SCORM 1.2 schema references (required by some LMSs when validating the package) ---
const ADLCP_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.adlnet.org/xsd/adlcp_rootv1p2" targetNamespace="http://www.adlnet.org/xsd/adlcp_rootv1p2" elementFormDefault="qualified">
  <xs:annotation>
    <xs:documentation>SCORM 1.2 Content Packaging Schema (minimal, for manifest validation)</xs:documentation>
  </xs:annotation>
</xs:schema>`;

const IMSCP_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" targetNamespace="http://www.imsproject.org/xsd/imscp_rootv1p1p2" elementFormDefault="qualified">
  <xs:annotation>
    <xs:documentation>IMS Content Packaging Schema 1.1.2 (minimal)</xs:documentation>
  </xs:annotation>
</xs:schema>`;

// --- SCORM 1.2 API discovery wrapper ---
// Walks up window.parent / window.opener chain to find the LMS-provided API object (window.API).
// Exposes SCORM_API.init() / .get() / .set() / .save() / .quit() with safe fallbacks for browser preview.
const SCORM_API_WRAPPER = `/* SCORM 1.2 API wrapper — discovers the LMS API in parent/opener frames. */
(function () {
  var SCORM_API = (function () {
    function findAPI(win) {
      var tries = 0;
      while (win && tries < 500) {
        if (win.API && typeof win.API.LMSInitialize === "function") return win.API;
        if (win === win.parent) break;
        win = win.parent;
        tries++;
      }
      return null;
    }
    function getAPI() {
      var api = findAPI(window);
      if (!api && window.opener) api = findAPI(window.opener);
      return api;
    }
    var _api = null;
    var _connected = false;
    var _lastError = "0";

    return {
      init: function () {
        _api = getAPI();
        if (!_api) {
          return { connected: false, reason: "LMS API not found in window.parent or window.opener (running outside an LMS frame)." };
        }
        try {
          _lastError = _api.LMSInitialize("");
          _connected = _lastError === "0";
          return { connected: _connected, error: _lastError };
        } catch (e) {
          return { connected: false, reason: "LMSInitialize threw: " + e.message };
        }
      },
      get: function (key) {
        if (!_api || !_connected) return "";
        try {
          var v = _api.LMSGetValue(key);
          _lastError = _api.LMSGetLastError();
          return v || "";
        } catch (e) {
          return "";
        }
      },
      set: function (key, value) {
        if (!_api || !_connected) return false;
        try {
          _lastError = _api.LMSSetValue(key, value);
          return _lastError === "0";
        } catch (e) {
          return false;
        }
      },
      save: function () {
        if (!_api || !_connected) return false;
        try {
          _lastError = _api.LMSCommit("");
          return _lastError === "0";
        } catch (e) {
          return false;
        }
      },
      quit: function () {
        if (!_api || !_connected) return;
        try { _api.LMSFinish(""); } catch (e) {}
      },
      isConnected: function () { return _connected; },
      lastError: function () { return _lastError; },
    };
  })();
  window.SCORM_API = SCORM_API;
})();
`;

// --- SCORM 1.2 quiz runtime ---
// Renders a quiz form, validates answers, writes cmi.interactions.* to the LMS, and reports the score.
const SCORM_RUNTIME = `/* SCORM 1.2 quiz runtime — renders the quiz and writes per-interaction data to the LMS. */
(function () {
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  window.renderQuiz = function (form, quiz, passMark, onSubmit) {
    if (!quiz || !quiz.questions || quiz.questions.length === 0) return;
    form.innerHTML = "";
    quiz.questions.forEach(function (q, qi) {
      var block = el("div", { class: "qblock" });
      block.appendChild(el("div", { class: "qprompt" }, [q.prompt || ("Question " + (qi + 1))]));
      var name = "q_" + q.id;
      q.choices.forEach(function (c, ci) {
        var id = name + "_" + ci;
        var label = el("label", { class: "qchoice", for: id });
        var input = el("input", { type: "radio", name: name, value: String(ci), id: id });
        var text = el("span", {}, [c || ("Choice " + (ci + 1))]);
        label.appendChild(input); label.appendChild(text);
        block.appendChild(label);
      });
      form.appendChild(block);
    });
    form.dataset.passMark = String(passMark);
    form.dataset.rendered = "1";
  };

  window.gradeQuiz = function (form, quiz) {
    var correct = 0;
    var total = quiz.questions.length;
    var details = [];
    quiz.questions.forEach(function (q, qi) {
      var name = "q_" + q.id;
      var checked = form.querySelector('input[name="' + name + '"]:checked');
      var picked = checked ? Number(checked.value) : -1;
      var isRight = picked === q.correctIndex;
      if (isRight) correct++;
      details.push({ q: qi, picked: picked, correct: q.correctIndex, right: isRight, explain: q.explanation || "" });
    });
    var pct = Math.round((correct / total) * 100);
    return { correct: correct, total: total, percent: pct, details: details };
  };

  window.writeQuizToLMS = function (quiz, grade, lmsConnected) {
    if (!lmsConnected || !window.SCORM_API) return;
    var api = window.SCORM_API;
    api.set("cmi.core.lesson_status", grade.percent >= (quiz.passingScore || 80) ? "passed" : "failed");
    api.set("cmi.core.score.raw", String(grade.percent));
    api.set("cmi.core.score.min", "0");
    api.set("cmi.core.score.max", "100");
    grade.details.forEach(function (d, i) {
      var idx = String(i);
      api.set("cmi.interactions." + idx + ".id", "q_" + (quiz.questions[i] ? quiz.questions[i].id : i));
      api.set("cmi.interactions." + idx + ".type", "choice");
      api.set("cmi.interactions." + idx + ".student_response", String(d.picked >= 0 ? d.picked : ""));
      api.set("cmi.interactions." + idx + ".correct_responses.0.pattern", String(d.correct));
      api.set("cmi.interactions." + idx + ".result", d.right ? "correct" : "wrong");
      api.set("cmi.interactions." + idx + ".weighting", "1");
    });
    api.save();
  };
})();
`;

const SCORM_NARRATION = `(function() {
  var TTS = {};
  TTS.supported = ("speechSynthesis" in window) && ("SpeechSynthesisUtterance" in window);
  TTS.speaking = false;
  TTS.currentUtterance = null;
  TTS.onStateChange = null;

  // Chrome bug: speech stops after ~15s if not re-pinged. Workaround by monitoring.
  TTS.chromeWorkaround = function() {
    var interval = setInterval(function() {
      if (!TTS.speaking) { clearInterval(interval); return; }
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        // Speech has been going for >14s — pause+resume to keep alive.
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 14000);
    return interval;
  };

  TTS.speak = function(text) {
    if (!TTS.supported || !text) return false;
    TTS.stop();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0; u.lang = "en-US";
    u.onstart = function() { TTS.speaking = true; TTS._keepalive = TTS.chromeWorkaround(); if (TTS.onStateChange) TTS.onStateChange("playing"); };
    u.onend = function() { TTS.speaking = false; if (TTS._keepalive) clearInterval(TTS._keepalive); if (TTS.onStateChange) TTS.onStateChange("idle"); };
    u.onerror = function(e) { TTS.speaking = false; if (TTS._keepalive) clearInterval(TTS._keepalive); if (TTS.onStateChange) TTS.onStateChange("error", e); };
    TTS.currentUtterance = u;
    window.speechSynthesis.speak(u);
    return true;
  };

  TTS.pause = function() {
    if (TTS.supported && TTS.speaking) { window.speechSynthesis.pause(); if (TTS.onStateChange) TTS.onStateChange("paused"); }
  };

  TTS.resume = function() {
    if (TTS.supported) { window.speechSynthesis.resume(); if (TTS.onStateChange) TTS.onStateChange("playing"); }
  };

  TTS.stop = function() {
    if (TTS.supported) { window.speechSynthesis.cancel(); TTS.speaking = false; if (TTS._keepalive) clearInterval(TTS._keepalive); if (TTS.onStateChange) TTS.onStateChange("idle"); }
  };

  TTS.readPage = function() {
    var contentEl = document.querySelector(".module-content");
    if (!contentEl) return false;
    var text = contentEl.innerText || contentEl.textContent || "";
    // Strip excessive whitespace
    text = text.replace(/\\s+/g, " ").trim();
    return TTS.speak(text);
  };

  TTS.readQuizQuestion = function(questionIndex) {
    var qblocks = document.querySelectorAll(".qblock");
    if (!qblocks[questionIndex]) return false;
    var prompt = qblocks[questionIndex].querySelector(".qprompt");
    var choices = qblocks[questionIndex].querySelectorAll(".qchoice");
    var parts = [];
    if (prompt) parts.push(prompt.innerText);
    choices.forEach(function(c, i) { parts.push("Option " + (i+1) + ": " + (c.innerText || "")); });
    return TTS.speak(parts.join(". "));
  };

  window.TTS = TTS;
})();`;

function buildManifest(input: BuildInput, safeTitle: string): string {
  const now = new Date().toISOString();
  const courseId = `CRS-${Date.now()}`;
  const orgId = `ORG-${courseId}`;
  const itemId = (i: number) => `ITEM-MOD-${i + 1}`;
  const resId = (i: number) => `RES-MOD-${i + 1}`;

  const items = input.modules
    .map(
      (m, i) =>
        `      <item identifier="${itemId(i)}" identifierref="${resId(i)}" isvisible="true">\n` +
        `        <title>${xmlEscape(m.title)}</title>\n` +
        `      </item>`
    )
    .join("\n");

  const resources = input.modules
    .map(
      (_m, i) =>
        `    <resource identifier="${resId(i)}" type="webcontent" adlcp:scormtype="sco" href="content/module-${i + 1}.html">\n` +
        `      <file href="content/module-${i + 1}.html" />\n` +
        `      <file href="scorm_api_wrapper.js" />\n` +
        `      <file href="scorm_runtime.js" />\n` +
        `      <file href="scorm_narration.js" />
` +
        `    </resource>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${courseId}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${orgId}">
    <organization identifier="${orgId}">
      <title>${xmlEscape(safeTitle)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>
`;
}

function buildMetadata(title: string, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<lom xmlns="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1">
  <general>
    <title><string language="en">${xmlEscape(title)}</string></title>
    <description><string language="en">${xmlEscape(description || title)}</string></description>
  </general>
</lom>
`;
}

function buildLauncherHtml(title: string, input: BuildInput): string {
  const moduleList = input.modules
    .map(
      (m, i) =>
        `<li><a href="content/module-${i + 1}.html" target="_self">${xmlEscape(m.title)}</a></li>`
    )
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${xmlEscape(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 1rem; color: #222; background: #f7f7f8; }
  h1 { color: #1a1a2e; }
  .desc { color: #555; }
  ul { line-height: 1.8; }
  a { color: #2563eb; text-decoration: none; font-weight: 500; }
  a:hover { text-decoration: underline; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ddd; color: #888; font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>${xmlEscape(title)}</h1>
  <p class="desc">${xmlEscape(input.courseDescription || "Generated by SCORM Builder")}</p>
  <h2>Course Modules</h2>
  <ol>
      ${moduleList}
  </ol>
  <p>Click a module above to begin. Progress and quiz scores are saved automatically to the LMS.</p>
  <div class="footer">SCORM 1.2 compliant package · generated by SCORM Builder</div>
</body>
</html>
`;
}

function buildScoHtml(opts: {
  module: ModuleInput;
  quiz: Quiz | null | undefined;
  passMark: number;
  isLast: boolean;
  nextHref: string;
  prevHref: string;
}): string {
  const { module: m, quiz, passMark, isLast, nextHref, prevHref } = opts;
  const quizJson = quiz ? JSON.stringify(quiz) : "null";
  const passingScore = quiz?.passingScore ?? passMark;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${xmlEscape(m.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 1.5rem auto; padding: 1rem 1.25rem; color: #1f2937; background: #fafafa; line-height: 1.55; }
  h1 { font-size: 1.6rem; margin: 0 0 0.4rem; color: #111827; }
  .module-content { background: white; padding: 1.2rem 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .module-content h1 { font-size: 1.4rem; }
  .module-content h2 { font-size: 1.2rem; margin-top: 1rem; }
  .module-content h3 { font-size: 1.05rem; margin-top: 0.8rem; }
  .module-content ul, .module-content ol { padding-left: 1.5rem; }
  .quiz { margin-top: 1.5rem; background: white; padding: 1.2rem 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .quiz h2 { margin-top: 0; }
  .qblock { margin-bottom: 1.1rem; padding-bottom: 1rem; border-bottom: 1px solid #eee; }
  .qblock:last-of-type { border-bottom: none; }
  .qprompt { font-weight: 600; margin-bottom: 0.5rem; }
  .qchoice { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border-radius: 4px; cursor: pointer; }
  .qchoice:hover { background: #f3f4f6; }
  .btn-quiz { background: #2563eb; color: white; border: 0; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-size: 0.95rem; font-weight: 500; }
  .btn-quiz:hover { background: #1d4ed8; }
  .btn-quiz:disabled { background: #94a3b8; cursor: not-allowed; }
  #quizResults { margin-top: 1rem; padding: 0.9rem 1rem; border-radius: 6px; font-size: 0.92rem; }
  #quizResults.pass { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  #quizResults.fail { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  #quizResults ol { padding-left: 1.5rem; margin-top: 0.5rem; }
  .status { margin-top: 1rem; padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.85rem; background: #f1f5f9; color: #475569; }
  .status.connected { background: #d1fae5; color: #065f46; }
  .status.error { background: #fee2e2; color: #991b1b; }
  .nav { display: flex; justify-content: space-between; margin-top: 1.5rem; }
  .nav a { background: #2563eb; color: white; padding: 0.55rem 1.1rem; border-radius: 6px; text-decoration: none; font-weight: 500; }
  .nav a.secondary { background: #e5e7eb; color: #1f2937; }
  .nav a:hover { opacity: 0.92; }
</style>
</head>
<body>
  <h1>${xmlEscape(m.title)}</h1>
  <div class="module-content">
    ${m.contentHtml}
  </div>

  ${
    quiz && quiz.questions.length > 0
      ? `<div class="quiz">
    <h2>Knowledge check</h2>
    <p>Answer all ${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"} to complete this module. Passing score: ${passingScore}%</p>
    <form id="quizForm"></form>
    <button id="submitQuiz" class="btn-quiz" type="button">Submit Answers</button>
    <div id="quizResults" style="display:none"></div>
  </div>`
      : ""
  }

  <div id="statusBox" class="status">Connecting to LMS…</div>

<div class="narr-bar">
<button id="narrPlay" type="button" class="narr-btn" title="Play narration">▶ Play</button>
<button id="narrPause" type="button" class="narr-btn" title="Pause" disabled>⏸ Pause</button>
<button id="narrStop" type="button" class="narr-btn" title="Stop" disabled>⏹ Stop</button>
<span id="narrStatus" class="narr-status">off</span>
</div>
<style>.narr-bar{margin-top:1rem;display:flex;gap:.5rem;align-items:center}.narr-btn{background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:.35rem .75rem;font-size:.85rem;cursor:pointer}.narr-btn:hover:not(:disabled){background:#f3f4f6}.narr-btn:disabled{opacity:.4;cursor:not-allowed}.narr-status{font-size:.8rem;color:#6b7280;margin-left:.25rem}</style>
  <div class="nav">
    <a href="${prevHref}" class="secondary" id="prevBtn">← Previous</a>
    <a href="${nextHref}" id="nextBtn">${isLast ? "Finish Course →" : "Next Module →"}</a>
  </div>

<script src="../scorm_api_wrapper.js"></script>
<script src="../scorm_runtime.js"></script>
<script src="../scorm_narration.js"></script>
<script>
(function() {
  const moduleTitle = ${JSON.stringify(m.title)};
  const quizData = ${quizJson};
  const passMark = ${passingScore};
  let lmsConnected = false;
  let lastScore = -1;
  let lastCompleted = false;

  const statusEl = document.getElementById("statusBox");
  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.className = "status" + (ok === true ? " connected" : ok === false ? " error" : "");

  }

  const lms = SCORM_API.init();
  if (lms.connected) {
    lmsConnected = true;
    setStatus("✓ Connected to LMS — progress will be saved", true);
    SCORM_API.set("cmi.core.lesson_status", "incomplete");
    SCORM_API.set("cmi.core.lesson_mode", "normal");
    SCORM_API.set("cmi.core.student_name", "");
    SCORM_API.save();
  } else {
    setStatus("⚠ Not running inside an LMS — quiz results will NOT be saved. Open from your LMS to enable tracking.", false);
  }

  if (quizData && quizData.questions && quizData.questions.length > 0) {
    const form = document.getElementById("quizForm");
    renderQuiz(form, quizData, passMark);
    const btn = document.getElementById("submitQuiz");
    btn.addEventListener("click", function() {
      const grade = gradeQuiz(form, quizData);
      const passed = grade.percent >= passMark;
      const results = document.getElementById("quizResults");
      results.style.display = "block";
      results.className = passed ? "pass" : "fail";
      let html = passed
        ? "<strong>✓ Passed.</strong> Score: " + grade.percent + "% (" + grade.correct + "/" + grade.total + ")"
        : "<strong>✗ Not passed.</strong> Score: " + grade.percent + "% (" + grade.correct + "/" + grade.total + "). Passing score: " + passMark + "%.";
      html += "<ol>";
      grade.details.forEach(function(d) {
        const q = quizData.questions[d.q];
        const your = d.picked >= 0 ? q.choices[d.picked] : "(no answer)";
        const correct = q.choices[d.correct];
        html += "<li>" + (d.right ? "✓" : "✗") + " Your answer: <em>" + (your || "(blank)") + "</em>";
        if (!d.right) html += ". Correct answer: <em>" + correct + "</em>";
        if (d.explain) html += "<br><small>" + d.explain + "</small>";
        html += "</li>";
      });
      html += "</ol>";
      results.innerHTML = html;
      btn.disabled = true;

      writeQuizToLMS(quizData, grade, lmsConnected);
      lastScore = grade.percent;
      lastCompleted = passed;
    });
  } else {
    const f = document.getElementById("quizForm");
    if (f) f.parentElement.style.display = "none";
  }

  window.addEventListener("beforeunload", function() {
    if (lmsConnected) {
      if (lastScore >= 0 && !lastCompleted) {
        SCORM_API.set("cmi.core.lesson_status", "incomplete");
        SCORM_API.set("cmi.core.score.raw", String(lastScore));
      } else if (lastCompleted) {
        SCORM_API.set("cmi.core.lesson_status", "passed");
        SCORM_API.set("cmi.core.score.raw", String(lastScore));
      }
      SCORM_API.save();
      SCORM_API.quit();
    }
  });

  document.getElementById("nextBtn").addEventListener("click", function() {
    if (lmsConnected && lastScore >= 0) {
      SCORM_API.save();
    }
  });
})();
</script>
</body>
</html>
`;
}

export async function buildScormPackage(input: BuildInput): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("scorm_narration.js", SCORM_NARRATION);
  const safeTitle = (input.courseTitle || "Untitled Course").trim();

  zip.file("imsmanifest.xml", buildManifest(input, safeTitle));
  zip.file("adlcp_rootv1p2.xsd", ADLCP_SCHEMA);
  zip.file("imscp_rootv1p1p2.xsd", IMSCP_SCHEMA);
  zip.file("metadata.xml", buildMetadata(safeTitle, input.courseDescription));
  zip.file("scorm_api_wrapper.js", SCORM_API_WRAPPER);
  zip.file("scorm_runtime.js", SCORM_RUNTIME);
  zip.file("index.html", buildLauncherHtml(safeTitle, input));

  const contentDir = zip.folder("content")!;
  for (let i = 0; i < input.modules.length; i++) {
    const m = input.modules[i];
    const quiz = input.quizzes.find((q) => q.moduleId === m.id);
    const fileName = `module-${i + 1}.html`;
    const html = buildScoHtml({
      module: m,
      quiz: quiz && quiz.questions.length > 0 ? quiz : null,
      passMark: input.passMark,
      isLast: i === input.modules.length - 1,
      nextHref: i < input.modules.length - 1 ? `module-${i + 2}.html` : "../index.html",
      prevHref: i === 0 ? "../index.html" : `module-${i}.html`,
    });
    contentDir.file(fileName, html);
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}