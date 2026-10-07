/*
 * Offline fixture for the chart drag-to-zoom regressions (issues #4105 and
 * #4116).
 *
 * Five production pages, each inside its production layout, mounted under
 * their real RouteMap patterns:
 *
 *   KUBERNETES_CLUSTER_VIEW           /dashboard/:projectId/kubernetes/:id
 *                                     Pages/Kubernetes/View/{Layout,Index}
 *   KUBERNETES_CLUSTER_VIEW_INSIGHTS  /dashboard/:projectId/kubernetes/:id/insights
 *                                     Pages/Kubernetes/View/{Layout,Insights}
 *   HOST_VIEW                         /dashboard/:projectId/host/:id
 *                                     Pages/Host/View/{Layout,Overview}
 *   TRACES                            /dashboard/:projectId/traces
 *                                     Pages/Traces/{Layout,Index} (TracesViewer)
 *   LOGS                              /dashboard/:projectId/logs
 *                                     Pages/Logs/{Layout,Index} (LogsViewer)
 *
 * Only the data boundary (ModelAPI / AnalyticsModelAPI / API / Realtime) and
 * the signed-in user are replaced. Every record is fabricated for a generic
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
 * The explorers' spans and logs are generated the same way: a pure function
 * of the minute (a few services, each with its own rate and error burst),
 * and the span list, the log list, the lists' totals, the histograms and the
 * facet counts are all read off those same generated rows, bucketed the way
 * the server buckets them (TraceAggregationService / LogAggregationService).
 *
 * Every data request is recorded, in order, on
 * window.__chartTimeZoomFixture.requests:
 *
 *   { seq, kind, modelName, ... }
 *   kind: getItem | getList | count | updateById | analytics.getList
 *         | analytics.count | aggregate | api | realtime
 *   aggregate: metricName, attributes, aggregationType, groupBy,
 *              groupByAttributeKeys, aggregationInterval,
 *              window: { start, end } (ISO, from startTimestamp /
 *              endTimestamp), queryTime: { start, end } (the query's own
 *              InBetween), interval and rows (what came back)
 *   lists and counts: query, select, sort, limit, skip, and
 *              window: { column, start, end } when the query filters a
 *              column by an InBetween; an analytics.count also records
 *              exact (whether it was asked for exactly) and count (what
 *              came back)
 *   getItem, updateById: id, select or body
 *   api: method, url, body, and window: { start, end } when the body
 *              names a startTime / endTime (the explorers' histogram,
 *              facets and analytics requests); a histogram also records
 *              bucketSizeInMinutes and buckets (how many came back)
 *   realtime: modelName, eventType (a subscription; nothing is ever sent)
 *
 * Two gates hold answers back so a spec can choose the moment data lands
 * (both default to "immediate", which answers at once):
 *
 *   .histogramGate   the explorers' histogram, facets and analytics answers
 *   .aggregateGate   every modelled AnalyticsModelAPI.aggregate answer
 *
 *   gate.mode = "manual"   later requests wait in gate.pending
 *                          ({ seq, url or metricName, window, response })
 *   gate.deliver()         answers everything pending, in order, and
 *                          returns how many it answered
 *
 * Anything the fixture does not model (a table, an analytics model, a
 * metric name, an API URL or an explorer filter) lands on .unhandled as
 * well. The spec asserts `unhandled` is empty. .dataset holds the ids and
 * identifiers.
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
import TracesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Traces/Layout";
import TracesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Traces/Index";
import LogsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Logs/Layout";
import LogsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Logs/Index";
import RouteMap, {
  RouteUtil,
} from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import Label from "Common/Models/DatabaseModels/Label";
import LogSavedView from "Common/Models/DatabaseModels/LogSavedView";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Project from "Common/Models/DatabaseModels/Project";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "Common/Models/DatabaseModels/Service";
import TraceSavedView from "Common/Models/DatabaseModels/TraceSavedView";
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
import LogSeverity from "Common/Types/Log/LogSeverity";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
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
/*
 * A gate holds answers back until the spec lets them through, so a spec can
 * choose the moment new data lands (issue #4116: a zoom's data landing in
 * the middle of a double-click). "immediate" answers at once; "manual" parks
 * every answer in `pending` until deliver(). Switching back to "immediate"
 * does not release what is already parked: deliver() does.
 */
function createGate() {
  const gate = {
    mode: "immediate",
    pending: [],
    deliver() {
      const released = gate.pending.splice(0, gate.pending.length);
      released.forEach((entry) => {
        entry.release();
      });
      return released.length;
    },
  };
  return gate;
}

/*
 * Answers through `gate`: at once, or once the spec delivers. `entry`
 * describes the request for the spec (plain data only); `answer` builds the
 * value the caller receives.
 */
function throughGate(gate, entry, answer) {
  if (gate.mode !== "manual") {
    return answer();
  }
  return new Promise((resolve, reject) => {
    gate.pending.push({
      ...entry,
      release() {
        try {
          resolve(answer());
        } catch (error) {
          reject(error);
        }
      },
    });
  });
}

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
  histogramGate: createGate(),
  aggregateGate: createGate(),
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
  /*
   * The collector release its config stamps: older than the 0.161.0 the
   * host guide pins, so its Agent Version carries the sign
   * (AgentVersionSign.spec.ts). `?hostAgentVersion=` reports another one
   * for one page load.
   */
  agentVersion:
    new window.URLSearchParams(window.location.search).get(
      "hostAgentVersion",
    ) || "0.154.0",
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
 * Traces and Logs explorers: four services, their spans and their logs
 *
 * Nothing is stored. Each minute of each service holds a number of spans and
 * of log lines that follows a smooth wave, and every row of that minute (its
 * offset, operation, status, severity, ids) comes from a hash of the minute,
 * the service and the row's index. So any window, zoomed or not, lists,
 * charts and counts the very same rows, and nothing reads the clock.
 * checkout-api's calls to payments-worker time out in a burst centred on
 * 11:43, the minute the other pages' data peaks too.
 * ---------------------------------------------------------------------------
 */
const EXPLORER_BURST = { at: ago(17 * MINUTE).getTime(), width: 3 * MINUTE };

const EXPLORER_SERVICES = [
  {
    number: 1,
    name: "checkout-api",
    color: "#6366f1",
    description: "Cart and checkout HTTP API.",
    host: "ip-10-20-4-31.eu-west-1.compute.internal",
    instances: ["checkout-api-7c9d8b6f5-x2k4p", "checkout-api-7c9d8b6f5-q8m1z"],
    spans: { base: 9, amplitude: 4.5, period: 13, phase: 0.4 },
    logs: { base: 6, amplitude: 3.5, period: 11, phase: 1.1 },
    // Errors, per mille of a minute's rows, and the extra during the burst.
    errors: { base: 20, burst: 320 },
    errorMessage: "context deadline exceeded calling payments-worker /charge",
    operations: [
      {
        name: "POST /api/checkout",
        kind: "SPAN_KIND_SERVER",
        ms: 180,
        attributes: { "http.method": "POST", "http.route": "/api/checkout" },
      },
      {
        name: "GET /api/cart",
        kind: "SPAN_KIND_SERVER",
        ms: 42,
        attributes: { "http.method": "GET", "http.route": "/api/cart" },
      },
      { name: "SELECT orders", kind: "SPAN_KIND_CLIENT", ms: 9 },
      {
        name: "POST payments-worker /charge",
        kind: "SPAN_KIND_CLIENT",
        ms: 140,
      },
    ],
    lines: {
      [LogSeverity.Information]: [
        "Checkout completed",
        "Cart loaded",
        "Order confirmation email queued",
      ],
      [LogSeverity.Debug]: ["Cart cache hit", "Pricing rules evaluated"],
      [LogSeverity.Warning]: [
        "Retrying payments-worker /charge (attempt 2 of 3)",
      ],
      [LogSeverity.Error]: [
        "Checkout failed: context deadline exceeded calling payments-worker",
      ],
    },
  },
  {
    number: 2,
    name: "payments-worker",
    color: "#0ea5e9",
    description: "Charges cards and issues refunds.",
    host: "ip-10-20-5-12.eu-west-1.compute.internal",
    instances: ["payments-worker-5f7b9c8d4-h6n2t"],
    spans: { base: 6, amplitude: 3, period: 17, phase: 2.1 },
    logs: { base: 4, amplitude: 2.5, period: 13, phase: 0.2 },
    errors: { base: 12, burst: 180 },
    errorMessage: "card processor timed out after 2000 ms",
    operations: [
      {
        name: "POST /charge",
        kind: "SPAN_KIND_SERVER",
        ms: 130,
        attributes: { "http.method": "POST", "http.route": "/charge" },
      },
      { name: "card-processor.authorize", kind: "SPAN_KIND_CLIENT", ms: 95 },
      { name: "UPDATE payments", kind: "SPAN_KIND_CLIENT", ms: 7 },
    ],
    lines: {
      [LogSeverity.Information]: ["Charge authorized", "Refund issued"],
      [LogSeverity.Debug]: [
        "Idempotency key reused",
        "Processor latency sample",
      ],
      [LogSeverity.Warning]: ["Card processor slow to answer"],
      [LogSeverity.Error]: ["Charge failed: card processor timed out"],
    },
  },
  {
    number: 3,
    name: "search-api",
    color: "#10b981",
    description: "Catalogue search.",
    host: "ip-10-20-6-40.eu-west-1.compute.internal",
    instances: ["search-api-6b8f7d9c5-r4w7v", "search-api-6b8f7d9c5-m2d8k"],
    spans: { base: 12, amplitude: 5.5, period: 11, phase: 4.3 },
    logs: { base: 5, amplitude: 3, period: 9, phase: 3.1 },
    errors: { base: 8, burst: 0 },
    errorMessage: "index shard unavailable",
    operations: [
      {
        name: "GET /api/search",
        kind: "SPAN_KIND_SERVER",
        ms: 65,
        attributes: { "http.method": "GET", "http.route": "/api/search" },
      },
      { name: "opensearch.query", kind: "SPAN_KIND_CLIENT", ms: 38 },
    ],
    lines: {
      [LogSeverity.Information]: ["Search served", "Suggestions served"],
      [LogSeverity.Debug]: ["Query rewritten", "Result cache miss"],
      [LogSeverity.Warning]: ["Slow query over 500 ms"],
      [LogSeverity.Error]: ["Search failed: index shard unavailable"],
    },
  },
  {
    number: 4,
    name: "storefront-web",
    color: "#f59e0b",
    description: "Server-rendered storefront.",
    host: "ip-10-20-4-18.eu-west-1.compute.internal",
    instances: ["storefront-web-8d6c5b7f9-j3p5s"],
    spans: { base: 8, amplitude: 3.5, period: 19, phase: 1.7 },
    logs: { base: 3, amplitude: 2, period: 15, phase: 2.6 },
    errors: { base: 5, burst: 60 },
    errorMessage: "upstream checkout-api returned 504",
    operations: [
      {
        name: "GET /",
        kind: "SPAN_KIND_SERVER",
        ms: 120,
        attributes: { "http.method": "GET", "http.route": "/" },
      },
      {
        name: "GET /product/:slug",
        kind: "SPAN_KIND_SERVER",
        ms: 150,
        attributes: { "http.method": "GET", "http.route": "/product/:slug" },
      },
      { name: "GET checkout-api /api/cart", kind: "SPAN_KIND_CLIENT", ms: 48 },
    ],
    lines: {
      [LogSeverity.Information]: ["Page rendered", "Product page rendered"],
      [LogSeverity.Debug]: ["Template cache hit"],
      [LogSeverity.Warning]: ["Upstream checkout-api slow"],
      [LogSeverity.Error]: [
        "Render failed: upstream checkout-api returned 504",
      ],
    },
  },
];

EXPLORER_SERVICES.forEach((service) => {
  service.id = uuid("64000000", service.number);
  insert(Service, {
    _id: service.id,
    name: service.name,
    slug: service.name,
    description: service.description,
    serviceColor: new Color(service.color),
    createdAt: ago(190 * DAY),
  });
});
fixture.dataset.services = EXPLORER_SERVICES.map((service) => {
  return { id: service.id, name: service.name };
});

// Read by the explorers' resource lists and saved views; none exist yet.
table(DockerHost);
table(PodmanHost);
table(TraceSavedView);
table(LogSavedView);

// A 32-bit FNV-style hash of a few integers, mixed so neighbours differ.
function hash(...parts) {
  let value = 0x811c9dc5;
  for (const part of parts) {
    value = Math.imul(value ^ (Math.floor(part) >>> 0), 0x01000193) >>> 0;
    value ^= value >>> 15;
    value = Math.imul(value, 0x2c1b3c6d) >>> 0;
    value ^= value >>> 12;
  }
  return value >>> 0;
}

function hex(length, ...parts) {
  let digits = "";
  for (let round = 0; digits.length < length; round++) {
    digits += hash(...parts, round)
      .toString(16)
      .padStart(8, "0");
  }
  return digits.slice(0, length);
}

function hashedUuid(...parts) {
  const digits = hex(32, ...parts);
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4${digits.slice(
    13,
    16,
  )}-8${digits.slice(17, 20)}-${digits.slice(20, 32)}`;
}

// How many rows a service writes in the minute starting at `minute`.
function rowsInMinute(shape, minute) {
  return Math.max(1, Math.round(wave(minute + 30 * SECOND, shape)));
}

// Per mille of a service's rows in that minute that are errors.
function errorPerMille(service, minute) {
  const distance =
    (minute + 30 * SECOND - EXPLORER_BURST.at) / EXPLORER_BURST.width;
  return (
    service.errors.base + service.errors.burst * Math.exp(-distance * distance)
  );
}

// Every span that starts in the minute starting at `minute`.
function spansInMinute(minute) {
  const rows = [];
  EXPLORER_SERVICES.forEach((service) => {
    const count = rowsInMinute(service.spans, minute);
    const errors = errorPerMille(service, minute);
    for (let index = 0; index < count; index++) {
      const seed = [minute / MINUTE, service.number, index, 1];
      const operation =
        service.operations[hash(...seed, 1) % service.operations.length];
      const roll = hash(...seed, 2) % 1000;
      const statusCode =
        roll < errors
          ? SpanStatus.Error
          : roll < errors + 240
            ? SpanStatus.Unset
            : SpanStatus.Ok;
      const startTime = minute + (hash(...seed, 3) % MINUTE);
      const durationMs = Math.max(
        1,
        Math.round(
          operation.ms *
            (0.55 + (hash(...seed, 4) % 1000) / 1000) *
            (statusCode === SpanStatus.Error ? 2.5 : 1),
        ),
      );
      const isRootSpan = operation.kind === "SPAN_KIND_SERVER";
      rows.push({
        _id: hashedUuid(...seed, 5),
        projectId: projectObjectId,
        traceId: hex(32, ...seed, 6),
        spanId: hex(16, ...seed, 7),
        parentSpanId: isRootSpan ? "" : hex(16, ...seed, 8),
        name: operation.name,
        kind: operation.kind,
        primaryEntityId: new ObjectID(service.id),
        startTime: new Date(startTime),
        endTime: new Date(startTime + durationMs),
        durationUnixNano: durationMs * 1000000,
        statusCode,
        statusMessage:
          statusCode === SpanStatus.Error ? service.errorMessage : "",
        hasException:
          statusCode === SpanStatus.Error && hash(...seed, 9) % 3 !== 0,
        isRootSpan,
        attributes: {
          "resource.service.name": service.name,
          "resource.service.instance.id":
            service.instances[index % service.instances.length],
          "resource.host.name": service.host,
          ...(operation.attributes || {}),
        },
      });
    }
  });
  return rows;
}

// Every log line written in the minute starting at `minute`.
function logsInMinute(minute) {
  const rows = [];
  EXPLORER_SERVICES.forEach((service) => {
    const count = rowsInMinute(service.logs, minute);
    const errors = errorPerMille(service, minute);
    for (let index = 0; index < count; index++) {
      const seed = [minute / MINUTE, service.number, index, 2];
      const roll = hash(...seed, 1) % 1000;
      const severity =
        roll < errors
          ? LogSeverity.Error
          : roll < errors + 60
            ? LogSeverity.Warning
            : roll < errors + 290
              ? LogSeverity.Debug
              : LogSeverity.Information;
      const lines = service.lines[severity];
      const hasTrace =
        severity !== LogSeverity.Debug && hash(...seed, 2) % 2 === 0;
      rows.push({
        _id: hashedUuid(...seed, 3),
        projectId: projectObjectId,
        time: new Date(minute + (hash(...seed, 4) % MINUTE)),
        body: lines[hash(...seed, 5) % lines.length],
        severityText: severity,
        primaryEntityId: new ObjectID(service.id),
        primaryEntityType: ServiceType.OpenTelemetry,
        traceId: hasTrace ? hex(32, ...seed, 6) : "",
        spanId: hasTrace ? hex(16, ...seed, 7) : "",
        attributes: {
          "resource.service.name": service.name,
          "resource.service.instance.id":
            service.instances[index % service.instances.length],
          "resource.host.name": service.host,
        },
      });
    }
  });
  return rows;
}

/*
 * The analytics tables whose rows are generated, and the time column each
 * is read by. A table may hold stored rows as well (the Log table keeps the
 * Kubernetes warning events above); lists, histograms and facet counts read
 * both.
 */
const GENERATED_TABLES = {
  [tableName(Span)]: {
    modelType: Span,
    generate: spansInMinute,
    column: "startTime",
  },
  [tableName(Log)]: { modelType: Log, generate: logsInMinute, column: "time" },
};

// Every row, generated or stored, whose time falls in the minute `minute`.
function rowsOfMinute(generated, minute) {
  const stored = table(generated.modelType).filter((row) => {
    const time = toTime(row[generated.column]);
    return time >= minute && time < minute + MINUTE;
  });
  return generated.generate(minute).concat(stored);
}

// Every row whose time lies in [start, end], both ends included.
function rowsBetween(generated, start, end) {
  const rows = [];
  for (
    let minute = Math.floor(start / MINUTE) * MINUTE;
    minute <= end;
    minute += MINUTE
  ) {
    for (const row of rowsOfMinute(generated, minute)) {
      const time = toTime(row[generated.column]);
      if (time >= start && time <= end) {
        rows.push(row);
      }
    }
  }
  return rows;
}

// TelemetryAPI's computeDefaultBucketSize.
function defaultBucketSizeInMinutes(start, end) {
  const minutes = (end - start) / MINUTE;
  if (minutes <= 60) {
    return 1;
  }
  if (minutes <= 360) {
    return 5;
  }
  if (minutes <= 1440) {
    return 15;
  }
  if (minutes <= 10080) {
    return 60;
  }
  if (minutes <= 43200) {
    return 360;
  }
  return 1440;
}

// A DateTime as ClickHouse's JSON output writes it: "2026-09-21 11:20:00".
function clickHouseDateTime(time) {
  return new Date(time).toISOString().slice(0, 19).replace("T", " ");
}

function contains(text, part) {
  return String(text || "")
    .toLowerCase()
    .includes(String(part || "").toLowerCase());
}

/*
 * The request filters the fixture models, field by field. Any other field
 * (outside the window, bucket and facet fields) is not modelled and lands
 * on `unhandled`, so a spec that starts filtering finds out.
 */
const SPAN_BODY_FILTERS = {
  rootOnly: (row, value) => {
    return value !== true || row.isRootSpan;
  },
  serviceIds: (row, ids) => {
    return ids.map(String).includes(String(row.primaryEntityId));
  },
  statusCodes: (row, codes) => {
    return codes.map(Number).includes(row.statusCode);
  },
  spanKinds: (row, kinds) => {
    return kinds.includes(row.kind);
  },
  spanNames: (row, names) => {
    return names.includes(row.name);
  },
  spanNameSearches: (row, texts) => {
    return texts.every((text) => {
      return contains(row.name, text);
    });
  },
  nameSearchText: (row, text) => {
    return contains(row.name, text);
  },
  hasException: (row, value) => {
    return row.hasException === value;
  },
  traceIds: (row, ids) => {
    return ids.includes(row.traceId);
  },
  spanIds: (row, ids) => {
    return ids.includes(row.spanId);
  },
};

const LOG_BODY_FILTERS = {
  serviceIds: SPAN_BODY_FILTERS.serviceIds,
  severityTexts: (row, severities) => {
    return severities.includes(row.severityText || LogSeverity.Unspecified);
  },
  bodySearchText: (row, text) => {
    return contains(row.body, text);
  },
  traceIds: SPAN_BODY_FILTERS.traceIds,
  spanIds: SPAN_BODY_FILTERS.spanIds,
};

const REQUEST_SHAPE_FIELDS = new Set([
  "startTime",
  "endTime",
  "bucketSizeInMinutes",
  "facetKeys",
  "chartType",
  "metric",
]);

function bodyFilter(filters, body, url) {
  const active = [];
  for (const [key, value] of Object.entries(body)) {
    if (
      REQUEST_SHAPE_FIELDS.has(key) ||
      value === undefined ||
      value === null
    ) {
      continue;
    }
    if (!filters[key]) {
      fixture.unhandled.push({ kind: "api", url, filter: key });
      continue;
    }
    active.push([filters[key], value]);
  }
  return (row) => {
    return active.every(([test, value]) => {
      return test(row, value);
    });
  };
}

// The request's window, as epoch milliseconds.
function bodyWindow(body) {
  return { start: toTime(body.startTime), end: toTime(body.endTime) };
}

/*
 * The server's histogram (TraceAggregationService / LogAggregationService
 * .getHistogram): the rows whose minute starts inside the window (the start
 * rounded down to its minute, the end exclusive), re-bucketed on
 * toStartOfInterval(minute, INTERVAL bucketSize SECOND), one entry per
 * bucket and series that has rows, in time order.
 */
function histogramOf(options) {
  const { start, end } = bodyWindow(options.body);
  const bucketSizeInMinutes =
    Number(options.body.bucketSizeInMinutes) ||
    defaultBucketSizeInMinutes(start, end);
  const bucketMs = bucketSizeInMinutes * MINUTE;
  const matches = bodyFilter(options.filters, options.body, options.url);
  const counts = new Map();
  for (
    let minute = Math.floor(start / MINUTE) * MINUTE;
    minute < end;
    minute += MINUTE
  ) {
    const bucket = Math.floor(minute / bucketMs) * bucketMs;
    for (const row of rowsOfMinute(options.generated, minute)) {
      if (!matches(row)) {
        continue;
      }
      const series = options.seriesOf(row);
      const key = `${bucket}|${series}`;
      if (!counts.has(key)) {
        counts.set(key, { bucket, series, count: 0 });
      }
      counts.get(key).count += 1;
    }
  }
  const buckets = Array.from(counts.values())
    .sort((left, right) => {
      return (
        left.bucket - right.bucket ||
        options.seriesOrder.indexOf(left.series) -
          options.seriesOrder.indexOf(right.series)
      );
    })
    .map((entry) => {
      return {
        time: clickHouseDateTime(entry.bucket),
        [options.seriesField]: entry.series,
        count: entry.count,
      };
    });
  return { bucketSizeInMinutes, buckets };
}

function countBy(rows, valueOf) {
  const counts = new Map();
  rows.forEach((row) => {
    const value = valueOf(row);
    if (value === undefined || value === null || value === "") {
      return;
    }
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([value, count]) => {
      return { value, count };
    })
    .sort((left, right) => {
      return right.count - left.count || left.value.localeCompare(right.value);
    });
}

function serviceFacet(rows) {
  return EXPLORER_SERVICES.map((service) => {
    return {
      value: service.id,
      count: rows.filter((row) => {
        return String(row.primaryEntityId) === service.id;
      }).length,
      displayName: service.name,
    };
  }).sort((left, right) => {
    return right.count - left.count;
  });
}

/*
 * A resource facet is the project's own list of that resource (from
 * Postgres) with counts merged in. No span or log line here names a host or
 * a cluster, so the two resources the project has count zero.
 */
function resourceFacet(key) {
  if (key === "hostId") {
    return [{ value: HOST_ID, count: 0, displayName: "api-gateway-01" }];
  }
  if (key === "kubernetesClusterId") {
    return [
      { value: CLUSTER_ID, count: 0, displayName: "Production (eu-west-1)" },
    ];
  }
  return [];
}

function attributeFacet(key) {
  return (rows) => {
    return countBy(rows, (row) => {
      return row.attributes?.[key];
    });
  };
}

const SPAN_FACETS = {
  primaryEntityId: serviceFacet,
  statusCode: (rows) => {
    return countBy(rows, (row) => {
      return String(row.statusCode);
    });
  },
  kind: (rows) => {
    return countBy(rows, (row) => {
      return row.kind;
    });
  },
  isRootSpan: (rows) => {
    return countBy(rows, (row) => {
      return String(row.isRootSpan);
    });
  },
  hasException: (rows) => {
    return countBy(rows, (row) => {
      return String(row.hasException);
    });
  },
  name: (rows) => {
    return countBy(rows, (row) => {
      return row.name;
    });
  },
  "resource.service.instance.id": attributeFacet(
    "resource.service.instance.id",
  ),
  "resource.host.name": attributeFacet("resource.host.name"),
};

const LOG_FACETS = {
  severityText: (rows) => {
    return countBy(rows, (row) => {
      return row.severityText || LogSeverity.Unspecified;
    });
  },
  primaryEntityId: serviceFacet,
};

function facetsOf(options) {
  const { start, end } = bodyWindow(options.body);
  const matches = bodyFilter(options.filters, options.body, options.url);
  const rows = rowsBetween(options.generated, start, end).filter(matches);
  const facets = {};
  for (const key of options.body.facetKeys || []) {
    if (options.facets[key]) {
      facets[key] = options.facets[key](rows);
    } else if (RESOURCE_FACET_CATALOG_KEYS.includes(key)) {
      facets[key] = resourceFacet(key);
    } else {
      fixture.unhandled.push({ kind: "api", url: options.url, facetKey: key });
      facets[key] = [];
    }
  }
  return { facets };
}

function quantile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(fraction * sortedValues.length) - 1),
  );
  return sortedValues[index];
}

// The span metrics the explorer's over-time chart can ask for, in ms.
const SPAN_ANALYTICS_METRICS = {
  count: (durations) => {
    return durations.length;
  },
  avgDuration: (durations) => {
    return (
      durations.reduce((sum, value) => {
        return sum + value;
      }, 0) / durations.length
    );
  },
  p50Duration: (durations) => {
    return quantile(durations, 0.5);
  },
  p95Duration: (durations) => {
    return quantile(durations, 0.95);
  },
};

/*
 * /telemetry/traces/analytics as the explorer's latency chart uses it: a
 * timeseries of one metric, bucketed like the histogram. Split-by-dimension
 * (groupBy) and the toplist / table shapes are not modelled.
 */
function spanAnalytics(body, url) {
  const metric = SPAN_ANALYTICS_METRICS[body.metric || "count"];
  if ((body.chartType || "timeseries") !== "timeseries" || !metric) {
    fixture.unhandled.push({
      kind: "api",
      url,
      chartType: body.chartType,
      metric: body.metric,
    });
    return { data: [] };
  }
  if (Array.isArray(body.groupBy) && body.groupBy.length > 0) {
    fixture.unhandled.push({ kind: "api", url, groupBy: body.groupBy });
  }
  const { start, end } = bodyWindow(body);
  const bucketMs =
    (Number(body.bucketSizeInMinutes) ||
      defaultBucketSizeInMinutes(start, end)) * MINUTE;
  const filterable = { ...body };
  delete filterable.groupBy;
  const matches = bodyFilter(SPAN_BODY_FILTERS, filterable, url);
  const durations = new Map();
  for (
    let minute = Math.floor(start / MINUTE) * MINUTE;
    minute < end;
    minute += MINUTE
  ) {
    const bucket = Math.floor(minute / bucketMs) * bucketMs;
    for (const row of rowsOfMinute(GENERATED_TABLES[tableName(Span)], minute)) {
      if (!matches(row)) {
        continue;
      }
      if (!durations.has(bucket)) {
        durations.set(bucket, []);
      }
      durations.get(bucket).push(row.durationUnixNano / 1000000);
    }
  }
  return {
    data: Array.from(durations.entries())
      .sort(([left], [right]) => {
        return left - right;
      })
      .map(([bucket, values]) => {
        const sorted = [...values].sort((left, right) => {
          return left - right;
        });
        return {
          time: clickHouseDateTime(bucket),
          value: Math.round(metric(sorted) * 100) / 100,
          groupValues: {},
        };
      }),
  };
}

// Attribute keys and values seen in the fixture's last hour.
function attributeKeysOf(generated) {
  const keys = new Set();
  rowsBetween(generated, ago(HOUR).getTime(), NOW.getTime()).forEach((row) => {
    Object.keys(row.attributes || {}).forEach((key) => {
      keys.add(key);
    });
  });
  return Array.from(keys).sort();
}

function attributeValuesOf(generated, key) {
  return countBy(
    rowsBetween(generated, ago(HOUR).getTime(), NOW.getTime()),
    (row) => {
      return row.attributes?.[key];
    },
  ).map((entry) => {
    return entry.value;
  });
}

const SPAN_SERIES_ORDER = ["unset", "ok", "error"];
const SPAN_SERIES = {
  [SpanStatus.Unset]: "unset",
  [SpanStatus.Ok]: "ok",
  [SpanStatus.Error]: "error",
};
const LOG_SERIES_ORDER = Object.values(LogSeverity);

/*
 * The explorers' own endpoints. `gated` answers go through histogramGate:
 * the histogram (or the latency chart that replaces it) and the facet
 * counts the Traces explorer awaits together with it.
 */
const EXPLORER_ENDPOINTS = [
  {
    path: "/telemetry/traces/histogram",
    gated: true,
    answer: (body, url, entry) => {
      const result = histogramOf({
        body,
        url,
        generated: GENERATED_TABLES[tableName(Span)],
        filters: SPAN_BODY_FILTERS,
        seriesField: "series",
        seriesOf: (row) => {
          return SPAN_SERIES[row.statusCode];
        },
        seriesOrder: SPAN_SERIES_ORDER,
      });
      entry.bucketSizeInMinutes = result.bucketSizeInMinutes;
      entry.buckets = result.buckets.length;
      return { buckets: result.buckets };
    },
  },
  {
    path: "/telemetry/traces/facets",
    gated: true,
    answer: (body, url) => {
      return facetsOf({
        body,
        url,
        generated: GENERATED_TABLES[tableName(Span)],
        filters: SPAN_BODY_FILTERS,
        facets: SPAN_FACETS,
      });
    },
  },
  {
    path: "/telemetry/traces/analytics",
    gated: true,
    answer: (body, url) => {
      return spanAnalytics(body, url);
    },
  },
  {
    path: "/telemetry/traces/get-attributes",
    answer: () => {
      return { attributes: attributeKeysOf(GENERATED_TABLES[tableName(Span)]) };
    },
  },
  {
    path: "/telemetry/traces/get-attribute-values",
    answer: (body) => {
      return {
        values: attributeValuesOf(
          GENERATED_TABLES[tableName(Span)],
          body.attributeKey,
        ),
      };
    },
  },
  {
    path: "/telemetry/logs/histogram",
    gated: true,
    answer: (body, url, entry) => {
      const result = histogramOf({
        body,
        url,
        generated: GENERATED_TABLES[tableName(Log)],
        filters: LOG_BODY_FILTERS,
        seriesField: "severity",
        seriesOf: (row) => {
          return row.severityText || LogSeverity.Unspecified;
        },
        seriesOrder: LOG_SERIES_ORDER,
      });
      entry.bucketSizeInMinutes = result.bucketSizeInMinutes;
      entry.buckets = result.buckets.length;
      return result;
    },
  },
  {
    path: "/telemetry/logs/facets",
    gated: true,
    answer: (body, url) => {
      return facetsOf({
        body,
        url,
        generated: GENERATED_TABLES[tableName(Log)],
        filters: LOG_BODY_FILTERS,
        facets: LOG_FACETS,
      });
    },
  },
  {
    path: "/telemetry/logs/get-attributes",
    answer: () => {
      return { attributes: attributeKeysOf(GENERATED_TABLES[tableName(Log)]) };
    },
  },
  {
    path: "/telemetry/logs/get-attribute-values",
    answer: (body) => {
      return {
        values: attributeValuesOf(
          GENERATED_TABLES[tableName(Log)],
          body.attributeKey,
        ),
      };
    },
  },
];

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
table(Span);
const ANALYTICS_TABLES = [
  tableName(Log),
  tableName(ChangeEvent),
  tableName(Metric),
  tableName(Span),
];

/*
 * Every row of an analytics table that `query` matches, unsorted, or null
 * for a table the fixture does not model (recorded on `unhandled` as
 * `kind`). A list pages through these rows and a count counts them, so an
 * explorer's total always describes the very rows its list holds.
 */
function analyticsRows(modelType, query, kind) {
  const modelName = tableName(modelType);
  if (!ANALYTICS_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind, modelName });
    return null;
  }
  const conditions = { ...(query || {}) };
  /*
   * Map-column filters (Log.attributes) are matched key by key: every
   * requested attribute must be present with the same value.
   */
  const attributeFilter = conditions.attributes;
  delete conditions.attributes;
  /*
   * Generated rows exist for any window, so a read of a generated table
   * must name one on its time column (every explorer and page read does).
   */
  let candidates = table(modelType);
  const generated = GENERATED_TABLES[modelName];
  if (generated) {
    const time = conditions[generated.column];
    if (time instanceof InBetween) {
      candidates = rowsBetween(
        generated,
        toTime(time.startValue),
        toTime(time.endValue),
      );
    } else {
      fixture.unhandled.push({
        kind,
        modelName,
        missing: `an InBetween on ${generated.column}`,
      });
    }
  }
  return candidates.filter((item) => {
    if (!matches(item, conditions)) {
      return false;
    }
    return Object.entries(attributeFilter || {}).every(([key, value]) => {
      return String(item.attributes?.[key]) === attributeValue(value);
    });
  });
}

/*
 * POST <model>/get-list, answered the way BaseAnalyticsAPI answers it. The
 * server skips COUNT(*): it reads one row past the page, says whether that
 * row was there (hasMore), and sends a lower bound as `count`, the rows up
 * to the page's last plus one while more follow. A page that ends the list
 * so proves its own total, and an explorer only counts (below) when rows
 * follow its page.
 */
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
  const records = sortRecords(
    analyticsRows(options.modelType, options.query, "analytics.getList") || [],
    options.sort,
  );
  const page = records.slice(skip, skip + limit);
  const hasMore = records.length > skip + limit;
  return {
    data: page.map((item) => {
      return projectRecord(options.modelType, item, options.select);
    }),
    count: skip + page.length + (hasMore ? 1 : 0),
    skip,
    limit,
    hasMore,
  };
};

/*
 * POST <model>/count, which BaseAnalyticsAPI answers with `{ count }`: how
 * many rows the query matches. The explorers print it as their total
 * ("2,120 spans") and ask for it exact (CountBy.exact): the very rows a list
 * with the same query pages through, never the server's estimate. The
 * fixture always counts exactly, which also answers a count that did not
 * ask to be exact. Only the generated tables (the explorers' spans and
 * logs) are counted: a count of any other table is not modelled and lands
 * on `unhandled`, so a page that starts counting one finds out.
 */
AnalyticsModelAPI.count = async (
  modelType,
  query,
  _requestOptions,
  countOptions,
) => {
  const modelName = tableName(modelType);
  const entry = record({
    kind: "analytics.count",
    modelName,
    query: serialize(query),
    window: windowOf(query),
    exact: Boolean(countOptions?.exact),
  });
  let rows = [];
  if (GENERATED_TABLES[modelName]) {
    rows = analyticsRows(modelType, query, "analytics.count");
  } else {
    fixture.unhandled.push({ kind: "analytics.count", modelName });
  }
  entry.count = rows.length;
  return entry.count;
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
  return throughGate(
    fixture.aggregateGate,
    { seq: entry.seq, metricName, window: entry.window },
    () => {
      return { data: rows };
    },
  );
};

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data) || {};
  const requestWindow =
    body.startTime && body.endTime
      ? { start: toIso(body.startTime), end: toIso(body.endTime) }
      : undefined;
  const entry = record({
    kind: "api",
    method,
    url,
    body,
    ...(requestWindow ? { window: requestWindow } : {}),
  });
  const parsed = new window.URL(url);

  const endpoint = EXPLORER_ENDPOINTS.find((candidate) => {
    return parsed.pathname.endsWith(candidate.path);
  });
  if (method === "POST" && endpoint) {
    let response;
    try {
      response = endpoint.answer(body, url, entry);
    } catch (error) {
      fixture.unhandled.push({
        kind: "api",
        method,
        url,
        error: String(error?.stack || error),
      });
      throw fail(500, "The fixture could not answer this request.");
    }
    if (!endpoint.gated) {
      return ok(response);
    }
    return throughGate(
      fixture.histogramGate,
      {
        seq: entry.seq,
        url,
        window: requestWindow || null,
        response: serialize(response),
      },
      () => {
        return ok(response);
      },
    );
  }

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

  /*
   * The Overview's "AI agent" card reads whether OneUptime AI can reach
   * the cluster. Not part of the zoom; answered "not installed" so the card
   * settles and the page makes no other call.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/kubernetes-cluster/ai-access/status")
  ) {
    if (body.clusterId !== CLUSTER_ID) {
      throw fail(404, "Kubernetes cluster not found.");
    }
    return ok({
      clusterId: CLUSTER_ID,
      clusterName: "Production (eu-west-1)",
      runner: null,
      accessMethod: "none",
      aiAgent: null,
      automaticInvestigation: {},
      gaps: [],
    });
  }

  /*
   * The host Overview's "AI agent" card reads whether OneUptime AI can reach
   * the host (the route every resource but a cluster uses). Not part of the
   * zoom or the agent version; answered "no AI agent yet", as the server
   * answers for a host nobody installed one on, so the card settles and the
   * page makes no other call.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    if (body.resourceType !== "Host" || body.resourceId !== HOST_ID) {
      throw fail(404, "Resource not found.");
    }
    return ok({
      resourceType: "Host",
      resourceId: HOST_ID,
      resourceName: "api-gateway-01",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Install the OneUptime AI agent on this host.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
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

/*
 * The logs explorer listens for new log rows. The subscription is recorded
 * and nothing is ever sent: the dataset does not change while a page is
 * open, and no socket leaves the page.
 */
function subscribe(listen) {
  record({
    kind: "realtime",
    modelName: tableName(listen.modelType),
    eventType: listen.eventType,
  });
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

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

function FixtureTracesLayout() {
  useNavigationHooks();
  return <TracesLayout {...pageProps(PageMap.TRACES)} />;
}

function FixtureLogsLayout() {
  useNavigationHooks();
  return <LogsLayout {...pageProps(PageMap.LOGS)} />;
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
          path={RouteMap[PageMap.TRACES].toString()}
          element={<FixtureTracesLayout />}
        >
          <Route
            index
            element={<TracesPage {...pageProps(PageMap.TRACES)} />}
          />
        </Route>
        <Route
          path={RouteMap[PageMap.LOGS].toString()}
          element={<FixtureLogsLayout />}
        >
          <Route index element={<LogsPage {...pageProps(PageMap.LOGS)} />} />
        </Route>
        <Route
          path="*"
          element={<StubPage pageKey="unknown" title="Not modelled" />}
        />
      </Route>
    </Routes>
  </BrowserRouter>,
);
