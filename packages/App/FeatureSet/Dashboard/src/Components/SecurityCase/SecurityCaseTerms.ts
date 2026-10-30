import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The values the case pages show straight from a record - a case's status,
 * priority and verdict, a detection's source, an entity's type, a playbook's
 * trigger and a run's status - registered for translation. Pill and the other
 * shared components look up the text they are handed, but the extractor only
 * finds literals, so these are listed here once, as the enums spell them.
 *
 * A case's priorities and statuses are the project's own: what a new project
 * starts with (DEFAULT_SECURITY_CASE_PRIORITIES and
 * DEFAULT_SECURITY_CASE_STATUSES) reads in the reader's language - its names
 * and descriptions, drawn on the pills, the status steps and the settings
 * pages - and a name the project gives one of its own reads as written.
 * The case pages' terms test (App/Tests/Dashboard/SecurityOperationsUi)
 * holds this list to those defaults.
 */
export const SECURITY_CASE_DISPLAY_TERMS: ReadonlyArray<string> = [
  // A new project's case statuses
  translationKey("New"),
  translationKey("Investigating"),
  translationKey("Contained"),
  translationKey("Closed"),
  translationKey("Nobody has looked at it yet."),
  translationKey("Someone is working out what happened."),
  translationKey(
    "The threat can no longer do harm; the cleanup is still to do.",
  ),
  translationKey("Done, with a verdict on what it was."),
  // A new project's case priorities
  translationKey("Critical"),
  translationKey("High"),
  translationKey("Medium"),
  translationKey("Low"),
  translationKey("Informational"),
  translationKey(
    "An active attack or a confirmed breach. Respond immediately.",
  ),
  translationKey("Likely malicious. Look into it as soon as you can."),
  translationKey("Suspicious, or of unknown weight. Look into it today."),
  translationKey("Unlikely to be harmful, but worth a look."),
  translationKey("For the record. Nothing needs to be done."),
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
  translationKey("Entity Risk"),
  translationKey("Data Security"),
  // SecurityEntityType
  translationKey("User"),
  translationKey("Host"),
  translationKey("IP Address"),
  translationKey("Domain"),
  translationKey("URL"),
  translationKey("File Hash"),
  translationKey("Process"),
  translationKey("Data Store"),
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
