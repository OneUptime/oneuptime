import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_BACKEND_DOWN_FACT_PREFIX,
  OPENSTACK_CONTROL_PLANE_FACTS,
  OPENSTACK_DEPENDENCIES,
  OPENSTACK_DEPENDENCY_DEFINITIONS,
  OPENSTACK_GALERA_STATE_DONOR_DESYNCED,
  OPENSTACK_GALERA_STATE_SYNCED,
  OPENSTACK_KEYED_FACT_CURRENT_MINUTES,
  OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT,
  OPENSTACK_NETWORK_FACTS,
  OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT,
  OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING,
  OPENSTACK_RAFT_LEADER_FACT_PREFIX,
  OPENSTACK_RAFT_MEMBER_FACT_PREFIX,
  OPENSTACK_SERVER_DOWN_FACT_PREFIX,
  OpenStackDependency,
  getOpenStackDependencyOfRow,
  getOpenStackKeyedFacts,
  isOpenStackControlPlaneRowCurrent,
  isOpenStackDependencyDown,
} from "Common/Types/OpenStack/OpenStackControlPlane";
import { percentOf } from "Common/Types/OpenStack/OpenStackHealthRules";
import { OPENSTACK_SERVICE_STATUS_DOWN } from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  mergeResourceAttentionSeverity,
} from "../../../Components/ResourcePart/ResourceAttention";

/*
 * WHAT THE CLOUD STANDS ON, AND HOW IT IS.
 *
 * The rules for the Control Plane card, a dependency's page and Needs attention. They read
 * the rows OpenStackControlPlaneScan folds, and every line they draw is the alert templates'
 * (Common/Types/OpenStack/OpenStackControlPlane).
 *
 *   Critical: all of a cluster gone, or a machine's own thing gone from it: every RabbitMQ
 *     node, Galera with no Primary component, an HAProxy backend with no server left, an OVN
 *     database with no leader, a RabbitMQ node refusing messages, libvirt, Open vSwitch or
 *     ovn-controller gone from a host.
 *   Warning: one of several gone, a node that needs a look, or Memcached however much of it
 *     is gone, because that makes a cloud slow and stops nothing.
 *
 * Two things these never do:
 *
 *  - Say a dependency nobody named is fine. No row is "Not watched", and the card says so:
 *    a green tick on something nobody reads is the worst thing this page could say.
 *  - Say a row is fine because it was once. A row that has not been read for a while is
 *    "No reading", until the agent reads it again or it ages out.
 *
 * React-free (pages hand in routeFor), so tests can read it.
 */

export const OPENSTACK_KIND_CONTROL_PLANE: string =
  translationKey("Control plane");

const REASON_NOT_ANSWERING: string = translationKey("Not answering");
const REASON_EXPORTER_NOT_ANSWERING: string = translationKey(
  "Its exporter isn't answering, so this can't be read",
);
const REASON_EVERY_NODE_DOWN: string = translationKey("Every node is down");
const REASON_NO_PRIMARY: string = translationKey(
  "No node is in the Primary component, so none takes writes",
);
const REASON_NOT_PRIMARY: string = translationKey(
  "Not in the Primary component",
);
const REASON_MEMORY_ALARM: string = translationKey(
  "Memory alarm: it has stopped taking messages",
);
const REASON_DISK_ALARM: string = translationKey(
  "Disk alarm: it has stopped taking messages",
);
const REASON_FILE_DESCRIPTOR_ALARM: string = translationKey(
  "File descriptor alarm: it has stopped taking connections",
);
const REASON_FILE_DESCRIPTORS_HIGH: string = translationKey(
  "{{percent}} of file descriptors in use",
);
const REASON_UNACKNOWLEDGED: string = translationKey(
  "{{count}} messages unacknowledged",
);
const REASON_NOT_READY: string = translationKey("Not ready for queries");
const REASON_OUT_OF_SYNC: string = translationKey(
  "Out of sync with the cluster",
);
const REASON_CONNECTIONS_HIGH: string = translationKey(
  "{{percent}} of connections in use",
);
const REASON_BACKEND_DOWN: string = translationKey(
  "Backend {{backend}} has no server left",
);
const REASON_SERVER_DOWN: string = translationKey("Server {{server}} is down");
const REASON_OVS_GONE: string = translationKey(
  "Open vSwitch isn't answering",
);
const REASON_OVN_CONTROLLER_GONE: string = translationKey(
  "ovn-controller isn't answering",
);
const REASON_NO_LEADER: string = translationKey(
  "The {{database}} database has no leader",
);
const REASON_LIBVIRT_DOWN: string = translationKey("libvirt isn't answering");

export interface OpenStackControlPlaneAssessment {
  severity: ResourceAttentionSeverity | null;
  reasons: Array<ResourceAttentionText>;
}

function factsOf(row: OpenStackResource): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

function numberFact(row: OpenStackResource, fact: string): number | null {
  const value: unknown = factsOf(row)[fact];
  return typeof value === "number" ? value : null;
}

function isDown(row: OpenStackResource): boolean {
  return row.status === OPENSTACK_SERVICE_STATUS_DOWN;
}

// Whether a series that goes away with what it reports has gone, with the row still read.
function hasGoneFrom(row: OpenStackResource, fact: string): boolean {
  const value: unknown = factsOf(row)[fact];
  if (typeof value !== "string" || !row.lastSeenAt) {
    return false;
  }
  return (
    new Date(row.lastSeenAt).getTime() - new Date(value).getTime() >
    OPENSTACK_KEYED_FACT_CURRENT_MINUTES * 60000
  );
}

function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

/*
 * One machine, on its own. What only all of them together can say (a cluster gone, a backend
 * gone from every load balancer, a database with no leader) is getClusterFindings's.
 */
export function assessOpenStackControlPlaneRow(
  row: OpenStackResource,
): OpenStackControlPlaneAssessment {
  const dependency: OpenStackDependency | null =
    getOpenStackDependencyOfRow(row);
  const facts: JSONObject = factsOf(row);
  const severities: Array<ResourceAttentionSeverity> = [];
  const reasons: Array<ResourceAttentionText> = [];
  const critical: (reason: ResourceAttentionText) => void = (
    reason: ResourceAttentionText,
  ): void => {
    severities.push(ResourceAttentionSeverity.Critical);
    reasons.push(reason);
  };
  const warning: (reason: ResourceAttentionText) => void = (
    reason: ResourceAttentionText,
  ): void => {
    severities.push(ResourceAttentionSeverity.Warning);
    reasons.push(reason);
  };

  if (isDown(row)) {
    const scrapeFailed: boolean =
      facts[OPENSTACK_CONTROL_PLANE_FACTS.ScrapeFailed] === true;

    if (dependency === OpenStackDependency.Libvirt && !scrapeFailed) {
      critical({ text: REASON_LIBVIRT_DOWN });
    } else if (
      scrapeFailed &&
      (dependency === OpenStackDependency.MariaDb ||
        dependency === OpenStackDependency.Memcached ||
        dependency === OpenStackDependency.Network ||
        dependency === OpenStackDependency.Libvirt)
    ) {
      // These exporters sit beside what they report, so its failure says nothing of that.
      warning({ text: REASON_EXPORTER_NOT_ANSWERING });
    } else {
      warning({ text: REASON_NOT_ANSWERING });
    }

    return {
      severity: mergeResourceAttentionSeverity(severities),
      reasons,
    };
  }

  switch (dependency) {
    case OpenStackDependency.RabbitMq: {
      if (facts[OPENSTACK_CONTROL_PLANE_FACTS.MemoryAlarm] === true) {
        critical({ text: REASON_MEMORY_ALARM });
      }
      if (facts[OPENSTACK_CONTROL_PLANE_FACTS.DiskAlarm] === true) {
        critical({ text: REASON_DISK_ALARM });
      }
      if (facts[OPENSTACK_CONTROL_PLANE_FACTS.FileDescriptorAlarm] === true) {
        critical({ text: REASON_FILE_DESCRIPTOR_ALARM });
      }
      const descriptors: number | null = percentOf(
        numberFact(row, OPENSTACK_CONTROL_PLANE_FACTS.OpenFileDescriptors),
        numberFact(row, OPENSTACK_CONTROL_PLANE_FACTS.MaxFileDescriptors),
      );
      if (
        descriptors !== null &&
        descriptors > OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT
      ) {
        warning({
          text: REASON_FILE_DESCRIPTORS_HIGH,
          values: { percent: formatPercent(descriptors) },
        });
      }
      const unacknowledged: number | null = numberFact(
        row,
        OPENSTACK_CONTROL_PLANE_FACTS.MessagesUnacknowledged,
      );
      if (
        unacknowledged !== null &&
        unacknowledged > OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING
      ) {
        warning({
          text: REASON_UNACKNOWLEDGED,
          values: { count: `${unacknowledged}` },
        });
      }
      break;
    }
    case OpenStackDependency.MariaDb: {
      if (facts[OPENSTACK_CONTROL_PLANE_FACTS.ClusterPrimary] === false) {
        critical({ text: REASON_NOT_PRIMARY });
      }
      if (facts[OPENSTACK_CONTROL_PLANE_FACTS.Ready] === false) {
        warning({ text: REASON_NOT_READY });
      }
      const state: number | null = numberFact(
        row,
        OPENSTACK_CONTROL_PLANE_FACTS.LocalState,
      );
      const isDesyncedOnPurpose: boolean =
        facts[OPENSTACK_CONTROL_PLANE_FACTS.Desynced] === true &&
        state === OPENSTACK_GALERA_STATE_DONOR_DESYNCED;
      if (
        state !== null &&
        state !== OPENSTACK_GALERA_STATE_SYNCED &&
        !isDesyncedOnPurpose
      ) {
        warning({ text: REASON_OUT_OF_SYNC });
      }
      const connections: number | null = percentOf(
        numberFact(row, OPENSTACK_CONTROL_PLANE_FACTS.ThreadsConnected),
        numberFact(row, OPENSTACK_CONTROL_PLANE_FACTS.MaxConnections),
      );
      if (
        connections !== null &&
        connections > OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT
      ) {
        warning({
          text: REASON_CONNECTIONS_HIGH,
          values: { percent: formatPercent(connections) },
        });
      }
      break;
    }
    case OpenStackDependency.Network: {
      if (hasGoneFrom(row, OPENSTACK_NETWORK_FACTS.OvsSeenAt)) {
        critical({ text: REASON_OVS_GONE });
      }
      if (hasGoneFrom(row, OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt)) {
        critical({ text: REASON_OVN_CONTROLLER_GONE });
      }
      break;
    }
    default:
      break;
  }

  return { severity: mergeResourceAttentionSeverity(severities), reasons };
}

/*
 * What only all of a dependency's machines together can say, in one region. A backend one
 * load balancer calls down may only be that load balancer's view of it, so it has to be gone
 * from each that answers. A database has no leader when something reads a member of it, and
 * no member says it leads.
 */
export function getOpenStackDependencyFindings(data: {
  dependency: OpenStackDependency;
  rows: Array<OpenStackResource>;
}): Array<{
  severity: ResourceAttentionSeverity;
  reason: ResourceAttentionText;
}> {
  const { dependency, rows } = data;
  const findings: Array<{
    severity: ResourceAttentionSeverity;
    reason: ResourceAttentionText;
  }> = [];

  if (isOpenStackDependencyDown({ dependency, rows })) {
    findings.push({
      severity:
        dependency === OpenStackDependency.Memcached
          ? ResourceAttentionSeverity.Warning
          : ResourceAttentionSeverity.Critical,
      reason: {
        text: rows.every(isDown) ? REASON_EVERY_NODE_DOWN : REASON_NO_PRIMARY,
      },
    });
    return findings;
  }

  const answering: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return !isDown(row);
    },
  );

  if (dependency === OpenStackDependency.HaProxy && answering.length > 0) {
    const onEvery: (prefix: string) => Array<string> = (
      prefix: string,
    ): Array<string> => {
      const [first, ...others] = answering.map(
        (row: OpenStackResource): Array<string> => {
          return getOpenStackKeyedFacts(row, prefix);
        },
      );
      return (first || []).filter((name: string): boolean => {
        return others.every((names: Array<string>): boolean => {
          return names.includes(name);
        });
      });
    };

    const backends: Array<string> = onEvery(OPENSTACK_BACKEND_DOWN_FACT_PREFIX);
    for (const backend of backends) {
      findings.push({
        severity: ResourceAttentionSeverity.Critical,
        reason: { text: REASON_BACKEND_DOWN, values: { backend } },
      });
    }
    // A backend with no server says so once, and not again for each of its servers.
    for (const server of onEvery(OPENSTACK_SERVER_DOWN_FACT_PREFIX)) {
      if (
        !backends.some((backend: string): boolean => {
          return server.startsWith(`${backend}/`);
        })
      ) {
        findings.push({
          severity: ResourceAttentionSeverity.Warning,
          reason: { text: REASON_SERVER_DOWN, values: { server } },
        });
      }
    }
  }

  if (dependency === OpenStackDependency.Network) {
    const led: Set<string> = new Set<string>(
      answering.flatMap((row: OpenStackResource): Array<string> => {
        return getOpenStackKeyedFacts(row, OPENSTACK_RAFT_LEADER_FACT_PREFIX);
      }),
    );
    const databases: Set<string> = new Set<string>(
      answering.flatMap((row: OpenStackResource): Array<string> => {
        return getOpenStackKeyedFacts(row, OPENSTACK_RAFT_MEMBER_FACT_PREFIX);
      }),
    );
    for (const database of Array.from(databases).sort()) {
      if (!led.has(database)) {
        findings.push({
          severity: ResourceAttentionSeverity.Critical,
          reason: { text: REASON_NO_LEADER, values: { database } },
        });
      }
    }
  }

  return findings;
}

export type OpenStackDependencyState =
  | "Fine"
  | "NeedsALook"
  | "Broken"
  | "NotWatched"
  | "NoReading";

export interface OpenStackDependencySummary {
  dependency: OpenStackDependency;
  state: OpenStackDependencyState;
  // Everything read of it, whether or not it is current.
  rows: Array<OpenStackResource>;
  nodesUp: number;
  nodesCurrent: number;
  reasons: Array<ResourceAttentionText>;
}

function regionOf(row: OpenStackResource): string {
  return row.regionName || "";
}

function groupByRegion(
  rows: Array<OpenStackResource>,
): Map<string, Array<OpenStackResource>> {
  const byRegion: Map<string, Array<OpenStackResource>> = new Map();
  for (const row of rows) {
    byRegion.set(regionOf(row), [...(byRegion.get(regionOf(row)) || []), row]);
  }
  return byRegion;
}

function rowsOfDependency(
  rows: Array<OpenStackResource>,
  dependency: OpenStackDependency,
): Array<OpenStackResource> {
  return rows.filter((row: OpenStackResource): boolean => {
    return getOpenStackDependencyOfRow(row) === dependency;
  });
}

/*
 * One line per dependency, across whichever rows it is given: a page narrowed to a region
 * hands in that region's. A cluster's whole-or-part question is answered region by region,
 * because a RabbitMQ in one region says nothing of another's.
 */
export function getOpenStackDependencySummaries(data: {
  rows: Array<OpenStackResource>;
  now: Date;
}): Array<OpenStackDependencySummary> {
  return OPENSTACK_DEPENDENCIES.map(
    (dependency: OpenStackDependency): OpenStackDependencySummary => {
      const rows: Array<OpenStackResource> = rowsOfDependency(
        data.rows,
        dependency,
      );

      if (rows.length === 0) {
        return {
          dependency,
          state: "NotWatched",
          rows,
          nodesUp: 0,
          nodesCurrent: 0,
          reasons: [],
        };
      }

      const current: Array<OpenStackResource> = rows.filter(
        (row: OpenStackResource): boolean => {
          return isOpenStackControlPlaneRowCurrent({ row, now: data.now });
        },
      );

      if (current.length === 0) {
        return {
          dependency,
          state: "NoReading",
          rows,
          nodesUp: 0,
          nodesCurrent: 0,
          reasons: [],
        };
      }

      const severities: Array<ResourceAttentionSeverity> = [];
      const reasons: Array<ResourceAttentionText> = [];

      for (const regionRows of groupByRegion(current).values()) {
        const findings: Array<{
          severity: ResourceAttentionSeverity;
          reason: ResourceAttentionText;
        }> = getOpenStackDependencyFindings({ dependency, rows: regionRows });

        for (const finding of findings) {
          severities.push(finding.severity);
          reasons.push(finding.reason);
        }

        // A cluster that is gone has said all there is: no line per node as well.
        if (!isOpenStackDependencyDown({ dependency, rows: regionRows })) {
          for (const row of regionRows) {
            const own: OpenStackControlPlaneAssessment =
              assessOpenStackControlPlaneRow(row);
            if (own.severity) {
              severities.push(own.severity);
              reasons.push(...own.reasons);
            }
          }
        }
      }

      const severity: ResourceAttentionSeverity | null =
        mergeResourceAttentionSeverity(severities);

      return {
        dependency,
        state:
          severity === ResourceAttentionSeverity.Critical
            ? "Broken"
            : severity === ResourceAttentionSeverity.Warning
              ? "NeedsALook"
              : "Fine",
        rows,
        nodesUp: current.filter((row: OpenStackResource): boolean => {
          return !isDown(row);
        }).length,
        nodesCurrent: current.length,
        reasons,
      };
    },
  );
}

/*
 * Needs attention's lines: one for what a whole dependency says, then one per machine. What
 * the first says, the second does not repeat: a cluster that is gone is one line.
 */
export function getOpenStackControlPlaneAttentionItems(data: {
  rows: Array<OpenStackResource>;
  now: Date;
  routeFor?: ((row: OpenStackResource) => Route | undefined) | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];

  const current: Array<OpenStackResource> = data.rows.filter(
    (row: OpenStackResource): boolean => {
      return (
        getOpenStackDependencyOfRow(row) !== null &&
        isOpenStackControlPlaneRowCurrent({ row, now: data.now })
      );
    },
  );

  for (const [region, regionRows] of groupByRegion(current)) {
    for (const dependency of OPENSTACK_DEPENDENCIES) {
      const rows: Array<OpenStackResource> = rowsOfDependency(
        regionRows,
        dependency,
      );
      const first: OpenStackResource | undefined = rows[0];

      if (!first) {
        continue;
      }

      const title: string =
        OPENSTACK_DEPENDENCY_DEFINITIONS[dependency].title;
      const findings: Array<{
        severity: ResourceAttentionSeverity;
        reason: ResourceAttentionText;
      }> = getOpenStackDependencyFindings({ dependency, rows });

      if (findings.length > 0) {
        items.push({
          key: `control-plane/${region}/${dependency}`,
          kind: OPENSTACK_KIND_CONTROL_PLANE,
          icon: IconProp.Layers,
          name: title,
          detail: region || undefined,
          severity: mergeResourceAttentionSeverity(
            findings.map(
              (finding: {
                severity: ResourceAttentionSeverity;
              }): ResourceAttentionSeverity => {
                return finding.severity;
              },
            ),
          ) as ResourceAttentionSeverity,
          reasons: findings.map(
            (finding: {
              reason: ResourceAttentionText;
            }): ResourceAttentionText => {
              return finding.reason;
            },
          ),
          route: data.routeFor?.(first),
        });
      }

      if (isOpenStackDependencyDown({ dependency, rows })) {
        continue;
      }

      for (const row of rows) {
        const own: OpenStackControlPlaneAssessment =
          assessOpenStackControlPlaneRow(row);
        if (own.severity) {
          items.push({
            key: `${row.kind}/${row.externalId}`,
            kind: OPENSTACK_KIND_CONTROL_PLANE,
            icon: IconProp.Layers,
            name: title,
            detail: region ? `${row.name} · ${region}` : row.name || undefined,
            severity: own.severity,
            reasons: own.reasons,
            route: data.routeFor?.(row),
          });
        }
      }
    }
  }

  return items;
}
