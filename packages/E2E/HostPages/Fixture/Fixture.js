/*
 * Offline fixture for the Hosts product's pages: the production Hosts
 * layout (Page, the Hosts side menu) with the Hosts list - its Needs
 * attention card and its Status, CPU, Memory and Disk columns - and a host's
 * own layout (ModelPage, the host's side menu) with its Overview (hero,
 * Needs attention, tiles, Host alerts, charts, Filesystems, Details) and the
 * Recommendations page "Turn on N alerts" opens, under their real RouteMap
 * patterns. Only the data boundary (ModelAPI, AnalyticsModelAPI, API,
 * Realtime) and the signed-in user are replaced. Every record is made up,
 * for an "Acme Infrastructure" workspace (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?fleet=   busy (default) | calm | new | large (Data.js)
 *   ?alerts=  none (default) | some (two host alerts on) | denied (the role
 *             may not read monitors)
 *   ?fail=    attention: POST /host/needs-attention answers 500
 *   ?lang=    de or fa reads the German or Persian locale file (Persian
 *             lays the page out right to left)
 *   ?theme=   dark adds html.dark (server.js)
 *
 * POST /host/needs-attention answers as HostService
 * .findHostsThatMayNeedAttention does: every host of the project past one of
 * HostHealth's lines - not reporting, never reporting, a filesystem or its
 * inodes past 85%, memory past 90%, swap past 80%, a 15-minute load above
 * twice its cores, failed systemd units, a collector config that failed or
 * a collector error - never an archived one. The Dashboard then says which
 * need attention and why.
 *
 * Every read is recorded on window.__hostPagesFixture: listRequests,
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
import HostLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Layout";
import HostsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import HostViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Layout";
import HostOverview from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import HostRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Recommendations";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "Common/Models/DatabaseModels/Host";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_INODES_NEAR_FULL_PERCENT,
  HOST_LOAD_PER_CORE_HIGH,
  HOST_MEMORY_HIGH_PERCENT,
  HOST_SWAP_HIGH_PERCENT,
} from "Common/Types/Host/HostHealth";
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
import { PROJECT_ID, buildFleet, hostMetricRows, uuid } from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const FLEET = ["calm", "new", "large"].includes(params.get("fleet"))
  ? params.get("fleet")
  : "busy";
const ALERTS = ["some", "denied"].includes(params.get("alerts"))
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
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Infrastructure",
});

const hosts = buildFleet({ fleet: FLEET }, LOADED_AT);

/*
 * ---------------------------------------------------------------------------
 * The monitors the project already has, for Host alerts and Recommendations
 * ---------------------------------------------------------------------------
 */
const hostRecommendations = MonitorRecommendationCatalog.getRecommendations(
  MonitorRecommendationResourceType.Host,
);
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendationId, hostIdentifier, number) {
  const recommendation = hostRecommendations.find((candidate) => {
    return candidate.recommendationId === recommendationId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: hostIdentifier,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: hostIdentifier,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${hostIdentifier} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.Host,
    monitorSteps: steps,
  };
}

// ?alerts=some: Host Stopped Reporting and High CPU are on for web-01.
const monitors =
  ALERTS === "some"
    ? ["Host:host-stopped-reporting", "Host:host-high-cpu"]
        .map((recommendationId, index) => {
          return monitorFor(recommendationId, "web-01", index + 1);
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
window.__hostPagesFixture = fixture;

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

const TRAILING_S = /s$/;

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
      const relationIds = record[`${field.replace(TRAILING_S, "")}Ids`];
      if (Array.isArray(relationIds)) {
        if (
          !relationIds.some((id) => {
            return allowed.has(String(id));
          })
        ) {
          return false;
        }
        continue;
      }
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

const store = {
  Host: hosts,
  HostOwnerUser: [],
  HostOwnerTeam: [],
  HostCollectorConfig: [],
  Label: [],
  TableView: [],
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
  Service: [],
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
 * ---------------------------------------------------------------------------
 * POST /host/needs-attention, as the server answers it
 * ---------------------------------------------------------------------------
 */
function above(value, line) {
  return value !== null && value !== undefined && Number(value) > line;
}

export function mayNeedAttention(row) {
  if (row.isArchived) {
    return false;
  }
  return (
    row.otelCollectorStatus === "disconnected" ||
    !row.lastSeenAt ||
    above(row.latestDiskPercent, HOST_DISK_NEAR_FULL_PERCENT) ||
    above(row.latestInodesPercent, HOST_INODES_NEAR_FULL_PERCENT) ||
    above(row.latestMemoryPercent, HOST_MEMORY_HIGH_PERCENT) ||
    above(row.latestSwapPercent, HOST_SWAP_HIGH_PERCENT) ||
    (row.cpuCores !== null &&
      row.cpuCores !== undefined &&
      above(
        row.latestLoadAverage15m,
        row.cpuCores * HOST_LOAD_PER_CORE_HIGH,
      )) ||
    above(row.failedSystemdUnitCount, 0) ||
    row.collectorConfigStatus === "failed" ||
    row.isCollectorHealthy === false
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
  return "sam@acme-infrastructure.example";
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

  if (modelName === "Monitor" && ALERTS === "denied") {
    throw new Error("You do not have permission to read monitors.");
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
 * A host's metrics (Data.js), for its Overview's tiles and charts
 * ---------------------------------------------------------------------------
 */
function currentHost() {
  const match = window.location.pathname.match(HOST_PATH);
  const id = match ? match[1] : "";
  return (
    hosts.find((row) => {
      return row._id === id;
    }) || null
  );
}

const HOST_PATH = /\/host\/([0-9a-f-]{36})/;

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy;
  fixture.aggregateRequests.push({
    modelName,
    name: aggregateBy.query?.name,
    attributes: serialize(aggregateBy.query?.attributes),
    aggregationType: aggregateBy.aggregationType,
    groupBy: serialize(aggregateBy.groupBy),
  });

  const row = currentHost();
  const data =
    modelName.startsWith("Metric") && row
      ? hostMetricRows({
          host: row,
          metricName: aggregateBy.query?.name,
          attributes: aggregateBy.query?.attributes,
          start: new Date(aggregateBy.startTimestamp || LOADED_AT - 30 * 60000),
          end: new Date(aggregateBy.endTimestamp || LOADED_AT),
          loadedAt: LOADED_AT,
        })
      : null;

  if (!data) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy.query?.name,
    });
    return { data: [] };
  }

  return { data };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  if (
    modelName.startsWith("Log") ||
    modelName.startsWith("Metric") ||
    modelName.startsWith("Span") ||
    modelName.startsWith("SecurityEvent")
  ) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (modelName.startsWith("Log") || modelName.startsWith("SecurityEvent")) {
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
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  // The Hosts list's Needs attention card.
  if (method === "POST" && parsed.pathname.endsWith("/host/needs-attention")) {
    if (FAIL === "attention") {
      return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
    }
    return ok({
      hosts: BaseModel.toJSONArray(
        hosts.filter(mayNeedAttention).map((row) => {
          return Object.assign(new Host(), row);
        }),
        Host,
      ),
      isTruncated: false,
    });
  }

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  // The host's Security card: nothing seen on it this week.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/security-case/resource-security")
  ) {
    const row = currentHost();
    return ok({
      kind: "Host",
      id: row?._id || "",
      name: row?.name || "",
      isInUse: false,
      windowDays: 7,
      values: [row?.hostIdentifier || ""],
      entity: { type: "Host", value: row?.hostIdentifier || "" },
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
      risk: null,
    });
  }

  // The AI agent card: the host has no Host AI agent yet.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "Host",
      resourceId: currentHost()?._id || "",
      resourceName: currentHost()?.name || "",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Install the Host AI agent on this host.",
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

const ListLayout = withNavigation(HostLayout, PageMap.HOSTS);
const ViewLayout = withNavigation(HostViewLayout, PageMap.HOST_VIEW);
const ListPage = withNavigation(HostsPage, PageMap.HOSTS);

const VIEW_PAGES = [
  [PageMap.HOST_VIEW, HostOverview],
  [PageMap.HOST_VIEW_RECOMMENDATIONS, HostRecommendations],
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
          <span className="text-sm text-gray-500">Acme Infrastructure</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<ListLayout />}>
          <Route
            path={RouteMap[PageMap.HOSTS].toString()}
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

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
