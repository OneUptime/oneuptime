import CephResource from "Common/Models/DatabaseModels/CephResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  CEPH_OSD_FULL_PERCENT,
  CEPH_OSD_NEARFULL_PERCENT,
  CephAssessment,
  CephOsdReadings,
  CephPoolReadings,
  assessCephCluster,
  assessCephPool,
  assessCephResource,
  getCephNewestSeenAt,
  getCephOsdReadings,
  getCephPoolReadings,
  getCephTopologyHealth,
} from "../../../Pages/Ceph/Utils/CephHealth";
import { ResourceAttentionText } from "../../ResourcePart/ResourceAttention";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
  sameName,
} from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";

/*
 * A Ceph cluster's topology: the hosts its daemons run on and, on each, its
 * OSDs, monitors, managers, metadata servers and object gateways; the
 * cluster's pools sit on the cluster itself.
 *
 * Health is the cluster's rules' (Pages/Ceph/Utils/CephHealth), the same the
 * Overview's Needs attention, the lists and an OSD's and a pool's page
 * read: an OSD down while still in the cluster is critical, one down and
 * out or up but out needs attention, as does one past Ceph's nearfull ratio
 * or 100 ms apply latency; a monitor out of quorum is critical; a pool past
 * 85% of its writable space needs attention, past 95% it is critical. A
 * manager, metadata server or gateway reads Reporting while Ceph lists it.
 * The cluster reads its own HEALTH_OK / WARN / ERR, and its raw capacity at
 * the Cluster Near Full and Full alerts' lines. A pool's placement groups
 * are read from its metrics, which the map does not read: its page and the
 * Pools list say them.
 */

export const CEPH_ROOT_ID: string = "cluster";

const DAEMON_KINDS: Record<string, string> = {
  Osd: "ceph.osd",
  Mon: "ceph.mon",
  Mgr: "ceph.mgr",
  Mds: "ceph.mds",
  Rgw: "ceph.rgw",
};

export interface CephTopologyInput {
  cluster: {
    id: string;
    name: string;
    lastSeenAt?: Date | null | undefined;
    /* 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR. */
    healthStatus?: number | null | undefined;
    capacityUsedPercent?: number | null | undefined;
  };
  rows: Array<CephResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

/*
 * A part's health, status and reasons by the cluster's rules. A
 * count-dependent reason reads its general form, with its count.
 */
function fromRules(
  assessment: CephAssessment,
  facts: Array<ResourceTopologyFact>,
): Assessment {
  return {
    health: getCephTopologyHealth(assessment),
    status: assessment.status.values
      ? text(assessment.status.label, assessment.status.values)
      : text(assessment.status.label),
    reasons: assessment.reasons.map(
      (reason: ResourceAttentionText): ResourceTopologyText => {
        if (reason.plural) {
          return text(reason.text, {
            ...(reason.values || {}),
            count: String(reason.plural.count),
          });
        }
        return reason.values
          ? text(reason.text, reason.values)
          : text(reason.text);
      },
    ),
    facts: facts,
  };
}

function osdFacts(row: CephResource, now: Date): Array<ResourceTopologyFact> {
  const facts: Array<ResourceTopologyFact> = [];
  const readings: CephOsdReadings = getCephOsdReadings(row, now);

  if (readings.usedPercent !== null) {
    // At the OSD Nearfull and Full alerts' lines, as the OSDs list colours it.
    facts.push({
      label: translationKey("Used"),
      value: formatTopologyPercent(readings.usedPercent),
      tone:
        readings.usedPercent > CEPH_OSD_FULL_PERCENT
          ? "critical"
          : readings.usedPercent > CEPH_OSD_NEARFULL_PERCENT
            ? "warning"
            : undefined,
    });
  }

  if (row.deviceClass) {
    facts.push({ label: translationKey("Class"), value: row.deviceClass });
  }

  return facts;
}

function poolFacts(row: CephResource, now: Date): Array<ResourceTopologyFact> {
  const readings: CephPoolReadings = getCephPoolReadings(row, now);
  return readings.storedBytes === null
    ? []
    : [
        {
          label: translationKey("Stored"),
          value: formatTopologyBytes(readings.storedBytes),
        },
      ];
}

export function buildCephTopology(
  input: CephTopologyInput,
): ResourceTopologyGraph {
  const clusterId: string = input.cluster.id;
  const newestSeenAt: Date | null = getCephNewestSeenAt(input.rows);
  const clusterAssessment: CephAssessment = assessCephCluster({
    healthStatus: toFiniteNumber(input.cluster.healthStatus),
    capacityUsedPercent: toFiniteNumber(input.cluster.capacityUsedPercent),
  });
  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: CEPH_ROOT_ID,
      parentId: null,
      kind: "ceph.cluster",
      name: input.cluster.name || "Ceph",
      ...fromRules(clusterAssessment, []),
      link: { page: PageMap.CEPH_CLUSTER_VIEW, modelId: clusterId },
    },
  ];

  const hostIds: Map<string, string> = new Map<string, string>();
  const ensureHost: (hostname: string | undefined) => string = (
    hostname: string | undefined,
  ): string => {
    if (!hostname) {
      return CEPH_ROOT_ID;
    }

    const key: string = hostname.toLowerCase();

    if (!hostIds.has(key)) {
      const id: string = `host:${key}`;
      hostIds.set(key, id);
      nodes.push({
        id: id,
        parentId: CEPH_ROOT_ID,
        kind: "ceph.host",
        name: hostname,
        health: "healthy",
      });
    }

    return hostIds.get(key)!;
  };

  const daemonIds: Map<string, string> = new Map<string, string>();
  const poolIds: Map<string, string> = new Map<string, string>();

  for (const row of input.rows) {
    if (!row.kind || !row.externalId) {
      continue;
    }

    const name: string = row.name || row.externalId;

    if (row.kind === "Pool") {
      const id: string = `pool:${row.externalId}`;
      const assessment: Assessment = fromRules(
        assessCephPool(row, { now: input.now, newestSeenAt: newestSeenAt }),
        poolFacts(row, input.now),
      );
      poolIds.set(name.toLowerCase(), id);
      poolIds.set(row.externalId.toLowerCase(), id);
      nodes.push({
        id: id,
        parentId: CEPH_ROOT_ID,
        kind: "ceph.pool",
        name: name,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        link: {
          page: PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL,
          modelId: clusterId,
          subModelId: row.externalId,
        },
      });
      continue;
    }

    const kind: string | undefined = DAEMON_KINDS[row.kind];

    if (!kind) {
      continue;
    }

    const id: string = `${row.kind.toLowerCase()}:${row.externalId}`;
    const rules: CephAssessment | null = assessCephResource(row, {
      now: input.now,
      newestSeenAt: newestSeenAt,
    });

    if (!rules) {
      continue;
    }

    const assessment: Assessment = fromRules(
      rules,
      row.kind === "Osd" ? osdFacts(row, input.now) : [],
    );
    daemonIds.set(name.toLowerCase(), id);
    nodes.push({
      id: id,
      parentId: ensureHost(row.hostname),
      kind: kind,
      name: name,
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: row.hostname || undefined,
      keywords: [row.daemonVersion || ""],
      link:
        row.kind === "Osd"
          ? {
              page: PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL,
              modelId: clusterId,
              subModelId: name,
            }
          : null,
    });
  }

  // ceph_daemon "osd.3", "mon.a"; pool or pool_id; osd.
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const daemon: string | null =
      readSeriesLabel(record.seriesLabels, "ceph_daemon") ||
      readSeriesLabel(record.seriesLabels, "osd");

    if (daemon) {
      const direct: string | undefined = daemonIds.get(daemon.toLowerCase());

      if (direct) {
        return direct;
      }

      const asOsd: string | undefined = daemonIds.get(
        `osd.${daemon}`.toLowerCase(),
      );

      if (asOsd) {
        return asOsd;
      }
    }

    const pool: string | null =
      readSeriesLabel(record.seriesLabels, "pool") ||
      readSeriesLabel(record.seriesLabels, "pool_id");

    if (pool && poolIds.has(pool.toLowerCase())) {
      return poolIds.get(pool.toLowerCase())!;
    }

    const host: string | null = readSeriesLabel(
      record.seriesLabels,
      "host.name",
    );

    if (host) {
      for (const [name, id] of hostIds) {
        if (sameName(name, host)) {
          return id;
        }
      }
    }

    return null;
  };

  return buildResourceTopologyGraph({
    rootId: CEPH_ROOT_ID,
    nodes: nodes,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: CEPH_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}
