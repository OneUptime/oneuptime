/*
 * Offline fixture for a Proxmox VE cluster's pages: the production cluster
 * layout (ModelPage, the cluster's side menu) with its Overview, its Nodes,
 * Guests and Storage lists, a node's, a guest's and a storage's own page, the
 * Recommendations page their alert cards open and the Documentation page -
 * under their real RouteMap patterns. Only the data boundary (ModelAPI,
 * AnalyticsModelAPI, API, Realtime) and the signed-in user are replaced.
 * Every record is made up, for an "Acme Virtualization" workspace
 * (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?estate=    busy (default) | calm | new | large | native (Data.js)
 *   ?collector= disconnected: the agent stopped reporting three days ago |
 *               unreadable: the agent runs but last read the cluster 25
 *               minutes ago | waiting: the agent runs and has not read the
 *               cluster yet (issue #7439)
 *   ?alerts=    none (default) | some (node alerts on) | all | denied (the
 *               role may not read monitors)
 *   ?open=      0 | 1 (default: an incident on pve3, an alert on db-01) |
 *               many
 *   ?fail=      inventory | metrics | events: that read fails, as a server
 *               that answers 500 does
 *   ?lang=      de or fa reads the German or Persian locale file (Persian
 *               lays the page out right to left)
 *   ?theme=     dark adds html.dark (server.js)
 *
 * Every read is recorded on window.__proxmoxPagesFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, apiRequests and unhandled
 * - anything the fixture does not model. The spec keeps `unhandled` empty.
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
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import ClusterLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Layout";
import ClusterOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index";
import ClusterNodes from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Nodes";
import ClusterNodeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import ClusterGuests from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Guests";
import ClusterGuestDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/GuestDetail";
import ClusterStorage from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Storage";
import ClusterStorageDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/StorageDetail";
import ClusterRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Recommendations";
import ClusterDocumentation from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Documentation";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
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
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "Common/Utils/ArchivableValues";
import {
  CEPH_CLUSTER_ID,
  CLUSTER_ID,
  PROJECT_ID,
  buildEstate,
  uuid,
} from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const ESTATE = ["calm", "new", "large", "native"].includes(params.get("estate"))
  ? params.get("estate")
  : "busy";
const COLLECTOR = ["disconnected", "unreadable", "waiting"].includes(
  params.get("collector"),
)
  ? params.get("collector")
  : "connected";
const ALERTS = ["some", "all", "denied"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const OPEN = ["0", "many"].includes(params.get("open"))
  ? params.get("open")
  : "1";
const FAIL = ["inventory", "metrics", "events"].includes(params.get("fail"))
  ? params.get("fail")
  : "";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
// ?notifications=off: the cluster has never sent Proxmox VE's notifications.
const NOTIFICATIONS = params.get("notifications") !== "off";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * The clock, the project and the estate
 * ---------------------------------------------------------------------------
 */
const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Virtualization",
});

const estate = buildEstate(
  { estate: ESTATE, collector: COLLECTOR, notifications: NOTIFICATIONS },
  LOADED_AT,
);

const inventoryById = new Map(
  estate.inventory.map((record) => {
    return [record.externalId, record];
  }),
);

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts on the cluster, each naming its part in its
 * series labels the way a grouped Proxmox monitor writes them (`id`).
 * ---------------------------------------------------------------------------
 */
const incidentStates = [
  { _id: uuid("50000000", 1), name: "Identified", order: 1 },
  { _id: uuid("50000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("50000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const alertStates = [
  { _id: uuid("51000000", 1), name: "Created", order: 1 },
  { _id: uuid("51000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("51000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const criticalIncident = {
  _id: uuid("52000000", 1),
  name: "Critical",
  color: new Color("#dc2626"),
};
const warningAlert = {
  _id: uuid("53000000", 1),
  name: "Warning",
  color: new Color("#d97706"),
};

function openIncident(number, title, objectId, minutesAgo) {
  return {
    _id: uuid("56000000", number),
    title: title,
    incidentNumber: 40 + number,
    incidentNumberWithPrefix: `INC-${40 + number}`,
    declaredAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: { id: objectId },
    incidentSeverity: criticalIncident,
    currentIncidentState: incidentStates[0],
    currentIncidentStateId: incidentStates[0]._id,
    proxmoxClusterIds: [CLUSTER_ID],
  };
}

function openAlert(number, title, objectId, minutesAgo) {
  return {
    _id: uuid("57000000", number),
    title: title,
    alertNumber: 110 + number,
    alertNumberWithPrefix: `ALT-${110 + number}`,
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: { id: objectId },
    alertSeverity: warningAlert,
    currentAlertState: alertStates[0],
    currentAlertStateId: alertStates[0]._id,
    proxmoxClusterIds: [CLUSTER_ID],
  };
}

const incidents = [];
const alerts = [];
if (OPEN !== "0" && ESTATE !== "new" && ESTATE !== "calm") {
  if (ESTATE === "large") {
    incidents.push(
      openIncident(1, "[Proxmox] Node Offline - pve-fra", "node/pve-17", 24),
    );
  } else {
    incidents.push(
      openIncident(1, "[Proxmox] Node Offline - pve-prod", "node/pve3", 24),
    );
    alerts.push(
      openAlert(1, "[Proxmox] High Guest CPU Usage - pve-prod", "qemu/102", 40),
    );
  }
  if (OPEN === "many" && ESTATE !== "large") {
    alerts.push(
      openAlert(2, "[Proxmox] Guest Down - pve-prod", "qemu/104", 23),
      openAlert(
        3,
        "[Proxmox] Storage Near Full - pve-prod",
        "storage/pve2/local-zfs",
        300,
      ),
      openAlert(
        4,
        "[Proxmox] High Node Memory Usage - pve-prod",
        "node/pve2",
        90,
      ),
      openAlert(5, "[Proxmox] Guest Down - pve-prod", "lxc/110", 22),
      openAlert(6, "[Proxmox] Replication Failing - pve-prod", "101-0", 180),
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * Monitors the cluster already has, for the alert cards and Recommendations
 * ---------------------------------------------------------------------------
 */
const proxmoxRecommendations = MonitorRecommendationCatalog.getRecommendations(
  MonitorRecommendationResourceType.Proxmox,
);
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendationId, number) {
  const recommendation = proxmoxRecommendations.find((candidate) => {
    return candidate.recommendationId === recommendationId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: estate.cluster.name,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: estate.cluster.name,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${estate.cluster.name} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.Proxmox,
    monitorSteps: steps,
  };
}

const monitorIds =
  ALERTS === "some"
    ? ["Proxmox:pve-node-offline", "Proxmox:pve-node-high-cpu"]
    : ALERTS === "all"
      ? proxmoxRecommendations.map((recommendation) => {
          return recommendation.recommendationId;
        })
      : [];
const monitors = monitorIds
  .map((recommendationId, index) => {
    return monitorFor(recommendationId, index + 1);
  })
  .filter(Boolean);

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    estate: ESTATE,
    collector: COLLECTOR,
    alerts: ALERTS,
    open: OPEN,
    fail: FAIL,
    language: LANGUAGE,
    notifications: NOTIFICATIONS,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__proxmoxPagesFixture = fixture;

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

/*
 * A query's plain values and its Includes must match, as the server would
 * compare them. A relation filter (`proxmoxClusters: Includes([id])`) reads
 * the record's `<relation>Ids`.
 */
const TRAILING_S = /s$/;

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
      const relationIds = record[`${field.replace(TRAILING_S, "")}Ids`];
      if (Array.isArray(relationIds)) {
        if (
          !relationIds.some((id) => {
            return allowed.has(String(id));
          })
        ) {
          return false;
        }
        continue;
      }
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
  ProxmoxCluster: [estate.cluster],
  ProxmoxResource: estate.inventory,
  CephCluster: [estate.cephCluster],
  /*
   * The guest page looks for a host agent inside the guest: web-01 has one.
   */
  Host:
    ESTATE === "busy" || ESTATE === "calm"
      ? [
          {
            _id: uuid("74000000", 1),
            name: "web-01",
            hostIdentifier: "web-01",
            proxmoxClusterId: CLUSTER_ID,
          },
        ]
      : [],
  IncidentState: incidentStates,
  AlertState: alertStates,
  ScheduledMaintenanceState: [
    { _id: uuid("54000000", 1), name: "Scheduled", order: 1 },
    { _id: uuid("54000000", 2), name: "Ongoing", order: 2 },
    {
      _id: uuid("54000000", 3),
      name: "Completed",
      order: 3,
      isResolvedState: true,
      isEndedState: true,
    },
  ],
  Incident: incidents,
  Alert: alerts,
  ScheduledMaintenance: [],
  Monitor: monitors,
  RecommendationDismissal: [],
  MonitorStatus: [
    {
      _id: uuid("55000000", 1),
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
      priority: 1,
    },
    {
      _id: uuid("55000000", 2),
      name: "Offline",
      isOperationalState: false,
      isOfflineState: true,
      priority: 2,
    },
  ],
  IncidentSeverity: [criticalIncident],
  AlertSeverity: [warningAlert],
  OnCallDutyPolicy: [],
  Label: [],
  TelemetryIngestionKey: [
    {
      _id: uuid("59000000", 1),
      name: "Proxmox agent",
      secretKey: uuid("5a000000", 1),
      // A server key: the setup guide lists only those.
      keyType: "Server",
      description: "",
    },
  ],
  Service: [],
  MetricType: [],
  LogSavedView: [],
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
      const a = left[field] ?? "";
      const b = right[field] ?? "";
      if (a !== b) {
        const ascending =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a) < String(b)
              ? -1
              : 1;
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

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
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
  return "sam@acme-virtualization.example";
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

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

function failsInventory(modelName) {
  return FAIL === "inventory" && modelName === "ProxmoxResource";
}

function failsEvents(modelName) {
  return (
    FAIL === "events" && (modelName === "Incident" || modelName === "Alert")
  );
}

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
  });

  if (modelName === "Monitor" && ALERTS === "denied") {
    throw new Error("You do not have permission to read monitors.");
  }
  if (failsInventory(modelName) || failsEvents(modelName)) {
    throw new Error(SERVER_ERROR);
  }

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const skip = options.skip || 0;
  const limit = options.limit || 10;
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (failsEvents(modelName)) {
    throw new Error(SERVER_ERROR);
  }

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
  fixture.itemRequests.push({
    modelName,
    id,
    select: serialize(options.select),
  });

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const record = store[modelName].find((candidate) => {
    return candidate._id === id;
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

/*
 * ---------------------------------------------------------------------------
 * Metrics: one series per pve `id`, as pve-exporter's scrape lands in
 * ClickHouse, around each part's latest reading.
 * ---------------------------------------------------------------------------
 */
function wave(seed, step) {
  return (
    Math.sin((step + seed * 7) / 5) * 0.5 + Math.sin((step + seed) / 13) * 0.5
  );
}

function seedOf(text) {
  let seed = 0;
  for (const character of text) {
    seed = (seed * 31 + character.charCodeAt(0)) % 997;
  }
  return seed;
}

function readingFor(metricName, record, step) {
  const seed = seedOf(record.externalId);
  const swing = wave(seed, step);
  switch (metricName) {
    case "pve_up":
      return record.isUp ? 1 : 0;
    case "pve_cpu_usage_ratio":
      return record.latestCpuPercent === undefined
        ? null
        : Math.max(0, Math.min(1, (record.latestCpuPercent + swing * 6) / 100));
    case "pve_cpu_usage_limit":
      return record.cpuCount || null;
    case "pve_memory_usage_bytes":
      return record.latestMemoryBytes === undefined
        ? null
        : record.latestMemoryBytes * (1 + swing * 0.03);
    case "pve_memory_size_bytes":
      return record.maxMemoryBytes || null;
    case "pve_disk_usage_bytes":
      return record.latestDiskBytes === undefined
        ? null
        : record.latestDiskBytes * (1 - (60 - step) * 0.0004);
    case "pve_disk_size_bytes":
      return record.maxDiskBytes || null;
    case "pve_uptime_seconds":
      return record.uptimeSeconds || 0;
    case "pve_network_receive_bytes":
    case "pve_network_transmit_bytes":
    case "pve_disk_read_bytes":
    case "pve_disk_write_bytes": {
      if (record.kind !== "Guest" || !record.isUp) {
        return null;
      }
      const perMinute =
        (metricName.includes("receive") ? 9 : 4) *
        1024 *
        1024 *
        (1 + (seed % 7) / 3);
      return 5e10 + seed * 1e8 + step * perMinute * (1 + swing * 0.2);
    }
    default:
      return undefined;
  }
}

function replicationReading(metricName, job) {
  const nowSeconds = LOADED_AT / 1000;
  switch (metricName) {
    case "pve_replication_info":
      return 1;
    case "pve_replication_last_sync_timestamp_seconds":
      return nowSeconds - job.lastSyncSecondsAgo;
    case "pve_replication_duration_seconds":
      return job.durationSeconds;
    case "pve_replication_failed_syncs":
      return job.failedSyncs;
    default:
      return undefined;
  }
}

function wantedIds(attributes) {
  const id = attributes && attributes["id"];
  return typeof id === "string" && id ? id : null;
}

function generateRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const metricName = query.name;
  const attributes = query.attributes || {};
  const start = new Date(aggregateBy.startTimestamp || LOADED_AT - 30 * MINUTE);
  const end = new Date(aggregateBy.endTimestamp || LOADED_AT);
  const spanMinutes = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MINUTE),
  );
  const stepMinutes = Math.max(1, Math.ceil(spanMinutes / 60));
  const steps = Math.floor(spanMinutes / stepMinutes);
  const out = [];

  if (metricName && metricName.startsWith("pve_replication_")) {
    for (const job of estate.replicationJobs) {
      const value = replicationReading(metricName, job);
      if (value === undefined) {
        return null;
      }
      out.push({
        timestamp: new Date(LOADED_AT - MINUTE).toISOString(),
        value: value,
        attributes:
          metricName === "pve_replication_info"
            ? {
                id: job.id,
                guest: job.guest,
                source: job.source,
                target: job.target,
                type: "local",
              }
            : { id: job.id },
      });
    }
    return out;
  }

  const onlyId = wantedIds(attributes);
  const records = estate.inventory.filter((record) => {
    return !onlyId || record.externalId === onlyId;
  });

  for (const record of records) {
    const lastMetricsAt = record.metricsUpdatedAt
      ? new Date(record.metricsUpdatedAt).getTime()
      : 0;
    for (let index = 0; index <= steps; index++) {
      const time = new Date(start.getTime() + index * stepMinutes * MINUTE);
      if (time.getTime() > lastMetricsAt + MINUTE) {
        continue;
      }
      const value = readingFor(metricName, record, index);
      if (value === undefined) {
        return null;
      }
      if (value === null) {
        continue;
      }
      out.push({
        timestamp: time.toISOString(),
        value: value,
        attributes: { id: record.externalId },
      });
    }
  }
  return out;
}

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy;
  fixture.aggregateRequests.push({
    modelName,
    name: aggregateBy.query?.name,
    attributes: serialize(aggregateBy.query?.attributes),
    aggregationType: aggregateBy.aggregationType,
    groupBy: serialize(aggregateBy.groupBy),
  });

  if (FAIL === "metrics") {
    throw new Error(SERVER_ERROR);
  }

  const data = modelName.startsWith("Metric")
    ? generateRows(aggregateBy)
    : null;

  if (!data) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy.query?.name,
    });
    return { data: [] };
  }

  return { data };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  if (
    modelName.startsWith("Log") ||
    modelName.startsWith("ChangeEvent") ||
    modelName.startsWith("Metric") ||
    modelName.startsWith("Span")
  ) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (modelName.startsWith("Log")) {
    return 0;
  }

  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function inventorySummary() {
  const count = (kind) => {
    return estate.inventory.filter((record) => {
      return record.kind === kind;
    }).length;
  };
  return {
    nodeCount: count("Node"),
    guestCount: count("Guest"),
    storageCount: count("Storage"),
  };
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

  // The cluster's side menu counts.
  if (
    method === "POST" &&
    parsed.pathname.includes("/proxmox-resource/inventory-summary/")
  ) {
    if (FAIL === "inventory") {
      return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
    }
    return ok(inventorySummary());
  }

  // The AI agent card: the cluster has no AI agent yet.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "ProxmoxCluster",
      resourceId: CLUSTER_ID,
      resourceName: estate.cluster.name,
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the Proxmox AI agent next to the collector.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
  }

  // A node's, guest's or storage's Metrics tab: the metric catalog it reads.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/metrics/get-attributes")
  ) {
    return ok({
      attributes: ["resource.proxmox.cluster.name", "id", "pve.scope"],
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
followLanguageForDates(i18next);
// <html lang> and <html dir> follow the language, as the Dashboard's do.
followLanguageForPage(i18next);

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
  [PageMap.PROXMOX_CLUSTER_VIEW, ClusterOverview],
  [PageMap.PROXMOX_CLUSTER_VIEW_NODES, ClusterNodes],
  [PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL, ClusterNodeDetail],
  [PageMap.PROXMOX_CLUSTER_VIEW_GUESTS, ClusterGuests],
  [PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL, ClusterGuestDetail],
  [PageMap.PROXMOX_CLUSTER_VIEW_STORAGE, ClusterStorage],
  [PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL, ClusterStorageDetail],
  [PageMap.PROXMOX_CLUSTER_VIEW_RECOMMENDATIONS, ClusterRecommendations],
  [PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION, ClusterDocumentation],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(
  ClusterLayout,
  PageMap.PROXMOX_CLUSTER_VIEW,
);

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
          <span className="text-sm text-gray-500">Acme Virtualization</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureLayout />}>
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
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);

export { CEPH_CLUSTER_ID };
