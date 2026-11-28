/*
 * Offline fixture for an XCP-ng pool's pages: the production pool layout
 * (ModelPage, the pool's side menu) with its Overview, its Hosts, VMs and
 * Storage lists, a host's, a VM's and a storage repository's own page, the
 * Topology, Recommendations and the setup guide - under their real RouteMap
 * patterns. Only the data boundary (ModelAPI, AnalyticsModelAPI, API,
 * Realtime) and the signed-in user are replaced. Every record is made up,
 * for an "Acme Virtualization" workspace (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?estate=    busy (default) | calm | new | large (Data.js)
 *   ?collector= disconnected: the agent and Xen Orchestra went quiet three
 *               days ago | stopped: the agent runs, Xen Orchestra stopped
 *               reporting the pool two hours ago
 *   ?alerts=    none (default) | some (two host alerts on) | all
 *   ?open=      0 | 1 (default: an incident on xcp-prod-03, an alert on
 *               db-01)
 *   ?fail=      inventory | metrics: that read fails, as a server that
 *               answers 500 does
 *   ?lang=      de or fa reads the German or Persian locale file (Persian
 *               lays the page out right to left)
 *   ?theme=     dark adds html.dark (server.js)
 *   ?aiAgent=   none (default) | connected | writes | broken-token |
 *               unreachable: the pool's XCP-ng AI agent (AiAgent.js)
 *
 * Every read is recorded on window.__xcpNgPagesFixture: listRequests,
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
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import PoolLayout from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Layout";
import PoolOverview from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Index";
import PoolHosts from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Hosts";
import PoolHostDetail from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/HostDetail";
import PoolVms from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Vms";
import PoolVmDetail from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/VmDetail";
import PoolStorage from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Storage";
import PoolStorageDetail from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/StorageDetail";
import PoolTopology from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Topology";
import PoolRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Recommendations";
import PoolDocumentation from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Documentation";
import PoolAiAgent from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/AI/Agent";
import PoolAiInsights from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/AI/Insights";
import PoolAiLogs from "../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/AI/Logs";
import { getAiAccessStatus, getAiInsights, getAiLogs } from "./AiAgent";
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
import {
  MonitorRecommendationCoverageMatcher,
  readCoverageQuestions,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
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
  HOST,
  POOL_ID,
  POOL_UUID,
  PROJECT_ID,
  VM,
  buildEstate,
  uuid,
} from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const ESTATE = ["calm", "new", "large"].includes(params.get("estate"))
  ? params.get("estate")
  : "busy";
const COLLECTOR = ["disconnected", "stopped"].includes(params.get("collector"))
  ? params.get("collector")
  : "connected";
const ALERTS = ["some", "all"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const OPEN = params.get("open") === "0" ? "0" : "1";
const FAIL = ["inventory", "metrics"].includes(params.get("fail"))
  ? params.get("fail")
  : "";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

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

const estate = buildEstate({ estate: ESTATE, collector: COLLECTOR }, LOADED_AT);

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts on the pool, each naming its part in its series
 * labels the way a grouped XCP-ng monitor writes them (`xcp_ng.id`).
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

const incidents = [];
const alerts = [];
if (OPEN !== "0" && ESTATE === "busy") {
  incidents.push({
    _id: uuid("56000000", 1),
    title: "[XCP-ng] Host Offline - Production",
    incidentNumber: 41,
    incidentNumberWithPrefix: "INC-41",
    declaredAt: new Date(LOADED_AT - 240 * MINUTE),
    createdAt: new Date(LOADED_AT - 240 * MINUTE),
    seriesLabels: { "xcp_ng.id": HOST.prod3, host_name: "xcp-prod-03" },
    incidentSeverity: criticalIncident,
    currentIncidentState: incidentStates[0],
    currentIncidentStateId: incidentStates[0]._id,
    xcpNgPoolIds: [POOL_ID],
  });
  alerts.push({
    _id: uuid("57000000", 1),
    title: "[XCP-ng] VM CPU Starved - Production",
    alertNumber: 111,
    alertNumberWithPrefix: "ALT-111",
    createdAt: new Date(LOADED_AT - 35 * MINUTE),
    seriesLabels: { "xcp_ng.id": VM.db01, vm_name: "db-01" },
    alertSeverity: warningAlert,
    currentAlertState: alertStates[0],
    currentAlertStateId: alertStates[0]._id,
    xcpNgPoolIds: [POOL_ID],
  });
}

/*
 * ---------------------------------------------------------------------------
 * Monitors the pool already has, for the alert cards and Recommendations
 * ---------------------------------------------------------------------------
 */
const xcpNgRecommendations = MonitorRecommendationCatalog.getRecommendations(
  MonitorRecommendationResourceType.XcpNg,
);
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendation, number) {
  const step = recommendation.getMonitorStep({
    resourceIdentifier: POOL_UUID,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: estate.pool.name,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${estate.pool.name} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.XcpNg,
    monitorSteps: steps,
  };
}

const monitors = (
  ALERTS === "all"
    ? xcpNgRecommendations
    : ALERTS === "some"
      ? xcpNgRecommendations.slice(0, 2)
      : []
).map((recommendation, index) => {
  return monitorFor(recommendation, index + 1);
});

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
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__xcpNgPagesFixture = fixture;

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
 * compare them. A relation filter (`xcpNgPools: Includes([id])`) reads the
 * record's `<relation>Ids`.
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
  // With the AI access columns every pool's row has (#10998), at their defaults.
  XcpNgPool: [
    {
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      ...estate.pool,
    },
  ],
  // The commands the AI agent ran (AI > Logs): none yet.
  RunnerJob: [],
  // The project, which AI > Insights reads for its AI settings.
  Project: [{ _id: PROJECT_ID, name: "Acme Virtualization" }],
  XcpNgResource: estate.inventory,
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
      name: "XCP-ng agent",
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

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
  });

  if (FAIL === "inventory" && modelName === "XcpNgResource") {
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
 * Metrics: one series per object (`xcp_ng.id`), as the agent's scrape of
 * Xen Orchestra lands in ClickHouse, around each part's latest reading. A
 * chart split by a label (interface, device, vif, sr_name, host_name) gets
 * one series per value.
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
  const cpu = (record.latestCpuPercent || 0) / 100;
  if (metricName.endsWith("_status")) {
    return record.isUp ? 1 : 0;
  }
  if (
    metricName === "xcp_host_cpu_average" ||
    metricName === "xcp_vm_cpu_usage"
  ) {
    return Math.max(0, Math.min(1, cpu + swing * 0.06));
  }
  if (
    metricName.includes("memory_total") ||
    metricName === "xcp_vm_memory_bytes"
  ) {
    return record.maxMemoryBytes || null;
  }
  if (metricName.includes("memory_free")) {
    return Math.max(
      0,
      (record.maxMemoryBytes || 0) -
        (record.latestMemoryBytes || 0) * (1 + swing * 0.02),
    );
  }
  if (metricName.includes("memory_internal_free")) {
    return record.latestMemoryBytes
      ? (record.maxMemoryBytes || 0) - record.latestMemoryBytes
      : null;
  }
  if (metricName.includes("load")) {
    return Math.max(0, (record.loadAverage || 0.5) + swing * 0.4);
  }
  if (metricName.includes("power_consumption")) {
    return record.powerWatts ? record.powerWatts + swing * 12 : null;
  }
  if (metricName.includes("uptime")) {
    return record.uptimeSeconds || 0;
  }
  if (metricName.includes("latency")) {
    return 0.002 + Math.abs(swing) * 0.004;
  }
  if (metricName.includes("iops")) {
    return 120 + seed + swing * 40;
  }
  if (metricName.includes("runstate") || metricName.includes("iowait")) {
    return Math.max(0, 0.02 + swing * 0.02 + (cpu > 0.9 ? 0.08 : 0));
  }
  if (metricName.includes("errors")) {
    return Math.max(0, swing * 0.2);
  }
  if (metricName.startsWith("xcp_sr_physical_size")) {
    return record.maxDiskBytes || 0;
  }
  if (metricName.startsWith("xcp_sr_physical_usage")) {
    return (record.latestDiskBytes || 0) * (1 - (60 - step) * 0.0002);
  }
  if (metricName.startsWith("xcp_sr_virtual_size")) {
    return record.virtualAllocationBytes || 0;
  }
  if (metricName.startsWith("xcp_vdi_")) {
    return record.latestDiskBytes || 0;
  }
  // Network and disk throughput: bytes per second, as gauges.
  return Math.max(0, (2 + (seed % 7)) * 1024 * 1024 * (1 + swing * 0.3));
}

// Each value a split chart draws a line for.
function splitValues(key, record) {
  switch (key) {
    case "interface":
      return ["eth0", "eth1"];
    case "vif":
      return ["0"];
    case "device":
      return ["xvda"];
    case "sr_name":
      return ["Local storage", "NFS VM store"];
    case "host_name":
      return ["xcp-prod-01", "xcp-prod-02"];
    default:
      return [record.name || record.externalId];
  }
}

// The object a chart reads: by xcp_ng.id, uuid (power) or sr_uuid.
function wantedId(attributes) {
  for (const key of ["xcp_ng.id", "uuid", "sr_uuid"]) {
    const id = attributes && attributes[key];
    if (typeof id === "string" && id) {
      return { key, id };
    }
  }
  return null;
}

function generateRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const metricName = query.name;
  if (typeof metricName !== "string" || !metricName.startsWith("xcp_")) {
    return null;
  }
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

  const wanted = wantedId(attributes);
  // A storage repository's hosts' I/O: every host that writes to it.
  const records = estate.inventory.filter((record) => {
    if (!wanted) {
      return false;
    }
    if (wanted.key === "sr_uuid") {
      return record.kind === "Host" && record.isUp;
    }
    return record.externalId === wanted.id;
  });
  const splitKeys = aggregateBy.groupByAttributeKeys || [];

  for (const record of records) {
    const lastMetricsAt = record.metricsUpdatedAt
      ? new Date(record.metricsUpdatedAt).getTime()
      : 0;
    const splits =
      splitKeys.length > 0
        ? splitValues(
            wanted.key === "sr_uuid" ? "host_name" : splitKeys[0],
            record,
          ).filter((value) => {
            return wanted.key !== "sr_uuid" || value === record.name;
          })
        : [null];
    splits.forEach((splitValue, splitIndex) => {
      for (let index = 0; index <= steps; index++) {
        const time = new Date(start.getTime() + index * stepMinutes * MINUTE);
        if (time.getTime() > lastMetricsAt + MINUTE) {
          continue;
        }
        const value = readingFor(metricName, record, index + splitIndex * 9);
        if (value === null || value === undefined) {
          continue;
        }
        out.push({
          timestamp: time.toISOString(),
          value: value * (splitIndex === 0 ? 1 : 0.6),
          attributes: {
            "xcp_ng.id": record.externalId,
            ...(splitValue !== null ? { [splitKeys[0]]: splitValue } : {}),
          },
        });
      }
    });
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
    groupByAttributeKeys: serialize(aggregateBy.groupByAttributeKeys),
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

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  /*
   * Which recommended alerts already have a monitor, as the server decides
   * it (MonitorAPI's recommendation-coverage, over the shared matcher): the
   * side menu's Recommendations badge, the alert cards and Recommendations.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/monitor/recommendation-coverage")
  ) {
    const questions = readCoverageQuestions(body);
    const covered = {};

    for (const type of new Set(
      questions.map((question) => {
        return question.monitorType;
      }),
    )) {
      const matcher = new MonitorRecommendationCoverageMatcher(
        questions.filter((question) => {
          return question.monitorType === type;
        }),
      );

      for (const monitor of monitors) {
        if (monitor.monitorType === type) {
          matcher.addMonitor(
            monitor._id,
            monitor.monitorSteps.data.monitorStepsInstanceArray,
          );
        }
      }

      for (const [key, monitorId] of matcher.getAnswer()) {
        covered[key] = monitorId;
      }
    }

    return ok({ covered });
  }

  // How OneUptime AI reaches the pool: the Overview's card and the AI pages.
  if (method === "POST") {
    if (parsed.pathname.endsWith("/resource-ai-access/status")) {
      return ok(
        getAiAccessStatus({
          aiAgent: params.get("aiAgent"),
          poolId: body.resourceId,
          poolName: estate.pool.name,
          poolIdentifier: POOL_UUID,
          now: new Date(LOADED_AT).toISOString(),
        }),
      );
    }
    if (parsed.pathname.endsWith("/resource-ai-access/logs")) {
      return ok(getAiLogs());
    }
    if (parsed.pathname.endsWith("/resource-ai-access/insights")) {
      return ok(getAiInsights());
    }
    // The LLM providers AI > Insights offers Ask AI with: the global one.
    if (parsed.pathname.endsWith("/ai-chat/providers")) {
      return ok({
        isAIEnabledForProject: true,
        defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
        providers: [
          {
            id: "9d9d9d9d-0000-4000-8000-000000000001",
            name: "OneUptime AI",
            isGlobal: true,
            isDefault: false,
          },
        ],
      });
    }
  }

  // A part's Metrics tab: the metric catalog it reads.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/metrics/get-attributes")
  ) {
    return ok({
      attributes: [
        "resource.xcp_ng.pool.id",
        "xcp_ng.scope",
        "xcp_ng.id",
        "host_name",
        "vm_name",
        "sr_name",
      ],
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

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: "en",
  resources: await localeResources({
    language: LANGUAGE,
    english: en,
    loaders: LOCALE_LOADERS,
  }),
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
  [PageMap.XCP_NG_POOL_VIEW, PoolOverview],
  [PageMap.XCP_NG_POOL_VIEW_HOSTS, PoolHosts],
  [PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL, PoolHostDetail],
  [PageMap.XCP_NG_POOL_VIEW_VMS, PoolVms],
  [PageMap.XCP_NG_POOL_VIEW_VM_DETAIL, PoolVmDetail],
  [PageMap.XCP_NG_POOL_VIEW_STORAGE, PoolStorage],
  [PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL, PoolStorageDetail],
  [PageMap.XCP_NG_POOL_VIEW_TOPOLOGY, PoolTopology],
  [PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS, PoolRecommendations],
  [PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION, PoolDocumentation],
  [PageMap.XCP_NG_POOL_VIEW_AI_AGENT, PoolAiAgent],
  [PageMap.XCP_NG_POOL_VIEW_AI_INSIGHTS, PoolAiInsights],
  [PageMap.XCP_NG_POOL_VIEW_AI_LOGS, PoolAiLogs],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(PoolLayout, PageMap.XCP_NG_POOL_VIEW);

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
