/*
 * Offline fixture for a Kubernetes cluster's pages: the production cluster
 * layout (ModelPage, the cluster's side menu) with its Overview, its Pods,
 * Deployments, StatefulSets, DaemonSets, Jobs, CronJobs and Nodes lists,
 * and the pages of a pod, a Deployment, a
 * StatefulSet, a DaemonSet, a Job, a CronJob and a node - under their real
 * RouteMap patterns - and Recommendations. Only the data boundary
 * (ModelAPI, AnalyticsModelAPI, API, Realtime) and the signed-in user are
 * replaced. Every record is fabricated for an "Acme Retail" workspace.
 *
 * The inventory rows are what ingest stores: spec and status in the
 * parsers' shape (Common/Types/Kubernetes/KubernetesObjectParser), owner
 * references as `{ items: [...] }`. What needs attention and a part's read
 * are answered as KubernetesResourceService answers them
 * (Common/Tests/Helpers/KubernetesPartReads). The busy cluster holds what
 * real clusters do and a page could get wrong:
 *
 *   - a `checkout` Deployment in both `shop` and `payments`: shop's is one
 *     replica short, its third pod crash-looping after an OOMKill, while
 *     payments' is healthy - the two must never be mixed up;
 *   - a node not ready, one under disk pressure, one cordoned;
 *   - a StatefulSet whose third pod cannot be scheduled, and the claim it
 *     waits for;
 *   - a DaemonSet ready on three of its four nodes;
 *   - a CronJob whose newest run failed (BackoffLimitExceeded), the run
 *     before it a success, and a Deployment mid-rollout;
 *   - an open alert about the crash-looping pod, an open incident about
 *     the node that is not ready, and one of the cluster's recommended
 *     monitors already on (CrashLoopBackOff Detection).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?estate=     busy (default) | calm (every part healthy, nothing open)
 *   ?collector=  connected (default) | disconnected (the agent went quiet)
 *   ?fail=       attention (what needs attention cannot be read) | part
 *                (an object's own read fails)
 *   ?lang=       de or fa reads the German or Persian locale file (Persian
 *                pages are right to left)
 *   ?theme=      dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__kubernetesPagesFixture: listRequests,
 * itemRequests, countRequests, aggregateRequests, apiRequests and
 * unhandled - anything the fixture does not model. The spec asserts
 * `unhandled` is empty.
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
import KubernetesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Layout";
import KubernetesOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import KubernetesPods from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Pods";
import KubernetesDeployments from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Deployments";
import KubernetesStatefulSets from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSets";
import KubernetesDaemonSets from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSets";
import KubernetesJobs from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Jobs";
import KubernetesCronJobs from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobs";
import KubernetesNodes from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Nodes";
import KubernetesPodDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail";
import KubernetesDeploymentDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentDetail";
import KubernetesStatefulSetDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSetDetail";
import KubernetesDaemonSetDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSetDetail";
import KubernetesJobDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/JobDetail";
import KubernetesCronJobDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobDetail";
import KubernetesNodeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import KubernetesRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Recommendations";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Log from "Common/Models/AnalyticsModels/Log";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
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
  readKubernetesNeedsAttention,
  readKubernetesPart,
} from "Common/Tests/Helpers/KubernetesPartReads";
import { getKubernetesPodWorkload } from "Common/Types/Kubernetes/KubernetesHealth";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const ESTATE = params.get("estate") === "calm" ? "calm" : "busy";
const IS_BUSY = ESTATE === "busy";
const COLLECTOR =
  params.get("collector") === "disconnected" ? "disconnected" : "connected";
const FAIL = ["attention", "part"].includes(params.get("fail"))
  ? params.get("fail")
  : "none";
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

function minutesAgo(minutes) {
  return new Date(LOADED_AT - minutes * MINUTE).toISOString();
}

const CLUSTER_ID = uuid("60000000", 1);
const CLUSTER_NAME = "EKS Production (eu-west-1)";
const CLUSTER_IDENTIFIER = "eks-prod-eu";

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Retail",
});

const cluster = {
  _id: CLUSTER_ID,
  projectId: PROJECT_ID,
  name: CLUSTER_NAME,
  clusterIdentifier: CLUSTER_IDENTIFIER,
  provider: "EKS",
  otelCollectorStatus: COLLECTOR,
  lastSeenAt: new Date(
    LOADED_AT - (COLLECTOR === "disconnected" ? 45 : 1) * MINUTE,
  ),
  nodeCount: 4,
  podCount: 20,
  namespaceCount: 4,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 90 * 24 * 60 * MINUTE),
};

/*
 * ---------------------------------------------------------------------------
 * Inventory, as ingest stores it
 * ---------------------------------------------------------------------------
 */
const NODE_A = "ip-10-0-1-11.eu-west-1.compute.internal";
const NODE_B = "ip-10-0-1-12.eu-west-1.compute.internal";
const NODE_C = "ip-10-0-1-13.eu-west-1.compute.internal";
const NODE_D = "ip-10-0-1-14.eu-west-1.compute.internal";

const CRASHING_POD = "checkout-7d9f8b6c5-g5h6i";
const PENDING_POD = "postgres-2";
const FAILED_RUN = "nightly-report-29013480";

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

// An EKS node's address is in its name: ip-10-0-1-13... is 10.0.1.13.
function addressOf(nodeName) {
  const match = /^ip-(\d+)-(\d+)-(\d+)-(\d+)\./.exec(nodeName || "");
  return match ? match.slice(1, 5).join(".") : "";
}

function owners(kind, name) {
  return { items: [{ kind: kind, name: name, uid: `${kind}-${name}` }] };
}

function condition(type, status, fields = {}) {
  return {
    type: type,
    status: status,
    reason: fields.reason || "",
    message: fields.message || "",
    lastTransitionTime: minutesAgo(fields.at ?? 600),
  };
}

function containerSpec(name, image, limits = {}) {
  return {
    name: name,
    image: image,
    command: [],
    args: [],
    env: [],
    ports: [],
    resources: {
      requests: { cpu: "250m", memory: "256Mi" },
      limits: limits,
    },
    volumeMounts: [],
  };
}

function runningContainer(name, image, fields = {}) {
  return {
    name: name,
    ready: fields.ready ?? true,
    restartCount: fields.restartCount ?? 0,
    state: fields.state || "running",
    reason: fields.reason || "",
    image: image,
    message: fields.message || "",
    exitCode: fields.exitCode ?? null,
    startedAt: minutesAgo(fields.startedMinutesAgo ?? 600),
    ...(fields.lastTerminationReason
      ? {
          lastTerminationReason: fields.lastTerminationReason,
          lastTerminationExitCode: fields.lastTerminationExitCode ?? null,
          lastTerminatedAt: minutesAgo(fields.lastTerminatedMinutesAgo ?? 3),
        }
      : {}),
  };
}

// What each node has, as its capacity says: 16070512Ki.
const NODE_MEMORY_BYTES = 16070512 * 1024;

function pod(fields) {
  const image = fields.image || "registry.acme-retail.example/app:2.4.1";
  const memoryBytes = fields.memoryMiB ? fields.memoryMiB * 1024 * 1024 : null;
  const containers = fields.containers || [
    runningContainer(fields.container || "app", image),
  ];
  const ready = containers.every((container) => {
    return container.ready;
  });
  const phase = fields.phase || "Running";
  return resource({
    kind: "Pod",
    name: fields.name,
    namespaceKey: fields.namespace,
    phase: phase,
    isReady: ready,
    labels: fields.labels || {},
    ownerReferences: fields.owner
      ? owners(fields.owner[0], fields.owner[1])
      : { items: [] },
    spec: {
      containers: containers.map((container) => {
        return containerSpec(container.name, container.image, {
          memory: fields.memoryLimit || "512Mi",
        });
      }),
      initContainers: [],
      serviceAccountName: "default",
      nodeName: fields.node || "",
      nodeSelector: {},
      tolerations: [],
      volumes: [],
    },
    status: {
      phase: phase,
      podIP: fields.node ? `10.0.${resourceNumber % 4}.${resourceNumber}` : "",
      hostIP: addressOf(fields.node),
      qosClass: "Burstable",
      conditions: fields.conditions || [
        condition("Initialized", "True"),
        condition("Ready", ready ? "True" : "False", {
          at: fields.notReadyMinutes ?? 600,
        }),
        condition("ContainersReady", ready ? "True" : "False", {
          at: fields.notReadyMinutes ?? 600,
        }),
        condition("PodScheduled", "True"),
      ],
      containerStatuses: containers,
      initContainerStatuses: [],
      startTime: minutesAgo(fields.startedMinutesAgo ?? 600),
    },
    resourceCreationTimestamp: new Date(
      LOADED_AT - (fields.createdMinutesAgo ?? 600) * MINUTE,
    ),
    latestCpuPercent: fields.cpu ?? null,
    latestMemoryBytes: memoryBytes,
    // Ingest's share of the pod's node (memoryBytesToPercent).
    latestMemoryPercent: memoryBytes
      ? (memoryBytes / NODE_MEMORY_BYTES) * 100
      : null,
    metricsUpdatedAt: fields.cpu ? new Date(LOADED_AT - MINUTE) : null,
  });
}

function node(name, fields = {}) {
  const conditions = [
    condition("MemoryPressure", "False", {
      reason: "KubeletHasSufficientMemory",
    }),
    condition("DiskPressure", fields.disk ? "True" : "False", {
      reason: fields.disk
        ? "KubeletHasDiskPressure"
        : "KubeletHasNoDiskPressure",
      message: fields.disk ? "kubelet has disk pressure" : "",
      at: fields.disk ? 35 : 600,
    }),
    condition("PIDPressure", "False", { reason: "KubeletHasSufficientPID" }),
    condition(
      "Ready",
      fields.notReady ? "Unknown" : "True",
      fields.notReady
        ? {
            reason: "NodeStatusUnknown",
            message: "Kubelet stopped posting node status.",
            at: 22,
          }
        : {
            reason: "KubeletReady",
            message: "kubelet is posting ready status",
          },
    ),
  ];
  return resource({
    kind: "Node",
    name: name,
    isReady: !fields.notReady,
    hasMemoryPressure: false,
    hasDiskPressure: Boolean(fields.disk),
    hasPidPressure: false,
    labels: {
      "node.kubernetes.io/instance-type": "m6i.xlarge",
      "topology.kubernetes.io/zone": "eu-west-1a",
    },
    spec: {
      unschedulable: Boolean(fields.cordoned),
      taints: fields.cordoned
        ? [
            {
              key: "node.kubernetes.io/unschedulable",
              value: "",
              effect: "NoSchedule",
            },
          ]
        : [],
    },
    status: {
      conditions: conditions,
      nodeInfo: {
        osImage: "Amazon Linux 2023.5.20240805",
        kernelVersion: "6.1.102-108.177.amzn2023.x86_64",
        containerRuntimeVersion: "containerd://1.7.20",
        kubeletVersion: "v1.30.2-eks-1552ad0",
        architecture: "amd64",
        operatingSystem: "linux",
      },
      allocatable: { cpu: "3920m", memory: "15147888Ki", pods: "58" },
      capacity: { cpu: "4", memory: "16070512Ki", pods: "58" },
      addresses: [{ type: "InternalIP", address: addressOf(name) }],
    },
    resourceCreationTimestamp: new Date(LOADED_AT - 40 * 24 * 60 * MINUTE),
    lastSeenAt: new Date(LOADED_AT - MINUTE),
    latestCpuPercent: fields.notReady ? null : fields.cpu ?? 38,
    latestMemoryBytes: fields.notReady ? null : 9.2 * 1024 * 1024 * 1024,
    metricsUpdatedAt: fields.notReady ? null : new Date(LOADED_AT - MINUTE),
  });
}

function deployment(name, namespace, fields) {
  return resource({
    kind: "Deployment",
    name: name,
    namespaceKey: namespace,
    labels: { app: name },
    spec: {
      replicas: fields.replicas,
      strategy: "RollingUpdate",
      selector: { app: name },
      paused: false,
    },
    status: {
      replicas: fields.replicas,
      readyReplicas: fields.available,
      availableReplicas: fields.available,
      unavailableReplicas: fields.replicas - fields.available,
      updatedReplicas: fields.updated ?? fields.replicas,
      conditions: [
        condition("Available", fields.available > 0 ? "True" : "False", {
          reason: "MinimumReplicasAvailable",
        }),
        condition("Progressing", "True", {
          reason: fields.rollingOut
            ? "ReplicaSetUpdated"
            : "NewReplicaSetAvailable",
          message: fields.rollingOut
            ? `ReplicaSet "${name}-6c4f8d9b7" is progressing.`
            : `ReplicaSet "${name}-7d9f8b6c5" has successfully progressed.`,
          at: fields.rollingOut ? 4 : 600,
        }),
      ],
    },
    resourceCreationTimestamp: new Date(LOADED_AT - 60 * 24 * 60 * MINUTE),
  });
}

const nodes = [
  node(NODE_A, { cpu: 46 }),
  node(NODE_B, { disk: IS_BUSY, cpu: 31 }),
  node(NODE_C, { notReady: IS_BUSY }),
  node(NODE_D, { cordoned: IS_BUSY, cpu: 12 }),
];

const namespaces = ["shop", "payments", "data", "kube-system"].map((name) => {
  return resource({
    kind: "Namespace",
    name: name,
    phase: "Active",
    status: { phase: "Active" },
  });
});

const CHECKOUT_IMAGE = "registry.acme-retail.example/checkout:4.12.0";

const workloads = [
  deployment("checkout", "shop", {
    replicas: 3,
    available: IS_BUSY ? 2 : 3,
  }),
  deployment("checkout", "payments", { replicas: 2, available: 2 }),
  deployment("cart", "shop", { replicas: 2, available: 2 }),
  deployment("web", "shop", {
    replicas: 3,
    available: 3,
    updated: IS_BUSY ? 1 : 3,
    rollingOut: IS_BUSY,
  }),
  resource({
    kind: "StatefulSet",
    name: "postgres",
    namespaceKey: "data",
    spec: {
      replicas: 3,
      serviceName: "postgres",
      podManagementPolicy: "OrderedReady",
      updateStrategy: "RollingUpdate",
    },
    status: {
      replicas: 3,
      readyReplicas: IS_BUSY ? 2 : 3,
      currentReplicas: 3,
      updatedReplicas: 3,
      availableReplicas: IS_BUSY ? 2 : 3,
      currentRevision: "postgres-5d8c9b7f4",
      updateRevision: "postgres-5d8c9b7f4",
    },
  }),
  resource({
    kind: "DaemonSet",
    name: "fluent-bit",
    namespaceKey: "kube-system",
    spec: { updateStrategy: "RollingUpdate" },
    status: {
      desiredNumberScheduled: 4,
      currentNumberScheduled: 4,
      numberReady: IS_BUSY ? 3 : 4,
      numberMisscheduled: 0,
      numberAvailable: IS_BUSY ? 3 : 4,
      updatedNumberScheduled: 4,
      numberUnavailable: IS_BUSY ? 1 : 0,
    },
  }),
  resource({
    kind: "CronJob",
    name: "nightly-report",
    namespaceKey: "shop",
    spec: {
      schedule: "0 2 * * *",
      suspend: false,
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
    },
    status: {
      lastScheduleTime: minutesAgo(70),
      activeCount: 0,
      lastSuccessfulTime: minutesAgo(70 + 24 * 60),
    },
  }),
  resource({
    kind: "Job",
    name: "nightly-report-29012040",
    namespaceKey: "shop",
    ownerReferences: owners("CronJob", "nightly-report"),
    spec: { completions: 1, parallelism: 1, backoffLimit: 2 },
    status: {
      active: 0,
      succeeded: 1,
      failed: 0,
      startTime: minutesAgo(70 + 24 * 60),
      completionTime: minutesAgo(64 + 24 * 60),
      conditions: [condition("Complete", "True", { at: 64 + 24 * 60 })],
    },
    resourceCreationTimestamp: new Date(LOADED_AT - (70 + 24 * 60) * MINUTE),
  }),
  resource({
    kind: "Job",
    name: FAILED_RUN,
    namespaceKey: "shop",
    ownerReferences: owners("CronJob", "nightly-report"),
    spec: { completions: 1, parallelism: 1, backoffLimit: 2 },
    status: IS_BUSY
      ? {
          active: 0,
          succeeded: 0,
          failed: 3,
          startTime: minutesAgo(70),
          completionTime: "",
          conditions: [
            condition("Failed", "True", {
              reason: "BackoffLimitExceeded",
              message: "Job has reached the specified backoff limit",
              at: 52,
            }),
          ],
        }
      : {
          active: 0,
          succeeded: 1,
          failed: 0,
          startTime: minutesAgo(70),
          completionTime: minutesAgo(64),
          conditions: [condition("Complete", "True", { at: 64 })],
        },
    resourceCreationTimestamp: new Date(LOADED_AT - 70 * MINUTE),
  }),
  resource({
    kind: "Job",
    name: "db-migrate-41",
    namespaceKey: "shop",
    spec: { completions: 1, parallelism: 1, backoffLimit: 6 },
    status: {
      active: 0,
      succeeded: 1,
      failed: 0,
      startTime: minutesAgo(3 * 24 * 60),
      completionTime: minutesAgo(3 * 24 * 60 - 2),
      conditions: [condition("Complete", "True", { at: 3 * 24 * 60 - 2 })],
    },
  }),
  resource({
    kind: "PersistentVolumeClaim",
    name: "data-postgres-2",
    namespaceKey: "data",
    phase: IS_BUSY ? "Pending" : "Bound",
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "gp3",
      volumeName: IS_BUSY ? "" : "pvc-3c1f6b2e",
      resources: { requests: { storage: "100Gi" } },
    },
    status: {
      phase: IS_BUSY ? "Pending" : "Bound",
      capacity: { storage: IS_BUSY ? "" : "100Gi" },
    },
    resourceCreationTimestamp: new Date(LOADED_AT - 25 * MINUTE),
  }),
];

const checkoutOwner = ["ReplicaSet", "checkout-7d9f8b6c5"];

const pods = [
  pod({
    name: "checkout-7d9f8b6c5-a1b2c",
    namespace: "shop",
    owner: checkoutOwner,
    labels: { app: "checkout", "pod-template-hash": "7d9f8b6c5" },
    node: NODE_A,
    image: CHECKOUT_IMAGE,
    container: "checkout",
    cpu: 22,
    memoryMiB: 318,
  }),
  pod({
    name: "checkout-7d9f8b6c5-d3e4f",
    namespace: "shop",
    owner: checkoutOwner,
    labels: { app: "checkout", "pod-template-hash": "7d9f8b6c5" },
    node: NODE_B,
    image: CHECKOUT_IMAGE,
    container: "checkout",
    cpu: 19,
    memoryMiB: 301,
  }),
  pod({
    name: CRASHING_POD,
    namespace: "shop",
    owner: checkoutOwner,
    labels: { app: "checkout", "pod-template-hash": "7d9f8b6c5" },
    node: NODE_A,
    notReadyMinutes: 34,
    containers: [
      IS_BUSY
        ? runningContainer("checkout", CHECKOUT_IMAGE, {
            ready: false,
            restartCount: 14,
            state: "waiting",
            reason: "CrashLoopBackOff",
            message:
              "back-off 5m0s restarting failed container=checkout pod=checkout-7d9f8b6c5-g5h6i_shop(2b6c1e9a)",
            lastTerminationReason: "OOMKilled",
            lastTerminationExitCode: 137,
            lastTerminatedMinutesAgo: 3,
          })
        : runningContainer("checkout", CHECKOUT_IMAGE),
    ],
    cpu: IS_BUSY ? null : 21,
  }),
  pod({
    name: "checkout-5c8d7f9b4-p1q2r",
    namespace: "payments",
    owner: ["ReplicaSet", "checkout-5c8d7f9b4"],
    labels: { app: "checkout", "pod-template-hash": "5c8d7f9b4" },
    node: NODE_A,
    image: "registry.acme-retail.example/payments-checkout:1.9.3",
    container: "checkout",
    cpu: 14,
    memoryMiB: 210,
  }),
  pod({
    name: "checkout-5c8d7f9b4-s3t4u",
    namespace: "payments",
    owner: ["ReplicaSet", "checkout-5c8d7f9b4"],
    labels: { app: "checkout", "pod-template-hash": "5c8d7f9b4" },
    node: NODE_D,
    image: "registry.acme-retail.example/payments-checkout:1.9.3",
    container: "checkout",
    cpu: 12,
    memoryMiB: 204,
  }),
  ...["x1y2z", "w3v4u"].map((suffix, index) => {
    return pod({
      name: `cart-6f7d8c9b5-${suffix}`,
      namespace: "shop",
      owner: ["ReplicaSet", "cart-6f7d8c9b5"],
      node: index === 0 ? NODE_B : NODE_D,
      container: "cart",
      cpu: 9,
      memoryMiB: 160,
    });
  }),
  ...["k8l9m", "n0p1q", "r2s3t"].map((suffix, index) => {
    // Rolling out: one pod of the new ReplicaSet so far, two of the old.
    const replicaSet = IS_BUSY && index > 0 ? "web-58b7c6d4f" : "web-6c4f8d9b7";
    return pod({
      name: `${replicaSet}-${suffix}`,
      namespace: "shop",
      owner: ["ReplicaSet", replicaSet],
      node: [NODE_A, NODE_B, NODE_D][index],
      container: "web",
      cpu: 7,
      memoryMiB: 120,
    });
  }),
  pod({
    name: "postgres-0",
    namespace: "data",
    owner: ["StatefulSet", "postgres"],
    node: NODE_A,
    container: "postgres",
    image: "postgres:16.4",
    memoryLimit: "4Gi",
    cpu: 28,
    memoryMiB: 1840,
  }),
  pod({
    name: "postgres-1",
    namespace: "data",
    owner: ["StatefulSet", "postgres"],
    node: NODE_B,
    container: "postgres",
    image: "postgres:16.4",
    memoryLimit: "4Gi",
    cpu: 24,
    memoryMiB: 1712,
  }),
  IS_BUSY
    ? pod({
        name: PENDING_POD,
        namespace: "data",
        owner: ["StatefulSet", "postgres"],
        phase: "Pending",
        createdMinutesAgo: 25,
        containers: [
          runningContainer("postgres", "postgres:16.4", {
            ready: false,
            state: "waiting",
            reason: "ContainerCreating",
          }),
        ],
        conditions: [
          condition("PodScheduled", "False", {
            reason: "Unschedulable",
            message:
              "0/4 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 1 node(s) were unschedulable, 2 node(s) didn't match pod anti-affinity rules. preemption: 0/4 nodes are available: 4 Preemption is not helpful for scheduling.",
            at: 25,
          }),
        ],
      })
    : pod({
        name: PENDING_POD,
        namespace: "data",
        owner: ["StatefulSet", "postgres"],
        node: NODE_D,
        container: "postgres",
        image: "postgres:16.4",
        memoryLimit: "4Gi",
        cpu: 20,
        memoryMiB: 1600,
      }),
  ...[NODE_A, NODE_B, NODE_C, NODE_D].map((nodeName, index) => {
    const isOnLostNode = IS_BUSY && nodeName === NODE_C;
    return pod({
      name: `fluent-bit-${["7xk2p", "9fz4c", "q2w8d", "h5n3v"][index]}`,
      namespace: "kube-system",
      owner: ["DaemonSet", "fluent-bit"],
      node: nodeName,
      container: "fluent-bit",
      image: "cr.fluentbit.io/fluent/fluent-bit:3.1.4",
      notReadyMinutes: isOnLostNode ? 22 : 600,
      containers: [
        runningContainer(
          "fluent-bit",
          "cr.fluentbit.io/fluent/fluent-bit:3.1.4",
          { ready: !isOnLostNode },
        ),
      ],
      cpu: isOnLostNode ? null : 3,
      memoryMiB: isOnLostNode ? null : 48,
    });
  }),
  IS_BUSY
    ? pod({
        name: `${FAILED_RUN}-k2j4h`,
        namespace: "shop",
        owner: ["Job", FAILED_RUN],
        node: NODE_B,
        phase: "Failed",
        createdMinutesAgo: 60,
        containers: [
          runningContainer(
            "report",
            "registry.acme-retail.example/report:7.0.2",
            {
              ready: false,
              state: "terminated",
              reason: "Error",
              exitCode: 1,
            },
          ),
        ],
      })
    : pod({
        name: `${FAILED_RUN}-k2j4h`,
        namespace: "shop",
        owner: ["Job", FAILED_RUN],
        node: NODE_B,
        phase: "Succeeded",
        createdMinutesAgo: 70,
        containers: [
          runningContainer(
            "report",
            "registry.acme-retail.example/report:7.0.2",
            {
              ready: false,
              state: "terminated",
              reason: "Completed",
              exitCode: 0,
            },
          ),
        ],
      }),
];

const resources = [...nodes, ...namespaces, ...workloads, ...pods];

function rowNamed(kind, name, namespace) {
  return resources.find((row) => {
    return (
      row.kind === kind &&
      row.name === name &&
      (namespace === undefined || row.namespaceKey === namespace)
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * What is open on the cluster, and the monitors it already has
 * ---------------------------------------------------------------------------
 */
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

const incidents = IS_BUSY
  ? [
      {
        _id: uuid("56000000", 1),
        title: `[K8s] Node Not Ready - ${CLUSTER_NAME}`,
        incidentNumber: 312,
        incidentNumberWithPrefix: "INC-312",
        declaredAt: new Date(LOADED_AT - 18 * MINUTE),
        createdAt: new Date(LOADED_AT - 18 * MINUTE),
        seriesLabels: { "resource.k8s.node.name": NODE_C },
        incidentSeverity: criticalIncident,
        currentIncidentState: incidentStates[0],
        currentIncidentStateId: incidentStates[0]._id,
        kubernetesClusters: [{ _id: CLUSTER_ID }],
        kubernetesResources: [{ _id: rowNamed("Node", NODE_C)._id }],
      },
    ]
  : [];

const alerts = IS_BUSY
  ? [
      {
        _id: uuid("57000000", 1),
        title: `[K8s] CrashLoopBackOff Detected - ${CLUSTER_NAME}`,
        alertNumber: 1207,
        alertNumberWithPrefix: "ALT-1207",
        createdAt: new Date(LOADED_AT - 30 * MINUTE),
        seriesLabels: {
          "resource.k8s.namespace.name": "shop",
          "resource.k8s.pod.name": CRASHING_POD,
          "resource.k8s.container.name": "checkout",
        },
        alertSeverity: warningAlert,
        currentAlertState: alertStates[0],
        currentAlertStateId: alertStates[0]._id,
        kubernetesClusters: [{ _id: CLUSTER_ID }],
        kubernetesResources: [
          { _id: rowNamed("Pod", CRASHING_POD, "shop")._id },
        ],
      },
    ]
  : [];

const kubernetesRecommendations =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
  );
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendationId, number) {
  const recommendation = kubernetesRecommendations.find((candidate) => {
    return candidate.recommendationId === recommendationId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: CLUSTER_IDENTIFIER,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: CLUSTER_NAME,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${CLUSTER_NAME} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.Kubernetes,
    monitorSteps: steps,
  };
}

// One of the cluster's recommended monitors is already on.
const monitors = IS_BUSY
  ? [monitorFor("Kubernetes:k8s-crashloopbackoff", 1)].filter(Boolean)
  : [];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    estate: ESTATE,
    collector: COLLECTOR,
    fail: FAIL,
    language: LANGUAGE,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  itemRequests: [],
  countRequests: [],
  aggregateRequests: [],
  updateRequests: [],
  apiRequests: [],
  logRequests: [],
  unhandled: [],
};
window.__kubernetesPagesFixture = fixture;

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
  return "Priya Raman";
};
UserUtil.getEmail = () => {
  return "priya@acme-retail.example";
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
  Incident: incidents,
  Alert: alerts,
  ScheduledMaintenance: [],
  Monitor: monitors,
  RecommendationDismissal: [],
  DatabaseServer: [],
  MetricType: [],
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
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
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

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
  });

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

// The cluster layout writes the counts it read back to the cluster.
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

  return new HTTPResponse(200, {}, {});
};

// The cluster's Events: none this week, on a cluster that only just warned.
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);

  if (modelName === tableName(Log)) {
    fixture.logRequests.push({
      attributes: serialize(options.query?.attributes || {}),
      limit: options.limit,
    });
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  // A Metrics tab's chart also looks for raw points and change events.
  if (["MetricItemV3", "ChangeEventV1"].includes(modelName)) {
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (modelType) => {
  const modelName = tableName(modelType);
  fixture.countRequests.push({ modelName });

  if (modelName === tableName(Log)) {
    return 0;
  }

  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

/*
 * The metrics: a calm, generated cluster. A read grouped by attributes gets
 * a series per pod for a pod or container metric and per node otherwise,
 * sampled once a minute inside its window, each in its own unit: cores,
 * bytes, a 0-1 ratio, or a heartbeat.
 */
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

function metricValue(name, series, time) {
  const swing = Math.sin(time / (11 * MINUTE) + series.length);
  const isPod = Boolean(series.attributes["resource.k8s.pod.name"]);
  if (name.includes("heartbeat")) {
    return 1;
  }
  if (name.includes("allocatable_cpu")) {
    return 3.92;
  }
  if (name.includes("allocatable_memory")) {
    return 14.4 * GIB;
  }
  if (name.includes("cpu_limit_utilization")) {
    return 0.35 + 0.1 * swing;
  }
  if (name.includes("memory_limit_utilization")) {
    return 0.55 + 0.05 * swing;
  }
  if (name.includes("cpu")) {
    return isPod ? 0.08 + 0.03 * swing : 1.3 + 0.3 * swing;
  }
  if (name.includes("filesystem.available")) {
    return 61 * GIB;
  }
  if (name.includes("filesystem")) {
    return isPod ? 220 * MIB : 39 * GIB;
  }
  if (name.includes("memory")) {
    return isPod ? 310 * MIB + 20 * MIB * swing : 8.6 * GIB + 0.4 * GIB * swing;
  }
  // A metric's name, matched whole: a substring that reads like a host name
  // is what code scanning takes for a URL check (js/incomplete-url-substring-sanitization).
  if (/^k8s\.(?:node|pod)\.network\.io$/.test(name)) {
    // Cumulative bytes: the page turns them into a rate.
    return (time / 1000) * (2.2e6 + 0.3e6 * swing);
  }
  return 40 + 12 * swing;
}

function generateMetricRows(aggregateBy) {
  const window = aggregateBy.query?.time;
  const name = aggregateBy.query?.name || "";
  const end = window instanceof InBetween ? new Date(window.endValue) : null;
  const start =
    window instanceof InBetween ? new Date(window.startValue) : null;

  if (!start || !end) {
    return [];
  }

  const isPodMetric =
    name.startsWith("k8s.pod.") || name.startsWith("container.");
  const series = isPodMetric
    ? pods
        .filter((row) => {
          return row.phase === "Running";
        })
        .map((row) => {
          return {
            "resource.k8s.namespace.name": row.namespaceKey,
            "resource.k8s.pod.name": row.name,
          };
        })
    : nodes
        .filter((row) => {
          return row.isReady;
        })
        .map((row) => {
          return { "resource.k8s.node.name": row.name };
        });

  const grouped = Boolean(aggregateBy.groupBy?.attributes);
  const rows = [];

  for (
    let time = start.getTime() + MINUTE;
    time <= Math.min(end.getTime(), LOADED_AT);
    time += MINUTE
  ) {
    if (grouped) {
      series.forEach((attributes, index) => {
        rows.push({
          timestamp: new Date(time).toISOString(),
          value: metricValue(
            name,
            { attributes: attributes, length: index },
            time,
          ),
          attributes: attributes,
        });
      });
      continue;
    }
    const values = series.map((attributes, index) => {
      return metricValue(name, { attributes: attributes, length: index }, time);
    });
    const isSum = String(aggregateBy.aggregationType || "")
      .toLowerCase()
      .includes("sum");
    const total = values.reduce((sum, value) => {
      return sum + value;
    }, 0);
    rows.push({
      timestamp: new Date(time).toISOString(),
      value: values.length === 0 ? 0 : isSum ? total : total / values.length,
      attributes: {},
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

  if (!modelName.startsWith("Metric")) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy?.query?.name,
    });
    return { data: [] };
  }

  return { data: generateMetricRows(aggregateBy || {}) };
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function countOf(kind) {
  return resources.filter((row) => {
    return row.kind === kind;
  }).length;
}

function podsInPhase(phase) {
  return pods.filter((row) => {
    return row.phase === phase;
  }).length;
}

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  // The side menu's counts and the hero's chips, from the inventory.
  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/inventory-summary/")
  ) {
    return ok({
      nodeCount: countOf("Node"),
      podCount: countOf("Pod"),
      namespaceCount: countOf("Namespace"),
      deploymentCount: countOf("Deployment"),
      statefulSetCount: countOf("StatefulSet"),
      daemonSetCount: countOf("DaemonSet"),
      jobCount: countOf("Job"),
      cronJobCount: countOf("CronJob"),
      containerCount: countOf("Pod"),
      pvcCount: countOf("PersistentVolumeClaim"),
      pvCount: 0,
      hpaCount: 0,
      vpaCount: 0,
      podPhaseCounts: {
        running: podsInPhase("Running"),
        pending: podsInPhase("Pending"),
        failed: podsInPhase("Failed"),
        succeeded: podsInPhase("Succeeded"),
      },
      nodeReadyCounts: {
        ready: nodes.filter((row) => {
          return row.isReady;
        }).length,
        notReady: nodes.filter((row) => {
          return !row.isReady;
        }).length,
      },
      nodePressureCounts: {
        memoryPressure: 0,
        diskPressure: nodes.filter((row) => {
          return row.hasDiskPressure;
        }).length,
        pidPressure: 0,
      },
    });
  }

  /*
   * What needs attention, and an object with what it runs, as
   * KubernetesResourceService answers them (Common/Tests/Helpers/
   * KubernetesPartReads, held to the service's own cases).
   */
  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/needs-attention/")
  ) {
    if (FAIL === "attention") {
      return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
    }
    return ok(serialize(readKubernetesNeedsAttention(resources)));
  }

  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/part/")
  ) {
    if (FAIL === "part") {
      return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
    }
    return ok(
      serialize(
        readKubernetesPart(resources, {
          kind: body.kind,
          name: body.name,
          namespace: body.namespace,
        }),
      ),
    );
  }

  /*
   * A list's CPU and memory: each workload's pods' latest readings added
   * up in their own namespace, keyed <namespace>/<name> as the server keys
   * them, so shop's checkout never reads payments' pods.
   */
  if (
    method === "POST" &&
    parsed.pathname.includes(
      "/kubernetes-resource/latest-pod-metrics-by-owner/",
    )
  ) {
    const ownerKind = parsed.pathname.split("/").pop();
    const aggregates = {};
    for (const row of pods) {
      const workload = getKubernetesPodWorkload(row);
      if (
        !workload ||
        workload.kind !== ownerKind ||
        row.latestCpuPercent === null ||
        row.latestCpuPercent === undefined
      ) {
        continue;
      }
      const key = `${row.namespaceKey}/${workload.name}`;
      const entry = aggregates[key] || {
        cpuPercent: 0,
        memoryBytes: 0,
        memoryPercent: 0,
      };
      entry.cpuPercent += row.latestCpuPercent;
      entry.memoryBytes += row.latestMemoryBytes || 0;
      entry.memoryPercent += row.latestMemoryPercent || 0;
      aggregates[key] = entry;
    }
    return ok({ aggregates: aggregates });
  }

  if (
    method === "POST" &&
    parsed.pathname.includes(
      "/kubernetes-resource/latest-pod-metrics-by-namespace/",
    )
  ) {
    return ok({ aggregates: {} });
  }

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

  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  if (
    method === "POST" &&
    parsed.pathname.endsWith("/security-case/resource-security")
  ) {
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
  [PageMap.KUBERNETES_CLUSTER_VIEW, KubernetesOverview],
  [PageMap.KUBERNETES_CLUSTER_VIEW_PODS, KubernetesPods],
  [PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS, KubernetesDeployments],
  [PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS, KubernetesStatefulSets],
  [PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS, KubernetesDaemonSets],
  [PageMap.KUBERNETES_CLUSTER_VIEW_JOBS, KubernetesJobs],
  [PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS, KubernetesCronJobs],
  [PageMap.KUBERNETES_CLUSTER_VIEW_NODES, KubernetesNodes],
  [PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL, KubernetesPodDetail],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
    KubernetesDeploymentDetail,
  ],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
    KubernetesStatefulSetDetail,
  ],
  [PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL, KubernetesDaemonSetDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL, KubernetesJobDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL, KubernetesCronJobDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL, KubernetesNodeDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS, KubernetesRecommendations],
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
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            OneUptime
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Acme Retail
          </span>
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
