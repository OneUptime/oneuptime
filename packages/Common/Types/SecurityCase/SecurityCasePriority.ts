import Color from "../Color";
import { Blue, Gray500, Orange, Red, Yellow } from "../BrandColors";
import OcsfSeverity from "../SecurityEvent/OcsfSeverity";

/*
 * How urgently a security case needs a person. A fixed scale rather than
 * per-project severities like incidents have: playbook conditions ("at
 * least High"), the queue's sort and the overview's counts all compare
 * priorities, and a scale every project shares is what lets them.
 *
 * The names are OCSF's severity names, so a case opened from a High
 * detection reads High without a translation table in anyone's head.
 */
enum SecurityCasePriority {
  Critical = "Critical",
  High = "High",
  Medium = "Medium",
  Low = "Low",
  Informational = "Informational",
}

// Higher is more urgent.
export const SECURITY_CASE_PRIORITY_RANK: Readonly<
  Record<SecurityCasePriority, number>
> = {
  [SecurityCasePriority.Critical]: 5,
  [SecurityCasePriority.High]: 4,
  [SecurityCasePriority.Medium]: 3,
  [SecurityCasePriority.Low]: 2,
  [SecurityCasePriority.Informational]: 1,
};

// Most urgent first, the order every list and picker shows them in.
export const SECURITY_CASE_PRIORITIES: ReadonlyArray<SecurityCasePriority> = [
  SecurityCasePriority.Critical,
  SecurityCasePriority.High,
  SecurityCasePriority.Medium,
  SecurityCasePriority.Low,
  SecurityCasePriority.Informational,
];

export function isSecurityCasePriority(
  value: unknown,
): value is SecurityCasePriority {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_PRIORITIES as ReadonlyArray<string>).includes(value)
  );
}

export function securityCasePriorityRank(
  priority: SecurityCasePriority | string | undefined | null,
): number {
  if (!isSecurityCasePriority(priority)) {
    return 0;
  }

  return SECURITY_CASE_PRIORITY_RANK[priority];
}

export function isPriorityAtLeast(
  priority: SecurityCasePriority | string | undefined | null,
  minimum: SecurityCasePriority | string | undefined | null,
): boolean {
  if (!isSecurityCasePriority(minimum)) {
    return true;
  }

  return (
    securityCasePriorityRank(priority) >= SECURITY_CASE_PRIORITY_RANK[minimum]
  );
}

export function higherSecurityCasePriority(
  a: SecurityCasePriority,
  b: SecurityCasePriority,
): SecurityCasePriority {
  return securityCasePriorityRank(b) > securityCasePriorityRank(a) ? b : a;
}

/*
 * The priority a detection of this severity opens a case at. Fatal reads as
 * Critical (OCSF's own top two), and a severity the source did not state
 * (Unknown, Other) reads as Medium: a signal of unknown weight deserves a
 * look before it is filed with the informational noise.
 */
export function securityCasePriorityFromSeverity(
  severity: OcsfSeverity | string | undefined | null,
): SecurityCasePriority {
  switch (severity) {
    case OcsfSeverity.Fatal:
    case OcsfSeverity.Critical:
      return SecurityCasePriority.Critical;
    case OcsfSeverity.High:
      return SecurityCasePriority.High;
    case OcsfSeverity.Low:
      return SecurityCasePriority.Low;
    case OcsfSeverity.Informational:
      return SecurityCasePriority.Informational;
    case OcsfSeverity.Medium:
    default:
      return SecurityCasePriority.Medium;
  }
}

// The same colors the events list gives the matching severities.
export function getSecurityCasePriorityColor(
  priority: SecurityCasePriority | string | undefined | null,
): Color {
  switch (priority) {
    case SecurityCasePriority.Critical:
      return Red;
    case SecurityCasePriority.High:
      return Orange;
    case SecurityCasePriority.Medium:
      return Yellow;
    case SecurityCasePriority.Low:
      return Blue;
    default:
      return Gray500;
  }
}

export default SecurityCasePriority;
