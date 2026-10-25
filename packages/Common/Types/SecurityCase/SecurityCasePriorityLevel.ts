import OcsfSeverity from "../SecurityEvent/OcsfSeverity";

/*
 * THE FIVE LEVELS A DETECTION'S SEVERITY IS READ ON.
 *
 * A project's case priorities are its own (SecurityCasePriority: renamed,
 * recoloured, reordered, its own added), but what raises a case speaks a
 * fixed scale: a Sigma rule's level, a connected product's alert severity,
 * OCSF's severity. So every project keeps one priority for each of these
 * five levels - its built-in priorities, flagged as such - and a detection
 * opens its case at the priority that stands for its level, whatever the
 * project calls it. OneUptime AI's triage suggests a level too, and the
 * playbook templates name the levels they set.
 *
 * The names are OCSF's severity names, as a new project's priorities are
 * named: a case opened from a High detection reads High until the project
 * renames it.
 */
enum SecurityCasePriorityLevel {
  Critical = "Critical",
  High = "High",
  Medium = "Medium",
  Low = "Low",
  Informational = "Informational",
}

// Most urgent first: the order a new project's priorities are in.
export const SECURITY_CASE_PRIORITY_LEVELS: ReadonlyArray<SecurityCasePriorityLevel> =
  [
    SecurityCasePriorityLevel.Critical,
    SecurityCasePriorityLevel.High,
    SecurityCasePriorityLevel.Medium,
    SecurityCasePriorityLevel.Low,
    SecurityCasePriorityLevel.Informational,
  ];

/*
 * The column that marks a project's priority as the one for each level
 * (SecurityCasePriority.isCriticalPriority, ...): the meaning OneUptime
 * reads, never the name.
 */
export const SECURITY_CASE_PRIORITY_LEVEL_FLAGS: Readonly<
  Record<SecurityCasePriorityLevel, string>
> = {
  [SecurityCasePriorityLevel.Critical]: "isCriticalPriority",
  [SecurityCasePriorityLevel.High]: "isHighPriority",
  [SecurityCasePriorityLevel.Medium]: "isMediumPriority",
  [SecurityCasePriorityLevel.Low]: "isLowPriority",
  [SecurityCasePriorityLevel.Informational]: "isInformationalPriority",
};

export function isSecurityCasePriorityLevel(
  value: unknown,
): value is SecurityCasePriorityLevel {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_PRIORITY_LEVELS as ReadonlyArray<string>).includes(value)
  );
}

// The level a built-in flag stands for, or undefined for any other column.
export function getSecurityCasePriorityLevelOfFlag(
  flag: string | undefined | null,
): SecurityCasePriorityLevel | undefined {
  return SECURITY_CASE_PRIORITY_LEVELS.find(
    (level: SecurityCasePriorityLevel): boolean => {
      return SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level] === flag;
    },
  );
}

/*
 * The level a detection of this severity opens a case at. Fatal reads as
 * Critical (OCSF's own top two), and a severity the source did not state
 * (Unknown, Other) reads as Medium: a signal of unknown weight deserves a
 * look before it is filed with the informational noise.
 */
export function securityCasePriorityLevelFromSeverity(
  severity: OcsfSeverity | string | undefined | null,
): SecurityCasePriorityLevel {
  switch (severity) {
    case OcsfSeverity.Fatal:
    case OcsfSeverity.Critical:
      return SecurityCasePriorityLevel.Critical;
    case OcsfSeverity.High:
      return SecurityCasePriorityLevel.High;
    case OcsfSeverity.Low:
      return SecurityCasePriorityLevel.Low;
    case OcsfSeverity.Informational:
      return SecurityCasePriorityLevel.Informational;
    case OcsfSeverity.Medium:
    default:
      return SecurityCasePriorityLevel.Medium;
  }
}

export default SecurityCasePriorityLevel;
