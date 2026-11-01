/*
 * Offline fixture for App Platforms, the product the apps on managed app and
 * container platforms moved to out of Cloud: the REAL App Platforms route
 * group (Routes/AppPlatformsRoutes - its layout, side menus, Overview, All
 * Environments, an environment's pages, its rules and Archived) and Cloud's
 * REAL resource view layout, under their real RouteMap patterns, as App.tsx
 * mounts them. Only the data boundary (ModelAPI, AnalyticsModelAPI, API,
 * Realtime) and the signed-in user are replaced. Every record is fabricated
 * for an "Acme Apps" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=   (default: six environments on four platforms, two of them
 *             quiet) | empty (no environment yet)
 *   ?lang=    de | fa (Persian, laid out right to left, as production does)
 *   ?theme=   dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__appPlatformsFixture: listRequests,
 * countRequests, itemRequests, apiRequests and unhandled - anything the
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
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import AppPlatformsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/AppPlatformsRoutes";
import CloudResourceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Layout";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
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
import { setPageLanguage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const EMPTY = params.get("state") === "empty";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: LANGUAGE,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Persian reads right to left, as production's followLanguageForPage sets it.
setPageLanguage(LANGUAGE);
// Dates in the reader's language ("vor 3 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * The workspace
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LOADED_AT = Date.now();

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Apps",
});

ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const GRANTED = [Permission.ProjectOwner];

PermissionUtil.getAllPermissions = () => {
  return GRANTED;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: GRANTED.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

/*
 * Six environments on four platforms - two of them quiet, the oldest
 * first on its platform's card - and one resource of a cloud account, which
 * is Cloud's and never listed here.
 */
function environment(number, fields) {
  return {
    _id: uuid("71000000", number),
    projectId: PROJECT_ID,
    cloudResourceKind: "environment",
    isArchived: false,
    createdAt: new Date(LOADED_AT - 30 * 24 * HOUR),
    ...fields,
  };
}

const ENVIRONMENTS = EMPTY
  ? []
  : [
      environment(1, {
        name: "checkout · us-east-1 · 4109-2277-8841",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudAccountId: "4109-2277-8841",
        cloudRegion: "us-east-1",
        resourceIdentifier: "aws_ecs|4109-2277-8841|us-east-1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(2, {
        name: "billing · eu-west-1 · 4109-2277-8841",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudAccountId: "4109-2277-8841",
        cloudRegion: "eu-west-1",
        resourceIdentifier: "aws_ecs|4109-2277-8841|eu-west-1",
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(LOADED_AT - 3 * HOUR),
      }),
      environment(3, {
        name: "api · europe-west1 · acme-prod",
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
        cloudAccountId: "acme-prod",
        cloudRegion: "europe-west1",
        resourceIdentifier: "gcp_cloud_run|acme-prod|europe-west1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(4, {
        name: "worker · us-central1 · acme-prod",
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
        cloudAccountId: "acme-prod",
        cloudRegion: "us-central1",
        resourceIdentifier: "gcp_cloud_run|acme-prod|us-central1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
      }),
      environment(5, {
        name: "reports · westeurope · core-prod-sub",
        cloudPlatform: "azure_container_apps",
        cloudProvider: "azure",
        cloudAccountId: "core-prod-sub",
        cloudRegion: "westeurope",
        resourceIdentifier: "azure_container_apps|core-prod-sub|westeurope",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(6, {
        name: "web · eastus · core-prod-sub",
        cloudPlatform: "azure_app_service",
        cloudProvider: "azure",
        cloudAccountId: "core-prod-sub",
        cloudRegion: "eastus",
        resourceIdentifier: "azure_app_service|core-prod-sub|eastus",
        otelCollectorStatus: "disconnected",
        lastSeenAt: null,
      }),
    ];

const RESOURCE = {
  _id: uuid("72000000", 1),
  projectId: PROJECT_ID,
  name: "vm-prod-01",
  cloudResourceKind: "resource",
  cloudProvider: "azure",
  cloudResourceType: "Microsoft.Compute/virtualMachines",
  isArchived: false,
};

// The checkout environment's running tasks: CPU 30%, 36% and 42%, 1.5 GiB in all.
const INSTANCES = EMPTY
  ? []
  : [1, 2, 3].map((number) => {
      return {
        _id: uuid("73000000", number),
        projectId: PROJECT_ID,
        cloudResourceId: uuid("71000000", 1),
        instanceName: `checkout/${number}a2b3c4d5e6f7`,
        lastSeenAt: new Date(LOADED_AT - number * MINUTE),
        latestCpuPercent: 24 + number * 6,
        latestMemoryBytes: 256 * 1024 * 1024 * number,
      };
    });

// One rule of each kind: App Platforms', Cloud's, and one for both.
function rule(number, fields) {
  return {
    _id: uuid("74000000", number),
    projectId: PROJECT_ID,
    isEnabled: true,
    createdAt: new Date(LOADED_AT - number * 24 * HOUR),
    ...fields,
  };
}

const OWNER_RULES = [
  rule(1, {
    name: "Payments team owns checkout",
    description: "Every checkout environment, wherever it runs.",
    cloudResourceKind: "environment",
    nameRegexPattern: "^checkout",
  }),
  rule(2, {
    name: "Platform team owns VMs",
    description: "Cloud's own: the virtual machines in our accounts.",
    cloudResourceKind: "resource",
  }),
  rule(3, {
    name: "Production owners",
    description: "Made before Cloud and App Platforms were split.",
    nameRegexPattern: "prod",
  }),
];

const LABEL_RULES = [
  rule(11, {
    name: "Label EU environments",
    description: "Environments in Europe get the region:eu label.",
    cloudResourceKind: "environment",
    nameRegexPattern: "europe|west",
  }),
  rule(12, {
    name: "Label every production row",
    description: "Made before Cloud and App Platforms were split.",
    nameRegexPattern: "prod",
  }),
];

const TABLES = {
  CloudResource: [...ENVIRONMENTS, RESOURCE],
  CloudResourceInstance: INSTANCES,
  CloudResourceOwnerRule: OWNER_RULES,
  CloudResourceLabelRule: LABEL_RULES,
};

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__appPlatformsFixture = fixture;

function tableName(modelType) {
  return new modelType().tableName || "";
}

// A query, as it reads in the spec: Includes and EqualToOrNull by their values.
function serialize(query) {
  const plain = {};
  for (const [field, value] of Object.entries(query || {})) {
    if (value instanceof EqualToOrNull) {
      plain[field] = { equalToOrNull: String(value.value) };
    } else if (value instanceof Includes) {
      plain[field] = { includes: value.values.map(String) };
    } else if (value && typeof value === "object" && value._type) {
      plain[field] = { [value._type]: String(value.value ?? "") };
    } else if (value instanceof ObjectID) {
      plain[field] = value.toString();
    } else {
      plain[field] = value;
    }
  }
  return plain;
}

function idsOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      return String(entry && entry._id ? entry._id : entry);
    });
  }
  return value === undefined || value === null ? [] : [String(value)];
}

// A query, matched as the server would, for the columns these pages read.
function rowMatches(row, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof EqualToOrNull) {
      if (
        row[field] !== undefined &&
        row[field] !== null &&
        String(row[field]) !== String(wanted.value)
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = wanted.values.map(String);
      if (
        !idsOf(row[field]).some((entry) => {
          return allowed.includes(entry);
        })
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof ObjectID) {
      if (String(row[field]) !== wanted.toString()) {
        return false;
      }
      continue;
    }
    if (
      typeof wanted === "string" ||
      typeof wanted === "number" ||
      typeof wanted === "boolean"
    ) {
      if (String(row[field] ?? "") !== String(wanted)) {
        return false;
      }
    }
  }
  return true;
}

function rowsOf(modelType, query) {
  return (TABLES[tableName(modelType)] || []).filter((row) => {
    return rowMatches(row, query);
  });
}

// The tables the pages read that the fixture keeps empty, as a new project's are.
const EMPTY_TABLES = [
  "Label",
  "IncidentState",
  "AlertState",
  "Incident",
  "Alert",
  "Team",
  "User",
  "CloudResourceOwnerUser",
  "CloudResourceOwnerTeam",
  "CloudResourceFeed",
  "TelemetryIngestionKey",
  "ProjectUser",
  // The telemetry explorers' pickers and saved views, and the metric catalog.
  "Service",
  "Host",
  "DockerHost",
  "PodmanHost",
  "KubernetesCluster",
  "LogSavedView",
  "MetricType",
  // The Incidents and Alerts tabs' create forms.
  "IncidentCustomField",
  "IncidentNoteTemplate",
  "AlertCustomField",
  "AlertNoteTemplate",
];

function isModelled(modelType) {
  const name = tableName(modelType);
  return Boolean(TABLES[name]) || EMPTY_TABLES.includes(name);
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  fixture.listRequests.push({
    modelName: name,
    query: serialize(options.query),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "list", modelName: name });
  }

  let rows = rowsOf(options.modelType, options.query);

  const sort = options.sort || {};
  const [sortField] = Object.keys(sort);
  if (sortField) {
    const direction = String(sort[sortField]).toLowerCase().startsWith("desc")
      ? -1
      : 1;
    rows = [...rows].sort((a, b) => {
      return (
        String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? "")) *
        direction
      );
    });
  }

  const skip = options.skip || 0;
  const limit = options.limit || rows.length;

  return {
    data: rows.slice(skip, skip + limit).map((row) => {
      return Object.assign(new options.modelType(), row);
    }),
    count: rows.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const name = tableName(options.modelType);
  fixture.countRequests.push({
    modelName: name,
    query: serialize(options.query),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "count", modelName: name });
  }

  return rowsOf(options.modelType, options.query).length;
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);
  fixture.itemRequests.push({
    modelName: name,
    id: options.id.toString(),
    select: Object.keys(options.select || {}).sort(),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "item", modelName: name });
    return null;
  }

  const found = (TABLES[name] || []).find((row) => {
    return row._id === options.id.toString();
  });

  return found ? Object.assign(new options.modelType(), found) : null;
};

/*
 * Telemetry: an environment's spans and metrics, as aggregates - a smooth
 * series over the last half hour, scaled to what each one counts: requests,
 * the few that errored, a p95 in nanoseconds, a metric's own value.
 */
function seriesOf(base, swing) {
  const data = [];
  for (let step = 30; step >= 0; step--) {
    data.push({
      timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
      value: base + swing * Math.sin(step / 4),
    });
  }
  return data;
}

AnalyticsModelAPI.aggregate = async (options) => {
  const name = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({
    modelName: name,
    aggregationType: aggregateBy.aggregationType || null,
  });

  // The analytics tables are named by version (SpanItemV3, MetricItemV3).
  if (name.startsWith("Span")) {
    if (
      String(aggregateBy.aggregationType || "")
        .toLowerCase()
        .includes("95")
    ) {
      // 120 ms, in nanoseconds.
      return { data: seriesOf(120e6, 20e6) };
    }
    if (query.statusCode !== undefined) {
      return { data: seriesOf(0.6, 0.4) };
    }
    return { data: seriesOf(42, 8) };
  }

  // A metric: CPU as a fraction, memory in bytes.
  return {
    data: String(query.name || "").includes("memory")
      ? seriesOf(512 * 1024 * 1024, 64 * 1024 * 1024)
      : seriesOf(0.38, 0.06),
  };
};

AnalyticsModelAPI.getList = async (options) => {
  fixture.listRequests.push({
    modelName: tableName(options.modelType),
    query: {},
  });
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};

AnalyticsModelAPI.count = async () => {
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = new URL(options.url.toString(), window.location.origin);
  fixture.apiRequests.push({ method, url: url.pathname });

  // The metrics search bar's attribute keys.
  if (url.pathname.endsWith("/telemetry/metrics/get-attributes")) {
    return ok({ attributes: ["resource.cloud.platform"] });
  }

  /*
   * The Logs and Traces tabs' explorers, for an environment that has sent
   * no logs or spans in the selected range: no attribute keys, no buckets,
   * no facet values.
   */
  if (/\/telemetry\/(logs|traces)\/get-attributes$/.test(url.pathname)) {
    return ok({ attributes: [] });
  }
  if (/\/telemetry\/(logs|traces)\/histogram$/.test(url.pathname)) {
    return ok({ buckets: [], bucketSizeInMinutes: 1 });
  }
  if (/\/telemetry\/(logs|traces)\/facets$/.test(url.pathname)) {
    return ok({ facets: {}, timedOutFacets: [] });
  }

  fixture.unhandled.push({ kind: "api", method, url: url.pathname });
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
 * ---------------------------------------------------------------------------
 * Router, as App.tsx mounts the route groups
 * ---------------------------------------------------------------------------
 */
const PAGE_PROPS = {
  pageRoute: RouteMap[PageMap.APP_PLATFORMS_OVERVIEW],
  currentProject: project,
  hasPaymentMethod: true,
};

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

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

function CloudResourceView() {
  useNavigationHooks();
  return <CloudResourceViewLayout {...PAGE_PROPS} />;
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
          <span className="text-sm text-gray-500">Acme Apps</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route
          path={RouteMap[PageMap.APP_PLATFORMS_ROOT].toString()}
          element={<AppPlatformsRoutes {...PAGE_PROPS} />}
        />
        {/*
         * Cloud's view of one row: it reads the row's kind and forwards an
         * environment to App Platforms. Its tabs are not modelled.
         */}
        <Route
          path={`${RouteMap[PageMap.CLOUD_RESOURCE_VIEW].toString()}/*`}
          element={<CloudResourceView />}
        >
          <Route path="*" element={<StubPage />} />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

// As the Dashboard mounts it: navigations update synchronously.
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
