import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The values the case pages show straight from a record - a case's status,
 * priority and verdict, a detection's source, an entity's type, a playbook's
 * trigger and a run's status - registered for translation. Pill and the other
 * shared components look up the text they are handed, but the extractor only
 * finds literals, so these are listed here once, as the enums spell them.
 */
export const SECURITY_CASE_DISPLAY_TERMS: ReadonlyArray<string> = [
  // SecurityCaseStatus
  translationKey("New"),
  translationKey("Investigating"),
  translationKey("Contained"),
  translationKey("Closed"),
  // SecurityCasePriority
  translationKey("Critical"),
  translationKey("High"),
  translationKey("Medium"),
  translationKey("Low"),
  translationKey("Informational"),
  // SecurityCaseVerdict
  translationKey("True Positive"),
  translationKey("Benign Positive"),
  translationKey("False Positive"),
  translationKey("Undetermined"),
  // SecurityCaseAiVerdict: OneUptime AI's read of a case
  translationKey("Likely Malicious"),
  translationKey("Likely Benign"),
  translationKey("Likely False Positive"),
  translationKey("Inconclusive"),
  // SecurityDetectionSource
  translationKey("Detection Rule"),
  translationKey("Threat Intel"),
  translationKey("Connected Product"),
  translationKey("Manual"),
  // SecurityEntityType
  translationKey("User"),
  translationKey("Host"),
  translationKey("IP Address"),
  translationKey("Domain"),
  translationKey("URL"),
  translationKey("File Hash"),
  translationKey("Process"),
  translationKey("Other"),
  // SecurityPlaybookTrigger
  translationKey("Case Opened"),
  translationKey("Detection Added"),
  translationKey("Triaged as Likely Malicious"),
  // SecurityPlaybookRunStatus and SecurityPlaybookStepStatus
  translationKey("Queued"),
  translationKey("Running"),
  translationKey("Waiting for Approval"),
  translationKey("Succeeded"),
  translationKey("Failed"),
  translationKey("Cancelled"),
  translationKey("Pending"),
  translationKey("Skipped"),
  translationKey("Rejected"),
];
