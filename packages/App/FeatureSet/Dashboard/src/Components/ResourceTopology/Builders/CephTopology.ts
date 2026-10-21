import CephResource from "Common/Models/DatabaseModels/CephResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
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
  isRecent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";

/*
 * A Ceph cluster's topology: the hosts its daemons run on and, on each, its
 * OSDs, monitors, managers, metadata servers and object gateways; the
 * cluster's pools sit on the cluster itself.
 *
 * Health is Ceph's own: an OSD that is down while still in the cluster is
 * critical (its placement groups are degraded); one that is up but out, or
 * down and out, needs attention; a monitor out of quorum is critical. A pool
 * past Ceph's default nearfull ratio (85%) needs attention, past full (95%)
 * it is critical. The cluster reads its own HEALTH_OK / WARN / ERR.
 */

export const CEPH_ROOT_ID: string = "cluster";
export const CEPH_POOL_NEARFULL_PERCENT: number = 85;
export const CEPH_POOL_FULL_PERCENT: number = 95;
export const CEPH_STALE_MS: number = 15 * 60 * 1000;

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

function assessOsd(row: CephResource): Assessment {
  const facts: Array<ResourceTopologyFact> = [];
  const total: number | null = toFiniteNumber(row.statBytes);
  const used: number | null = toFiniteNumber(row.statBytesUsed);

  if (total !== null && used !== null && total > 0) {
    facts.push({
      label: translationKey("Used"),
      value: formatTopologyPercent((used / total) * 100),
    });
  }

  if (row.deviceClass) {
    facts.push({ label: translationKey("Class"), value: row.deviceClass });
  }

  if (row.isUp === false && row.isIn === true) {
    return {
      health: "critical",
      status: text(translationKey("Down")),
      reasons: [
        text(
          translationKey(
            "The OSD is down but still in the cluster: its data is degraded.",
          ),
        ),
      ],
      facts: facts,
    };
  }

  if (row.isUp === false) {
    return {
      health: "warning",
      status: text(translationKey("Down and out")),
      reasons: [],
      facts: facts,
    };
  }

  if (row.isUp === true && row.isIn === false) {
    return {
      health: "warning",
      status: text(translationKey("Out")),
      reasons: [text(translationKey("The OSD is up but holds no data (out)."))],
      facts: facts,
    };
  }

  return {
    health: row.isUp === true ? "healthy" : "unknown",
    status:
      row.isUp === true
        ? text(translationKey("Up and in"))
        : text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

function assessMon(row: CephResource): Assessment {
  if (row.inQuorum === false) {
    return {
      health: "critical",
      status: text(translationKey("Out of quorum")),
      reasons: [],
      facts: [],
    };
  }

  return {
    health: row.inQuorum === true ? "healthy" : "unknown",
    status:
      row.inQuorum === true
        ? text(translationKey("In quorum"))
        : text(translationKey("No data yet")),
    reasons: [],
    facts: [],
  };
}

function assessDaemon(row: CephResource): Assessment {
  if (row.isUp === false) {
    return {
      health: "critical",
      status: text(translationKey("Down")),
      reasons: [],
      facts: [],
    };
  }

  return {
    health: row.isUp === true ? "healthy" : "unknown",
    status:
      row.isUp === true
        ? text(translationKey("Up"))
        : text(translationKey("No data yet")),
    reasons: [],
    facts: [],
  };
}

function assessPool(row: CephResource, now: Date): Assessment {
  const fresh: boolean = isRecent(row.metricsUpdatedAt, now, CEPH_STALE_MS);
  const stored: number | null = fresh ? toFiniteNumber(row.storedBytes) : null;
  const available: number | null = fresh
    ? toFiniteNumber(row.maxAvailBytes)
    : null;

  if (stored === null || available === null || stored + available <= 0) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  const percent: number = (stored / (stored + available)) * 100;
  const health: ResourceTopologyHealth =
    percent >= CEPH_POOL_FULL_PERCENT
      ? "critical"
      : percent >= CEPH_POOL_NEARFULL_PERCENT
        ? "warning"
        : "healthy";

  return {
    health: health,
    status: text(translationKey("{{percent}} used"), {
      percent: formatTopologyPercent(percent, 1),
    }),
    reasons:
      health === "healthy"
        ? []
        : [
            text(translationKey("{{percent}} of the pool is used"), {
              percent: formatTopologyPercent(percent, 1),
            }),
          ],
    facts: [
      { label: translationKey("Stored"), value: formatTopologyBytes(stored) },
    ],
  };
}

export function buildCephTopology(
  input: CephTopologyInput,
): ResourceTopologyGraph {
  const clusterId: string = input.cluster.id;
  const status: number | null = toFiniteNumber(input.cluster.healthStatus);
  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: CEPH_ROOT_ID,
      parentId: null,
      kind: "ceph.cluster",
      name: input.cluster.name || "Ceph",
      health:
        status === 2
          ? "critical"
          : status === 1
            ? "warning"
            : status === 0
              ? "healthy"
              : "unknown",
      status:
        status === 2
          ? { text: "HEALTH_ERR" }
          : status === 1
            ? { text: "HEALTH_WARN" }
            : status === 0
              ? { text: "HEALTH_OK" }
              : text(translationKey("No data yet")),
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
      const assessment: Assessment = assessPool(row, input.now);
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
    const assessment: Assessment =
      row.kind === "Osd"
        ? assessOsd(row)
        : row.kind === "Mon"
          ? assessMon(row)
          : assessDaemon(row);
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
