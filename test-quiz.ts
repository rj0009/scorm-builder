import { autoGenerateQuiz } from "./server-lib/auto-quiz";
// Mirror the extractor logic locally
const text = "Hazards can be physical, chemical, or ergonomic. A physical hazard includes slips, trips, and falls. A chemical hazard means any substance that can cause harm. Ergonomic hazards refer to repetitive motion injuries.";

// Extract Title phrases
const phraseRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
const phrases1: string[] = [];
let m: RegExpExecArray | null;
while ((m = phraseRe.exec(text)) !== null) {
  phrases1.push(m[1]);
}
console.log("Title-case phrases:", phrases1);

// Extract definition candidates
const re2 = /\b([A-Z][a-zA-Z]+(?:\s+[a-z]+){0,4})\s+(is|are|means|refers to|can be|include|includes|describes?)\b/g;
const phrases2: string[] = [];
while ((m = re2.exec(text)) !== null) {
  phrases2.push(m[1]);
}
console.log("Definition candidates:", phrases2);
