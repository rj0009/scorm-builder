#!/usr/bin/env bun
// SCORM 1.2 conformance test — generates a sample package and validates the
// structural invariants against the SCORM 1.2 Content Packaging specification.
//
// Run with: bun run test:conformance

import JSZip from "jszip";
import { buildScormPackage } from "../server-lib/scorm-pkg";

const assert = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`✓ ${msg}`);
};

const sample = {
  courseTitle: "Conformance Test Course",
  courseDescription: "Auto-generated for SCORM 1.2 conformance validation.",
  passMark: 80,
  modules: [
    {
      id: "m1",
      title: "Module 1",
      contentHtml: "<p>Content one.</p>",
    },
    {
      id: "m2",
      title: "Module 2",
      contentHtml: "<p>Content two.</p>",
    },
  ],
  quizzes: [
    {
      moduleId: "m1",
      passingScore: 80,
      questions: [
        {
          id: "q1",
          prompt: "What is 2 + 2?",
          choices: ["3", "4", "5"],
          correctIndex: 1,
          explanation: "Basic arithmetic.",
        },
      ],
    },
  ],
};

async function main() {
  console.log("Generating sample SCORM 1.2 package…");
  const buf = await buildScormPackage(sample);
  assert(buf.length > 1024, `package size ${buf.length} bytes > 1KB`);

  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);

  // Required files
  assert(names.includes("imsmanifest.xml"), "imsmanifest.xml present at root");
  assert(names.includes("index.html"), "index.html launcher present");
  assert(names.includes("scorm_api_wrapper.js"), "scorm_api_wrapper.js present");
  assert(names.includes("scorm_runtime.js"), "scorm_runtime.js present");

  // imsmanifest.xml must be valid XML with the SCORM 1.2 namespace
  const manifestXml = await zip.file("imsmanifest.xml")!.async("string");
  assert(manifestXml.includes("version=\"1.2\""), "manifest version=1.2");
  assert(
    manifestXml.includes("xmlns=\"http://www.imsproject.org/xsd/imscp_rootv1p1p2\""),
    "manifest declares imscp namespace",
  );
  assert(
    manifestXml.includes("xmlns:adlcp=\"http://www.adlnet.org/xsd/adlcp_rootv1p2\""),
    "manifest declares adlcp namespace",
  );
  assert(manifestXml.includes("<schemaversion>1.2</schemaversion>"), "schemaversion=1.2");
  assert(manifestXml.includes("adlcp:scormtype=\"sco\""), "resources are SCO type");

  // Per-module files
  assert(names.includes("content/module-1.html"), "content/module-1.html present");
  assert(names.includes("content/module-2.html"), "content/module-2.html present");

  // Module-1 HTML must contain the quiz, module-2 must not
  const m1Html = await zip.file("content/module-1.html")!.async("string");
  const m2Html = await zip.file("content/module-2.html")!.async("string");
  assert(m1Html.includes("Knowledge check"), "module-1 has quiz");
  assert(!m2Html.includes("Knowledge check"), "module-2 has no quiz");
  assert(m1Html.includes("../scorm_api_wrapper.js"), "module-1 uses relative script path");
  assert(
    m1Html.includes("SCORM_API.init"),
    "module-1 calls SCORM 1.2 API wrapper",
  );
  // The LMSInitialize function lives in scorm_api_wrapper.js, not in module-1.html itself.
  const apiWrapper = await zip.file("scorm_api_wrapper.js")!.async("string");
  assert(
    apiWrapper.includes("LMSInitialize") &&
      apiWrapper.includes("LMSCommit") &&
      apiWrapper.includes("LMSFinish") &&
      apiWrapper.includes("LMSSetValue") &&
      apiWrapper.includes("LMSGetValue"),
    "scorm_api_wrapper.js implements LMSInitialize/Commit/Finish/SetValue/GetValue",
  );

  // Launcher links to all modules
  const launcher = await zip.file("index.html")!.async("string");
  assert(
    launcher.includes("content/module-1.html") && launcher.includes("content/module-2.html"),
    "launcher links to all modules",
  );

  console.log("\n✓ All SCORM 1.2 conformance checks passed");
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
