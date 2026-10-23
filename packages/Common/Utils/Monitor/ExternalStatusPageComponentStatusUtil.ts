import { StatusPageSummaryStatus } from "../../Types/StatusPage/StatusPageSummary";

/*
 * THE STATUS OF A COMPONENT, AS AN EXTERNAL STATUS PAGE MONITOR REPORTS IT.
 *
 * The monitor's Component Status criteria compare a component's status with
 * one of a fixed list of values (CriteriaFilterUtil's dropdown, and the
 * default criteria that create an incident on an outage), and they compare
 * exactly. Atlassian Statuspage and incident.io report these values
 * themselves. A OneUptime status page names its statuses as its project
 * chose - Operational, Degraded, Offline, or names of its own - so its
 * provider reports each resource's status as the value it stands for, and
 * keeps the page's own name in the component's description.
 */
export enum ExternalStatusPageComponentStatusValue {
  Operational = "operational",
  UnderMaintenance = "under_maintenance",
  DegradedPerformance = "degraded_performance",
  PartialOutage = "partial_outage",
  MajorOutage = "major_outage",
  FullOutage = "full_outage",
  // The page does not show this component's status.
  Unknown = "unknown",
}

// Runs of anything but a letter or a digit, in a lower-cased name.
const NOT_A_LETTER_OR_DIGIT: RegExp = /[^a-z0-9]+/g;

// The names a project gives a status that mean its resource is under maintenance.
const MAINTENANCE_NAMES: ReadonlyArray<string> = [
  "maintenance",
  "under_maintenance",
  "in_maintenance",
  "scheduled_maintenance",
  "planned_maintenance",
];

/*
 * Names of an outage or a slowdown, by the value they stand for. A status
 * page's own names come first: Degraded and Offline are a project's
 * defaults.
 */
const NAMED_VALUES: ReadonlyArray<
  [ExternalStatusPageComponentStatusValue, ReadonlyArray<string>]
> = [
  [
    ExternalStatusPageComponentStatusValue.Operational,
    ["operational", "online", "up"],
  ],
  [
    ExternalStatusPageComponentStatusValue.DegradedPerformance,
    ["degraded", "degraded_performance", "degradation", "performance_issues"],
  ],
  [
    ExternalStatusPageComponentStatusValue.PartialOutage,
    ["partial_outage", "partial"],
  ],
  [
    ExternalStatusPageComponentStatusValue.MajorOutage,
    [
      "major_outage",
      "offline",
      "down",
      "outage",
      "unavailable",
      "unreachable",
      "critical",
    ],
  ],
  [ExternalStatusPageComponentStatusValue.FullOutage, ["full_outage"]],
];

export default class ExternalStatusPageComponentStatusUtil {
  /*
   * A status's name as the values above are written: lower case, with each
   * run of other characters one underscore - "Partial Outage" reads
   * "partial_outage". In time linear in the name.
   */
  public static normalizeName(name: string): string {
    let normalized: string = (name || "")
      .toLowerCase()
      .replace(NOT_A_LETTER_OR_DIGIT, "_");

    if (normalized.startsWith("_")) {
      normalized = normalized.slice(1);
    }

    if (normalized.endsWith("_")) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /*
   * The value a resource of a OneUptime status page reports:
   *
   *   - under maintenance while a scheduled maintenance event in progress
   *     affects it, whatever status its monitors are left in - a monitor is
   *     not checked while an event holds it;
   *   - unknown when the page does not show its status;
   *   - under maintenance for a status named for maintenance (a project's
   *     own "Maintenance", which events often change monitors to);
   *   - operational for the project's operational status;
   *   - the value a status's name stands for (Degraded, Offline, Major
   *     Outage ...);
   *   - and degraded performance for any other status: it is not
   *     operational, and nothing says how bad it is.
   */
  public static fromStatusPageStatus(data: {
    status: StatusPageSummaryStatus | null;
    isUnderMaintenance: boolean;
  }): ExternalStatusPageComponentStatusValue {
    if (data.isUnderMaintenance) {
      return ExternalStatusPageComponentStatusValue.UnderMaintenance;
    }

    if (!data.status) {
      return ExternalStatusPageComponentStatusValue.Unknown;
    }

    const name: string = ExternalStatusPageComponentStatusUtil.normalizeName(
      data.status.name,
    );

    if (MAINTENANCE_NAMES.includes(name)) {
      return ExternalStatusPageComponentStatusValue.UnderMaintenance;
    }

    if (data.status.isOperational) {
      return ExternalStatusPageComponentStatusValue.Operational;
    }

    for (const [value, names] of NAMED_VALUES) {
      if (names.includes(name)) {
        return value;
      }
    }

    return ExternalStatusPageComponentStatusValue.DegradedPerformance;
  }
}
