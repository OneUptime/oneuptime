/*
 * Offline fixture for the chart drag-to-zoom regressions (issue #4105).
 *
 * Three production pages, each inside its production View layout
 * (ModelPage + side menu), mounted under their real RouteMap patterns:
 *
 *   KUBERNETES_CLUSTER_VIEW           /dashboard/:projectId/kubernetes/:id
 *                                     Pages/Kubernetes/View/{Layout,Index}
 *   KUBERNETES_CLUSTER_VIEW_INSIGHTS  /dashboard/:projectId/kubernetes/:id/insights
 *                                     Pages/Kubernetes/View/{Layout,Insights}
 *   HOST_VIEW                         /dashboard/:projectId/host/:id
 *                                     Pages/Host/View/{Layout,Overview}
 *
 * Only the data boundary (ModelAPI / AnalyticsModelAPI / API) and the
 * signed-in user are replaced. Every record is fabricated for a generic
 * "Acme Platform" workspace, and the fixture header says so.
 *
 * Telemetry is generated, not stored: every Metric aggregate is answered
 * from a catalogue of series (metric name + attributes + a smooth value
 * function of time), sampled once a minute inside the requested time
 * filter and bucketed the way the analytics server buckets it
 * (AggregationIntervalUtil, toStartOfInterval). So a chart is never empty
 * whatever window a zoom asks for, and the same instant always carries the
 * same value, zoomed or not. Values are a pure function of time: the
 * fixture never reads the clock. The spec pins the browser clock to
 * NOW = 2026-09-21T12:00:00Z, so "Past 30 Minutes" is always
 * 11:30-12:00 UTC.
 *
 * Every data request is recorded, in order, on
 * window.__chartTimeZoomFixture.requests:
 *
 *   { seq, kind, modelName, ... }
 *   kind: getItem | getList | count | updateById | analytics.getList
 *         | analytics.count | aggregate | api
 *   aggregate: metricName, attributes, aggregationType, groupBy,
 *              groupByAttributeKeys, aggregationInterval,
 *              window: { start, end } (ISO, from startTimestamp /
 *              endTimestamp), queryTime: { start, end } (the query's own
 *              InBetween), interval and rows (what came back)
 *   lists and counts: query, select, sort, limit, skip, and
 *              window: { column, start, end } when the query filters a
 *              column by an InBetween
 *   getItem, updateById: id, select or body
 *   api: method, url, body
 *
 * Anything the fixture does not model (a table, an analytics model, a
 * metric name or an API URL) lands on .unhandled as well. The spec asserts
 * `unhandled` is empty. .dataset holds the ids and identifiers.
 *
 * Query parameters (parsed once per page load):
 *   ?theme=dark   adds html.dark (handled by server.js).
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import KubernetesClusterViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Layout";
import KubernetesClusterOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import KubernetesClusterInsights from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import HostViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Layout";
import HostOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import RouteMap, {
  RouteUtil,
} from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Host from "Common/Models/DatabaseModels/Host";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import Label from "Common/Models/DatabaseModels/Label";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * ---------------------------------------------------------------------------
 * Clock and ids
 * ---------------------------------------------------------------------------
 */
const NOW = new Date("2026-09-21T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GIB = 1024 * 1024 * 1024;

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID = uuid("60000000", 1);
const HOST_ID = uuid("62000000", 1);
const ID = {
  incidentState: (number) => uuid("21000000", number),
  alertState: (number) => uuid("31000000", number),
  maintenanceState: (number) => uuid("41000000", number),
  label: (number) => uuid("72000000", number),
  user: (number) => uuid("80000000", number),
  node: (number) => uuid("63000000", number),
};
let rowCounter = 0;
function rowId() {
  rowCounter += 1;
  return uuid("90000000", rowCounter);
}

const projectObjectId = new ObjectID(PROJECT_ID);

const CLUSTER_IDENTIFIER = "prod-eu-west-1";
const HOST_IDENTIFIER = "api-gateway-01";

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  now: NOW.toISOString(),
  dataset: {
    projectId: PROJECT_ID,
    clusterId: CLUSTER_ID,
    clusterIdentifier: CLUSTER_IDENTIFIER,
    hostId: HOST_ID,
    hostIdentifier: HOST_IDENTIFIER,
  },
  requests: [],
  unhandled: [],
};
window.__chartTimeZoomFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function record(entry) {
  const full = { seq: fixture.requests.length + 1, ...entry };
  fixture.requests.push(full);
  return full;
}

function ok(data) {
  return new HTTPResponse(200, serialize(data), {});
}

function fail(statusCode, message) {
  return new HTTPErrorResponse(statusCode, { message }, {});
}

function make(modelType, record) {
  return Object.assign(new modelType(), record);
}

function toTime(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  return new Date(value).getTime();
}

function toIso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const time = toTime(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/*
 * The first InBetween a read filters on (time, createdAt, ...), so the
 * spec can see which window a list read asked for.
 */
function windowOf(query) {
  for (const [column, condition] of Object.entries(query || {})) {
    if (condition instanceof InBetween) {
      return {
        column,
        start: toIso(condition.startValue),
        end: toIso(condition.endValue),
      };
    }
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * In-memory tables, keyed by model table name. Records are plain objects
 * whose relation values are already model instances; every read hands out a
 * fresh model instance holding only the selected columns, as the API does.
 * ---------------------------------------------------------------------------
 */
const tables = new Map();

function tableName(modelType) {
  return new modelType().tableName;
}

function table(modelType) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    tables.set(name, { modelType, records: [] });
  }
  return tables.get(name).records;
}

function insert(modelType, record) {
  const full = { _id: rowId(), projectId: projectObjectId, ...record };
  table(modelType).push(full);
  return make(modelType, full);
}

function idOf(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && "_id" in value && value._id) {
    return String(value._id);
  }
  return String(value);
}

function comparable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "object" && value.constructor !== Object) {
    return value.toString();
  }
  return value;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.constructor === Object || value.constructor === undefined)
  );
}

function matchesCondition(actual, condition) {
  if (condition instanceof Includes) {
    const values = condition.values.map((value) => {
      return idOf(value);
    });
    // A relation list (Incident.kubernetesClusters) matches when any does.
    if (Array.isArray(actual)) {
      return actual.some((item) => {
        return values.includes(idOf(item));
      });
    }
    return values.includes(idOf(actual));
  }
  if (condition instanceof InBetween) {
    if (actual === null || actual === undefined) {
      return false;
    }
    const time = toTime(actual);
    return (
      time >= toTime(condition.startValue) && time <= toTime(condition.endValue)
    );
  }
  if (condition instanceof Search) {
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(condition.value).toLowerCase());
  }
  if (condition instanceof NotEqual) {
    return String(comparable(actual)) !== String(comparable(condition.value));
  }
  if (
    condition !== null &&
    typeof condition === "object" &&
    !isPlainObject(condition) &&
    !(condition instanceof ObjectID) &&
    !(condition instanceof Date)
  ) {
    // Other query operators are not modelled: match.
    return true;
  }
  // A nested relation filter: { kubernetesClusters: { _id: "..." } }.
  if (isPlainObject(condition)) {
    if (Array.isArray(actual)) {
      return actual.some((item) => {
        return matches(item, condition);
      });
    }
    if (actual && typeof actual === "object") {
      return matches(actual, condition);
    }
    return false;
  }
  return String(comparable(actual)) === String(comparable(condition));
}

function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || key === "projectId") {
      continue;
    }
    if (!matchesCondition(record[key], condition)) {
      return false;
    }
  }
  return true;
}

function sortRecords(records, sort) {
  const entries = Object.entries(sort || {});
  if (entries.length === 0) {
    return records;
  }
  return [...records].sort((left, right) => {
    for (const [key, order] of entries) {
      const a = comparable(left[key]);
      const b = comparable(right[key]);
      if (a === b) {
        continue;
      }
      const direction = order === SortOrder.Descending ? -1 : 1;
      if (a === undefined || a === null) {
        return direction;
      }
      if (b === undefined || b === null) {
        return -direction;
      }
      return a > b ? direction : -direction;
    }
    return 0;
  });
}

/*
 * A relation value cut down to its selected columns. The id always comes
 * back, as it does from the API.
 */
function projectValue(value, subSelect) {
  if (
    subSelect === true ||
    subSelect === undefined ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      return projectValue(item, subSelect);
    });
  }
  if (
    typeof value === "object" &&
    typeof subSelect === "object" &&
    !isPlainObject(value) &&
    "_id" in value
  ) {
    const copy = new value.constructor();
    copy._id = value._id;
    for (const [key, nested] of Object.entries(subSelect)) {
      if (value[key] !== undefined) {
        copy[key] = projectValue(value[key], nested);
      }
    }
    return copy;
  }
  return value;
}

function projectRecord(modelType, record, select) {
  if (!select) {
    return make(modelType, record);
  }
  const out = { _id: record._id };
  for (const [key, subSelect] of Object.entries(select)) {
    if (record[key] !== undefined) {
      out[key] = projectValue(record[key], subSelect);
    }
  }
  return make(modelType, out);
}

/*
 * ---------------------------------------------------------------------------
 * Catalogue: project, people, labels, states
 * ---------------------------------------------------------------------------
 */
const project = make(Project, { _id: PROJECT_ID, name: "Acme Platform" });

const viewer = insert(User, {
  _id: ID.user(1),
  name: new Name("Jordan Lee"),
  email: new Email("jordan.lee@acme-platform.example"),
});

const productionLabel = insert(Label, {
  _id: ID.label(1),
  name: "production",
  color: new Color("#4f46e5"),
});

/*
 * Every table a side menu, a badge or an activity card counts. They are
 * empty on purpose: no incident, alert or maintenance is open on either
 * resource, and no monitor or dismissal exists yet.
 */
table(Incident);
table(Alert);
table(ScheduledMaintenance);
table(Monitor);
table(RecommendationDismissal);

[
  ["Created", false],
  ["Acknowledged", false],
  ["Resolved", true],
].forEach(([name, isResolvedState], index) => {
  insert(IncidentState, {
    _id: ID.incidentState(index + 1),
    name,
    order: index + 1,
    isResolvedState,
  });
  insert(AlertState, {
    _id: ID.alertState(index + 1),
    name,
    order: index + 1,
    isResolvedState,
  });
});

[
  ["Scheduled", false, false],
  ["Ongoing", false, false],
  ["Ended", true, false],
  ["Completed", false, true],
].forEach(([name, isEndedState, isResolvedState], index) => {
  insert(ScheduledMaintenanceState, {
    _id: ID.maintenanceState(index + 1),
    name,
    order: index + 1,
    isEndedState,
    isResolvedState,
  });
});

/*
 * ---------------------------------------------------------------------------
 * Kubernetes cluster: three workers, a handful of workloads
 * ---------------------------------------------------------------------------
 */
insert(KubernetesCluster, {
  _id: CLUSTER_ID,
  name: "Production (eu-west-1)",
  slug: "production-eu-west-1",
  description: "Customer-facing workloads for the EU region.",
  clusterIdentifier: CLUSTER_IDENTIFIER,
  provider: "EKS",
  otelCollectorStatus: "connected",
  agentVersion: "1.9.0",
  lastSeenAt: ago(20 * SECOND),
  nodeCount: 3,
  podCount: 24,
  namespaceCount: 6,
  labels: [productionLabel],
  createdAt: ago(212 * DAY),
});

/*
 * Each node: allocatable cores and memory, and the shape of its CPU
 * (cores in use), memory and filesystem curves. worker-2 runs the batch
 * job whose CPU spike (centred 17 minutes before NOW) is the thing a
 * reader zooms into.
 */
const NODES = [
  {
    number: 1,
    name: "worker-1",
    cores: 4,
    memoryBytes: 16 * GIB,
    cpu: { base: 1.35, amplitude: 0.25, period: 23, phase: 0.3 },
    memory: { base: 7.1 * GIB, amplitude: 0.35 * GIB, period: 41, phase: 1.1 },
    filesystemUsed: 41.5 * GIB,
    filesystemTotal: 96 * GIB,
    receive: 310000,
    transmit: 145000,
  },
  {
    number: 2,
    name: "worker-2",
    cores: 4,
    memoryBytes: 16 * GIB,
    cpu: { base: 1.7, amplitude: 0.3, period: 31, phase: 2.2 },
    memory: { base: 8.4 * GIB, amplitude: 0.4 * GIB, period: 37, phase: 0.4 },
    filesystemUsed: 52.2 * GIB,
    filesystemTotal: 96 * GIB,
    receive: 420000,
    transmit: 198000,
    spike: { at: ago(17 * MINUTE).getTime(), width: 3 * MINUTE, height: 1.6 },
  },
  {
    number: 3,
    name: "worker-3",
    cores: 4,
    memoryBytes: 16 * GIB,
    cpu: { base: 1.1, amplitude: 0.2, period: 19, phase: 4.1 },
    memory: { base: 6.3 * GIB, amplitude: 0.3 * GIB, period: 29, phase: 2.9 },
    filesystemUsed: 38.9 * GIB,
    filesystemTotal: 96 * GIB,
    receive: 260000,
    transmit: 121000,
  },
];

NODES.forEach((node) => {
  insert(KubernetesResource, {
    _id: ID.node(node.number),
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    kind: "Node",
    name: node.name,
    isReady: true,
    hasMemoryPressure: false,
    hasDiskPressure: false,
    hasPidPressure: false,
    status: {
      allocatable: {
        cpu: String(node.cores),
        memory: `${node.memoryBytes / GIB}Gi`,
      },
      capacity: {
        cpu: String(node.cores),
        memory: `${node.memoryBytes / GIB}Gi`,
      },
    },
    lastSeenAt: ago(30 * SECOND),
  });
});

const PODS = [
  ["checkout-api-7c9d8b6f5-x2k4p", "shop", "worker-1", 0.42, 612],
  ["checkout-api-7c9d8b6f5-q8m1z", "shop", "worker-3", 0.38, 598],
  ["payments-worker-5f7b9c8d4-h6n2t", "shop", "worker-2", 0.31, 744],
  ["search-indexer-6b8f7d9c5-r4w7v", "search", "worker-2", 0.55, 1310],
  ["redis-cache-0", "data", "worker-1", 0.12, 402],
  [
    "ingress-nginx-controller-8d6c5b7f9-j3p5s",
    "ingress-nginx",
    "worker-3",
    0.18,
    236,
  ],
  ["report-builder-28791440-t9x3q", "batch", "worker-2", 0.09, 318],
].map(([name, namespace, node, cores, memoryMiB], index) => {
  return {
    name,
    namespace,
    node,
    cpu: {
      base: cores,
      amplitude: cores * 0.2,
      period: 17 + index * 3,
      phase: index,
    },
    memory: {
      base: memoryMiB * 1024 * 1024,
      amplitude: memoryMiB * 1024 * 1024 * 0.04,
      period: 43 + index * 5,
      phase: index * 0.7,
    },
    // The batch pod is what drives worker-2's spike.
    spike: name.startsWith("report-builder")
      ? { at: ago(17 * MINUTE).getTime(), width: 3 * MINUTE, height: 1.5 }
      : undefined,
  };
});

const INVENTORY_SUMMARY = {
  nodeCount: 3,
  podCount: 24,
  namespaceCount: 6,
  deploymentCount: 9,
  statefulSetCount: 2,
  daemonSetCount: 3,
  jobCount: 1,
  cronJobCount: 2,
  containerCount: 31,
  pvcCount: 4,
  pvCount: 4,
  hpaCount: 2,
  vpaCount: 0,
  podPhaseCounts: { running: 23, pending: 0, failed: 0, succeeded: 1 },
  nodeReadyCounts: { ready: 3, notReady: 0 },
  nodePressureCounts: { memoryPressure: 0, diskPressure: 0, pidPressure: 0 },
  degradedPods: [],
  degradedNodes: [],
};

/*
 * ---------------------------------------------------------------------------
 * Host
 * ---------------------------------------------------------------------------
 */
insert(Host, {
  _id: HOST_ID,
  name: "api-gateway-01",
  slug: "api-gateway-01",
  description: "Edge API gateway in front of the checkout services.",
  hostIdentifier: HOST_IDENTIFIER,
  otelCollectorStatus: "connected",
  agentVersion: "1.9.0",
  lastSeenAt: ago(15 * SECOND),
  osType: "linux",
  osVersion: "Ubuntu 24.04.1 LTS",
  hostArch: "amd64",
  hostType: "vm",
  hostIpAddresses: "10.20.4.21, 172.17.0.1",
  cpuCores: 4,
  totalMemoryBytes: 16 * GIB,
  processCount: 214,
  containerRuntime: "containerd",
  labels: [productionLabel],
  createdAt: ago(305 * DAY),
});

/*
 * ---------------------------------------------------------------------------
 * Telemetry: a catalogue of series, sampled once a minute
 * ---------------------------------------------------------------------------
 */
const SAMPLE_OFFSET = 7 * SECOND;

function wave(time, shape) {
  const minutes = time / MINUTE;
  let value =
    shape.base +
    shape.amplitude *
      Math.sin((2 * Math.PI * minutes) / shape.period + shape.phase) +
    shape.amplitude *
      0.35 *
      Math.sin(
        (2 * Math.PI * minutes) / (shape.period / 3.7) + shape.phase * 1.9,
      );
  if (shape.spike) {
    const distance = (time - shape.spike.at) / shape.spike.width;
    value += shape.spike.height * Math.exp(-distance * distance);
  }
  return value;
}

/*
 * A cumulative byte counter growing at about `rate` B/s. The wobble's
 * slope never exceeds a fifth of the rate, so the counter never goes
 * backwards.
 */
function counter(time, rate, phase) {
  const seconds = time / SECOND;
  const period = 600;
  return Math.round(
    rate * seconds +
      ((0.2 * rate * period) / (2 * Math.PI)) *
        Math.sin((2 * Math.PI * seconds) / period + phase),
  );
}

const SERIES = [];

function series(metricName, attributes, value) {
  SERIES.push({ metricName, attributes, value });
}

const clusterAttributes = {
  "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
};

series("oneuptime.host.heartbeat", { ...clusterAttributes }, () => {
  return 1;
});

NODES.forEach((node, index) => {
  const nodeAttributes = {
    ...clusterAttributes,
    "resource.k8s.node.name": node.name,
  };
  // Grows about 40 MiB an hour, with log rotation noise.
  const filesystemUsed = (time) => {
    return (
      node.filesystemUsed +
      ((time - NOW.getTime()) / HOUR) * 40 * 1024 * 1024 +
      Math.sin(time / (7 * MINUTE) + index) * 64 * 1024 * 1024
    );
  };
  series("k8s.node.allocatable_cpu", nodeAttributes, () => {
    return node.cores;
  });
  series("k8s.node.cpu.utilization", nodeAttributes, (time) => {
    return Math.max(0.05, wave(time, { ...node.cpu, spike: node.spike }));
  });
  series("k8s.node.memory.usage", nodeAttributes, (time) => {
    return Math.round(wave(time, node.memory));
  });
  series("k8s.node.filesystem.usage", nodeAttributes, (time) => {
    return Math.round(filesystemUsed(time));
  });
  series("k8s.node.filesystem.available", nodeAttributes, (time) => {
    return Math.round(node.filesystemTotal - filesystemUsed(time));
  });
  ["receive", "transmit"].forEach((direction) => {
    series(
      "k8s.node.network.io",
      { ...nodeAttributes, interface: "eth0", direction },
      (time) => {
        return counter(
          time,
          node[direction],
          index + (direction === "receive" ? 0 : 2),
        );
      },
    );
  });
});

PODS.forEach((pod) => {
  const podAttributes = {
    ...clusterAttributes,
    "resource.k8s.namespace.name": pod.namespace,
    "resource.k8s.pod.name": pod.name,
    "resource.k8s.node.name": pod.node,
  };
  series("k8s.pod.cpu.utilization", podAttributes, (time) => {
    return Math.max(0.01, wave(time, { ...pod.cpu, spike: pod.spike }));
  });
  series("k8s.pod.memory.usage", podAttributes, (time) => {
    return Math.round(wave(time, pod.memory));
  });
});

const hostAttributes = { "resource.host.name": HOST_IDENTIFIER };

series("oneuptime.host.heartbeat", { ...hostAttributes }, () => {
  return 1;
});

// Busy fraction per CPU and state; the gateway gets a burst at 11:43.
const HOST_BURST = { at: ago(17 * MINUTE).getTime(), width: 3 * MINUTE };
["cpu0", "cpu1", "cpu2", "cpu3"].forEach((cpu, index) => {
  const cpuAttributes = { ...hostAttributes, cpu };
  series(
    "system.cpu.utilization",
    { ...cpuAttributes, state: "user" },
    (time) => {
      return Math.min(
        0.95,
        wave(time, {
          base: 0.24,
          amplitude: 0.06,
          period: 21 + index * 2,
          phase: index,
          spike: { ...HOST_BURST, height: 0.38 },
        }),
      );
    },
  );
  series(
    "system.cpu.utilization",
    { ...cpuAttributes, state: "system" },
    (time) => {
      return wave(time, {
        base: 0.07,
        amplitude: 0.015,
        period: 13 + index,
        phase: index * 1.3,
        spike: { ...HOST_BURST, height: 0.06 },
      });
    },
  );
  series(
    "system.cpu.utilization",
    { ...cpuAttributes, state: "idle" },
    (time) => {
      return Math.max(
        0.02,
        1 -
          wave(time, {
            base: 0.31,
            amplitude: 0.075,
            period: 21 + index * 2,
            phase: index,
            spike: { ...HOST_BURST, height: 0.44 },
          }),
      );
    },
  );
});

// Memory states are fractions that add up to 1.
const HOST_MEMORY_USED = {
  base: 0.62,
  amplitude: 0.025,
  period: 47,
  phase: 0.8,
};
const HOST_MEMORY_CACHED = {
  base: 0.21,
  amplitude: 0.01,
  period: 53,
  phase: 1.7,
};
series(
  "system.memory.utilization",
  { ...hostAttributes, state: "used" },
  (time) => {
    return wave(time, HOST_MEMORY_USED);
  },
);
series(
  "system.memory.utilization",
  { ...hostAttributes, state: "cached" },
  (time) => {
    return wave(time, HOST_MEMORY_CACHED);
  },
);
series(
  "system.memory.utilization",
  { ...hostAttributes, state: "free" },
  (time) => {
    return 1 - wave(time, HOST_MEMORY_USED) - wave(time, HOST_MEMORY_CACHED);
  },
);
series("system.cpu.load_average.1m", { ...hostAttributes }, (time) => {
  return wave(time, {
    base: 1.45,
    amplitude: 0.3,
    period: 17,
    phase: 0.2,
    spike: { ...HOST_BURST, height: 1.9 },
  });
});
[
  ["running", 4, 1.5],
  ["sleeping", 201, 6],
  ["blocked", 0.4, 0.4],
].forEach(([status, base, amplitude], index) => {
  series("system.processes.count", { ...hostAttributes, status }, (time) => {
    return Math.max(
      0,
      Math.round(
        wave(time, { base, amplitude, period: 11 + index * 4, phase: index }),
      ),
    );
  });
});

const HOST_MOUNTS = [
  {
    mountpoint: "/",
    device: "/dev/nvme0n1p1",
    type: "ext4",
    total: 96 * GIB,
    used: 58.4 * GIB,
    reserved: 4.8 * GIB,
  },
  {
    mountpoint: "/boot/efi",
    device: "/dev/nvme0n1p15",
    type: "vfat",
    total: 0.1 * GIB,
    used: 0.006 * GIB,
    reserved: 0,
  },
];
HOST_MOUNTS.forEach((mount, index) => {
  const mountAttributes = {
    ...hostAttributes,
    device: mount.device,
    mountpoint: mount.mountpoint,
    type: mount.type,
  };
  const usedAt = (time) => {
    return (
      mount.used +
      (index === 0
        ? ((time - NOW.getTime()) / HOUR) * 25 * 1024 * 1024 +
          Math.sin(time / (9 * MINUTE)) * 48 * 1024 * 1024
        : 0)
    );
  };
  series(
    "system.filesystem.usage",
    { ...mountAttributes, state: "used" },
    (time) => {
      return Math.round(usedAt(time));
    },
  );
  series(
    "system.filesystem.usage",
    { ...mountAttributes, state: "reserved" },
    () => {
      return Math.round(mount.reserved);
    },
  );
  series(
    "system.filesystem.usage",
    { ...mountAttributes, state: "free" },
    (time) => {
      return Math.round(mount.total - mount.reserved - usedAt(time));
    },
  );
});
[
  ["eth0", 520000, 380000],
  ["lo", 42000, 42000],
].forEach(([device, receive, transmit], index) => {
  series(
    "system.network.io",
    { ...hostAttributes, device, direction: "receive" },
    (time) => {
      return counter(time, receive, index);
    },
  );
  series(
    "system.network.io",
    { ...hostAttributes, device, direction: "transmit" },
    (time) => {
      return counter(time, transmit, index + 1.5);
    },
  );
});
[
  ["1", "systemd", 0.001],
  ["812", "envoy", 0.18],
  ["1044", "otelcol-contrib", 0.02],
  ["1290", "containerd", 0.01],
].forEach(([pid, executable, base], index) => {
  series(
    "process.cpu.utilization",
    {
      ...hostAttributes,
      "resource.process.pid": pid,
      "resource.process.executable.name": executable,
    },
    (time) => {
      return Math.max(
        0,
        wave(time, {
          base,
          amplitude: base * 0.2,
          period: 9 + index,
          phase: index,
        }),
      );
    },
  );
});

const MODELLED_METRICS = new Set(
  SERIES.map((item) => {
    return item.metricName;
  }),
);

/*
 * Native units, as MetricType rows. CPU is in cores ("{cpu}", which no
 * display unit converts), so the Insights CPU% transform sees cores.
 */
const METRIC_UNITS = {
  "k8s.node.allocatable_cpu": "{cpu}",
  "k8s.node.cpu.utilization": "{cpu}",
  "k8s.node.memory.usage": "By",
  "k8s.node.filesystem.usage": "By",
  "k8s.node.filesystem.available": "By",
  "k8s.node.network.io": "By",
  "k8s.pod.cpu.utilization": "{cpu}",
  "k8s.pod.memory.usage": "By",
  "oneuptime.host.heartbeat": "1",
  "system.cpu.utilization": "1",
  "system.memory.utilization": "1",
  "system.cpu.load_average.1m": "{thread}",
  "system.processes.count": "{processes}",
  "system.filesystem.usage": "By",
  "system.network.io": "By",
  "process.cpu.utilization": "1",
};
Object.entries(METRIC_UNITS)
  .sort(([left], [right]) => {
    return left.localeCompare(right);
  })
  .forEach(([name, unit]) => {
    insert(MetricType, {
      name,
      unit,
      isMonotonic: name.endsWith(".io"),
      aggregationTemporality: name.endsWith(".io")
        ? "Cumulative"
        : "Unspecified",
    });
  });

function attributeValue(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && "value" in value) {
    return String(value.value);
  }
  return String(value);
}

function seriesMatches(item, metricName, attributes) {
  if (item.metricName !== metricName) {
    return false;
  }
  for (const [key, expected] of Object.entries(attributes || {})) {
    const wanted = attributeValue(expected);
    if (wanted === undefined) {
      continue;
    }
    if (String(item.attributes[key] ?? "") !== wanted) {
      return false;
    }
  }
  return true;
}

function reduceValues(values, aggregationType) {
  if (values.length === 0) {
    return null;
  }
  switch (aggregationType) {
    case AggregationType.Sum:
      return values.reduce((sum, value) => {
        return sum + value;
      }, 0);
    case AggregationType.Max:
      return Math.max(...values);
    case AggregationType.Min:
      return Math.min(...values);
    case AggregationType.Count:
      return values.length;
    default:
      return (
        values.reduce((sum, value) => {
          return sum + value;
        }, 0) / values.length
      );
  }
}

/*
 * The server's answer to an aggregate: samples inside the query's time
 * filter, bucketed on the interval the server derives from
 * startTimestamp / endTimestamp (or the pinned aggregationInterval), one
 * row per bucket, or per bucket and attribute set when grouped.
 */
function aggregateMetric(aggregateBy) {
  const query = aggregateBy.query || {};
  const metricName = String(query.name || "");
  const time = query.time instanceof InBetween ? query.time : null;
  const windowStart = toTime(
    time ? time.startValue : aggregateBy.startTimestamp,
  );
  const windowEnd = toTime(time ? time.endValue : aggregateBy.endTimestamp);
  const interval = AggregationIntervalUtil.getAggregationIntervalForWindow({
    startDate: new Date(toTime(aggregateBy.startTimestamp ?? windowStart)),
    endDate: new Date(toTime(aggregateBy.endTimestamp ?? windowEnd)),
    aggregationInterval: aggregateBy.aggregationInterval,
  });
  const bucketMs = AggregationIntervalUtil.getAggregationIntervalMs(interval);
  const grouped = Boolean(
    aggregateBy.groupBy && aggregateBy.groupBy.attributes,
  );
  const groupKeys = aggregateBy.groupByAttributeKeys || [];
  const matching = SERIES.filter((item) => {
    return seriesMatches(item, metricName, query.attributes);
  });

  const buckets = new Map();
  const firstSample =
    Math.ceil((windowStart - SAMPLE_OFFSET) / MINUTE) * MINUTE + SAMPLE_OFFSET;
  for (let sample = firstSample; sample <= windowEnd; sample += MINUTE) {
    const bucket = Math.floor(sample / bucketMs) * bucketMs;
    matching.forEach((item) => {
      let groupKey = "";
      let groupAttributes = null;
      if (groupKeys.length > 0) {
        groupAttributes = {};
        groupKeys.forEach((key) => {
          groupAttributes[key] = item.attributes[key];
        });
        groupKey = JSON.stringify(groupAttributes);
      } else if (grouped) {
        groupAttributes = item.attributes;
        groupKey = JSON.stringify(item.attributes);
      }
      const key = `${bucket}|${groupKey}`;
      if (!buckets.has(key)) {
        buckets.set(key, { bucket, groupAttributes, values: [] });
      }
      buckets.get(key).values.push(item.value(sample));
    });
  }

  const rows = Array.from(buckets.values())
    .sort((left, right) => {
      return left.bucket - right.bucket;
    })
    .map((entry) => {
      const row = {
        timestamp: new Date(entry.bucket).toISOString(),
        value: reduceValues(entry.values, aggregateBy.aggregationType),
      };
      if (entry.groupAttributes) {
        row.attributes = { ...entry.groupAttributes };
      }
      return row;
    });

  return { rows, interval };
}

/*
 * ---------------------------------------------------------------------------
 * Kubernetes warning events (the Log table, k8sobjects receiver shape)
 * ---------------------------------------------------------------------------
 */
function kv(values) {
  return {
    kvlistValue: {
      values: Object.entries(values).map(([key, value]) => {
        return {
          key,
          value: typeof value === "string" ? { stringValue: value } : value,
        };
      }),
    },
  };
}

[
  [
    ago(6 * MINUTE),
    "BackOff",
    "Back-off restarting failed container indexer in pod search-indexer-6b8f7d9c5-r4w7v",
    "Pod",
    "search-indexer-6b8f7d9c5-r4w7v",
    "search",
  ],
  [
    ago(18 * MINUTE),
    "FailedScheduling",
    "0/3 nodes are available: 3 Insufficient cpu. preemption: 0/3 nodes are available.",
    "Pod",
    "report-builder-28791440-t9x3q",
    "batch",
  ],
].forEach(([time, reason, note, kind, name, namespace]) => {
  insert(Log, {
    time,
    body: JSON.stringify(
      kv({
        type: "MODIFIED",
        object: kv({
          type: "Warning",
          reason,
          note,
          regarding: kv({ kind, name, namespace }),
        }),
      }),
    ),
    attributes: {
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
    },
  });
});

table(ChangeEvent);

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return viewer.id;
};
UserUtil.getName = () => {
  return viewer.name;
};
UserUtil.getEmail = () => {
  return viewer.email;
};
PermissionUtil.getAllPermissions = () => {
  return [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectOwner,
  ];
};
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};
AnalyticsModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

function knownTable(modelType, kind, extra) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    fixture.unhandled.push({ kind, modelName: name, ...extra });
    return null;
  }
  return tables.get(name);
}

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  record({
    kind: "getItem",
    modelName,
    id,
    select: serialize(options.select),
  });
  const known = knownTable(options.modelType, "getItem", { id });
  const found = known?.records.find((item) => {
    return String(item._id) === id;
  });
  if (known && !found) {
    fixture.unhandled.push({ kind: "getItem", modelName, id, missing: true });
  }
  return found ? projectRecord(options.modelType, found, options.select) : null;
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  record({
    kind: "getList",
    modelName,
    query: serialize(options.query),
    window: windowOf(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  const known = knownTable(options.modelType, "getList", {
    query: serialize(options.query),
  });
  const records = sortRecords(
    (known?.records || []).filter((item) => {
      return matches(item, options.query);
    }),
    options.sort,
  );
  return {
    data: records.slice(skip, skip + limit).map((item) => {
      return projectRecord(options.modelType, item, options.select);
    }),
    count: records.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  record({
    kind: "count",
    modelName,
    query: serialize(options.query),
    window: windowOf(options.query),
  });
  const known = knownTable(options.modelType, "count", {
    query: serialize(options.query),
  });
  return (known?.records || []).filter((item) => {
    return matches(item, options.query);
  }).length;
};

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  record({
    kind: "updateById",
    modelName,
    id,
    body: serialize(options.data),
  });
  const found = (tables.get(modelName)?.records || []).find((item) => {
    return String(item._id) === id;
  });
  if (!found) {
    fixture.unhandled.push({ kind: "updateById", modelName, id });
  } else {
    Object.assign(found, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

/*
 * Raw Metric rows are only ever listed for exemplars (rows that carry a
 * traceId). Infrastructure metrics from kubeletstats and hostmetrics carry
 * none, so that table is empty.
 */
table(Metric);
const ANALYTICS_LIST_TABLES = [
  tableName(Log),
  tableName(ChangeEvent),
  tableName(Metric),
];

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  record({
    kind: "analytics.getList",
    modelName,
    query: serialize(options.query),
    window: windowOf(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  if (!ANALYTICS_LIST_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "analytics.getList", modelName });
    return { data: [], count: 0, skip, limit };
  }
  const query = { ...(options.query || {}) };
  /*
   * Map-column filters (Log.attributes) are matched key by key: every
   * requested attribute must be present with the same value.
   */
  const attributeFilter = query.attributes;
  delete query.attributes;
  const records = sortRecords(
    table(options.modelType).filter((item) => {
      if (!matches(item, query)) {
        return false;
      }
      return Object.entries(attributeFilter || {}).every(([key, value]) => {
        return String(item.attributes?.[key]) === attributeValue(value);
      });
    }),
    options.sort,
  );
  return {
    data: records.slice(skip, skip + limit).map((item) => {
      return projectRecord(options.modelType, item, options.select);
    }),
    count: records.length,
    skip,
    limit,
  };
};

AnalyticsModelAPI.count = async (modelType, query) => {
  const modelName = tableName(modelType);
  record({
    kind: "analytics.count",
    modelName,
    query: serialize(query),
    window: windowOf(query),
  });
  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  const metricName = String(query.name || "");
  const entry = record({
    kind: "aggregate",
    modelName,
    metricName,
    attributes: serialize(query.attributes),
    aggregationType: aggregateBy.aggregationType,
    groupBy: serialize(aggregateBy.groupBy),
    groupByAttributeKeys: serialize(aggregateBy.groupByAttributeKeys),
    aggregationInterval: aggregateBy.aggregationInterval,
    window: {
      start: toIso(aggregateBy.startTimestamp),
      end: toIso(aggregateBy.endTimestamp),
    },
    queryTime:
      query.time instanceof InBetween
        ? {
            start: toIso(query.time.startValue),
            end: toIso(query.time.endValue),
          }
        : null,
  });
  if (modelName !== tableName(Metric)) {
    fixture.unhandled.push({ kind: "analytics.aggregate", modelName });
    return { data: [] };
  }
  if (!MODELLED_METRICS.has(metricName)) {
    fixture.unhandled.push({
      kind: "analytics.aggregate",
      modelName,
      metricName,
    });
    return { data: [] };
  }
  const { rows, interval } = aggregateMetric(aggregateBy);
  entry.interval = interval;
  entry.rows = rows.length;
  return { data: rows };
};

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data) || {};
  record({ kind: "api", method, url, body });
  const parsed = new window.URL(url);

  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/inventory-summary/")
  ) {
    const clusterId = parsed.pathname.split("/").pop();
    if (clusterId !== CLUSTER_ID) {
      throw fail(404, "Kubernetes cluster not found.");
    }
    return ok(INVENTORY_SUMMARY);
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return ok({});
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

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function FixtureKubernetesLayout() {
  useNavigationHooks();
  return <KubernetesClusterViewLayout {...pageProps(undefined)} />;
}

function FixtureHostLayout() {
  useNavigationHooks();
  return <HostViewLayout {...pageProps(undefined)} />;
}

function StubPage(props) {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p
        data-testid="stub-page"
        data-page={props.pageKey}
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </main>
  );
}

function FixtureShell() {
  useNavigationHooks();
  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Platform</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Outlet />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route element={<FixtureShell />}>
        <Route
          path={RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW].toString()}
          element={<FixtureKubernetesLayout />}
        >
          <Route
            index
            element={
              <KubernetesClusterOverview
                {...pageProps(PageMap.KUBERNETES_CLUSTER_VIEW)}
              />
            }
          />
          <Route
            path={RouteUtil.getLastPathForKey(
              PageMap.KUBERNETES_CLUSTER_VIEW_INSIGHTS,
            )}
            element={
              <KubernetesClusterInsights
                {...pageProps(PageMap.KUBERNETES_CLUSTER_VIEW_INSIGHTS)}
              />
            }
          />
        </Route>
        <Route
          path={RouteMap[PageMap.HOST_VIEW].toString()}
          element={<FixtureHostLayout />}
        >
          <Route
            index
            element={<HostOverview {...pageProps(PageMap.HOST_VIEW)} />}
          />
        </Route>
        <Route
          path="*"
          element={<StubPage pageKey="unknown" title="Not modelled" />}
        />
      </Route>
    </Routes>
  </BrowserRouter>,
);
