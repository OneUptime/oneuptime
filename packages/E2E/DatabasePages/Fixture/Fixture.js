/*
 * Offline fixture for the Databases product's pages: the production
 * Databases layout (Page, the Databases side menu) with the Databases list -
 * its Needs attention card and its Status column - and a database's own
 * layout (its side menu) with its Overview (hero and health, Needs
 * attention, Database alerts, charts, Details) and the Recommendations page
 * "Turn on N alerts" opens, under their real RouteMap patterns. Only the
 * data boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the
 * signed-in user are replaced. Every record is made up, for an "Acme
 * Commerce" workspace (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?fleet=   busy (default) | calm | new (Data.js)
 *   ?alerts=  none (default) | some (two of orders-db's alerts on)
 *   ?fail=    attention: the Needs attention card's reads answer 500
 *   ?lang=    de or fa reads the German or Persian locale file (Persian
 *             lays the page out right to left)
 *   ?theme=   dark adds html.dark (server.js)
 *
 * The list's Needs attention card asks for the databases whose stored
 * verdict may need someone (DatabaseFleetAttention's two reads: a fresh
 * Degraded or Unhealthy verdict, and engine metrics that stopped); this
 * fixture answers them as Postgres would, from the rows' own columns.
 *
 * Every read is recorded on window.__databasePagesFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, apiRequests and unhandled
 * - anything the fixture does not model. The spec keeps `unhandled` empty.
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
import DatabasesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Layout";
import DatabasesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import DatabaseViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Layout";
import DatabaseOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import DatabaseRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Recommendations";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { DATABASE_SERVER_ID_SCOPE_ATTRIBUTE } from "Common/Types/Monitor/DatabaseAlertTemplates";
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
  DATABASE_IDS,
  PROJECT_ID,
  buildEndpoints,
  buildFleet,
  uuid,
} from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const FLEET = ["calm", "new"].includes(params.get("fleet"))
  ? params.get("fleet")
  : "busy";
const ALERTS = ["some"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const FAIL = ["attention"].includes(params.get("fail"))
  ? params.get("fail")
  : "";
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
 * The clock, the project and the fleet
 * ---------------------------------------------------------------------------
 */
const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

const databases = buildFleet({ fleet: FLEET }, LOADED_AT);

// The busy fleet's flagship carries labels, as a team's database would.
for (const row of databases) {
  if (row._id === DATABASE_IDS.ordersDb && FLEET === "busy") {
    row.labels = [
      {
        _id: uuid("72000000", 1),
        name: "production",
        color: Color.fromString("#4f46e5"),
      },
      {
        _id: uuid("72000000", 2),
        name: "team-checkout",
        color: Color.fromString("#d97706"),
      },
    ];
  }
}

/*
 * ---------------------------------------------------------------------------
 * The monitors the project already has, for Database alerts
 * ---------------------------------------------------------------------------
 */
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(databaseRow, templateId, number) {
  const recommendation = MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.DatabaseServer,
    {
      databaseEngine: databaseRow.dbSystem,
      databaseEngineMetricsReported: true,
    },
  ).find((candidate) => {
    return candidate.templateId === templateId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: databaseRow._id,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: databaseRow.name,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${databaseRow.name} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.Metrics,
    monitorSteps: steps,
  };
}

// ?alerts=some: Engine Metrics Stopped and Connections Nearly Exhausted for orders-db.
const ordersDb = databases.find((row) => {
  return row._id === DATABASE_IDS.ordersDb;
});
const monitors =
  ALERTS === "some" && ordersDb
    ? [
        "database-postgresql-engine-metrics-stopped",
        "database-postgresql-connections-exhausted",
      ]
        .map((templateId, index) => {
          return monitorFor(ordersDb, templateId, index + 1);
        })
        .filter(Boolean)
    : [];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    fleet: FLEET,
    alerts: ALERTS,
    fail: FAIL,
    language: LANGUAGE,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__databasePagesFixture = fixture;

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

function comparable(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return Date.parse(value);
  }
  return value;
}

/*
 * A query's values match as Postgres would match them: plain values,
 * Includes, NotEqual, NotNull, GreaterThan(OrEqual) and a Search.
 */
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    const value = record[field];
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      if (!allowed.has(String(plain(value)))) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotEqual) {
      if (String(value ?? "") === String(plain(wanted.value))) {
        return false;
      }
      // Postgres: NULL <> 'connected' is not true.
      if (value === null || value === undefined) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotNull) {
      if (value === null || value === undefined) {
        return false;
      }
      continue;
    }
    if (wanted instanceof GreaterThanOrEqual || wanted instanceof GreaterThan) {
      if (value === null || value === undefined) {
        return false;
      }
      const left = comparable(value);
      const right = comparable(wanted.value);
      if (wanted instanceof GreaterThan ? !(left > right) : !(left >= right)) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Search) {
      if (
        !String(value ?? "")
          .toLowerCase()
          .includes(String(wanted.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    const plainWanted = plain(wanted);
    if (
      typeof plainWanted !== "string" &&
      typeof plainWanted !== "boolean" &&
      typeof plainWanted !== "number"
    ) {
      continue;
    }
    if (String(value ?? "") !== String(plainWanted)) {
      return false;
    }
  }
  return true;
}

const store = {
  DatabaseServer: databases,
  DatabaseServerEndpoint: buildEndpoints(databases),
  DatabaseServerOwnerUser: [],
  DatabaseServerOwnerTeam: [],
  Label: [],
  TableView: [],
  Service: [],
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
  Monitor: monitors,
  RecommendationDismissal: [],
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
    { _id: uuid("52000000", 1), name: "Critical", color: new Color("#dc2626") },
  ],
  AlertSeverity: [
    { _id: uuid("53000000", 1), name: "Warning", color: new Color("#d97706") },
  ],
  OnCallDutyPolicy: [],
  MetricType: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: nulls last, as Postgres sorts them.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const descending = order === SortOrder.Descending;
      const a = left[field];
      const b = right[field];
      if (a === b) {
        continue;
      }
      if (a === null || a === undefined) {
        return 1;
      }
      if (b === null || b === undefined) {
        return -1;
      }
      const ascending =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : a instanceof Date || b instanceof Date
            ? new Date(a).getTime() - new Date(b).getTime()
            : String(a) < String(b)
              ? -1
              : 1;
      if (ascending !== 0) {
        return descending ? -ascending : ascending;
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

/*
 * The Needs attention card's reads: the ones that ask for a stored verdict
 * or for engine metrics that stopped.
 */
function isAttentionRead(modelName, query) {
  return (
    modelName === "DatabaseServer" &&
    query &&
    (query.engineHealth !== undefined ||
      query.otelCollectorStatus instanceof NotEqual)
  );
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
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
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ProjectUtil.getCurrentPlan = () => {
  return null;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    limit: options.limit,
  });

  if (FAIL === "attention" && isAttentionRead(modelName, options.query)) {
    throw new Error(SERVER_ERROR);
  }

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
    return String(candidate._id) === String(id);
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

/*
 * ---------------------------------------------------------------------------
 * Telemetry
 * ---------------------------------------------------------------------------
 *
 * The Overview's tiles and charts read their series from aggregates: each
 * answers a smooth series over the time range, the same whatever was
 * asked - the health, Needs attention and alerts are what this fixture is
 * about. The cards that list services get no rows. The Recommendations
 * page asks whether a metric its monitors read arrived with the database's
 * id: yes for a database whose agent has reported.
 */
const DATABASE_PATH = /\/databases\/([0-9a-f-]{36})/;

function currentDatabase() {
  const match = window.location.pathname.match(DATABASE_PATH);
  const id = match ? match[1] : "";
  return (
    databases.find((row) => {
      return row._id === id;
    }) || null
  );
}

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({
    modelName,
    name: typeof query.name === "string" ? query.name : null,
    groupBy: serialize(aggregateBy.groupBy),
  });

  if (aggregateBy.groupBy && aggregateBy.groupBy.primaryEntityId) {
    return { data: [] };
  }

  const start = new Date(aggregateBy.startTimestamp || LOADED_AT - 60 * MINUTE);
  const end = new Date(aggregateBy.endTimestamp || LOADED_AT);
  const step = Math.max(MINUTE, Math.floor((end - start) / 30));
  const data = [];
  for (let at = start.getTime(); at <= end.getTime(); at += step) {
    data.push({
      timestamp: new Date(at).toISOString(),
      value: 40 + 12 * Math.sin(at / (8 * MINUTE)),
    });
  }
  return { data };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const query = options.query || {};
  fixture.listRequests.push({ modelName, query: serialize(query) });

  // The Recommendations page's probe: has a metric they read arrived?
  if (modelName.startsWith("Metric")) {
    const id = (query.attributes || {})[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE];
    const row = databases.find((candidate) => {
      return candidate._id === id;
    });
    const arrived = Boolean(row && row.collectorLastSeenAt);
    return {
      data: arrived ? [{ time: new Date(LOADED_AT - MINUTE) }] : [],
      count: arrived ? 1 : 0,
      skip: 0,
      limit: options.limit || 1,
    };
  }

  if (modelName.startsWith("Log") || modelName.startsWith("Span")) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (modelName.startsWith("Log") || modelName.startsWith("Span")) {
    return 0;
  }

  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({ method, url: parsed.pathname, body });

  // The logs and exceptions charts: nothing in this range.
  if (
    method === "POST" &&
    (parsed.pathname.endsWith("/telemetry/logs/histogram") ||
      parsed.pathname.endsWith("/telemetry/exceptions/histogram"))
  ) {
    return ok({ buckets: [], bucketSizeInMinutes: 1 });
  }

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  // The Security card: this project uses no Security Events.
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

  // The AI agent card: no Database AI agent connected yet.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    const row = currentDatabase();
    return ok({
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      resourceName: row?.name || "",
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

const ListLayout = withNavigation(DatabasesLayout, PageMap.DATABASE_SERVERS);
const ViewLayout = withNavigation(
  DatabaseViewLayout,
  PageMap.DATABASE_SERVER_VIEW,
);
const ListPage = withNavigation(DatabasesPage, PageMap.DATABASE_SERVERS);

const VIEW_PAGES = [
  [PageMap.DATABASE_SERVER_VIEW, DatabaseOverview],
  [PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS, DatabaseRecommendations],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
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
        <Route element={<ListLayout />}>
          <Route
            path={RouteMap[PageMap.DATABASE_SERVERS].toString()}
            element={<ListPage />}
          />
        </Route>
        <Route element={<ViewLayout />}>
          {VIEW_PAGES.map((page) => {
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
