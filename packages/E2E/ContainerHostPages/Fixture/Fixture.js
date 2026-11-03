/*
 * Offline fixture for a Docker and a Podman host's pages: the production
 * host layout (ModelPage, the host's side menu) with its Overview (its
 * health and Needs attention by the containers' rules, ContainerHostHealth),
 * its Containers list and a container's own page - for both runtimes, under
 * their real RouteMap patterns. Only the data boundary (ModelAPI,
 * AnalyticsModelAPI, API, Realtime) and the signed-in user are replaced.
 * Every record is fabricated for an "Acme Containers" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?host=      trouble (default): a container in a restart loop, one that
 *               restarted, one near its memory limit, a service that
 *               stopped, a migration that finished and an alert open on the
 *               crash-looping one | calm: every container fine | empty: a
 *               host that has reported no container yet
 *   ?collector= disconnected: the host's agent stopped reporting three days
 *               ago
 *   ?fail=      readings: every latest-readings read fails
 *   ?lang=      de reads the German locale file, fa the Persian one (right
 *               to left)
 *   ?theme=     dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__containerHostPagesFixture:
 * listRequests, itemRequests, aggregateRequests, apiRequests and unhandled -
 * anything the fixture does not model. The spec asserts `unhandled` is
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import DockerLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Layout";
import DockerOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import DockerContainers from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Containers";
import DockerContainerDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/ContainerDetail";
import PodmanLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Layout";
import PodmanOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import PodmanContainers from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Containers";
import PodmanContainerDetail from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/ContainerDetail";
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
const HOST_STATE = ["calm", "empty"].includes(params.get("host"))
  ? params.get("host")
  : "trouble";
const DISCONNECTED = params.get("collector") === "disconnected";
const READINGS_FAIL = params.get("fail") === "readings";

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
 * Ids, the clock and the hosts
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();
const MIB = 1024 * 1024;

const DOCKER_HOST_ID = uuid("72000000", 1);
const PODMAN_HOST_ID = uuid("73000000", 1);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Containers",
});

function host(id, name) {
  return {
    _id: id,
    name: name,
    description: "The shop's checkout and its workers, in Frankfurt.",
    hostIdentifier: `${name}.acme-containers.example`,
    otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
    lastSeenAt: new Date(
      LOADED_AT - (DISCONNECTED ? 3 * 24 * 60 * MINUTE : 20 * 1000),
    ),
    osType: "linux",
    osVersion: "Ubuntu 24.04.1 LTS",
    agentVersion: "14.0.101",
    isArchived: false,
    createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
  };
}

const dockerHost = host(DOCKER_HOST_ID, "web-01");
const podmanHost = host(PODMAN_HOST_ID, "web-02");

const FULL_ID_BASE =
  "4f1c2d3e5a6b7c8d9e0f11223344556677889900aabbccddeeff0011223344";

/*
 * The host's containers: each one's latest readings (cpu, memoryPercent,
 * memoryBytes; seconds since its last), its restarts in 15 minutes, when
 * its run started and its labels.
 */
const TROUBLE_CONTAINERS = [
  {
    name: "shop-checkout-api-1",
    image: "registry.acme-containers.example/shop/checkout-api:2.4.1",
    cpu: 23.4,
    memoryPercent: 41.2,
    memoryBytes: 412 * MIB,
    restarts: 0,
    startedMinutesAgo: 3 * 24 * 60,
    labels: {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "checkout-api",
    },
  },
  {
    name: "shop-worker-1",
    image: "registry.acme-containers.example/shop/worker:2.4.1",
    cpu: 3.1,
    memoryPercent: 18.5,
    memoryBytes: 96 * MIB,
    restarts: 6,
    startedMinutesAgo: 1,
    labels: {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "worker",
    },
  },
  {
    name: "shop-search-1",
    image: "docker.io/library/opensearch:2.17.1",
    cpu: 96.2,
    memoryPercent: 91.4,
    memoryBytes: 1843 * MIB,
    restarts: 0,
    startedMinutesAgo: 9 * 60,
    labels: {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "search",
    },
  },
  {
    name: "cache",
    image: "docker.io/library/redis:7.4",
    cpu: 0.8,
    memoryPercent: 4.2,
    memoryBytes: 24 * MIB,
    restarts: 1,
    startedMinutesAgo: 6,
  },
  {
    name: "billing-exporter",
    image: "registry.acme-containers.example/billing/exporter:1.9.0",
    readMinutesAgo: 7,
    startedMinutesAgo: 6 * 60,
  },
  {
    name: "shop-migrate-run-8d2f1c9a",
    image: "registry.acme-containers.example/shop/checkout-api:2.4.1",
    readMinutesAgo: 8,
    startedMinutesAgo: 9,
    labels: {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "migrate",
      "com.docker.compose.oneoff": "True",
    },
  },
  {
    name: "oneuptime-agent",
    image: "oneuptime/docker-agent:release",
    cpu: 1.2,
    memoryPercent: 2.1,
    memoryBytes: 61 * MIB,
    restarts: 0,
    startedMinutesAgo: 12 * 24 * 60,
  },
];

const CALM_CONTAINERS = TROUBLE_CONTAINERS.filter((container) => {
  return !container.readMinutesAgo;
}).map((container) => {
  return {
    ...container,
    restarts: 0,
    memoryPercent: Math.min(container.memoryPercent, 60),
    startedMinutesAgo: Math.max(container.startedMinutesAgo, 60),
  };
});

const CONTAINERS =
  HOST_STATE === "empty"
    ? []
    : HOST_STATE === "calm"
      ? CALM_CONTAINERS
      : TROUBLE_CONTAINERS;

function containerId(index) {
  return `${FULL_ID_BASE}${String(index).padStart(2, "0")}`;
}

function inventoryFor(hostIdColumn, hostId, prefix) {
  return CONTAINERS.map((container, index) => {
    const readAt = new Date(
      LOADED_AT - (container.readMinutesAgo || 0) * MINUTE - 15 * 1000,
    );
    return {
      _id: uuid(prefix, index + 1),
      [hostIdColumn]: hostId,
      kind: "Container",
      name: container.name,
      containerId: containerId(index),
      imageName: container.image,
      state: "running",
      labels: container.labels,
      latestCpuPercent: container.cpu,
      latestMemoryBytes: container.memoryBytes,
      metricsUpdatedAt: readAt,
      lastSeenAt: readAt,
      resourceCreationTimestamp: new Date(
        LOADED_AT - container.startedMinutesAgo * MINUTE,
      ),
    };
  });
}

// What the restart loop raised on the Docker host: an alert about its container.
const openAlerts =
  HOST_STATE === "trouble"
    ? [
        {
          _id: uuid("61000000", 1),
          title: "[Docker] Container Restart Loop - web-01",
          alertNumber: 31,
          createdAt: new Date(LOADED_AT - 11 * MINUTE),
          currentAlertStateId: uuid("51000000", 1),
          dockerHosts: DOCKER_HOST_ID,
          podmanHosts: PODMAN_HOST_ID,
          seriesLabels: { "resource.container.name": "shop-worker-1" },
        },
      ]
    : [];

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
window.__containerHostPagesFixture = fixture;

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
  DockerHost: [dockerHost],
  PodmanHost: [podmanHost],
  DockerResource: inventoryFor("dockerHostId", DOCKER_HOST_ID, "74000000"),
  PodmanResource: inventoryFor("podmanHostId", PODMAN_HOST_ID, "75000000"),
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
  // The container alerts card reads which monitors exist: none yet.
  Monitor: [],
  RecommendationDismissal: [],
  // The database badge on a container's page: no database discovered.
  DatabaseServer: [],
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
  return "sam@acme-containers.example";
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

// Which runtime a read is for: the attribute every container read carries.
function runtimeOf(query) {
  const attributes = (query && query.attributes) || {};
  return attributes["resource.container.runtime"] || null;
}

const READING_FIELDS = {
  "container.cpu.utilization": "cpu",
  "container.memory.percent": "memoryPercent",
  "container.memory.usage.total": "memoryBytes",
  "container.network.io.usage.rx_bytes": "rx",
  "container.network.io.usage.tx_bytes": "tx",
};

/*
 * The containers' latest readings: the newest point of a metric for each
 * container that reported in the last 5 minutes, newest first.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const query = options.query || {};
  fixture.listRequests.push({ modelName, query: serialize(query) });

  if (modelName !== tableName(Metric) || !READING_FIELDS[query.name]) {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName,
      name: query.name || null,
    });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  if (READINGS_FAIL) {
    throw new Error("The analytics database did not answer in time.");
  }

  const field = READING_FIELDS[query.name];
  const data = CONTAINERS.filter((container) => {
    return !container.readMinutesAgo || container.readMinutesAgo <= 5;
  })
    .map((container, index) => {
      const row = new options.modelType();
      row.time = new Date(
        LOADED_AT - (container.readMinutesAgo || 0) * MINUTE - 15 * 1000,
      );
      row.value =
        field === "rx"
          ? 4 * MIB * (index + 1)
          : field === "tx"
            ? MIB * (index + 1)
            : container[field];
      row.attributes = {
        "resource.container.name": container.name,
        "resource.container.id": containerId(CONTAINERS.indexOf(container)),
        "resource.container.image.name": container.image,
        "resource.container.runtime": runtimeOf(query),
      };
      return row;
    })
    .filter((row) => {
      return row.value !== undefined && row.value !== null;
    });
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
 * The Overview's charts and tiles (a smooth series a container over the
 * chart's range) and the containers' restarts in the last 15 minutes.
 */
const CHART_METRICS = {
  "container.cpu.utilization": "cpu",
  "container.memory.percent": "memoryPercent",
  "container.pids.count": "pids",
  "container.network.io.usage.rx_bytes": "rx",
  "container.network.io.usage.tx_bytes": "tx",
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

  if (query.name === "container.restarts.increase") {
    return {
      data: CONTAINERS.filter((container) => {
        return container.restarts !== undefined;
      }).map((container) => {
        return {
          value: container.restarts,
          attributes: { "resource.container.name": container.name },
        };
      }),
    };
  }

  if (query.name === "oneuptime.host.heartbeat") {
    const data = [];
    for (let step = 30; step >= 1; step--) {
      data.push({
        timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
        value: 2,
      });
    }
    return { data: DISCONNECTED || HOST_STATE === "empty" ? [] : data };
  }

  const field = CHART_METRICS[query.name];
  if (!field) {
    fixture.unhandled.push({ kind: "aggregate", modelName, name: query.name });
    return { data: [] };
  }

  const data = [];
  CONTAINERS.forEach((container, index) => {
    if (container.readMinutesAgo) {
      return;
    }
    const level =
      field === "pids"
        ? 12 + index * 4
        : field === "rx" || field === "tx"
          ? MIB * (index + 1)
          : container[field] || 1;
    for (let step = 30; step >= 1; step--) {
      data.push({
        timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
        value:
          field === "rx" || field === "tx"
            ? level * (31 - step)
            : Math.max(0, level + (level / 10) * Math.sin(step / 3)),
        attributes: {
          "resource.container.name": container.name,
          interface: "eth0",
        },
      });
    }
  });
  return { data: DISCONNECTED ? [] : data };
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

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  /*
   * The Overview's AI agent card: answered "no AI agent yet", as the server
   * answers for a host nobody installed one on.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "DockerHost",
      resourceId: DOCKER_HOST_ID,
      resourceName: "web-01",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the AI agent on this host.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
  }

  // The Overview's Security card: a project that uses no Security Events.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/security-case/resource-security")
  ) {
    return ok({
      kind: body.kind,
      id: body.id,
      name: "",
      isInUse: false,
      windowDays: 7,
      values: [],
      isSearchedByLogs: false,
      entity: null,
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

function pagesOf(entries) {
  return entries.map(([pageKey, Component]) => {
    return {
      path: RouteMap[pageKey].toString(),
      Page: withNavigation(Component, pageKey),
    };
  });
}

const DOCKER_PAGES = pagesOf([
  [PageMap.DOCKER_HOST_VIEW, DockerOverview],
  [PageMap.DOCKER_HOST_VIEW_CONTAINERS, DockerContainers],
  [PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL, DockerContainerDetail],
]);

const PODMAN_PAGES = pagesOf([
  [PageMap.PODMAN_HOST_VIEW, PodmanOverview],
  [PageMap.PODMAN_HOST_VIEW_CONTAINERS, PodmanContainers],
  [PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL, PodmanContainerDetail],
]);

const DockerFixtureLayout = withNavigation(
  DockerLayout,
  PageMap.DOCKER_HOST_VIEW,
);
const PodmanFixtureLayout = withNavigation(
  PodmanLayout,
  PageMap.PODMAN_HOST_VIEW,
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
          <span className="text-sm text-gray-500">Acme Containers</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<DockerFixtureLayout />}>
          {DOCKER_PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        <Route element={<PodmanFixtureLayout />}>
          {PODMAN_PAGES.map((page) => {
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
