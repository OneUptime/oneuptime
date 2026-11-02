/*
 * Offline fixture for OpenShift in the Kubernetes product (issue #5477): the
 * production Kubernetes cluster layout (ModelPage, the cluster's side menu)
 * with its Overview and the pages of a Route, a Service, a DeploymentConfig
 * and a pod - under their real RouteMap patterns. Only the data boundary
 * (ModelAPI, AnalyticsModelAPI, API, Realtime) and the signed-in user are
 * replaced. Every record is fabricated for an "Acme Cloud" workspace.
 *
 * The inventory rows are what ingest stores: each object goes through the
 * production state functions (getOpenShiftInventoryState), and Route, Service
 * and DeploymentConfig spec and status have the parsers' shape. It holds what
 * real clusters do and a list view could get wrong:
 *
 *   - a Route and a Service named `frontend` in both `shop` and `payments`;
 *   - a canary Route splitting traffic between two Services by weight;
 *   - a Route a router rejected (HostAlreadyClaimed), one no router has
 *     answered, and one a router admitted with a wildcard host;
 *   - DeploymentConfigs available, mid-rollout and scaled to zero;
 *   - `legacy-web` and a neighbour, `legacy-web-api`, whose name starts the
 *     same and whose pod's BackOff must never show on `legacy-web`'s page;
 *   - a pod of `legacy-web`, owned by the ReplicationController of rollout 7.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?cluster=   openshift (default) | plain (an EKS cluster: no Routes, no
 *               Services, no DeploymentConfigs, no ClusterOperators)
 *   ?health=    healthy (default) | degraded (an operator Degraded, another
 *               rolling out) | down (an operator not Available) | updating
 *               (an update under way) | failing (the update is Failing)
 *   ?lang=      de reads the German locale file
 *   ?theme=     dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__openShiftPagesFixture: listRequests,
 * itemRequests, countRequests, aggregateRequests, apiRequests, logRequests
 * and unhandled - anything the fixture does not model. The spec asserts
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
import KubernetesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Layout";
import KubernetesOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import KubernetesPodDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail";
import KubernetesEventsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events";
import KubernetesRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Recommendations";
import OpenShiftRoutes from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/OpenShiftRoutes";
import OpenShiftRouteDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/OpenShiftRouteDetail";
import KubernetesServices from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Services";
import KubernetesServiceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ServiceDetail";
import DeploymentConfigs from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentConfigs";
import DeploymentConfigDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentConfigDetail";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Log from "Common/Models/AnalyticsModels/Log";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import { getOpenShiftInventoryState } from "Common/Types/Kubernetes/OpenShiftObjectParser";
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
import { storedKubernetesEventLog } from "Common/Tests/Helpers/KubernetesEventRecords";
import {
  readKubernetesNeedsAttention,
  readKubernetesPart,
} from "Common/Tests/Helpers/KubernetesPartReads";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const IS_PLAIN_CLUSTER = params.get("cluster") === "plain";
const LANGUAGE = params.get("lang") === "de" ? "de" : "en";
const HEALTH = ["degraded", "down", "updating", "failing"].includes(
  params.get("health"),
)
  ? params.get("health")
  : "healthy";

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
const CLUSTER_NAME = IS_PLAIN_CLUSTER
  ? "EKS Production"
  : "OpenShift Production (eu-central-1)";
const CLUSTER_IDENTIFIER = IS_PLAIN_CLUSTER ? "eks-prod" : "ocp-prod-eu";

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Cloud",
});

const cluster = {
  _id: CLUSTER_ID,
  projectId: PROJECT_ID,
  name: CLUSTER_NAME,
  clusterIdentifier: CLUSTER_IDENTIFIER,
  provider: IS_PLAIN_CLUSTER ? "EKS" : "OpenShift",
  otelCollectorStatus: "connected",
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  nodeCount: 2,
  podCount: 4,
  namespaceCount: 4,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
};

/*
 * ---------------------------------------------------------------------------
 * Inventory
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

// A row of one of OpenShift's kinds, as ingest stores it.
function openShiftResource(fields) {
  const state = getOpenShiftInventoryState(fields.kind, {
    spec: fields.spec,
    status: fields.status,
  });

  return resource({ ...fields, phase: state.phase, isReady: state.isReady });
}

function admittedBy(host, routerName = "default") {
  return {
    host: host,
    routerName: routerName,
    routerCanonicalHostname: `router-${routerName}.apps.ocp.example.com`,
    conditions: [
      {
        type: "Admitted",
        status: "True",
        reason: "",
        message: "",
        lastTransitionTime: minutesAgo(600),
      },
    ],
  };
}

function route(fields) {
  return openShiftResource({
    kind: "Route",
    name: fields.name,
    namespaceKey: fields.namespace,
    labels: { app: fields.name },
    spec: {
      host: fields.host,
      path: fields.path || "",
      to: fields.to,
      alternateBackends: fields.alternateBackends || [],
      targetPort: fields.targetPort || "8080",
      tlsTermination: fields.tlsTermination || "",
      insecureEdgeTerminationPolicy: fields.insecure || "",
      wildcardPolicy: "None",
    },
    status: { ingress: fields.ingress },
  });
}

function service(fields) {
  return resource({
    kind: "Service",
    name: fields.name,
    namespaceKey: fields.namespace,
    labels: { app: fields.name },
    spec: {
      type: fields.type || "ClusterIP",
      clusterIP: fields.clusterIP,
      externalName: "",
      sessionAffinity: "None",
      selector: fields.selector || {},
      ports: fields.ports,
    },
    status: { loadBalancerIngress: fields.loadBalancerIngress || [] },
  });
}

function deploymentConfig(fields) {
  return openShiftResource({
    kind: "DeploymentConfig",
    name: fields.name,
    namespaceKey: fields.namespace,
    labels: { app: fields.name },
    spec: {
      replicas: fields.replicas,
      strategy: fields.strategy || "Rolling",
      selector: { app: fields.name, deploymentconfig: fields.name },
      triggers: ["ConfigChange", "ImageChange"],
      paused: false,
    },
    status: {
      latestVersion: fields.latestVersion,
      replicas: fields.replicas,
      readyReplicas: fields.ready,
      availableReplicas: fields.ready,
      unavailableReplicas: fields.replicas - fields.ready,
      updatedReplicas: fields.ready,
      conditions: [
        {
          type: "Available",
          status: fields.ready >= fields.replicas ? "True" : "False",
          reason: "",
          message: "Deployment config has minimum availability.",
          lastTransitionTime: minutesAgo(90),
        },
      ],
    },
  });
}

function pod(fields) {
  return resource({
    kind: "Pod",
    name: fields.name,
    namespaceKey: fields.namespace,
    phase: "Running",
    labels: fields.labels,
    ownerReferences: { items: fields.owners },
    spec: { nodeName: "worker-a", containers: [] },
    status: { phase: "Running", conditions: [], containerStatuses: [] },
  });
}

const nodesAndNamespaces = [
  resource({ kind: "Node", name: "worker-a", isReady: true }),
  resource({ kind: "Node", name: "worker-b", isReady: true }),
  ...["shop", "payments", "openshift-console", "openshift-ingress"].map(
    (name) => {
      return resource({
        kind: "Namespace",
        name: name,
        status: { phase: "Active" },
      });
    },
  ),
];

const openShiftObjects = [
  route({
    name: "frontend",
    namespace: "shop",
    host: "frontend-shop.apps.ocp.example.com",
    to: { kind: "Service", name: "frontend", weight: 90 },
    alternateBackends: [
      { kind: "Service", name: "frontend-canary", weight: 10 },
    ],
    tlsTermination: "edge",
    insecure: "Redirect",
    ingress: [admittedBy("frontend-shop.apps.ocp.example.com")],
  }),
  route({
    name: "frontend",
    namespace: "payments",
    host: "frontend-payments.apps.ocp.example.com",
    path: "/pay",
    to: { kind: "Service", name: "frontend", weight: 100 },
    tlsTermination: "reencrypt",
    targetPort: "https",
    ingress: [admittedBy("frontend-payments.apps.ocp.example.com")],
  }),
  route({
    name: "console",
    namespace: "openshift-console",
    host: "console-openshift-console.apps.ocp.example.com",
    to: { kind: "Service", name: "console", weight: 100 },
    tlsTermination: "reencrypt",
    insecure: "Redirect",
    ingress: [admittedBy("console-openshift-console.apps.ocp.example.com")],
  }),
  route({
    name: "legacy-api",
    namespace: "shop",
    host: "frontend-shop.apps.ocp.example.com",
    to: { kind: "Service", name: "frontend", weight: 100 },
    ingress: [
      {
        host: "frontend-shop.apps.ocp.example.com",
        routerName: "default",
        routerCanonicalHostname: "router-default.apps.ocp.example.com",
        conditions: [
          {
            type: "Admitted",
            status: "False",
            reason: "HostAlreadyClaimed",
            message:
              "route frontend already exposes frontend-shop.apps.ocp.example.com and is older",
            lastTransitionTime: minutesAgo(30),
          },
        ],
      },
    ],
  }),
  route({
    name: "new-launch",
    namespace: "shop",
    host: "launch.example.com",
    to: { kind: "Service", name: "frontend-canary", weight: 100 },
    tlsTermination: "edge",
    ingress: [],
  }),
  service({
    name: "frontend",
    namespace: "shop",
    clusterIP: "172.30.14.2",
    selector: { app: "frontend", deploymentconfig: "legacy-web" },
    ports: [
      {
        name: "http",
        protocol: "TCP",
        port: 8080,
        targetPort: "8080",
        nodePort: 0,
      },
    ],
  }),
  service({
    name: "frontend-canary",
    namespace: "shop",
    clusterIP: "172.30.14.3",
    selector: { app: "frontend", track: "canary" },
    ports: [
      {
        name: "http",
        protocol: "TCP",
        port: 8080,
        targetPort: "http",
        nodePort: 0,
      },
    ],
  }),
  service({
    name: "frontend",
    namespace: "payments",
    clusterIP: "172.30.90.7",
    selector: { app: "payments-frontend" },
    ports: [
      {
        name: "https",
        protocol: "TCP",
        port: 8443,
        targetPort: "https",
        nodePort: 0,
      },
    ],
  }),
  service({
    name: "console",
    namespace: "openshift-console",
    clusterIP: "172.30.3.3",
    selector: { app: "console", component: "ui" },
    ports: [
      {
        name: "https",
        protocol: "TCP",
        port: 443,
        targetPort: "8443",
        nodePort: 0,
      },
    ],
  }),
  service({
    name: "router-default",
    namespace: "openshift-ingress",
    type: "LoadBalancer",
    clusterIP: "172.30.200.9",
    selector: { "ingresscontroller.operator.openshift.io/deployment": "x" },
    ports: [
      {
        name: "http",
        protocol: "TCP",
        port: 80,
        targetPort: "http",
        nodePort: 31080,
      },
    ],
    loadBalancerIngress: ["a1b2c3.eu-central-1.elb.amazonaws.com"],
  }),
  deploymentConfig({
    name: "legacy-web",
    namespace: "shop",
    replicas: 3,
    ready: 3,
    latestVersion: 7,
  }),
  deploymentConfig({
    name: "legacy-web-api",
    namespace: "shop",
    replicas: 2,
    ready: 1,
    latestVersion: 3,
    strategy: "Recreate",
  }),
  deploymentConfig({
    name: "reports",
    namespace: "payments",
    replicas: 0,
    ready: 0,
    latestVersion: 12,
  }),
  pod({
    name: "legacy-web-7-x2x7q",
    namespace: "shop",
    labels: {
      app: "legacy-web",
      deployment: "legacy-web-7",
      deploymentconfig: "legacy-web",
    },
    owners: [{ kind: "ReplicationController", name: "legacy-web-7" }],
  }),
];

/*
 * The cluster's operators and version, as ingest stores them: a dozen of the
 * thirty or so a real cluster has, every one fine until a scenario says not.
 */
function condition(type, status, reason = "", message = "") {
  return {
    type,
    status,
    reason,
    message,
    lastTransitionTime: minutesAgo(45),
  };
}

const VERSION = "4.16.12";
const NEXT_VERSION = "4.16.14";

const OPERATOR_PROBLEMS = {
  degraded: {
    authentication: [
      condition("Available", "True"),
      condition("Progressing", "False"),
      condition(
        "Degraded",
        "True",
        "OAuthServerRouteEndpointAccessibleController_SyncError",
        "route health check failed: the OAuth server's route answers 503",
      ),
    ],
    monitoring: [
      condition("Available", "True"),
      condition(
        "Progressing",
        "True",
        "RollOutInProgress",
        "Rolling out the stack.",
      ),
      condition("Degraded", "False"),
    ],
  },
  down: {
    ingress: [
      condition(
        "Available",
        "False",
        "IngressUnavailable",
        "The default ingress controller is not available",
      ),
      condition("Progressing", "False"),
      condition("Degraded", "True", "IngressDegraded", "2 of 2 routers down"),
    ],
  },
  updating: {
    "machine-config": [
      condition("Available", "True"),
      condition(
        "Progressing",
        "True",
        "RollingOut",
        `Working towards ${NEXT_VERSION}`,
      ),
      condition("Degraded", "False"),
    ],
  },
};

function clusterOperator(name) {
  return openShiftResource({
    kind: "ClusterOperator",
    name: name,
    spec: {},
    status: {
      conditions: OPERATOR_PROBLEMS[HEALTH]?.[name] || [
        condition("Available", "True"),
        condition("Progressing", "False"),
        condition("Degraded", "False"),
      ],
      versions: [
        { name: "operator", version: VERSION },
        { name: "operand", version: "1.29.5" },
      ],
    },
  });
}

const CLUSTER_VERSION_CONDITIONS = {
  healthy: [
    condition("Available", "True"),
    condition("Progressing", "False", "", `Cluster version is ${VERSION}`),
    condition("Failing", "False"),
  ],
  updating: [
    condition("Available", "True"),
    condition(
      "Progressing",
      "True",
      "",
      `Working towards ${NEXT_VERSION}: 642 of 829 done (77% complete)`,
    ),
    condition("Failing", "False"),
  ],
  failing: [
    condition("Available", "True"),
    condition("Progressing", "True", "", "Unable to apply 4.16.14"),
    condition(
      "Failing",
      "True",
      "ClusterOperatorDegraded",
      "Cluster operator authentication is degraded",
    ),
  ],
};

const clusterStatusObjects = [
  ...[
    "authentication",
    "console",
    "dns",
    "etcd",
    "ingress",
    "kube-apiserver",
    "kube-controller-manager",
    "kube-scheduler",
    "machine-config",
    "monitoring",
    "network",
    "openshift-apiserver",
  ].map(clusterOperator),
  openShiftResource({
    kind: "ClusterVersion",
    name: "version",
    spec: {
      channel: "stable-4.16",
      clusterID: uuid("90000000", 1),
      desiredUpdate: "",
    },
    status: {
      desiredVersion: ["updating", "failing"].includes(HEALTH)
        ? NEXT_VERSION
        : VERSION,
      currentVersion: VERSION,
      history: [
        ...(["updating", "failing"].includes(HEALTH)
          ? [
              {
                version: NEXT_VERSION,
                state: "Partial",
                startedTime: minutesAgo(12),
                completionTime: "",
              },
            ]
          : []),
        {
          version: VERSION,
          state: "Completed",
          startedTime: minutesAgo(60 * 24 * 7),
          completionTime: minutesAgo(60 * 24 * 7 - 50),
        },
      ],
      conditions:
        CLUSTER_VERSION_CONDITIONS[HEALTH] ||
        CLUSTER_VERSION_CONDITIONS.healthy,
      availableUpdateCount: HEALTH === "healthy" ? 2 : 0,
    },
  }),
];

const resources = [
  ...nodesAndNamespaces,
  ...(IS_PLAIN_CLUSTER ? [] : [...openShiftObjects, ...clusterStatusObjects]),
];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: { language: LANGUAGE, plain: IS_PLAIN_CLUSTER },
  listRequests: [],
  itemRequests: [],
  countRequests: [],
  aggregateRequests: [],
  updateRequests: [],
  apiRequests: [],
  logRequests: [],
  unhandled: [],
};
window.__openShiftPagesFixture = fixture;

/*
 * ---------------------------------------------------------------------------
 * The Events, as the logs table holds them
 * ---------------------------------------------------------------------------
 */
let eventNumber = 0;

function storedEvent(fields) {
  eventNumber++;
  const uid = `7c1d2e3f-0000-4000-8000-${String(eventNumber).padStart(12, "0")}`;

  return storedKubernetesEventLog({
    fields: {
      uid: uid,
      name: `${fields.object.name}.${String(eventNumber).padStart(16, "0")}`,
      namespace: fields.namespace,
      type: fields.type || "Normal",
      reason: fields.reason,
      message: fields.message,
      object: fields.object,
      controller: fields.controller || "deploymentconfig-controller",
      instance: "",
      count: 1,
      firstSeen: minutesAgo(fields.at),
      lastSeen: minutesAgo(fields.at),
    },
    clusterName: CLUSTER_IDENTIFIER,
    id: uuid("70000000", eventNumber),
  });
}

const logs = IS_PLAIN_CLUSTER
  ? []
  : [
      storedEvent({
        namespace: "shop",
        reason: "DeploymentCreated",
        message: "Created new replication controller legacy-web-7",
        object: { kind: "DeploymentConfig", name: "legacy-web" },
        at: 40,
      }),
      storedEvent({
        namespace: "shop",
        reason: "SuccessfulCreate",
        message: "Created pod: legacy-web-7-x2x7q",
        object: { kind: "ReplicationController", name: "legacy-web-7" },
        at: 39,
      }),
      storedEvent({
        namespace: "shop",
        reason: "Scheduled",
        message: "Successfully assigned shop/legacy-web-7-deploy to worker-a",
        object: { kind: "Pod", name: "legacy-web-7-deploy" },
        at: 41,
      }),
      storedEvent({
        namespace: "shop",
        type: "Warning",
        reason: "BackOff",
        message: "Back-off restarting failed container web",
        object: { kind: "Pod", name: "legacy-web-7-x2x7q" },
        controller: "kubelet",
        at: 12,
      }),
      // About a Service whose name repeats in `shop`.
      storedEvent({
        namespace: "payments",
        type: "Warning",
        reason: "FailedToUpdateEndpoint",
        message: "Failed to update endpoint payments/frontend",
        object: { kind: "Service", name: "frontend" },
        controller: "endpoint-controller",
        at: 15,
      }),
      // The neighbour's: never on legacy-web's page.
      storedEvent({
        namespace: "shop",
        type: "Warning",
        reason: "Unhealthy",
        message: "Readiness probe failed: connection refused",
        object: { kind: "Pod", name: "legacy-web-api-3-k2m4p" },
        controller: "kubelet",
        at: 9,
      }),
    ];

function attributeMatches(value, wanted) {
  const text = value === undefined || value === null ? "" : String(value);

  if (wanted instanceof Includes) {
    return wanted.values
      .map((entry) => {
        return String(plain(entry));
      })
      .includes(text);
  }

  if (wanted instanceof StartsWith) {
    return text.toLowerCase().startsWith(String(wanted.value).toLowerCase());
  }

  return text === String(plain(wanted));
}

function listEventLogs(options) {
  const query = options.query || {};
  const select = options.select || {};
  const limit = Number(options.limit || 10);
  const attributes = query.attributes || {};

  fixture.logRequests.push({
    attributes: serialize(attributes),
    limit: limit,
  });

  const ids =
    query._id instanceof Includes
      ? query._id.values.map((entry) => {
          return String(plain(entry));
        })
      : null;

  const matching = logs
    .filter((log) => {
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
    count: page.length,
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

/*
 * The project's records, by table. Tables the pages read that this project
 * has nothing in are modelled as empty; a read of any other is `unhandled`.
 */
const store = {
  KubernetesCluster: [cluster],
  KubernetesResource: resources,
  KubernetesContainer: [],
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
  Alert: [],
  ScheduledMaintenance: [],
  Monitor: [],
  RecommendationDismissal: [],
  DatabaseServer: [],
  // What a Metrics tab's chart reads beside its series: nothing here.
  MetricType: [],
  /*
   * What the cluster's Recommendations page reads to build a monitor and fill
   * its create panel: the project's statuses and severities, and no on-call
   * policies or labels yet.
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

  return ok({});
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);

  if (modelName === tableName(Log)) {
    return listEventLogs(options);
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
  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

/*
 * The metrics: a calm, generated cluster. A read grouped by attributes gets a
 * series per pod for a pod metric and per node otherwise, sampled once a
 * minute inside its window.
 */
function generateMetricRows(aggregateBy) {
  const window = aggregateBy.query?.time;
  const name = aggregateBy.query?.name || "";
  const end = window instanceof InBetween ? new Date(window.endValue) : null;
  const start =
    window instanceof InBetween ? new Date(window.startValue) : null;

  if (!start || !end) {
    return [];
  }

  const series = name.startsWith("k8s.pod.")
    ? [
        { "resource.k8s.pod.name": "legacy-web-7-x2x7q" },
        { "resource.k8s.pod.name": "legacy-web-7-m4n5p" },
      ]
    : [
        { "resource.k8s.node.name": "worker-a" },
        { "resource.k8s.node.name": "worker-b" },
      ];

  const grouped = Boolean(aggregateBy.groupBy?.attributes);
  const rows = [];

  for (
    let time = start.getTime() + MINUTE;
    time <= end.getTime();
    time += MINUTE
  ) {
    for (const attributes of grouped ? series : [{}]) {
      rows.push({
        timestamp: new Date(time).toISOString(),
        value: 40 + 12 * Math.sin(time / (11 * MINUTE)),
        attributes: attributes,
      });
    }
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

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/inventory-summary/")
  ) {
    return ok({
      nodeCount: countOf("Node"),
      podCount: countOf("Pod"),
      namespaceCount: countOf("Namespace"),
      deploymentCount: 0,
      statefulSetCount: 0,
      daemonSetCount: 0,
      jobCount: 0,
      cronJobCount: 0,
      containerCount: 0,
      pvcCount: 0,
      pvCount: 0,
      hpaCount: 0,
      vpaCount: 0,
      deploymentConfigCount: countOf("DeploymentConfig"),
      routeCount: countOf("Route"),
      serviceCount: countOf("Service"),
      clusterOperatorCount: countOf("ClusterOperator"),
      podPhaseCounts: { running: countOf("Pod") },
      nodeReadyCounts: { ready: countOf("Node") },
      nodePressureCounts: {},
      degradedPods: [],
      degradedNodes: [],
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
    return ok(serialize(readKubernetesNeedsAttention(resources)));
  }

  if (
    method === "POST" &&
    parsed.pathname.includes("/kubernetes-resource/part/")
  ) {
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
   * A DeploymentConfig's pods, added up by their label in their namespace,
   * keyed <namespace>/<name> as the server keys them.
   */
  if (
    method === "POST" &&
    parsed.pathname.includes(
      "/kubernetes-resource/latest-pod-metrics-by-owner/",
    )
  ) {
    return ok({
      aggregates: parsed.pathname.endsWith("/DeploymentConfig")
        ? {
            "shop/legacy-web": {
              cpuPercent: 12.5,
              memoryBytes: String(512 * 1024 * 1024),
              memoryPercent: 6.25,
            },
          }
        : {},
    });
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
  [PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS, KubernetesRecommendations],
  [PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL, KubernetesPodDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_ROUTES, OpenShiftRoutes],
  [PageMap.KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL, OpenShiftRouteDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_SERVICES, KubernetesServices],
  [PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL, KubernetesServiceDetail],
  [PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIGS, DeploymentConfigs],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL,
    DeploymentConfigDetail,
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

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
