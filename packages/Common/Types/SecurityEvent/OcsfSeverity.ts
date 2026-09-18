/*
 * OCSF (Open Cybersecurity Schema Framework) severity levels.
 *
 * Security events are normalized to OCSF at ingest, whatever dialect they
 * arrived in (Google SecOps UDM, native OCSF, generic JSON). The severity a
 * row stores is always one of these names plus the matching numeric id —
 * writers must take both from this file or a row will say one thing in its
 * text and another in its number.
 *
 * https://schema.ocsf.io/ (severity_id on the base event class)
 */
enum OcsfSeverity {
  Unknown = "Unknown",
  Informational = "Informational",
  Low = "Low",
  Medium = "Medium",
  High = "High",
  Critical = "Critical",
  Fatal = "Fatal",
  Other = "Other",
}

export const OcsfSeverityId: Record<OcsfSeverity, number> = {
  [OcsfSeverity.Unknown]: 0,
  [OcsfSeverity.Informational]: 1,
  [OcsfSeverity.Low]: 2,
  [OcsfSeverity.Medium]: 3,
  [OcsfSeverity.High]: 4,
  [OcsfSeverity.Critical]: 5,
  [OcsfSeverity.Fatal]: 6,
  [OcsfSeverity.Other]: 99,
};

export function ocsfSeverityFromId(id: number): OcsfSeverity {
  const entries: Array<[string, number]> = Object.entries(OcsfSeverityId);

  for (const [name, value] of entries) {
    if (value === id) {
      return name as OcsfSeverity;
    }
  }

  return OcsfSeverity.Unknown;
}

/*
 * Loose severity text -> OCSF severity. Accepts the dialects we ingest:
 * UDM security_result severities (EMERGENCY/ALERT/CRITICAL/ERROR/HIGH/...),
 * syslog-style levels, and common vendor strings. Returns null for anything
 * unrecognised — callers decide the fallback, guessing here would silently
 * misgrade events.
 */
export function normalizeOcsfSeverity(text: string): OcsfSeverity | null {
  const normalized: string = (text || "").trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  const aliases: Record<string, OcsfSeverity> = {
    UNKNOWN: OcsfSeverity.Unknown,
    UNKNOWN_SEVERITY: OcsfSeverity.Unknown,
    NONE: OcsfSeverity.Informational,
    INFO: OcsfSeverity.Informational,
    INFORMATION: OcsfSeverity.Informational,
    INFORMATIONAL: OcsfSeverity.Informational,
    NOTICE: OcsfSeverity.Informational,
    DEBUG: OcsfSeverity.Informational,
    LOW: OcsfSeverity.Low,
    WARN: OcsfSeverity.Low,
    WARNING: OcsfSeverity.Low,
    MEDIUM: OcsfSeverity.Medium,
    MODERATE: OcsfSeverity.Medium,
    ERR: OcsfSeverity.Medium,
    ERROR: OcsfSeverity.Medium,
    HIGH: OcsfSeverity.High,
    SEVERE: OcsfSeverity.High,
    CRITICAL: OcsfSeverity.Critical,
    CRIT: OcsfSeverity.Critical,
    ALERT: OcsfSeverity.Critical,
    FATAL: OcsfSeverity.Fatal,
    EMERGENCY: OcsfSeverity.Fatal,
  };

  return aliases[normalized] || null;
}

export default OcsfSeverity;
