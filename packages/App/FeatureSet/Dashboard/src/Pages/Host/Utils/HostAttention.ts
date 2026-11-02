import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  HostFinding,
  HostHealthAssessment,
  HostHealthRow,
  HostHealthSeverity,
  assessHost,
  compareHostsByUrgency,
  toHostDate,
} from "Common/Types/Host/HostHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../Components/ResourcePart/ResourceAttention";

/*
 * WHAT NEEDS ATTENTION ON A FLEET OF HOSTS, AND ON ONE HOST, AS ROWS.
 *
 * HostHealth (Common/Types/Host) decides what needs attention and how bad
 * it is; this turns its findings into the rows the shared Needs attention
 * card draws (Components/ResourcePart):
 *
 *   - on the Hosts list, one row per host that needs attention, the most
 *     urgent first, its reasons on one line ("/var 96% full", "Memory 93%
 *     used"), opening the host's page - and when it stopped reporting, when
 *     it last did;
 *   - on a host's page, one row per thing on it: the host itself ("This
 *     host": memory, swap, load, not reporting), each filesystem, its
 *     collector and each failed systemd unit, which opens the unit's page.
 *
 * React-free (no Route building: pages hand in the routes), so App tests can
 * read it.
 */

const KIND_HOST: string = translationKey("Host");
const KIND_FILESYSTEM: string = translationKey("Filesystem");
const KIND_COLLECTOR: string = translationKey("Collector");
const KIND_SYSTEMD_UNIT: string = translationKey("Systemd unit");

// How a host's page names its own row: NeedsAttentionCard's `current`.
export const HOST_ATTENTION_CURRENT: { key: string; label: string } = {
  key: "host",
  label: translationKey("This host"),
};

// A host as a list of hosts reads it: its rules' columns and its identity.
export interface HostAttentionRow extends HostHealthRow {
  _id?: string | { toString: () => string } | null | undefined;
  name?: string | null | undefined;
  hostIdentifier?: string | null | undefined;
}

function toSeverity(severity: HostHealthSeverity): ResourceAttentionSeverity {
  return severity === HostHealthSeverity.Critical
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
}

// The name people know the host by: its display name, else its host name.
export function getHostDisplayName(row: HostAttentionRow): string {
  return (row.name || row.hostIdentifier || "").trim();
}

function idOf(row: HostAttentionRow): string {
  return row._id ? row._id.toString() : "";
}

/*
 * Every host of the list that needs attention, the most urgent first (the
 * critical, then the ones with the most to look at, then by name).
 */
export function getHostFleetAttentionItems(data: {
  hosts: Array<HostAttentionRow>;
  now: Date;
  getHostRoute: (hostId: string) => Route | undefined;
}): Array<ResourceAttentionItem> {
  const assessed: Array<{
    row: HostAttentionRow;
    name: string;
    assessment: HostHealthAssessment;
  }> = [];

  for (const row of data.hosts) {
    const assessment: HostHealthAssessment = assessHost(row, {
      now: data.now,
    });
    if (!assessment.severity) {
      continue;
    }
    assessed.push({
      row: row,
      name: getHostDisplayName(row),
      assessment: assessment,
    });
  }

  assessed.sort(compareHostsByUrgency);

  return assessed.map(
    (entry: {
      row: HostAttentionRow;
      name: string;
      assessment: HostHealthAssessment;
    }): ResourceAttentionItem => {
      const hostId: string = idOf(entry.row);
      const identifier: string = (entry.row.hostIdentifier || "").trim();
      const lastSeenAt: Date | null = toHostDate(entry.row.lastSeenAt);

      return {
        key: hostId || identifier || entry.name,
        kind: KIND_HOST,
        icon: IconProp.Server,
        name: entry.name,
        // Its host name, where its display name is another.
        detail:
          identifier && identifier !== entry.name ? identifier : undefined,
        severity: toSeverity(entry.assessment.severity!),
        reasons: entry.assessment.fleetReasons,
        lastReportAt:
          entry.assessment.state === "not-reporting" && lastSeenAt
            ? lastSeenAt
            : undefined,
        route: hostId ? data.getHostRoute(hostId) : undefined,
      };
    },
  );
}

/*
 * What needs attention on one host, as its page lists it: its own row
 * first ("This host"), then its filesystems, its collector and its failed
 * units, each as urgent as HostHealth says. `collectorName` is what its
 * collector runs, as the Collector page names it.
 */
export function getHostOwnAttentionItems(data: {
  host: HostAttentionRow;
  now: Date;
  collectorName: string;
  getUnitRoute: (unitName: string) => Route | undefined;
  collectorRoute: Route | undefined;
}): Array<ResourceAttentionItem> {
  const assessment: HostHealthAssessment = assessHost(data.host, {
    now: data.now,
  });
  const lastSeenAt: Date | null = toHostDate(data.host.lastSeenAt);

  return assessment.findings.map(
    (finding: HostFinding): ResourceAttentionItem => {
      const severity: ResourceAttentionSeverity = toSeverity(finding.severity);

      switch (finding.part) {
        case "filesystem":
          return {
            key: finding.key,
            kind: KIND_FILESYSTEM,
            icon: IconProp.Database,
            name: finding.name || "",
            severity: severity,
            reasons: finding.reasons,
          };
        case "collector":
          return {
            key: finding.key,
            kind: KIND_COLLECTOR,
            icon: IconProp.Cube,
            name: data.collectorName,
            severity: severity,
            reasons: finding.reasons,
            route: data.collectorRoute,
          };
        case "systemd-unit":
          return {
            key: finding.key,
            kind: KIND_SYSTEMD_UNIT,
            icon: IconProp.Cog6Tooth,
            // A count without the units' names reads as the host's own row.
            name: finding.name || getHostDisplayName(data.host),
            severity: severity,
            reasons: finding.reasons,
            route: finding.name ? data.getUnitRoute(finding.name) : undefined,
          };
        default:
          return {
            key: HOST_ATTENTION_CURRENT.key,
            kind: KIND_HOST,
            icon: IconProp.Server,
            name: getHostDisplayName(data.host),
            severity: severity,
            reasons: finding.reasons,
            lastReportAt:
              assessment.state === "not-reporting" && lastSeenAt
                ? lastSeenAt
                : undefined,
          };
      }
    },
  );
}

/*
 * The Hosts list's card description when there were more hosts past a line
 * than one read holds: the rows are the most urgent.
 */
export const HOST_FLEET_ATTENTION_TRUNCATED_DESCRIPTION: string =
  translationKey(
    "What is broken or needs a look, the most urgent first. More hosts need attention than one read holds: these are the most urgent.",
  );
