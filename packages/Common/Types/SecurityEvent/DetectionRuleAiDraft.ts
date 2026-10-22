/*
 * Drafting a detection rule with OneUptime AI (Security Events > Detection
 * Rules, Draft with AI): what the description it is written from may be.
 * The form and the server (DetectionRuleDraft) hold it to the same bounds,
 * so the form never sends what the server refuses.
 */

// A few words at least: "ssh brute force" is a rule; "ssh" is not.
export const DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH: number = 10;

// Two thousand characters: a paragraph, never a pasted log file.
export const DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH: number = 2000;

// Whether a description is one a rule can be drafted from.
export function isDetectionRuleDraftDescription(
  description: string | undefined | null,
): boolean {
  const text: string = (description || "").trim();

  return (
    text.length >= DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH &&
    text.length <= DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH
  );
}
