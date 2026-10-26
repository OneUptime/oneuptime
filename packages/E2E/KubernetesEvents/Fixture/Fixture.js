/*
 * Offline fixture for where a Kubernetes cluster's warning events show
 * (issue #5179): the production Kubernetes cluster layout (ModelPage, the
 * cluster's side menu) with the cluster's Overview (Recent Warnings), its
 * Events page, and the pages of a node, an HPA, a Deployment and a
 * namespace, each with its Events tab - under their real RouteMap patterns.
 * Only the data boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and
 * the signed-in user are replaced. Every record is fabricated for an "Acme
 * Cloud" workspace.
 *
 * The Events are the customer's (Common/Tests/Helpers/KubernetesEventRecords,
 * shared with the parser, ingest and render tests): kernel-monitor's
 * OOMKilling on two AKS nodes, the horizontal-pod-autoscaler's
 * FailedGetResourceMetric and FailedComputeMetricsReplicas on HPAs in
 * aks-istio-system and app-routing-system - each stored the way ingest
 * stores it now, one log record per change the agent's watch saw (added,
 * then updated as it repeats) - beside a Deployment's crash loop, a
 * neighbour Deployment whose name starts the same, Normal events of every
 * kind, a warning stored before ingest stamped what an Event says (only its
 * body tells), and another cluster's warning that must never show here.
 *
 * The logs list answers the way BaseAnalyticsAPI answers it: filtered on
 * the time range, on the attributes asked for (an exact value, an Includes,
 * a StartsWith matched without regard to case) and on ids, newest first, up
 * to the limit and saying when there is more, with the body only when it is
 * selected.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?events=     issue (default) | normal-only (no warning anywhere) | none
 *   ?busy=1      1,500 more Normal events in the last hour, more than one
 *                read takes: the warnings must still all show
 *   ?fail=       events (the first read of Events fails, the next works)
 *   ?alerting=   on (a Logs monitor alerts on the cluster's warning events,
 *                the Warning Events recommendation's own) | disabled (that
 *                monitor, turned off) - by default nothing alerts on them
 *   ?lang=       de reads the German locale file
 *   ?theme=      dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__kubernetesEventsFixture: logRequests
 * (each Events read: attributes, select, limit, ids), listRequests,
 * itemRequests, countRequests, aggregateRequests, apiRequests and unhandled
 * - anything the fixture does not model. The spec asserts `unhandled` is
 * empty.
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
import KubernetesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Layout";
import KubernetesOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import KubernetesEventsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events";
import KubernetesNodeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import KubernetesHPADetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/HPADetail";
import KubernetesDeploymentDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentDetail";
import KubernetesNamespaceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NamespaceDetail";
import KubernetesRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Recommendations";
import { getKubernetesWarningEventsTemplate } from "Common/Types/Monitor/KubernetesEventAlertTemplates";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Log from "Common/Models/AnalyticsModels/Log";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
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
import {
  issue5179Events,
  storedKubernetesEventLog,
} from "Common/Tests/Helpers/KubernetesEventRecords";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const EVENTS = ["normal-only", "none"].includes(params.get("events"))
  ? params.get("events")
  : "issue";
const IS_BUSY = params.get("busy") === "1";
const FAIL = params.get("fail") === "events" ? "events" : "";
const LANGUAGE = params.get("lang") === "de" ? "de" : "en";
const ALERTING = ["on", "disabled"].includes(params.get("alerting"))
  ? params.get("alerting")
  : "off";

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
const NOW = new Date(LOADED_AT);

function minutesAgo(minutes) {
  return new Date(LOADED_AT - minutes * MINUTE).toISOString();
}

const CLUSTER_ID = uuid("60000000", 1);
const CLUSTER_NAME = "AKS Production (West Europe)";
const CLUSTER_IDENTIFIER = "aks-prod-westeurope";
const OTHER_CLUSTER_IDENTIFIER = "aks-staging-westeurope";

const USER_POOL_NODE = "aks-userpool-11935137-vmss00000o";
const AGENT_POOL_NODE = "aks-agentpool-19172126-vmss000000";

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Cloud",
});

const cluster = {
  _id: CLUSTER_ID,
  name: CLUSTER_NAME,
  description: "The production AKS cluster in West Europe.",
  clusterIdentifier: CLUSTER_IDENTIFIER,
  otelCollectorStatus: "connected",
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  agentVersion: "14.0.85",
  provider: "aks",
  nodeCount: 2,
  podCount: 14,
  namespaceCount: 6,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
};

/*
 * ---------------------------------------------------------------------------
 * The Events, as the logs table holds them
 * ---------------------------------------------------------------------------
 */
const logs = [];
let logNumber = 0;
let eventNumber = 0;

function eventUid() {
  eventNumber++;
  return `7c1d2e3f-0000-4000-8000-${String(eventNumber).padStart(12, "0")}`;
}

function putRecord(fields, options) {
  logNumber++;
  logs.push(
    storedKubernetesEventLog({
      fields: fields,
      clusterName: options.cluster || CLUSTER_IDENTIFIER,
      watchType: options.watchType || "ADDED",
      stamped: options.stamped !== false,
      id: uuid("70000000", logNumber),
    }),
  );
}

/*
 * An Event the way the agent's watch saw it: added when it first happened
 * and, for one that repeated, updated with its count as it did - so a row
 * of the views is several records, and says the newest count.
 */
function putEvent(fields, options = {}) {
  const count = fields.count || 1;

  if (count > 1) {
    putRecord({ ...fields, count: 1, lastSeen: fields.firstSeen }, options);
    putRecord(fields, { ...options, watchType: "MODIFIED" });
    return;
  }

  putRecord(fields, options);
}

function normal(fields) {
  const at = fields.at;
  const uid = eventUid();
  return {
    uid: uid,
    name: `${fields.object.name}.${String(eventNumber).padStart(16, "0")}`,
    namespace: fields.namespace,
    type: "Normal",
    reason: fields.reason,
    message: fields.message,
    object: fields.object,
    controller: fields.controller,
    instance: fields.instance,
    count: fields.count || 1,
    firstSeen: minutesAgo(at + (fields.count > 1 ? 30 : 0)),
    lastSeen: minutesAgo(at),
  };
}

function warning(fields) {
  return { ...normal(fields), type: "Warning" };
}

const CHECKOUT_POD = "checkout-7d4f9b6c5-x2x7q";
const CHECKOUT_POD_TWO = "checkout-7d4f9b6c5-r4w7v";
const CHECKOUT_REPLICA_SET = "checkout-7d4f9b6c5";
const NEIGHBOUR_POD = "checkout-api-6c5b8d7f9-k2m4p";
const ISTIOD_POD = "istiod-6b9c8d7f5-p9kxm";
const NGINX_POD = "nginx-5d8f7c9b6-wz2lq";

// What a busy cluster says all day, about every kind of object.
const NORMAL_EVENTS = [
  normal({
    at: 140,
    namespace: "default",
    reason: "RegisteredNode",
    message: `Node ${USER_POOL_NODE} event: Registered Node ${USER_POOL_NODE} in Controller`,
    object: { kind: "Node", name: USER_POOL_NODE, uid: USER_POOL_NODE },
    controller: "node-controller",
  }),
  normal({
    at: 25,
    namespace: "aks-istio-system",
    reason: "SuccessfulRescale",
    message:
      "New size: 2; reason: All metrics below target, current replicas 3",
    object: {
      kind: "HorizontalPodAutoscaler",
      name: "istiod",
      namespace: "aks-istio-system",
      apiVersion: "autoscaling/v2",
    },
    controller: "horizontal-pod-autoscaler",
  }),
  normal({
    at: 52,
    namespace: "shop",
    reason: "ScalingReplicaSet",
    message: `Scaled up replica set ${CHECKOUT_REPLICA_SET} to 3`,
    object: { kind: "Deployment", name: "checkout", namespace: "shop" },
    controller: "deployment-controller",
  }),
  normal({
    at: 51,
    namespace: "shop",
    reason: "SuccessfulCreate",
    message: `Created pod: ${CHECKOUT_POD}`,
    object: {
      kind: "ReplicaSet",
      name: CHECKOUT_REPLICA_SET,
      namespace: "shop",
    },
    controller: "replicaset-controller",
  }),
  normal({
    at: 51,
    namespace: "shop",
    reason: "Scheduled",
    message: `Successfully assigned shop/${CHECKOUT_POD} to ${USER_POOL_NODE}`,
    object: { kind: "Pod", name: CHECKOUT_POD, namespace: "shop" },
    controller: "default-scheduler",
  }),
  normal({
    at: 50,
    namespace: "shop",
    reason: "Pulled",
    message:
      'Container image "acmecloud.azurecr.io/shop/checkout:4.12.0" already present on machine',
    object: {
      kind: "Pod",
      name: CHECKOUT_POD,
      namespace: "shop",
      fieldPath: "spec.containers{checkout}",
    },
    controller: "kubelet",
    instance: USER_POOL_NODE,
  }),
  normal({
    at: 49,
    namespace: "shop",
    reason: "Started",
    message: "Started container checkout",
    object: {
      kind: "Pod",
      name: CHECKOUT_POD_TWO,
      namespace: "shop",
      fieldPath: "spec.containers{checkout}",
    },
    controller: "kubelet",
    instance: AGENT_POOL_NODE,
  }),
  normal({
    at: 47,
    namespace: "aks-istio-system",
    reason: "Pulled",
    message:
      'Container image "mcr.microsoft.com/oss/istio/pilot:1.24.3" already present on machine',
    object: {
      kind: "Pod",
      name: ISTIOD_POD,
      namespace: "aks-istio-system",
      fieldPath: "spec.containers{discovery}",
    },
    controller: "kubelet",
    instance: AGENT_POOL_NODE,
  }),
  normal({
    at: 44,
    namespace: "app-routing-system",
    reason: "Started",
    message: "Started container controller",
    object: {
      kind: "Pod",
      name: NGINX_POD,
      namespace: "app-routing-system",
      fieldPath: "spec.containers{controller}",
    },
    controller: "kubelet",
    instance: USER_POOL_NODE,
  }),
  normal({
    at: 38,
    namespace: "kube-system",
    reason: "Pulled",
    message:
      'Container image "mcr.microsoft.com/oss/kubernetes/coredns:v1.11.3" already present on machine',
    object: {
      kind: "Pod",
      name: "coredns-7b9f8d6c5-hj4kl",
      namespace: "kube-system",
      fieldPath: "spec.containers{coredns}",
    },
    controller: "kubelet",
    instance: USER_POOL_NODE,
  }),
  normal({
    at: 30,
    namespace: "shop",
    reason: "Killing",
    message: "Stopping container storefront",
    object: {
      kind: "Pod",
      name: "storefront-5c8d7b9f4-tz6qw",
      namespace: "shop",
      fieldPath: "spec.containers{storefront}",
    },
    controller: "kubelet",
    instance: AGENT_POOL_NODE,
  }),
];

const WARNING_EVENTS = [
  // The crash loop of a Deployment's pod: reported about the pod.
  warning({
    at: 3,
    count: 14,
    namespace: "shop",
    reason: "BackOff",
    message: `Back-off restarting failed container checkout in pod ${CHECKOUT_POD}_shop(5f0c2a51-1e1b-4bb5-9a3e-7d2f8c6b9a10)`,
    object: {
      kind: "Pod",
      name: CHECKOUT_POD,
      namespace: "shop",
      fieldPath: "spec.containers{checkout}",
    },
    controller: "kubelet",
    instance: USER_POOL_NODE,
  }),
  warning({
    at: 6,
    count: 6,
    namespace: "shop",
    reason: "Unhealthy",
    message:
      'Readiness probe failed: Get "http://10.244.1.27:8080/ready": dial tcp 10.244.1.27:8080: connect: connection refused',
    object: {
      kind: "Pod",
      name: CHECKOUT_POD,
      namespace: "shop",
      fieldPath: "spec.containers{checkout}",
    },
    controller: "kubelet",
    instance: USER_POOL_NODE,
  }),
  // A Deployment whose name starts the same: never on checkout's page.
  warning({
    at: 8,
    count: 3,
    namespace: "shop",
    reason: "BackOff",
    message: `Back-off restarting failed container api in pod ${NEIGHBOUR_POD}_shop(0b3c9e1d-77aa-4c1e-8d2f-1a2b3c4d5e6f)`,
    object: {
      kind: "Pod",
      name: NEIGHBOUR_POD,
      namespace: "shop",
      fieldPath: "spec.containers{api}",
    },
    controller: "kubelet",
    instance: AGENT_POOL_NODE,
  }),
];

// A warning stored before ingest stamped what an Event says: its body tells.
const UNSTAMPED_WARNING = warning({
  at: 180,
  count: 4,
  namespace: "batch",
  reason: "FailedMount",
  message:
    'MountVolume.SetUp failed for volume "report-secrets" : secret "report-secrets" not found',
  object: {
    kind: "Pod",
    name: "reports-28791440-t9x3q",
    namespace: "batch",
  },
  controller: "kubelet",
  instance: AGENT_POOL_NODE,
});

// Another cluster's warning: never on this cluster's pages.
const OTHER_CLUSTER_WARNING = {
  uid: eventUid(),
  name: "aks-stagingpool-23810077-vmss000001.17f0c0ffee000001",
  namespace: "default",
  type: "Warning",
  reason: "OOMKilling",
  message:
    "Memory cgroup out of memory: Killed process 77001 (java) total-vm:8123456kB, anon-rss:2034848kB",
  object: {
    kind: "Node",
    name: "aks-stagingpool-23810077-vmss000001",
    uid: "aks-stagingpool-23810077-vmss000001",
  },
  controller: "kernel-monitor",
  instance: "aks-stagingpool-23810077-vmss000001",
  count: 5,
  firstSeen: minutesAgo(40),
  lastSeen: minutesAgo(2),
};

if (EVENTS !== "none") {
  for (const event of NORMAL_EVENTS) {
    putEvent(event);
  }

  putEvent(
    normal({
      at: 1,
      namespace: "default",
      reason: "Pulled",
      message: "Container image already present on machine",
      object: {
        kind: "Pod",
        name: "acme-staging-canary-0",
        namespace: "default",
      },
      controller: "kubelet",
    }),
    { cluster: OTHER_CLUSTER_IDENTIFIER },
  );
}

if (EVENTS === "issue") {
  for (const event of issue5179Events(NOW)) {
    putEvent(event);
  }

  for (const event of WARNING_EVENTS) {
    putEvent(event);
  }

  putEvent(UNSTAMPED_WARNING, { stamped: false });
  putEvent(OTHER_CLUSTER_WARNING, { cluster: OTHER_CLUSTER_IDENTIFIER });
}

/*
 * A busy hour: a rollout's worth of Normal events, newer than every warning
 * but the newest - more than one read takes (1,000 records).
 */
if (IS_BUSY && EVENTS !== "none") {
  const alphabet = "bcdfghjklmnpqrstvwxz2456789";
  for (let index = 0; index < 1500; index++) {
    let suffix = "";
    let rest = index;
    for (let place = 0; place < 5; place++) {
      suffix += alphabet[rest % alphabet.length];
      rest = Math.floor(rest / alphabet.length);
    }
    putRecord(
      {
        uid: uuid("7d000000", index + 1),
        name: `storefront-5c8d7b9f4-${suffix}.17f0d${String(index).padStart(11, "0")}`,
        namespace: "shop",
        type: "Normal",
        reason: index % 2 === 0 ? "Pulled" : "Started",
        message:
          index % 2 === 0
            ? 'Container image "acmecloud.azurecr.io/shop/storefront:9.3.1" already present on machine'
            : "Started container storefront",
        object: {
          kind: "Pod",
          name: `storefront-5c8d7b9f4-${suffix}`,
          namespace: "shop",
          fieldPath: "spec.containers{storefront}",
        },
        controller: "kubelet",
        instance: index % 3 === 0 ? AGENT_POOL_NODE : USER_POOL_NODE,
        count: 1,
        firstSeen: minutesAgo(1 + (index % 50) / 25),
        lastSeen: minutesAgo(1 + (index % 50) / 25),
      },
      {},
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * The cluster's inventory (KubernetesResource rows)
 * ---------------------------------------------------------------------------
 */
let resourceNumber = 0;
function resource(fields) {
  resourceNumber++;
  return {
    _id: uuid("42000000", resourceNumber),
    kubernetesClusterId: CLUSTER_ID,
    namespaceKey: "",
    uid: uuid("43000000", resourceNumber),
    labels: {},
    annotations: {},
    ownerReferences: { items: [] },
    resourceCreationTimestamp: new Date(LOADED_AT - 9 * 24 * 60 * MINUTE),
    lastSeenAt: new Date(LOADED_AT - MINUTE),
    ...fields,
  };
}

function node(name, pool) {
  return resource({
    kind: "Node",
    name: name,
    labels: {
      "kubernetes.azure.com/agentpool": pool,
      "kubernetes.io/os": "linux",
      "node.kubernetes.io/instance-type": "Standard_D4s_v5",
    },
    isReady: true,
    spec: {},
    status: {
      conditions: [
        {
          type: "MemoryPressure",
          status: "False",
          reason: "KubeletHasSufficientMemory",
          message: "kubelet has sufficient memory available",
          lastTransitionTime: minutesAgo(9 * 24 * 60),
        },
        {
          type: "Ready",
          status: "True",
          reason: "KubeletReady",
          message: "kubelet is posting ready status",
          lastTransitionTime: minutesAgo(9 * 24 * 60),
        },
      ],
      nodeInfo: {
        osImage: "Ubuntu 22.04.5 LTS",
        kernelVersion: "5.15.0-1079-azure",
        containerRuntimeVersion: "containerd://1.7.27-1",
        kubeletVersion: "v1.31.7",
        architecture: "amd64",
        operatingSystem: "linux",
      },
      allocatable: { cpu: "3860m", memory: "12544Mi", pods: "110" },
      capacity: { cpu: "4", memory: "16374Mi", pods: "110" },
      addresses: [
        {
          type: "InternalIP",
          address: pool === "userpool" ? "10.224.0.5" : "10.224.0.4",
        },
        { type: "Hostname", address: name },
      ],
    },
  });
}

const resources = [
  node(USER_POOL_NODE, "userpool"),
  node(AGENT_POOL_NODE, "agentpool"),
  ...[
    "default",
    "kube-system",
    "shop",
    "batch",
    "aks-istio-system",
    "app-routing-system",
  ].map((name) => {
    return resource({
      kind: "Namespace",
      name: name,
      spec: {},
      status: { phase: "Active" },
    });
  }),
  resource({
    kind: "Deployment",
    name: "checkout",
    namespaceKey: "shop",
    labels: { app: "checkout" },
    spec: {
      replicas: 3,
      strategy: "RollingUpdate",
      selector: { app: "checkout" },
    },
    status: {
      replicas: 3,
      readyReplicas: 2,
      availableReplicas: 2,
      unavailableReplicas: 1,
      conditions: [
        {
          type: "Available",
          status: "True",
          reason: "MinimumReplicasAvailable",
          message: "Deployment has minimum availability.",
          lastTransitionTime: minutesAgo(52),
        },
      ],
    },
  }),
  ...[
    ["istiod", "aks-istio-system", 2, 5],
    ["nginx", "app-routing-system", 2, 10],
  ].map(([name, namespace, minReplicas, maxReplicas]) => {
    return resource({
      kind: "HorizontalPodAutoscaler",
      name: name,
      namespaceKey: namespace,
      spec: {
        minReplicas: minReplicas,
        maxReplicas: maxReplicas,
        scaleTargetRef: { kind: "Deployment", name: name },
        metrics: [
          {
            type: "Resource",
            resourceName: "cpu",
            targetType: "Utilization",
            targetValue: "80",
          },
        ],
      },
      status: {
        currentReplicas: minReplicas,
        desiredReplicas: minReplicas,
        conditions: [
          {
            type: "ScalingActive",
            status: "False",
            reason: "FailedGetResourceMetric",
            message:
              "the HPA was unable to compute the replica count: failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
            lastTransitionTime: minutesAgo(30),
          },
        ],
      },
    });
  }),
];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    events: EVENTS,
    busy: IS_BUSY,
    fail: FAIL,
    language: LANGUAGE,
  },
  dataset: {
    projectId: PROJECT_ID,
    clusterId: CLUSTER_ID,
    clusterIdentifier: CLUSTER_IDENTIFIER,
    otherClusterIdentifier: OTHER_CLUSTER_IDENTIFIER,
    storedRecords: logs.length,
  },
  logRequests: [],
  listRequests: [],
  itemRequests: [],
  countRequests: [],
  aggregateRequests: [],
  updateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__kubernetesEventsFixture = fixture;

let eventReadFailuresLeft = FAIL === "events" ? 1 : 0;

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

function valuesOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      return entry && typeof entry === "object"
        ? String(plain(entry._id || entry.id || entry))
        : String(entry);
    });
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [String(plain(value))];
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
      if (
        !valuesOf(record[field]).some((entry) => {
          return allowed.has(entry);
        })
      ) {
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

const incidentStates = [
  { _id: uuid("50000000", 1), name: "Identified", order: 1 },
  {
    _id: uuid("50000000", 2),
    name: "Resolved",
    order: 2,
    isResolvedState: true,
  },
];
const alertStates = [
  { _id: uuid("51000000", 1), name: "Created", order: 1 },
  {
    _id: uuid("51000000", 2),
    name: "Resolved",
    order: 2,
    isResolvedState: true,
  },
];

/*
 * The Logs monitor the cluster's Warning Events recommendation creates
 * (KubernetesEventAlertTemplates), as a monitor list returns it: what
 * ?alerting=on puts on the project, and ?alerting=disabled turns off.
 */
const warningEventsMonitor = {
  _id: uuid("58000000", 1),
  name: `${CLUSTER_NAME} - Warning Events`,
  monitorType: "Logs",
  disableActiveMonitoring: ALERTING === "disabled",
  monitorSteps: {
    data: {
      monitorStepsInstanceArray: [
        getKubernetesWarningEventsTemplate().getMonitorStep({
          clusterIdentifier: CLUSTER_IDENTIFIER,
          onlineMonitorStatusId: new ObjectID(uuid("55000000", 1)),
          offlineMonitorStatusId: new ObjectID(uuid("55000000", 2)),
          defaultIncidentSeverityId: new ObjectID(uuid("56000000", 2)),
          defaultAlertSeverityId: new ObjectID(uuid("57000000", 2)),
          monitorName: CLUSTER_NAME,
        }),
      ],
      defaultMonitorStatusId: new ObjectID(uuid("55000000", 1)),
    },
  },
};

/*
 * The project's records, by table. Tables the pages read that this project
 * has nothing in are modelled as empty; a read of any other is `unhandled`.
 */
const store = {
  KubernetesCluster: [cluster],
  KubernetesResource: resources,
  KubernetesContainer: [],
  IncidentState: incidentStates,
  AlertState: alertStates,
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
  Alert: [],
  ScheduledMaintenance: [],
  /*
   * What the Recommendations menu item and page, and the Events page's last
   * line, read: no monitors - or, with ?alerting=, the Warning Events
   * recommendation's Logs monitor - and nothing dismissed.
   */
  Monitor: ALERTING === "off" ? [] : [warningEventsMonitor],
  RecommendationDismissal: [],
  /*
   * What the cluster's Recommendations page reads to build a monitor and
   * fill its create panel: the project's statuses and severities, and no
   * on-call policies, labels or teams yet.
   */
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
  IncidentSeverity: [
    { _id: uuid("56000000", 1), name: "Critical", order: 1 },
    { _id: uuid("56000000", 2), name: "Major", order: 2 },
  ],
  AlertSeverity: [
    { _id: uuid("57000000", 1), name: "Critical", order: 1 },
    { _id: uuid("57000000", 2), name: "Warning", order: 2 },
  ],
  OnCallDutyPolicy: [],
  Label: [],
  // The databases a Deployment's page finds running in it: none here.
  DatabaseServer: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

function rows(modelType, query) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return store[name]
    .filter((record) => {
      return matches(record, query);
    })
    .map((record) => {
      return Object.assign(new modelType(), record);
    });
}

/*
 * ---------------------------------------------------------------------------
 * The logs list, for the Events views
 * ---------------------------------------------------------------------------
 */

// An attribute's value against what a read asks for, as the server compares.
function attributeMatches(value, wanted) {
  const text = value === undefined || value === null ? "" : String(value);

  if (wanted instanceof Includes) {
    return wanted.values
      .map((entry) => {
        return String(plain(entry));
      })
      .includes(text);
  }

  // ILIKE 'value%': without regard to case.
  if (wanted instanceof StartsWith) {
    return text.toLowerCase().startsWith(String(wanted.value).toLowerCase());
  }

  return text === String(plain(wanted));
}

const KNOWN_LOG_QUERY_KEYS = new Set([
  "projectId",
  "time",
  "attributes",
  "_id",
]);

function listEventLogs(options) {
  const query = options.query || {};
  const select = options.select || {};
  const limit = Number(options.limit || 10);
  const timeWindow = query.time;
  const ids =
    query._id instanceof Includes
      ? query._id.values.map((entry) => {
          return String(plain(entry));
        })
      : null;
  const attributes = query.attributes || {};

  fixture.logRequests.push({
    attributes: serialize(attributes),
    operators: Object.fromEntries(
      Object.entries(attributes).map(([key, wanted]) => {
        return [
          key,
          wanted instanceof Includes
            ? "Includes"
            : wanted instanceof StartsWith
              ? "StartsWith"
              : "EqualTo",
        ];
      }),
    ),
    select: serialize(select),
    limit: limit,
    ids: ids,
    window:
      timeWindow instanceof InBetween
        ? {
            start: new Date(timeWindow.startValue).toISOString(),
            end: new Date(timeWindow.endValue).toISOString(),
          }
        : null,
  });

  for (const key of Object.keys(query)) {
    if (!KNOWN_LOG_QUERY_KEYS.has(key)) {
      fixture.unhandled.push({
        kind: "analytics.getList",
        modelName: "Log",
        key,
      });
    }
  }

  if (!(timeWindow instanceof InBetween)) {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName: "Log",
      missing: "an InBetween on time",
    });
  }

  for (const [key, wanted] of Object.entries(attributes)) {
    if (
      wanted !== null &&
      typeof wanted === "object" &&
      !(wanted instanceof Includes) &&
      !(wanted instanceof StartsWith)
    ) {
      fixture.unhandled.push({
        kind: "analytics.getList",
        modelName: "Log",
        attribute: key,
      });
    }
  }

  if (eventReadFailuresLeft > 0) {
    eventReadFailuresLeft--;
    throw new Error("The logs could not be read. Try again in a moment.");
  }

  const start =
    timeWindow instanceof InBetween ? new Date(timeWindow.startValue) : null;
  const end =
    timeWindow instanceof InBetween ? new Date(timeWindow.endValue) : null;

  const matching = logs
    .filter((log) => {
      if (start && log.time.getTime() < start.getTime()) {
        return false;
      }
      if (end && log.time.getTime() > end.getTime()) {
        return false;
      }
      if (ids && !ids.includes(log._id)) {
        return false;
      }
      return Object.entries(attributes).every(([key, wanted]) => {
        return attributeMatches(log.attributes[key], wanted);
      });
    })
    .sort((a, b) => {
      return b.time.getTime() - a.time.getTime();
    });

  const page = matching.slice(0, limit);

  return {
    data: page.map((log) => {
      const row = new Log();
      row._id = new ObjectID(log._id);
      row.time = log.time;
      row.attributes = log.attributes;
      if (select.body) {
        row.body = log.body;
      }
      return row;
    }),
    count: page.length + (matching.length > limit ? 1 : 0),
    skip: 0,
    limit: limit,
    hasMore: matching.length > limit,
  };
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
  return "sam@acme-cloud.example";
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
    select: serialize(options.select),
    limit: options.limit,
  });

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
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
 * The cluster layout writes the counts it read back to the cluster (for the
 * clusters list). Nothing else here writes, so any other write is unhandled.
 */
ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.updateRequests.push({
    modelName,
    id: plain(options.id),
    data: serialize(options.data),
  });

  if (modelName !== "KubernetesCluster") {
    fixture.unhandled.push({ kind: "updateById", modelName });
  }

  return ok({});
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);

  if (modelName === tableName(Log)) {
    return listEventLogs(options);
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (modelType) => {
  const modelName = tableName(modelType);
  fixture.countRequests.push({ modelName });
  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

/*
 * ---------------------------------------------------------------------------
 * The Overview's metrics: a calm, generated cluster
 *
 * Not what this suite is about - the Overview is here for its Recent
 * Warnings - but drawn so the page reads as it does in production. Every
 * series is a smooth function of time, sampled once a minute inside the
 * read's window; a grouped read gets one series per node or pod, an
 * ungrouped one their average (or sum, for a Sum).
 * ---------------------------------------------------------------------------
 */
function wave(time, base, amplitude, periodMinutes, phase) {
  return (
    base +
    amplitude *
      Math.sin((time / (periodMinutes * MINUTE)) * 2 * Math.PI + phase)
  );
}

const GIB = 1024 * 1024 * 1024;
const NODE_SERIES = [
  [USER_POOL_NODE, 0],
  [AGENT_POOL_NODE, 1.7],
];
const POD_SERIES = [
  ["shop", CHECKOUT_POD, 0.32, 410],
  ["shop", CHECKOUT_POD_TWO, 0.21, 380],
  ["aks-istio-system", ISTIOD_POD, 0.18, 290],
  ["app-routing-system", NGINX_POD, 0.09, 140],
];

function nodeSeries(value) {
  return NODE_SERIES.map(([nodeName, phase]) => {
    return {
      attributes: {
        "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
        "resource.k8s.node.name": nodeName,
      },
      value: (time) => {
        return value(time, phase);
      },
    };
  });
}

function podSeries(value) {
  return POD_SERIES.map(([namespace, podName, cpu, memory]) => {
    return {
      attributes: {
        "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
        "resource.k8s.namespace.name": namespace,
        "resource.k8s.pod.name": podName,
      },
      value: (time) => {
        return value(time, cpu, memory);
      },
    };
  });
}

const METRIC_SERIES = {
  "k8s.node.cpu.utilization": nodeSeries((time, phase) => {
    return wave(time, 1.4, 0.35, 23, phase);
  }),
  "k8s.node.allocatable_cpu": nodeSeries(() => {
    return 3.86;
  }),
  "k8s.node.memory.usage": nodeSeries((time, phase) => {
    return wave(time, 7.2 * GIB, 0.6 * GIB, 31, phase);
  }),
  "k8s.node.filesystem.usage": nodeSeries(() => {
    return 41 * GIB;
  }),
  "k8s.node.filesystem.available": nodeSeries(() => {
    return 82 * GIB;
  }),
  "k8s.node.network.io": nodeSeries((time, phase) => {
    // Cumulative bytes: the page turns them into a rate.
    return (time / 1000) * wave(time, 2.4e6, 0.3e6, 17, phase);
  }),
  "k8s.pod.cpu.utilization": podSeries((time, cpu) => {
    return wave(time, cpu, cpu / 5, 19, cpu);
  }),
  "k8s.pod.memory.usage": podSeries((time, cpu, memory) => {
    return wave(time, memory * 1024 * 1024, 20 * 1024 * 1024, 29, cpu);
  }),
  "oneuptime.host.heartbeat": [
    {
      attributes: { "resource.k8s.cluster.name": CLUSTER_IDENTIFIER },
      value: () => {
        return 1;
      },
    },
  ],
};

function generateMetricRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const series = METRIC_SERIES[query.name];

  if (!series) {
    return null;
  }

  // Only this cluster's series: another cluster's read gets none.
  const wantedCluster = query.attributes?.["resource.k8s.cluster.name"];
  if (wantedCluster && wantedCluster !== CLUSTER_IDENTIFIER) {
    return [];
  }

  const start = new Date(aggregateBy.startTimestamp).getTime();
  const end = Math.min(new Date(aggregateBy.endTimestamp).getTime(), LOADED_AT);
  const isGrouped =
    Boolean(aggregateBy.groupBy?.attributes) ||
    (aggregateBy.groupByAttributeKeys || []).length > 0;
  const isSum =
    String(aggregateBy.aggregationType || "").toLowerCase() === "sum";
  const rows = [];

  for (
    let time = Math.ceil(start / MINUTE) * MINUTE;
    time <= end;
    time += MINUTE
  ) {
    if (isGrouped) {
      for (const entry of series) {
        rows.push({
          timestamp: new Date(time),
          value: Math.max(0, entry.value(time)),
          attributes: { ...entry.attributes },
        });
      }
      continue;
    }

    const values = series.map((entry) => {
      return Math.max(0, entry.value(time));
    });
    const total = values.reduce((sum, value) => {
      return sum + value;
    }, 0);
    rows.push({
      timestamp: new Date(time),
      value: isSum ? total : total / values.length,
    });
  }

  return rows;
}

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy;
  fixture.aggregateRequests.push({
    modelName,
    name: aggregateBy?.query?.name,
    attributes: serialize(aggregateBy?.query?.attributes),
  });

  const data = modelName.startsWith("Metric")
    ? generateMetricRows(aggregateBy || {})
    : null;

  if (!data) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy?.query?.name,
    });
    return { data: [] };
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
    parsed.pathname.includes("/kubernetes-resource/inventory-summary/")
  ) {
    return ok({
      nodeCount: 2,
      podCount: 14,
      namespaceCount: 6,
      deploymentCount: 5,
      statefulSetCount: 0,
      daemonSetCount: 3,
      jobCount: 1,
      cronJobCount: 1,
      containerCount: 19,
      pvcCount: 0,
      pvCount: 0,
      hpaCount: 2,
      vpaCount: 0,
    });
  }

  /*
   * The Overview's AI agent card: answered "no AI agent yet", as the server
   * answers for a cluster nobody installed one on.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/kubernetes-cluster/ai-access/status")
  ) {
    return ok({
      clusterId: CLUSTER_ID,
      clusterName: CLUSTER_NAME,
      runner: null,
      accessMethod: "none",
      aiAgent: null,
      automaticInvestigation: {},
      gaps: [],
    });
  }

  /*
   * The Overview's availability chart asks when OneUptime was not receiving
   * data in its window: never, here.
   */
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  /*
   * The Overview's Security card asks what Security Events found about the
   * cluster this week. This project uses no Security Events - no event
   * arrived this week - so the server says so and the card draws nothing.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/security-case/resource-security")
  ) {
    const body = options.data || {};
    if (body.kind !== "KubernetesCluster" || body.id !== CLUSTER_ID) {
      return new HTTPErrorResponse(
        404,
        { message: "This record could not be found." },
        {},
      );
    }
    return ok({
      kind: "KubernetesCluster",
      id: CLUSTER_ID,
      name: CLUSTER_IDENTIFIER,
      isInUse: false,
      windowDays: 7,
      values: [CLUSTER_IDENTIFIER],
      entity: { type: "Host", value: CLUSTER_IDENTIFIER },
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
      risk: null,
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
  },
  interpolation: { escapeValue: false },
});

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
  [PageMap.KUBERNETES_CLUSTER_VIEW, KubernetesOverview],
  [PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS, KubernetesEventsPage],
  [PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL, KubernetesNodeDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL, KubernetesHPADetail],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
    KubernetesDeploymentDetail,
  ],
  [PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL, KubernetesNamespaceDetail],
  // Where the Events page's "Turn on warning alerts" goes.
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS,
    KubernetesRecommendations,
  ],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(
  KubernetesLayout,
  PageMap.KUBERNETES_CLUSTER_VIEW,
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
          <span className="text-sm text-gray-500">Acme Cloud</span>
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
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
