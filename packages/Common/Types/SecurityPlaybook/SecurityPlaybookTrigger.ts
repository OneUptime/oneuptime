/*
 * When a playbook runs on its own.
 *
 *  - Case Opened: once, as a case is opened (whatever opened it).
 *  - Detection Added: each time a NEW detection joins a case that is
 *    already open. A detection that fires again only bumps its count and
 *    runs nothing, so a noisy rule cannot replay a playbook every minute.
 *  - Triaged as Likely Malicious: once per case, when OneUptime AI's triage
 *    reads the case as Likely Malicious (SecurityCaseTriageRunner) - never
 *    for a case whose data held text written to steer an AI, and never
 *    again for the same case when it is triaged again. Its containment
 *    steps still wait for approval, as every playbook's do.
 *  - Manual: never on its own; somebody runs it from a case.
 *
 * Every playbook can also be run by hand from a case, whatever its trigger.
 */
enum SecurityPlaybookTrigger {
  CaseOpened = "Case Opened",
  DetectionAdded = "Detection Added",
  TriagedAsLikelyMalicious = "Triaged as Likely Malicious",
  Manual = "Manual",
}

export const SECURITY_PLAYBOOK_TRIGGERS: ReadonlyArray<SecurityPlaybookTrigger> =
  [
    SecurityPlaybookTrigger.CaseOpened,
    SecurityPlaybookTrigger.DetectionAdded,
    SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    SecurityPlaybookTrigger.Manual,
  ];

/*
 * The triggers that run a playbook on its own, by what sets them off: the
 * ones OneUptime AI sets off are offered only while the project's AI is on
 * (a playbook already set to one keeps it, and simply waits).
 */
export const AI_SECURITY_PLAYBOOK_TRIGGERS: ReadonlyArray<SecurityPlaybookTrigger> =
  [SecurityPlaybookTrigger.TriagedAsLikelyMalicious];

export function isAiSecurityPlaybookTrigger(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (AI_SECURITY_PLAYBOOK_TRIGGERS as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityPlaybookTrigger(
  value: unknown,
): value is SecurityPlaybookTrigger {
  return (
    typeof value === "string" &&
    (SECURITY_PLAYBOOK_TRIGGERS as ReadonlyArray<string>).includes(value)
  );
}

export default SecurityPlaybookTrigger;
