export * from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";

/*
 * The words of a case's Response Plan: what to do about the case now -
 * confirm it, contain it, fix what let it happen, close it (#9557). The
 * words are shared with every reader of the plan - the server, OneUptime AI,
 * the mobile app - and kept beside it (Common/Utils/SecurityCase/
 * ResponsePlan/ResponsePlanWords, #10340), each an en.json key looked up
 * where it is drawn. The card's test ids are its own.
 */

export const SECURITY_CASE_RESPONSE_TEST_IDS: {
  card: string;
  progress: string;
  phase: string;
  step: string;
  stepText: string;
  checkbox: string;
  byHand: string;
  action: string;
  doneLine: string;
  readyToContain: string;
  aiVerdict: string;
  aiToggle: string;
  falsePositives: string;
  error: string;
} = {
  card: "security-case-response-plan",
  progress: "security-case-response-progress",
  phase: "security-case-response-phase",
  step: "security-case-response-step",
  stepText: "security-case-response-step-text",
  checkbox: "security-case-response-step-done",
  byHand: "security-case-response-step-by-hand",
  action: "security-case-response-step-action",
  doneLine: "security-case-response-step-done-line",
  readyToContain: "security-case-response-ready-to-contain",
  aiVerdict: "security-case-response-ai-verdict",
  aiToggle: "security-case-response-ai-toggle",
  falsePositives: "security-case-response-false-positives",
  error: "security-case-response-error",
};
