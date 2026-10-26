/*
 * Offline fixture for the resource Overviews drawn with ResourceOverview,
 * where #5298's UI review finished their hero and their Details card: a
 * service's, a database's and a queue's Overview, each inside its
 * production layout (ModelPage, its labels in the page's header, the side
 * menu) under its real RouteMap pattern. Only the data boundary (ModelAPI,
 * AnalyticsModelAPI, API, Realtime) and the signed-in user are replaced.
 * Every record is fabricated for an "Acme Commerce" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?resource=  busy (default: a description, labels, many reported
 *               facts) | new (a name and nothing else reported) | long (a
 *               long service name, a description longer than two lines of
 *               a phone's hero, and long values that must wrap)
 *   ?lang=      de or fa reads the German or Persian locale file
 *   ?theme=     dark adds html.dark (handled by server.js)
 *   ?dir=       rtl lays the page out right to left
 *
 * Every read is recorded on window.__resourceOverviewsFixture: listRequests,
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
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import ServiceLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Layout";
import ServiceOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import DatabaseLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Layout";
import DatabaseOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import QueueLayout from "../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Layout";
import QueueOverview from "../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Overview";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
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

const RESOURCE = ["new", "long"].includes(params.get("resource"))
  ? params.get("resource")
  : "busy";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("dir") === "rtl") {
  document.documentElement.dir = "rtl";
}

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * Ids, the clock and the records
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();

const SERVICE_ID = uuid("71000000", 1);
const DATABASE_ID = uuid("73000000", 1);
const QUEUE_ID = uuid("74000000", 1);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

function label(number, name, color) {
  return {
    _id: uuid("72000000", number),
    name,
    color: Color.fromString(color),
  };
}

const LABELS = {
  busy: [
    label(1, "production", "#4f46e5"),
    label(2, "payments", "#059669"),
    label(3, "team-checkout", "#d97706"),
  ],
  new: [],
  long: [
    label(1, "production", "#4f46e5"),
    label(4, "inventory", "#0891b2"),
    label(5, "canary", "#dc2626"),
    label(6, "eu-west-2", "#7c3aed"),
    label(7, "owner: warehouse-platform-team", "#64748b"),
  ],
};

const DESCRIPTIONS = {
  busy: "Takes the basket to an order: prices it, reserves stock and charges the card.",
  new: undefined,
  long: "Reserves stock for every basket across the three EU warehouses, releases it when an order is cancelled, and reconciles the counts each night against the warehouse management system's own export.",
};

const SERVICES = {
  busy: {
    name: "checkout-api",
    telemetrySdkLanguage: "nodejs",
    runtimeName: "nodejs",
    runtimeVersion: "20.11.1",
    serviceVersion: "2.7.0",
    deploymentEnvironment: "production",
    serviceNamespace: "shop",
    cloudProvider: "aws",
    cloudPlatform: "aws_ecs",
    cloudRegion: "eu-west-1",
    cloudAccountId: "123456789012",
    techStack: ["NodeJS", "TypeScript"],
  },
  new: {
    name: "checkout-api",
    telemetrySdkLanguage: "nodejs",
    techStack: [],
  },
  long: {
    /*
     * As a Kubernetes rollout names a service: too long to share a laptop's
     * hero row with the controls.
     */
    name: "inventory-reservation-service-eu-west-2-canary-blue",
    telemetrySdkLanguage: "java",
    runtimeName: "OpenJDK Runtime Environment",
    runtimeVersion: "21.0.2+13-LTS-58",
    serviceVersion: "2026.10.25-build.4821-sha.6f3c2a91d8b7",
    deploymentEnvironment: "production-eu-west-2-canary",
    serviceNamespace: "com.acme-commerce.inventory.reservations",
    cloudProvider: "gcp",
    cloudPlatform: "gcp_kubernetes_engine",
    cloudRegion: "europe-west2",
    cloudAccountId: "acme-commerce-inventory-prod-4821",
    techStack: ["Java", "Kotlin", "Shell"],
  },
};

const service = {
  _id: SERVICE_ID,
  projectId: PROJECT_ID,
  description: DESCRIPTIONS[RESOURCE],
  labels: LABELS[RESOURCE],
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  otelCollectorStatus: RESOURCE === "new" ? undefined : "connected",
  isArchived: false,
  ...SERVICES[RESOURCE],
};

const database = {
  _id: DATABASE_ID,
  projectId: PROJECT_ID,
  name: RESOURCE === "long" ? "inventory-reservations-primary" : "orders-db",
  description: DESCRIPTIONS[RESOURCE],
  labels: LABELS[RESOURCE],
  dbSystem: "postgresql",
  dbVersion: RESOURCE === "new" ? undefined : "16.4",
  serverAddress: "orders-db.internal",
  serverPort: 5432,
  // Found in the queries its applications send: "Application traces".
  discoverySource: RESOURCE === "new" ? undefined : "client-spans",
  otelCollectorStatus: undefined,
  collectorLastSeenAt: undefined,
  agentVersion: undefined,
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  memberEntityKeys: [],
  instanceCount: 1,
  isArchived: false,
};

const databaseEndpoints =
  RESOURCE === "new"
    ? []
    : [
        {
          _id: uuid("75000000", 1),
          databaseServerId: DATABASE_ID,
          endpoint:
            RESOURCE === "long"
              ? "inventory-reservations-primary.c9akciq32.eu-west-2.rds.amazonaws.com:5432"
              : "orders-db.internal:5432",
          isPrimary: true,
        },
      ];

const queue = {
  _id: QUEUE_ID,
  projectId: PROJECT_ID,
  name:
    RESOURCE === "long"
      ? "orders.v2.checkout-completed.eu-west-2"
      : "orders.checkout-completed",
  description: DESCRIPTIONS[RESOURCE],
  labels: LABELS[RESOURCE],
  // system|broker scope|destination, as ingest identifies a queue.
  queueIdentifier:
    RESOURCE === "long"
      ? "kafka||orders.v2.checkout-completed.eu-west-2.dead-letter"
      : "kafka||orders.checkout-completed",
  messagingSystem: "kafka",
  destinationName:
    RESOURCE === "long"
      ? "orders.v2.checkout-completed.eu-west-2.dead-letter"
      : "orders.checkout-completed",
  brokerScope: undefined,
  brokerAddress: RESOURCE === "new" ? undefined : "kafka-1.internal:9092",
  discoverySource: RESOURCE === "new" ? undefined : "traces",
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  brokerMetricsLastSeenAt: undefined,
  isArchived: false,
};

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  itemRequests: [],
  countRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
  dataset: {
    projectId: PROJECT_ID,
    serviceId: SERVICE_ID,
    databaseId: DATABASE_ID,
    queueId: QUEUE_ID,
    resource: RESOURCE,
  },
};
window.__resourceOverviewsFixture = fixture;

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
  Service: [service],
  DatabaseServer: [database],
  DatabaseServerEndpoint: databaseEndpoints,
  MessageQueue: [queue],
  // The activity cards' states and counts: nothing open here.
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
  // What the Recommendations menu item reads: no monitors, nothing dismissed.
  Monitor: [],
  RecommendationDismissal: [],
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
  return "sam@acme-commerce.example";
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
 * Telemetry: the tiles and charts read their series from aggregates. Each
 * answers a smooth series over the last half hour, the same whatever was
 * asked: the hero and the Details card are what this fixture is about.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });
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
  fixture.aggregateRequests.push({
    modelName,
    name: typeof query.name === "string" ? query.name : null,
  });

  const data = [];
  for (let step = 30; step >= 0; step--) {
    data.push({
      timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
      value: 40 + 12 * Math.sin(step / 4),
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
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({ method, url: parsed.pathname, body });

  // The logs and exceptions charts: nothing in this half hour.
  if (
    method === "POST" &&
    (parsed.pathname.endsWith("/telemetry/logs/histogram") ||
      parsed.pathname.endsWith("/telemetry/exceptions/histogram"))
  ) {
    return ok({ buckets: [], bucketSizeInMinutes: 1 });
  }

  /*
   * The Security card: this project uses no Security Events, as the server
   * says when no event arrived this week, so the card draws nothing.
   */
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
      entity: null,
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
      risk: null,
    });
  }

  /*
   * The database's AI agent card: no AI agent yet, as the server answers
   * for a database nobody connected one to.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      resourceName: database.name,
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Connect the OneUptime Database Agent.",
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
document.documentElement.lang = LANGUAGE;

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

const VIEWS = [
  [ServiceLayout, ServiceOverview, PageMap.SERVICE_VIEW],
  [DatabaseLayout, DatabaseOverview, PageMap.DATABASE_SERVER_VIEW],
  [QueueLayout, QueueOverview, PageMap.MESSAGE_QUEUE_VIEW],
].map(([Layout, Overview, pageKey]) => {
  return {
    key: String(pageKey),
    path: RouteMap[pageKey].toString(),
    Layout: withNavigation(Layout, pageKey),
    Page: withNavigation(Overview, pageKey),
  };
});

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
          <span className="text-sm text-gray-500">Acme Commerce</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        {VIEWS.map((view) => {
          return (
            <Route key={view.key} element={<view.Layout />}>
              <Route path={view.path} element={<view.Page />} />
            </Route>
          );
        })}
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
