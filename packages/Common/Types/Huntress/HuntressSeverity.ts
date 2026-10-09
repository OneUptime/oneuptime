/*
 * The three severities a Huntress incident report carries, as Huntress
 * writes them in its API and webhook payloads ("critical", "high", "low").
 *
 * Huntress defines them by what is at stake, not by a number:
 *   - critical: hands-on-keyboard activity, ransomware, active compromise.
 *     Immediate containment is required.
 *   - high: confirmed malware or identity compromise that needs urgent
 *     remediation but no isolation.
 *   - low: potentially unwanted programs, adware, historic findings.
 *
 * Shared by the server (which maps a report to an incident severity and
 * decides whether it pages on-call) and the dashboard (which shows them).
 */
enum HuntressSeverity {
  Critical = "critical",
  High = "high",
  Low = "low",
}

export default HuntressSeverity;

// Most severe first: the order every list of them is shown in.
export const AllHuntressSeverities: Array<HuntressSeverity> = [
  HuntressSeverity.Critical,
  HuntressSeverity.High,
  HuntressSeverity.Low,
];

/*
 * A report whose severity Huntress left out, or wrote as something it does
 * not document, is handled as High: it still opens an incident at the
 * severity the connection gives High reports, and it pages on-call under the
 * default setting. Treating an unreadable severity as Low would let a real
 * security incident through without anyone being woken up.
 */
export const HUNTRESS_SEVERITY_WHEN_UNKNOWN: HuntressSeverity =
  HuntressSeverity.High;

export function isHuntressSeverity(value: unknown): value is HuntressSeverity {
  return (
    typeof value === "string" &&
    (AllHuntressSeverities as Array<string>).includes(value)
  );
}

/*
 * The severity a payload names, case and white space aside, or null when it
 * names none Huntress documents.
 */
export function parseHuntressSeverity(value: unknown): HuntressSeverity | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  return isHuntressSeverity(normalized) ? normalized : null;
}

// Higher is more severe.
export function getHuntressSeverityRank(severity: HuntressSeverity): number {
  switch (severity) {
    case HuntressSeverity.Critical:
      return 3;
    case HuntressSeverity.High:
      return 2;
    case HuntressSeverity.Low:
      return 1;
  }
}

/*
 * Whether a report of `severity` is at or above `threshold` - how a
 * connection's "Page on-call for" setting is read: "high" pages for high and
 * critical reports, "low" for every report.
 */
export function isHuntressSeverityAtOrAbove(
  severity: HuntressSeverity,
  threshold: HuntressSeverity,
): boolean {
  return (
    getHuntressSeverityRank(severity) >= getHuntressSeverityRank(threshold)
  );
}

// The word Huntress shows for each severity, for text OneUptime writes.
export function getHuntressSeverityTitle(severity: HuntressSeverity): string {
  switch (severity) {
    case HuntressSeverity.Critical:
      return "Critical";
    case HuntressSeverity.High:
      return "High";
    case HuntressSeverity.Low:
      return "Low";
  }
}
