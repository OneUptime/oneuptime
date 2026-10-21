import SecurityCasePriority, {
  SECURITY_CASE_PRIORITY_RANK,
  isSecurityCasePriority,
  securityCasePriorityRank,
} from "./SecurityCasePriority";

/*
 * THE PRIORITY A PERSON HEARS ABOUT NEW SECURITY CASES AT.
 *
 * Everyone who can see a project's security cases is told about a case that
 * opens, or rises, at the priority they chose on their New Security Case
 * setting (UserNotificationSetting.minimumSecurityCasePriority) or above.
 * Nobody has to choose: an empty choice is High, so a project that only
 * turned Security on hears about its High and Critical cases, and the
 * Medium, Low and Informational ones wait in the queue.
 *
 * A case is told about once per person: the case keeps the highest priority
 * people were told about it at (SecurityCase.notifiedPriority), and a rise is
 * news only to the people whose chosen priority it reaches for the first
 * time. A Medium case that rises to Critical reaches the people who chose
 * High or Critical; the people who chose Medium heard about it when it
 * opened.
 */
export const DEFAULT_SECURITY_CASE_NOTIFICATION_PRIORITY: SecurityCasePriority =
  SecurityCasePriority.High;

// A person's choice as stored: empty, or anything that is not a priority, is the default.
export function readSecurityCaseNotificationPriority(
  value: unknown,
): SecurityCasePriority {
  return isSecurityCasePriority(value)
    ? value
    : DEFAULT_SECURITY_CASE_NOTIFICATION_PRIORITY;
}

/*
 * Whether a case now at `priority`, last told about at `notifiedPriority`
 * (nothing yet: undefined), is news to a person who chose `minimum`: it
 * reaches their priority now, and did not when people were last told.
 */
export function reachesNotificationPriorityNow(data: {
  priority: SecurityCasePriority | string | undefined | null;
  notifiedPriority: SecurityCasePriority | string | undefined | null;
  minimum: SecurityCasePriority;
}): boolean {
  const minimumRank: number = SECURITY_CASE_PRIORITY_RANK[data.minimum];

  return (
    securityCasePriorityRank(data.priority) >= minimumRank &&
    securityCasePriorityRank(data.notifiedPriority) < minimumRank
  );
}

/*
 * The choices a person picks from, as the setting reads them: each is the
 * lowest priority that notifies.
 */
export const SECURITY_CASE_NOTIFICATION_PRIORITY_CHOICES: ReadonlyArray<{
  priority: SecurityCasePriority;
  label: string;
}> = [
  { priority: SecurityCasePriority.Critical, label: "Critical only" },
  { priority: SecurityCasePriority.High, label: "High and Critical" },
  { priority: SecurityCasePriority.Medium, label: "Medium and above" },
  { priority: SecurityCasePriority.Low, label: "Low and above" },
  { priority: SecurityCasePriority.Informational, label: "Every case" },
];
