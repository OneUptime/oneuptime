/*
 * Offline fixture for every resource's Topology page, and the master
 * Topology that links to them: the production product layouts (ModelPage,
 * side menus, breadcrumbs), the production Topology pages and the
 * production master TopologyPage, under their real RouteMap patterns. Only
 * the data boundary (ModelAPI, API, Realtime) and the signed-in user are
 * replaced; the Topology API is answered by the master Topology suite's own
 * reference fixture (../../Topology/TopologyApiFixture.js).
 *
 * Scenarios, read once at load:
 *
 *   ?estate=   normal (default) | large | quiet | empty (see FixtureData)
 *   ?issues=   on (default) | off | denied (the role may not read incidents
 *              or alerts)
 *   ?fail=     topology (every inventory read fails once, so the page shows
 *              its error and retries)
 *   ?lang=     de reads the German locale file, fa the Persian one (a page
 *              read from right to left)
 *   ?theme=    dark (handled by server.js)
 *
 * Every read is recorded on window.__resourceTopologyFixture: listRequests,
 * itemRequests, countRequests, apiRequests, and `unhandled` - anything the
 * fixture does not model. The spec keeps `unhandled` empty.
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
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import VMwareLayout from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Layout";
import VMwareTopology from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Topology";
import KubernetesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Layout";
import KubernetesTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Topology";
import HostLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Layout";
import HostTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Topology";
import DockerLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Layout";
import DockerTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Topology";
import PodmanLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Layout";
import PodmanTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Topology";
import SwarmLayout from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Layout";
import SwarmTopology from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Topology";
import ProxmoxLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Layout";
import ProxmoxTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Topology";
import CephLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Layout";
import CephTopology from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Topology";
import StorageArrayLayout from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Layout";
import StorageArrayTopology from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Topology";
import MasterTopologyPage from "../../../App/FeatureSet/Dashboard/src/Pages/Topology/TopologyPage";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import {
  answerTopologyRequest,
  isTopologyApiUrl,
  topologyRouteFor,
} from "../../Topology/TopologyApiFixture";
import { IDS, NAMES, PROJECT_ID, buildEstate, uuid } from "./FixtureData";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const ESTATE = ["large", "quiet", "empty"].includes(params.get("estate"))
  ? params.get("estate")
  : "normal";
const ISSUES = ["off", "denied"].includes(params.get("issues"))
  ? params.get("issues")
  : "on";
const FAIL = params.get("fail") || "";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const LOADED_AT = Date.now();
const MINUTE = 60 * 1000;

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];
const projectObjectId = new ObjectID(PROJECT_ID);
const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Platform",
});

const estate = buildEstate({ estate: ESTATE, loadedAt: LOADED_AT });
const fresh = new Date(LOADED_AT - 2 * MINUTE);

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts
 * ---------------------------------------------------------------------------
 */
const incidentStates = [
  {
    _id: uuid("50000000", 1),
    name: "Identified",
    order: 1,
    isResolvedState: false,
  },
  {
    _id: uuid("50000000", 2),
    name: "Resolved",
    order: 2,
    isResolvedState: true,
  },
];
const alertStates = [
  {
    _id: uuid("51000000", 1),
    name: "Created",
    order: 1,
    isResolvedState: false,
  },
  {
    _id: uuid("51000000", 2),
    name: "Resolved",
    order: 2,
    isResolvedState: true,
  },
];
const criticalIncident = Object.assign(new IncidentSeverity(), {
  _id: uuid("52000000", 1),
  name: "Critical",
  color: new Color("#ef4444"),
});
const warningAlert = Object.assign(new AlertSeverity(), {
  _id: uuid("53000000", 1),
  name: "Warning",
  color: new Color("#f59e0b"),
});

let issueNumber = 0;
function incident(fields) {
  issueNumber++;
  return {
    _id: uuid("60000000", issueNumber),
    incidentNumber: issueNumber,
    declaredAt: new Date(LOADED_AT - (5 + issueNumber) * MINUTE),
    createdAt: new Date(LOADED_AT - (5 + issueNumber) * MINUTE),
    incidentSeverity: criticalIncident,
    currentIncidentState: Object.assign(new IncidentState(), {
      name: "Identified",
    }),
    currentIncidentStateId: incidentStates[0]._id,
    ...fields,
  };
}
function alert(fields) {
  issueNumber++;
  return {
    _id: uuid("61000000", issueNumber),
    alertNumber: issueNumber,
    createdAt: new Date(LOADED_AT - (2 + issueNumber) * MINUTE),
    alertSeverity: warningAlert,
    currentAlertState: Object.assign(new AlertState(), { name: "Created" }),
    currentAlertStateId: alertStates[0]._id,
    ...fields,
  };
}

const crashingPod = estate.k8sRows.find((row) => {
  return row.kind === "Pod" && row.name.startsWith("catalog-api");
});
const restartingContainer = estate.dockerRows.find((row) => {
  return row.name === "shop-api-2";
});

const incidents =
  ISSUES === "on" && ESTATE !== "quiet" && ESTATE !== "empty"
    ? [
        incident({
          title: "[VMware] Datastore Capacity Critical (>90%) - vcenter-prod",
          vmwareVCenters: [{ _id: IDS.vcenter }],
          seriesLabels: {
            "resource.vcenter.datacenter.name": "Amsterdam",
            "resource.vcenter.datastore.name": "ams-ssd-02",
          },
        }),
        incident({
          title: "vCenter certificate expires in 3 days",
          vmwareVCenters: [{ _id: IDS.vcenter }],
          seriesLabels: null,
        }),
        incident({
          title: "[Kubernetes] Pod CrashLoopBackOff - prod-eu",
          kubernetesClusters: [{ _id: IDS.kubernetes }],
          kubernetesResources: crashingPod ? [{ _id: crashingPod._id }] : [],
          seriesLabels: null,
        }),
        incident({
          title: "Checkout error rate above 5%",
          hosts: [{ _id: IDS.host }],
          seriesLabels: { "service.name": "checkout" },
        }),
        incident({
          title: "[Docker] Container restarting - docker-01",
          dockerHosts: [{ _id: IDS.dockerHost }],
          dockerResources: restartingContainer
            ? [{ _id: restartingContainer._id }]
            : [],
          seriesLabels: null,
        }),
        incident({
          title: "[Ceph] OSD down",
          cephClusters: [{ _id: IDS.ceph }],
          seriesLabels: { ceph_daemon: "osd.5" },
        }),
      ]
    : [];

const alerts =
  ISSUES === "on" && ESTATE !== "quiet" && ESTATE !== "empty"
    ? [
        alert({
          title: "[VMware] Host CPU Saturation (>90%) - vcenter-prod",
          vmwareVCenters: [{ _id: IDS.vcenter }],
          seriesLabels: {
            "resource.vcenter.datacenter.name": "Amsterdam",
            "resource.vcenter.host.name": "esx102.ams.acme.example",
          },
        }),
        alert({
          title: "[Kubernetes] Node memory pressure - prod-eu",
          kubernetesClusters: [{ _id: IDS.kubernetes }],
          seriesLabels: {
            "resource.k8s.node.name": "ip-10-0-5-25.eu-west-1.compute.internal",
          },
        }),
        alert({
          title: "[Proxmox] Guest not backed up",
          proxmoxClusters: [{ _id: IDS.proxmox }],
          seriesLabels: { id: "qemu/113" },
        }),
      ]
    : [];

/*
 * ---------------------------------------------------------------------------
 * Recorder and query matching
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: { estate: ESTATE, issues: ISSUES, fail: FAIL, language: LANGUAGE },
  listRequests: [],
  itemRequests: [],
  countRequests: [],
  updateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__resourceTopologyFixture = fixture;

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

const store = {
  VMwareVCenter: [
    {
      _id: IDS.vcenter,
      name: NAMES.vcenter,
      lastSeenAt: fresh,
      otelCollectorStatus: "connected",
      collectionStatus: "Succeeded",
      isArchived: false,
    },
  ],
  VMwareResource: estate.vmwareRows,
  KubernetesCluster: [
    {
      _id: IDS.kubernetes,
      name: NAMES.kubernetes,
      clusterIdentifier: NAMES.kubernetes,
      lastSeenAt: fresh,
      otelCollectorStatus: "connected",
      isArchived: false,
    },
  ],
  KubernetesResource: estate.k8sRows,
  KubernetesContainer: estate.k8sContainers,
  Host: [
    {
      _id: IDS.host,
      name: NAMES.host,
      hostIdentifier: NAMES.host,
      lastSeenAt: fresh,
      otelCollectorStatus: "connected",
      isArchived: false,
    },
  ],
  Service: [
    { _id: uuid("72000000", 1), name: "storefront" },
    { _id: uuid("72000000", 2), name: "checkout" },
    { _id: uuid("72000000", 3), name: "payments" },
    { _id: uuid("72000000", 4), name: "mobile-bff" },
  ],
  DockerHost: [
    {
      _id: IDS.dockerHost,
      name: "docker-01",
      hostIdentifier: "docker-01",
      lastSeenAt: fresh,
      isArchived: false,
    },
  ],
  DockerResource: estate.dockerRows,
  PodmanHost: [
    {
      _id: IDS.podmanHost,
      name: "podman-01",
      hostIdentifier: "podman-01",
      lastSeenAt: fresh,
      isArchived: false,
    },
  ],
  PodmanResource: estate.podmanRows,
  DockerSwarmCluster: [
    {
      _id: IDS.swarm,
      name: "swarm-prod",
      lastSeenAt: fresh,
      isArchived: false,
    },
  ],
  DockerSwarmResource: estate.swarmRows,
  ProxmoxCluster: [
    {
      _id: IDS.proxmox,
      name: "pve-prod",
      lastSeenAt: fresh,
      isArchived: false,
    },
  ],
  ProxmoxResource: estate.proxmoxRows,
  CephCluster: [
    {
      _id: IDS.ceph,
      name: "ceph-prod",
      lastSeenAt: fresh,
      healthStatus: ESTATE === "quiet" ? 0 : 1,
      isArchived: false,
    },
  ],
  CephResource: estate.cephRows,
  StorageArray: [
    {
      _id: IDS.storageArray,
      name: "flasharray-01",
      lastSeenAt: fresh,
      openAlertCount: ESTATE === "quiet" ? 0 : 1,
      isArchived: false,
    },
  ],
  StorageArrayResource: estate.storageRows,
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
  // What the Recommendations menu item reads: no monitors, nothing dismissed.
  Monitor: [],
  RecommendationDismissal: [],
};

const INVENTORY_TABLES = new Set([
  "VMwareResource",
  "KubernetesResource",
  "KubernetesContainer",
  "DockerResource",
  "PodmanResource",
  "DockerSwarmResource",
  "ProxmoxResource",
  "CephResource",
  "StorageArrayResource",
]);
let failuresLeft = FAIL === "topology" ? 1 : 0;

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
  return "sam@acme-platform.example";
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

const FORBIDDEN = "You do not have permission to read this.";

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
  });

  if (
    ISSUES === "denied" &&
    (modelName === "Incident" || modelName === "Alert")
  ) {
    throw new Error(FORBIDDEN);
  }

  if (INVENTORY_TABLES.has(modelName) && failuresLeft > 0) {
    failuresLeft--;
    throw new Error("The inventory could not be read.");
  }

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
 * The Kubernetes cluster layout writes the counts it read back to the
 * cluster (for the clusters list). A topology page never writes, so a write
 * from anything else is recorded as unhandled.
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

  if (method === "POST" && isTopologyApiUrl(url)) {
    const answer = answerTopologyRequest(
      estate.inventory,
      topologyRouteFor(url),
      body,
    );
    return answer.status === 200
      ? ok(answer.body)
      : new HTTPErrorResponse(answer.status, answer.body, {});
  }

  // Every product layout asks for its side menu's counts.
  if (method === "POST" && parsed.pathname.includes("/inventory-summary/")) {
    return ok({});
  }

  /*
   * The service map's overlay: checkout has an open incident, payments an
   * open alert (the host's map pins them to those services).
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/service-operational-status")
  ) {
    const names = Array.isArray(body.serviceNames) ? body.serviceNames : [];
    const services = [];
    if (ISSUES === "on" && ESTATE !== "quiet") {
      if (names.includes("payments")) {
        services.push({
          serviceId: uuid("72000000", 3),
          serviceName: "payments",
          activeIncidentCount: 0,
          incidents: [],
          activeAlertCount: 1,
          worstAlertSeverityName: "Warning",
          worstAlertSeverityColor: "#f59e0b",
          alerts: [
            {
              id: uuid("61000000", 90),
              title: "Payments p95 latency above 1 s",
              severityName: "Warning",
              severityColor: "#f59e0b",
            },
          ],
        });
      }
    }
    return ok({ services });
  }

  // The resource AI agent cards some layouts show: no agent yet.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      agent: null,
      gaps: [],
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

const PRODUCTS = [
  [
    VMwareLayout,
    VMwareTopology,
    PageMap.VMWARE_VCENTER_VIEW,
    PageMap.VMWARE_VCENTER_VIEW_TOPOLOGY,
  ],
  [
    KubernetesLayout,
    KubernetesTopology,
    PageMap.KUBERNETES_CLUSTER_VIEW,
    PageMap.KUBERNETES_CLUSTER_VIEW_TOPOLOGY,
  ],
  [HostLayout, HostTopology, PageMap.HOST_VIEW, PageMap.HOST_VIEW_TOPOLOGY],
  [
    DockerLayout,
    DockerTopology,
    PageMap.DOCKER_HOST_VIEW,
    PageMap.DOCKER_HOST_VIEW_TOPOLOGY,
  ],
  [
    PodmanLayout,
    PodmanTopology,
    PageMap.PODMAN_HOST_VIEW,
    PageMap.PODMAN_HOST_VIEW_TOPOLOGY,
  ],
  [
    SwarmLayout,
    SwarmTopology,
    PageMap.DOCKER_SWARM_CLUSTER_VIEW,
    PageMap.DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY,
  ],
  [
    ProxmoxLayout,
    ProxmoxTopology,
    PageMap.PROXMOX_CLUSTER_VIEW,
    PageMap.PROXMOX_CLUSTER_VIEW_TOPOLOGY,
  ],
  [
    CephLayout,
    CephTopology,
    PageMap.CEPH_CLUSTER_VIEW,
    PageMap.CEPH_CLUSTER_VIEW_TOPOLOGY,
  ],
  [
    StorageArrayLayout,
    StorageArrayTopology,
    PageMap.STORAGE_ARRAY_VIEW,
    PageMap.STORAGE_ARRAY_VIEW_TOPOLOGY,
  ],
].map(([Layout, Page, layoutKey, pageKey]) => {
  return {
    Layout: withNavigation(Layout, layoutKey),
    Page: withNavigation(Page, pageKey),
    path: RouteMap[pageKey].toString(),
  };
});

const FixtureMasterTopology = withNavigation(
  MasterTopologyPage,
  PageMap.TOPOLOGY,
);

// A page a topology links to that is not modelled: says where it is.
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
          <span className="text-sm text-gray-500">Acme Platform</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        {PRODUCTS.map((product) => {
          return (
            <Route key={product.path} element={<product.Layout />}>
              <Route path={product.path} element={<product.Page />} />
            </Route>
          );
        })}
        <Route
          path={RouteMap[PageMap.TOPOLOGY].toString()}
          element={
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
              <FixtureMasterTopology />
            </main>
          }
        />
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
