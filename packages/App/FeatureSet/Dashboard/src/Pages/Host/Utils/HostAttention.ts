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
import {
  SYSTEMD_FAILED_UNITS_LISTED,
  SystemdUnitFailure,
  SystemdUnitJournalLine,
  getSystemdUnitFailureItem,
  groupSystemdJournalLinesByUnit,
  readSystemdUnitFailure,
} from "./SystemdUnitFailure";

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
 *     collector and each failed systemd unit, which opens the unit's page -
 *     and says why it failed, as systemd said it, once its journal is read
 *     (#10129).
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
 * The failed units a host's record names, as one read of their journal
 * asks for them (#10129): each once, by name, at most as many as the
 * Systemd Units list's count opens. Any more keep their rows as they are.
 */
export function getHostFailedUnitNames(host: HostAttentionRow): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const name of host.failedSystemdUnits || []) {
    if (typeof name === "string" && name.trim()) {
      names.add(name.trim());
    }
  }

  return Array.from(names)
    .sort((a: string, b: string): number => {
      return a.localeCompare(b);
    })
    .slice(0, SYSTEMD_FAILED_UNITS_LISTED);
}

/*
 * A failed unit's row, with why it failed when its journal says (#10129):
 * the reason in a chip ("Exited with code 1"), since when, and systemd's
 * own words - and, for a dialog that answers "what failed?", systemd's
 * result and exit status and the lines it wrote about the unit, as the
 * Systemd Units list's dialog lists them. It keeps the row's urgency, name
 * and page: the host's Needs attention and its health say the same. A unit
 * whose journal says nothing of why keeps its row as it was.
 */
function withUnitFailure(data: {
  row: ResourceAttentionItem;
  unitName: string;
  lines: ReadonlyArray<SystemdUnitJournalLine>;
  isDetailed: boolean;
}): ResourceAttentionItem {
  const failure: SystemdUnitFailure | null = readSystemdUnitFailure(data.lines);

  if (!failure) {
    return data.row;
  }

  const failed: ResourceAttentionItem = getSystemdUnitFailureItem({
    unitName: data.unitName,
    failure: failure,
    lines: data.lines,
    key: data.row.key,
    route: data.row.route,
  });

  return {
    ...data.row,
    reasons: failed.reasons,
    message: failed.message,
    since: failed.since,
    ...(data.isDetailed ? { facts: failed.facts, events: failed.events } : {}),
  };
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
  /*
   * What systemd said of why the host's failed units failed (#10129): the
   * lines one read of their journal returned (readSystemdFailedUnitsJournal).
   * Not read yet, or not readable: every unit's row says Failed.
   */
  unitJournal?: ReadonlyArray<SystemdUnitJournalLine> | null | undefined;
  /*
   * The list is a dialog's, which answers "what failed?" (the host's
   * Degraded): a failed unit's row lists systemd's result and exit status
   * and its lines too. The Needs attention card's rows leave them out.
   */
  isDetailed?: boolean | undefined;
}): Array<ResourceAttentionItem> {
  const assessment: HostHealthAssessment = assessHost(data.host, {
    now: data.now,
  });
  const lastSeenAt: Date | null = toHostDate(data.host.lastSeenAt);
  const linesByUnit: Map<string, Array<SystemdUnitJournalLine>> | null =
    data.unitJournal ? groupSystemdJournalLinesByUnit(data.unitJournal) : null;

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
        case "systemd-unit": {
          const row: ResourceAttentionItem = {
            key: finding.key,
            kind: KIND_SYSTEMD_UNIT,
            icon: IconProp.Cog6Tooth,
            // A count without the units' names reads as the host's own row.
            name: finding.name || getHostDisplayName(data.host),
            severity: severity,
            reasons: finding.reasons,
            route: finding.name ? data.getUnitRoute(finding.name) : undefined,
          };

          return finding.name && linesByUnit
            ? withUnitFailure({
                row: row,
                unitName: finding.name,
                lines: linesByUnit.get(finding.name) || [],
                isDetailed: Boolean(data.isDetailed),
              })
            : row;
        }
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
