/*
 * Offline fixture for a Ceph cluster's pages: the production cluster layout
 * (ModelPage, the cluster's side menu) with its Overview (its health and
 * Needs attention by the cluster's rules, Pages/Ceph/Utils/CephHealth), its
 * OSDs, Pools and Daemons lists, and an OSD's and a pool's own page - under
 * their real RouteMap patterns. Only the data boundary (ModelAPI,
 * AnalyticsModelAPI, API, Realtime) and the signed-in user are replaced.
 * Every record is fabricated for an "Acme Storage" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?cluster=   trouble (default): Ceph says HEALTH_ERR; an OSD is down but
 *               still in, one is past the full ratio, one past nearfull, one
 *               writes slowly, one is drained out; a monitor is out of
 *               quorum; a pool is nearly full and another has degraded
 *               placement groups; a metadata server stopped reporting |
 *               calm: HEALTH_OK, every part fine
 *   ?collector= disconnected: the cluster's agent stopped reporting three
 *               days ago
 *   ?fail=      inventory: every inventory read fails
 *   ?lang=      de reads the German locale file, fa the Persian one (right
 *               to left)
 *   ?theme=     dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__cephPagesFixture: listRequests,
 * itemRequests, aggregateRequests, apiRequests and unhandled - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import CephLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Layout";
import CephOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import CephOsds from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Osds";
import CephOsdDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/OsdDetail";
import CephPools from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Pools";
import CephPoolDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import CephDaemons from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Daemons";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "Common/Utils/ArchivableValues";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const CALM = params.get("cluster") === "calm";
const DISCONNECTED = params.get("collector") === "disconnected";
const INVENTORY_FAILS = params.get("fail") === "inventory";

// A Persian page reads right to left, as production lays it out.
if (params.get("dir") === "rtl" || LANGUAGE === "fa") {
  document.documentElement.dir = "rtl";
}
document.documentElement.lang = LANGUAGE;

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * Ids, the clock and the cluster
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();
const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * GIB;

const CLUSTER_ID = uuid("38000000", 1);

const CEPH_VERSION =
  "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)";

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Storage",
});

// When the agent's last report reached OneUptime.
const LAST_REPORT = new Date(
  LOADED_AT - (DISCONNECTED ? 3 * 24 * 60 * MINUTE : 20 * 1000),
);

const cluster = {
  _id: CLUSTER_ID,
  name: "ceph-prod",
  description: "The block and file storage behind the shop, in Frankfurt.",
  fsid: "3b0c1f7e-5c1d-4a8e-9f6b-2d7e4c8a1b90",
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: LAST_REPORT,
  // As ceph_mon_metadata's ceph_version label writes it.
  cephVersion: CEPH_VERSION,
  agentVersion: "14.0.101",
  healthStatus: CALM ? 0 : 2,
  monCount: 3,
  osdCount: 12,
  osdUpCount: CALM ? 12 : 11,
  osdInCount: CALM ? 12 : 11,
  poolCount: 5,
  capacityUsedPercent: CALM ? 41.8 : 62.4,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 90 * 24 * 60 * MINUTE),
};

const HOSTS = ["ceph-a", "ceph-b", "ceph-c"];

/*
 * Each OSD: its host, how full it is, how fast it writes, and whether it
 * runs and holds data. The trouble cluster's: osd.3 down but still in,
 * osd.5 past the full ratio, osd.9 past nearfull, osd.10 slow, osd.7
 * drained out.
 */
function osdSpec(id) {
  const base = {
    id: id,
    host: HOSTS[Math.floor(id / 4)],
    deviceClass: id % 4 === 3 ? "hdd" : "ssd",
    sizeTib: id % 4 === 3 ? 8 : 3.84,
    usedPercent: 38 + ((id * 7) % 23),
    applyMs: 3 + (id % 5),
    commitMs: 4 + (id % 5),
    pgs: 96 + (id % 6) * 4,
    isUp: true,
    isIn: true,
  };
  if (CALM) {
    return base;
  }
  if (id === 3) {
    return { ...base, isUp: false, isIn: true };
  }
  if (id === 5) {
    return { ...base, usedPercent: 96.2 };
  }
  if (id === 9) {
    return { ...base, usedPercent: 88.4 };
  }
  if (id === 10) {
    return { ...base, applyMs: 182, commitMs: 197 };
  }
  if (id === 7) {
    return { ...base, isIn: false, usedPercent: 2.1, pgs: 0 };
  }
  return base;
}

const OSDS = Array.from({ length: 12 }, (_value, id) => {
  return osdSpec(id);
});

const reportedAt = new Date(LAST_REPORT.getTime() - 10 * 1000);

function inventoryRow(number, fields) {
  return {
    _id: uuid("47000000", number),
    cephClusterId: CLUSTER_ID,
    lastSeenAt: reportedAt,
    metricsUpdatedAt: reportedAt,
    createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
    ...fields,
  };
}

let rowNumber = 0;
const inventory = [];

for (const osd of OSDS) {
  rowNumber++;
  inventory.push(
    inventoryRow(rowNumber, {
      kind: "Osd",
      externalId: `osd.${osd.id}`,
      name: `osd.${osd.id}`,
      hostname: osd.host,
      deviceClass: osd.deviceClass,
      daemonVersion: CEPH_VERSION,
      isUp: osd.isUp,
      isIn: osd.isIn,
      statBytes: Math.round(osd.sizeTib * TIB),
      statBytesUsed: Math.round((osd.usedPercent / 100) * osd.sizeTib * TIB),
      applyLatencyMs: osd.applyMs,
      commitLatencyMs: osd.commitMs,
      pgCount: osd.pgs,
    }),
  );
}

for (const [index, host] of HOSTS.entries()) {
  rowNumber++;
  inventory.push(
    inventoryRow(rowNumber, {
      kind: "Mon",
      externalId: `mon.${host}`,
      name: `mon.${host}`,
      hostname: host,
      daemonVersion: CEPH_VERSION,
      inQuorum: CALM || index !== 2,
    }),
  );
}

const DAEMONS = [
  { kind: "Mgr", name: "mgr.ceph-a.wlkzpq", host: "ceph-a" },
  { kind: "Mgr", name: "mgr.ceph-b.xrtvbn", host: "ceph-b" },
  { kind: "Mds", name: "mds.cephfs.ceph-a.hjqzrd", host: "ceph-a" },
  // The trouble cluster's standby MDS: Ceph stopped listing it 9 minutes ago.
  {
    kind: "Mds",
    name: "mds.cephfs.ceph-c.pmvkye",
    host: "ceph-c",
    silentMinutes: CALM ? 0 : 9,
  },
  { kind: "Rgw", name: "rgw.objects.ceph-b.uqnmtx", host: "ceph-b" },
];

for (const daemon of DAEMONS) {
  rowNumber++;
  const seenAt = new Date(
    reportedAt.getTime() - (daemon.silentMinutes || 0) * MINUTE,
  );
  inventory.push(
    inventoryRow(rowNumber, {
      kind: daemon.kind,
      externalId: daemon.name,
      name: daemon.name,
      hostname: daemon.host,
      daemonVersion: CEPH_VERSION,
      lastSeenAt: seenAt,
      metricsUpdatedAt: seenAt,
    }),
  );
}

/*
 * The pools: what each stores and how much more it can take, its objects
 * and its placement groups (total, active, clean, degraded, undersized).
 */
const POOLS = [
  {
    id: "1",
    name: ".mgr",
    storedGib: 0.4,
    availGib: 9400,
    objects: 12,
    pgs: [1, 1, 1, 0, 0],
  },
  {
    id: "2",
    name: "rbd",
    storedGib: 4210,
    availGib: 7620,
    objects: 1081344,
    pgs: CALM ? [256, 256, 256, 0, 0] : [256, 256, 244, 12, 0],
  },
  {
    id: "3",
    name: "cephfs_data",
    storedGib: CALM ? 2100 : 3080,
    availGib: CALM ? 6100 : 95,
    objects: 2895002,
    pgs: [128, 128, 128, 0, 0],
  },
  {
    id: "4",
    name: "cephfs_metadata",
    storedGib: 1.8,
    availGib: 9400,
    objects: 48211,
    pgs: [32, 32, 32, 0, 0],
  },
  {
    id: "5",
    name: "default.rgw.buckets.data.archive-eu-central",
    storedGib: 820,
    availGib: 9400,
    objects: 431980,
    pgs: [64, 64, 64, 0, 0],
  },
];

for (const pool of POOLS) {
  rowNumber++;
  inventory.push(
    inventoryRow(rowNumber, {
      kind: "Pool",
      externalId: pool.id,
      name: pool.name,
      storedBytes: Math.round(pool.storedGib * GIB),
      maxAvailBytes: Math.round(pool.availGib * GIB),
      objects: pool.objects,
    }),
  );
}

// The checks Ceph raised: each one's newest reading, 1 while raised.
const HEALTH_CHECKS = CALM
  ? [{ name: "OSD_DOWN", severity: "HEALTH_WARN", value: 0 }]
  : [
      { name: "OSD_FULL", severity: "HEALTH_ERR", value: 1 },
      { name: "OSD_DOWN", severity: "HEALTH_WARN", value: 1 },
      { name: "OSD_NEARFULL", severity: "HEALTH_WARN", value: 1 },
      { name: "MON_DOWN", severity: "HEALTH_WARN", value: 1 },
      { name: "PG_DEGRADED", severity: "HEALTH_WARN", value: 1 },
      // Cleared since: its newest reading is 0.
      { name: "RECENT_CRASH", severity: "HEALTH_WARN", value: 0 },
    ];

// What the trouble cluster raised: an alert on osd.3, an incident on rbd.
const openAlerts = CALM
  ? []
  : [
      {
        _id: uuid("61000000", 1),
        title: "[Ceph] OSD Down (osd.3) - ceph-prod",
        alertNumber: 41,
        createdAt: new Date(LOADED_AT - 14 * MINUTE),
        currentAlertStateId: uuid("51000000", 1),
        cephClusters: CLUSTER_ID,
        seriesLabels: { ceph_daemon: "osd.3" },
      },
    ];

const openIncidents = CALM
  ? []
  : [
      {
        _id: uuid("62000000", 1),
        title: "[Ceph] Degraded Placement Groups - ceph-prod",
        incidentNumber: 17,
        createdAt: new Date(LOADED_AT - 12 * MINUTE),
        declaredAt: new Date(LOADED_AT - 12 * MINUTE),
        currentIncidentStateId: uuid("50000000", 1),
        cephClusters: CLUSTER_ID,
        seriesLabels: { pool_id: "2" },
      },
    ];

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__cephPagesFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function plain(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

// A query's plain values and its Includes must match, as the server would.
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      if (!allowed.has(String(plain(record[field])))) {
        return false;
      }
      continue;
    }
    const value = plain(wanted);
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      continue;
    }
    if (String(record[field] ?? "") !== String(value)) {
      return false;
    }
  }
  return true;
}

const store = {
  CephCluster: [cluster],
  CephResource: inventory,
  IncidentState: [
    { _id: uuid("50000000", 1), name: "Identified", order: 1 },
    {
      _id: uuid("50000000", 2),
      name: "Resolved",
      order: 2,
      isResolvedState: true,
    },
  ],
  AlertState: [
    { _id: uuid("51000000", 1), name: "Created", order: 1 },
    {
      _id: uuid("51000000", 2),
      name: "Resolved",
      order: 2,
      isResolvedState: true,
    },
  ],
  ScheduledMaintenanceState: [
    { _id: uuid("54000000", 1), name: "Scheduled", order: 1 },
    {
      _id: uuid("54000000", 2),
      name: "Completed",
      order: 2,
      isResolvedState: true,
      isEndedState: true,
    },
  ],
  Incident: openIncidents,
  Alert: openAlerts,
  ScheduledMaintenance: [],
  // The part alerts cards read which monitors exist: none yet.
  Monitor: [],
  // The golden charts read the metrics' units: none recorded yet.
  MetricType: [],
  RecommendationDismissal: [],
  Label: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: by each sort field, in turn.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const a = String(left[field] ?? "");
      const b = String(right[field] ?? "");
      if (a !== b) {
        const ascending = a < b ? -1 : 1;
        return String(order).toLowerCase().startsWith("desc")
          ? -ascending
          : ascending;
      }
    }
    return 0;
  });
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return sortRecords(
    store[name].filter((record) => {
      return matches(record, query);
    }),
    sort,
  ).map((record) => {
    return Object.assign(new modelType(), record);
  });
}

UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-storage.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    limit: options.limit,
  });

  if (modelName === "CephResource" && INVENTORY_FAILS) {
    throw new Error("The inventory could not be read.");
  }

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.itemRequests.push({ modelName, id });

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const record = store[modelName].find((candidate) => {
    return candidate._id === id;
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

// The golden charts' raw-point reads, beside their aggregates.
const CHART_RAW_READS = new Set([
  "ceph_cluster_total_used_bytes",
  "ceph_osd_apply_latency_ms",
  "ceph_osd_commit_latency_ms",
]);

// One newest reading per pool for a placement-group state, by its position.
const PG_STATES = {
  ceph_pg_total: 0,
  ceph_pg_active: 1,
  ceph_pg_clean: 2,
  ceph_pg_degraded: 3,
  ceph_pg_undersized: 4,
};

function metricRow(modelType, value, attributes, minutesAgo) {
  const row = new modelType();
  row.time = new Date(LOADED_AT - (minutesAgo || 0) * MINUTE - 20 * 1000);
  row.value = value;
  row.attributes = {
    "resource.ceph.cluster.name": "ceph-prod",
    ...attributes,
  };
  return row;
}

/*
 * The newest readings the Overview, the Pools list and a pool's page read:
 * the checks Ceph raised, each pool's placement groups by state and the
 * cluster's raw size - newest first.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const query = options.query || {};
  fixture.listRequests.push({ modelName, query: serialize(query) });

  // The golden charts look for change events to mark: none here.
  if (modelName === "ChangeEventV1") {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  if (modelName !== tableName(Metric)) {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName,
      name: query.name || null,
    });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  let data = [];
  if (DISCONNECTED || CHART_RAW_READS.has(query.name)) {
    /*
     * A disconnected agent sends nothing; a chart's raw points come empty,
     * as it draws from the aggregates below.
     */
    data = [];
  } else if (query.name === "ceph_health_detail") {
    data = HEALTH_CHECKS.map((check) => {
      return metricRow(options.modelType, check.value, {
        name: check.name,
        severity: check.severity,
      });
    });
  } else if (PG_STATES[query.name] !== undefined) {
    data = POOLS.map((pool) => {
      return metricRow(options.modelType, pool.pgs[PG_STATES[query.name]], {
        pool_id: pool.id,
      });
    });
  } else if (query.name === "ceph_cluster_total_bytes") {
    data = [metricRow(options.modelType, 12 * 3.84 * TIB, {})];
  } else {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName,
      name: query.name || null,
    });
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
};

AnalyticsModelAPI.count = async (modelType) => {
  fixture.unhandled.push({
    kind: "analytics.count",
    modelName: tableName(modelType),
  });
  return 0;
};

/*
 * The series the pages chart and project: the cluster's used bytes over the
 * day, each pool's counters and STORED / MAX AVAIL, the OSDs' latencies. A
 * smooth line a series over the chart's range.
 */
const SERIES = new Set([
  "ceph_cluster_total_used_bytes",
  "ceph_cluster_total_bytes",
  "ceph_osd_apply_latency_ms",
  "ceph_osd_commit_latency_ms",
  "ceph_osd_stat_bytes_used",
  "ceph_osd_numpg",
  "ceph_pool_rd",
  "ceph_pool_wr",
  "ceph_pool_rd_bytes",
  "ceph_pool_wr_bytes",
  "ceph_pool_stored",
  "ceph_pool_max_avail",
  "ceph_pool_objects",
]);

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({ modelName, name: query.name || null });

  if (modelName !== tableName(Metric) || !SERIES.has(query.name)) {
    fixture.unhandled.push({ kind: "aggregate", modelName, name: query.name });
    return { data: [] };
  }

  if (DISCONNECTED) {
    return { data: [] };
  }

  const attributes = query.attributes || {};
  const counter =
    query.name === "ceph_pool_rd" || query.name === "ceph_pool_wr";
  const counterBytes =
    query.name === "ceph_pool_rd_bytes" || query.name === "ceph_pool_wr_bytes";
  const pools = attributes["pool_id"]
    ? POOLS.filter((pool) => {
        return pool.id === String(attributes["pool_id"]);
      })
    : POOLS;
  const data = [];

  for (const pool of pools) {
    for (let step = 30; step >= 0; step--) {
      const timestamp = new Date(LOADED_AT - step * MINUTE).toISOString();
      let value;
      if (counter || counterBytes) {
        value =
          (counterBytes ? 4 * 1024 * 1024 : 40) *
          (Number(pool.id) + 1) *
          60 *
          (31 - step);
      } else if (query.name === "ceph_pool_stored") {
        value = pool.storedGib * GIB * (1 - step * 0.002);
      } else if (query.name === "ceph_pool_max_avail") {
        value = pool.availGib * GIB;
      } else if (query.name === "ceph_cluster_total_used_bytes") {
        value =
          (cluster.capacityUsedPercent / 100) *
          12 *
          3.84 *
          TIB *
          (1 - step * 0.001);
      } else if (query.name.startsWith("ceph_osd_")) {
        value = 6 + 2 * Math.sin(step / 3);
      } else {
        value = pool.objects;
      }
      data.push({
        timestamp: timestamp,
        value: value,
        attributes: { pool_id: pool.id },
      });
    }
    // The cluster-wide series are one line, not one a pool.
    if (!counter && !counterBytes && !query.name.startsWith("ceph_pool_")) {
      break;
    }
  }
  return { data };
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  // The side menu's counts, from the inventory as the server counts it.
  if (method === "POST" && parsed.pathname.includes("/inventory-summary/")) {
    const count = (kind) => {
      return inventory.filter((row) => {
        return row.kind === kind;
      }).length;
    };
    return ok({
      osdCount: count("Osd"),
      poolCount: count("Pool"),
      monCount: count("Mon"),
      mgrCount: count("Mgr"),
      mdsCount: count("Mds"),
      rgwCount: count("Rgw"),
    });
  }

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  /*
   * The Overview's AI agent card: answered "no AI agent yet", as the server
   * answers for a cluster nobody installed one on.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "CephCluster",
      resourceId: CLUSTER_ID,
      resourceName: "ceph-prod",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the AI agent beside the Ceph agent.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
  }

  fixture.unhandled.push({ kind: "api", method, url: parsed.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fa: { translation: fa },
  },
  interpolation: { escapeValue: false },
});
// Dates in the page's language, as the Dashboard's i18n start-up has them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: RouteMap[pageKey],
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function withNavigation(Component, pageKey) {
  return function NavigatedPage() {
    useNavigationHooks();
    return <Component {...pageProps(pageKey)} />;
  };
}

const PAGES = [
  [PageMap.CEPH_CLUSTER_VIEW, CephOverview],
  [PageMap.CEPH_CLUSTER_VIEW_OSDS, CephOsds],
  [PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL, CephOsdDetail],
  [PageMap.CEPH_CLUSTER_VIEW_POOLS, CephPools],
  [PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL, CephPoolDetail],
  [PageMap.CEPH_CLUSTER_VIEW_DAEMONS, CephDaemons],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const CephFixtureLayout = withNavigation(CephLayout, PageMap.CEPH_CLUSTER_VIEW);

// A page the views link to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Storage</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<CephFixtureLayout />}>
          {PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  // Synchronous navigation, as the Dashboard mounts it (Index.tsx).
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
