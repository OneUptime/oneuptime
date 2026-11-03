/*
 * Offline fixture for a Docker Swarm cluster's pages: the production
 * cluster layout (ModelPage, the cluster's side menu) with its Overview (its
 * health and Needs attention by the swarm's rules, each node at a glance,
 * the agent version chip and the sign beside an agent whose files are
 * behind), the Nodes, Services and Tasks lists, a node's, a service's and a
 * task's page (a task's 64-character Container ID in its details) and the
 * Metrics tab (the metrics list's rows on a phone) - under their real
 * RouteMap patterns. Only the data
 * boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the signed-in
 * user are replaced. Every record is fabricated for an "Acme Swarm"
 * workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?agent=   old (default: 0.161.0, the files before #5076's CPU fix) |
 *             current (0.161.3, the files this release ships) | none (an
 *             agent that reports no version)
 *   ?swarm=   trouble: a worker down, a service short of a replica, one
 *             whose tasks keep failing, a task near its memory limit, and an
 *             alert open on the short service (default: all healthy)
 *   ?lang=    de reads the German locale file, fa the Persian one (right to
 *             left)
 *   ?theme=   dark adds html.dark (handled by server.js)
 *   ?description=  long gives the cluster a description of two lines'
 *             length, which the hero must wrap beside its controls
 *   ?dir=     rtl lays the page out right to left, as a Persian page is
 *
 * Every read is recorded on window.__dockerSwarmPagesFixture: listRequests,
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
import SwarmLayout from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Layout";
import SwarmOverview from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import SwarmNodes from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Nodes";
import SwarmServices from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Services";
import SwarmTasks from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Tasks";
import SwarmNodeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/NodeDetail";
import SwarmServiceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/ServiceDetail";
import SwarmTaskDetail from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/TaskDetail";
import SwarmMetrics from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Metrics";
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

const AGENT = ["current", "none"].includes(params.get("agent"))
  ? params.get("agent")
  : "old";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const LONG_DESCRIPTION = params.get("description") === "long";
// The swarm's agent stopped reporting three days ago.
const DISCONNECTED = params.get("collector") === "disconnected";
// A swarm with something broken and something to look at.
const TROUBLE = params.get("swarm") === "trouble";

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

const CLUSTER_ID = uuid("62000000", 1);
const CLUSTER_NAME = "swarm-prod";

const AGENT_VERSIONS = { old: "0.161.0", current: "0.161.3", none: "" };

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Swarm",
});

const cluster = {
  _id: CLUSTER_ID,
  name: CLUSTER_NAME,
  description: LONG_DESCRIPTION
    ? "The production swarm in Frankfurt: the shop's checkout, web and search services, with their Redis caches and the nightly batch jobs."
    : "The production swarm in Frankfurt.",
  clusterIdentifier: CLUSTER_NAME,
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: new Date(
    LOADED_AT - (DISCONNECTED ? 3 * 24 * 60 * MINUTE : MINUTE),
  ),
  agentVersion: AGENT_VERSIONS[AGENT] || undefined,
  dockerVersion: "28.5.1",
  swarmId: "q8l3n0u2x9v7w1y5z4a6b8c0d",
  nodeCount: 2,
  readyNodeCount: 2,
  managerNodeCount: 1,
  serviceCount: 2,
  taskCount: 3,
  runningTaskCount: 3,
  stackCount: 1,
  networkCount: 1,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
};

// The task whose container ID ran out of its card on a phone.
const CONTAINER_ID =
  "6f3c2a91d8b74e05a1c9f0e7b2d4a6c8e1f3b5d7a9c0e2f4b6d8a0c2e4f6a8b0";
const TASK_ID = "x7k2m9p4q1r8s5t3v6w0y2z4a";

function inventoryRow(fields) {
  return {
    _id: uuid("63000000", fields.number),
    dockerSwarmClusterId: CLUSTER_ID,
    metricsUpdatedAt: new Date(LOADED_AT - MINUTE),
    lastSeenAt: new Date(LOADED_AT - MINUTE),
    ...fields,
  };
}

const GIB = 1024 * 1024 * 1024;

const inventory = [
  inventoryRow({
    number: 1,
    kind: "Node",
    externalId: "node/n1",
    name: "swarm-manager-01",
    role: "manager",
    state: "ready",
    isReady: true,
    attributes: {
      availability: "active",
      managerStatus: "Leader",
      isLeader: true,
      engineVersion: "28.5.1",
      addr: "10.20.0.11",
      cpus: 4,
      memoryBytes: 8 * GIB,
    },
  }),
  inventoryRow({
    number: 2,
    kind: "Node",
    externalId: "node/n2",
    name: "swarm-worker-01",
    role: "worker",
    state: "ready",
    isReady: true,
    attributes: {
      availability: "active",
      engineVersion: "28.5.1",
      addr: "10.20.0.21",
      cpus: 4,
      memoryBytes: 8 * GIB,
    },
  }),
  inventoryRow({
    number: 3,
    kind: "Service",
    externalId: "service/s1",
    name: "shop_checkout",
    serviceMode: "replicated",
    desiredReplicas: 2,
    runningReplicas: 2,
    isReady: true,
    image: "registry.acme-swarm.example/shop/checkout:2.7.0",
    stackName: "shop",
  }),
  inventoryRow({
    number: 4,
    kind: "Service",
    externalId: "service/s2",
    name: "shop_web",
    serviceMode: "replicated",
    desiredReplicas: 1,
    runningReplicas: 1,
    isReady: true,
    image: "registry.acme-swarm.example/shop/web:5.1.2",
    stackName: "shop",
  }),
  inventoryRow({
    number: 5,
    kind: "Task",
    externalId: `task/${TASK_ID}`,
    name: "shop_checkout.1",
    state: "running",
    isReady: true,
    serviceName: "shop_checkout",
    nodeHostname: "swarm-worker-01",
    image: "registry.acme-swarm.example/shop/checkout:2.7.0",
    stackName: "shop",
    latestCpuPercent: 3.42,
    latestMemoryBytes: 183500800,
    latestMemoryPercent: 34.2,
    maxMemoryBytes: 536870912,
    attributes: {
      slot: "1",
      containerId: CONTAINER_ID,
      desiredState: "running",
      since: new Date(LOADED_AT - 26 * 60 * MINUTE).toISOString(),
      message: "started",
    },
  }),
  inventoryRow({
    number: 6,
    kind: "Task",
    externalId: "task/b3c4d5e6f7a8b9c0d1e2f3a4b",
    name: "shop_checkout.2",
    state: "running",
    isReady: true,
    serviceName: "shop_checkout",
    nodeHostname: "swarm-manager-01",
    latestCpuPercent: TROUBLE ? 46.5 : 2.1,
    latestMemoryBytes: TROUBLE ? 493921239 : 160432128,
    latestMemoryPercent: TROUBLE ? 92 : 29.9,
    maxMemoryBytes: 536870912,
    attributes: {
      slot: "2",
      containerId: "1a2b3c4d5e6f",
      desiredState: "running",
    },
  }),
  inventoryRow({
    number: 7,
    kind: "Task",
    externalId: "task/c4d5e6f7a8b9c0d1e2f3a4b5c",
    name: "shop_web.1",
    state: "running",
    isReady: true,
    serviceName: "shop_web",
    nodeHostname: "swarm-worker-01",
    latestCpuPercent: 1.4,
    latestMemoryBytes: 98566144,
    latestMemoryPercent: 18.4,
    maxMemoryBytes: 536870912,
    attributes: {
      slot: "1",
      containerId: "2b3c4d5e6f7a",
      desiredState: "running",
    },
  }),
  inventoryRow({
    number: 8,
    kind: "Stack",
    externalId: "stack/shop",
    name: "shop",
  }),
  inventoryRow({
    number: 9,
    kind: "Network",
    externalId: "network/w1",
    name: "shop_default",
    driver: "overlay",
  }),
];

/*
 * The swarm in trouble: a worker the managers lost, shop_web short of the
 * replica that ran there, shop_search crash-looping (Swarm replaces each
 * failed task, so it reads full), and shop_checkout.2 near its memory
 * limit.
 */
if (TROUBLE) {
  const web = inventory.find((row) => {
    return row.name === "shop_web";
  });
  web.desiredReplicas = 2;
  web.runningReplicas = 1;
  web.isReady = false;
  web.attributes = {
    lastTaskError: "task: non-zero exit (1)",
    lastTaskState: "failed",
    lastTaskExitCode: "1",
    lastTaskErrorAt: new Date(LOADED_AT - 4 * MINUTE).toISOString(),
    recentFailedTasks: 1,
  };
  inventory.push(
    inventoryRow({
      number: 10,
      kind: "Node",
      externalId: "node/n3",
      name: "swarm-worker-02",
      role: "worker",
      state: "down",
      isReady: false,
      lastSeenAt: new Date(LOADED_AT - MINUTE),
      attributes: {
        availability: "active",
        message: 'heartbeat failure for node in "unknown" state',
        engineVersion: "28.5.1",
        addr: "10.20.0.22",
        cpus: 4,
        memoryBytes: 8 * GIB,
      },
    }),
    inventoryRow({
      number: 11,
      kind: "Service",
      externalId: "service/s3",
      name: "shop_search",
      serviceMode: "replicated",
      desiredReplicas: 1,
      runningReplicas: 1,
      isReady: true,
      image: "registry.acme-swarm.example/shop/search:3.0.4",
      stackName: "shop",
      attributes: {
        recentFailedTasks: 4,
        lastTaskError: "task: non-zero exit (137)",
        lastTaskState: "failed",
        lastTaskExitCode: "137",
        lastTaskErrorAt: new Date(LOADED_AT - 2 * MINUTE).toISOString(),
      },
    }),
    inventoryRow({
      number: 12,
      kind: "Task",
      externalId: "task/d5e6f7a8b9c0d1e2f3a4b5c6d",
      name: "shop_search.1",
      state: "running",
      isReady: true,
      serviceName: "shop_search",
      nodeHostname: "swarm-worker-01",
      latestCpuPercent: 12.2,
      latestMemoryBytes: 241172480,
      latestMemoryPercent: 44.9,
      maxMemoryBytes: 536870912,
      attributes: {
        slot: "1",
        containerId: "3c4d5e6f7a8b",
        desiredState: "running",
      },
    }),
    inventoryRow({
      number: 13,
      kind: "Task",
      externalId: "task/e6f7a8b9c0d1e2f3a4b5c6d7e",
      name: "shop_web.2",
      state: "failed",
      isReady: false,
      serviceName: "shop_web",
      nodeHostname: "swarm-worker-02",
      attributes: {
        slot: "2",
        containerId: "4d5e6f7a8b9c",
        desiredState: "running",
        error: "task: non-zero exit (1)",
        exitCode: "1",
      },
    }),
  );
}

// An alert open on the short service, as the replicas template raises it.
const openAlerts = TROUBLE
  ? [
      {
        _id: uuid("61000000", 1),
        title: "[Docker Swarm] Service Replicas Mismatch - swarm-prod",
        alertNumber: 12,
        createdAt: new Date(LOADED_AT - 9 * MINUTE),
        currentAlertStateId: uuid("51000000", 1),
        // What links an alert to its swarm (Alert.dockerSwarmClusters).
        dockerSwarmClusters: CLUSTER_ID,
        seriesLabels: { "resource.docker.swarm.service.name": "shop_web" },
      },
    ]
  : [];

/*
 * The metrics the swarm's agent sends, as the metric catalog holds them:
 * names long enough that a phone's row used to cut them to a few letters.
 */
const metricTypes = [
  {
    name: "container.cpu.utilization",
    unit: "%",
    description:
      "CPU used over each collection interval, where 100% is one full CPU core.",
  },
  {
    name: "container.memory.percent",
    unit: "%",
    description:
      "Memory in use as a percent of the container's limit, or of host memory if it has none.",
  },
  {
    name: "container.memory.usage.total",
    unit: "By",
    description: "Memory in use, page cache included.",
  },
  {
    name: "container.network.io.usage.rx_bytes",
    unit: "By",
    description: "Bytes received over the container's network interfaces.",
  },
  {
    name: "container.blockio.io_service_bytes_recursive",
    unit: "By",
    description: "Bytes read and written by the container's block devices.",
  },
].map((metric, index) => {
  return {
    _id: uuid("64000000", index + 1),
    services: [],
    ...metric,
  };
});

// Where each metric's sparkline sits, and how far it swings.
const SPARKLINE_LEVELS = {
  "container.cpu.utilization": [3.4, 1.2],
  "container.memory.percent": [34, 4],
  "container.memory.usage.total": [183500800, 12000000],
  "container.network.io.usage.rx_bytes": [2400000, 600000],
  "container.blockio.io_service_bytes_recursive": [12500000, 2500000],
};

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
window.__dockerSwarmPagesFixture = fixture;

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
  DockerSwarmCluster: [cluster],
  DockerSwarmResource: inventory,
  MetricType: metricTypes,
  // The side menu's activity counts: nothing open here.
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
  Incident: [],
  Alert: openAlerts,
  ScheduledMaintenance: [],
  // What the Recommendations menu item reads: no monitors, nothing dismissed.
  Monitor: [],
  RecommendationDismissal: [],
  // The services the metrics list names beside a metric: none here.
  Service: [],
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
  return "sam@acme-swarm.example";
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

/*
 * The metrics list: which metrics the swarm sent in the range (one row per
 * name), and a smooth sparkline for each.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  if (modelName === tableName(Metric)) {
    const data = metricTypes.map((metric) => {
      const row = new options.modelType();
      row.name = metric.name;
      return row;
    });
    return { data, count: data.length, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (modelType) => {
  fixture.unhandled.push({
    kind: "analytics.count",
    modelName: tableName(modelType),
  });
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({ modelName, name: query.name || null });

  if (modelName !== tableName(Metric)) {
    fixture.unhandled.push({ kind: "aggregate", modelName });
    return { data: [] };
  }

  const level = SPARKLINE_LEVELS[query.name];
  if (!level) {
    fixture.unhandled.push({ kind: "aggregate", modelName, name: query.name });
    return { data: [] };
  }

  const [base, swing] = level;
  const data = [];
  for (let step = 30; step >= 0; step--) {
    const time = new Date(LOADED_AT - step * MINUTE);
    data.push({
      timestamp: time.toISOString(),
      value: base + swing * Math.sin(step / 4),
    });
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

  // The cluster's side menu counts, from its inventory.
  if (
    method === "POST" &&
    parsed.pathname.includes("/docker-swarm-resource/inventory-summary/")
  ) {
    const countOf = (kind) => {
      return inventory.filter((row) => {
        return row.kind === kind;
      }).length;
    };
    return ok({
      nodeCount: countOf("Node"),
      serviceCount: countOf("Service"),
      taskCount: countOf("Task"),
      stackCount: countOf("Stack"),
      networkCount: countOf("Network"),
      secretCount: 0,
      configCount: 0,
      volumeCount: 0,
    });
  }

  // The metrics list's search bar: the attribute keys it offers.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/metrics/get-attributes")
  ) {
    return ok({
      attributes: [
        "resource.docker.swarm.cluster.name",
        "resource.docker.swarm.service.name",
      ],
    });
  }

  /*
   * The Overview's AI agent card: answered "no AI agent yet", as the server
   * answers for a swarm nobody installed one on.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "DockerSwarmCluster",
      resourceId: CLUSTER_ID,
      resourceName: CLUSTER_NAME,
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the Docker Swarm AI agent on a manager node.",
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
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW, SwarmOverview],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES, SwarmNodes],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES, SwarmServices],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS, SwarmTasks],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL, SwarmNodeDetail],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL, SwarmServiceDetail],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL, SwarmTaskDetail],
  [PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS, SwarmMetrics],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(
  SwarmLayout,
  PageMap.DOCKER_SWARM_CLUSTER_VIEW,
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
          <span className="text-sm text-gray-500">Acme Swarm</span>
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

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
