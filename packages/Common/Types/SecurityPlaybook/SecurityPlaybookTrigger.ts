/*
 * When a playbook runs on its own.
 *
 *  - Case Opened: once, as a case is opened (whatever opened it).
 *  - Detection Added: each time a NEW detection joins a case that is
 *    already open. A detection that fires again only bumps its count and
 *    runs nothing, so a noisy rule cannot replay a playbook every minute.
 *  - Manual: never on its own; somebody runs it from a case.
 *
 * Every playbook can also be run by hand from a case, whatever its trigger.
 */
enum SecurityPlaybookTrigger {
  CaseOpened = "Case Opened",
  DetectionAdded = "Detection Added",
  Manual = "Manual",
}

export const SECURITY_PLAYBOOK_TRIGGERS: ReadonlyArray<SecurityPlaybookTrigger> =
  [
    SecurityPlaybookTrigger.CaseOpened,
    SecurityPlaybookTrigger.DetectionAdded,
    SecurityPlaybookTrigger.Manual,
  ];

export function isSecurityPlaybookTrigger(
  value: unknown,
): value is SecurityPlaybookTrigger {
  return (
    typeof value === "string" &&
    (SECURITY_PLAYBOOK_TRIGGERS as ReadonlyArray<string>).includes(value)
  );
}

export default SecurityPlaybookTrigger;
