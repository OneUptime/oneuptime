/*
 * The dashboard inside OneUptime, as a signed-in member opens it: the real
 * view layout (Pages/Dashboards/View/Layout) around the real Dashboard page
 * (Pages/Dashboards/View/Index -> Components/Dashboard/DashboardView), with
 * only the data boundary replaced: ModelAPI, AnalyticsModelAPI and API.
 *
 * Every list is answered as the database would answer it (Boards.js
 * readTable): filtered, ordered by the read's own sort, cut to its limit.
 * The trace table's groups are ranked by the request's tableSort, as
 * ClickHouse ranks them. The fixture's server keeps the dashboard's config
 * for the tab (sessionStorage), so Save Changes followed by a reload opens
 * what was saved. Steered by the query string, read before the app starts:
 *
 *   - lang=de       the Dashboard's German words
 *   - theme=dark    (read by server.js) the dark theme
 *   - board=narrow  the second dashboard: a narrow metric table and the
 *                   security events list (Boards.js buildNarrowConfig)
 *   - titles=long   the first incident's title a long sentence, as an
 *                   incident's often is (Boards.js incidents)
 *
 * Everything the page asks for is recorded on window.__dashboardWidgetSortFixture:
 * every list read with its sort, phase and limit (lists), every trace table
 * request's tableSort (traceTables), every save with the config it wrote
 * (saves), and every read the fixture does not model (unexpected - the
 * suite fails on any).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import DashboardViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Layout";
import DashboardViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Index";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import {
  DASHBOARD_ID,
  METRIC_TYPES,
  PROJECT_ID,
  REQUESTS_BY_SERVICE,
  buildConfig,
  buildNarrowConfig,
  describePhase,
  incidents,
  monitors,
  pods,
  readTable,
  securityEvents,
  traceGroups,
} from "./Boards";

const USER_ID = "40000000-0000-4000-8000-0000000000e4";
const SERVER_KEY = "dashboard-widget-sort-fixture-server";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") === "de" ? "de" : "en";
// ?board=narrow: the second dashboard (Boards.js buildNarrowConfig).
const isNarrowBoard = params.get("board") === "narrow";
// ?titles=long: an incident's title a long sentence (Boards.js incidents).
const hasLongTitles = params.get("titles") === "long";
const BOARD_KEY = isNarrowBoard ? `${SERVER_KEY}-narrow` : SERVER_KEY;

// The fixture's clock: rows are minutes and hours before it.
const NOW = Date.now();

const record = {
  lists: [],
  traceTables: [],
  aggregates: [],
  saves: [],
  unexpected: [],
};

window.__dashboardWidgetSortFixture = record;

function unexpected(call) {
  record.unexpected.push(call);
}

// ---- the fixture's server: the dashboard's stored config, for the tab ------

function storedConfig() {
  try {
    const stored = window.sessionStorage.getItem(BOARD_KEY);

    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Nothing kept: the dashboard as created.
  }

  return isNarrowBoard ? buildNarrowConfig() : buildConfig();
}

function storeConfig(config) {
  window.sessionStorage.setItem(BOARD_KEY, JSON.stringify(config));
}

function idOf(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }

  return value.toString().toLowerCase();
}

// ---- who is signed in: the project's owner ----------------------------------

const heldPermissions = [Permission.ProjectOwner];

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [
  ...heldPermissions,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: heldPermissions.map((permission) => ({
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  })),
});
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [new ObjectID(PROJECT_ID)],
});
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary -------------------------------------------------------

function tableOf(options) {
  return new options.modelType().tableName;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

const TABLES = {
  Monitor: () => monitors(),
  KubernetesResource: () => pods(),
  Incident: () => incidents(NOW, { longTitles: hasLongTitles }),
};

/*
 * Tables the widgets' settings read to offer their choices (statuses,
 * labels, clusters...): answered with none.
 */
const CHOICE_TABLES = [
  "MonitorStatus",
  "Label",
  "IncidentSeverity",
  "IncidentState",
  "KubernetesCluster",
  "Alert",
];

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);

  if (table === "Dashboard" && idOf(options.id) === DASHBOARD_ID) {
    const dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;
    dashboard.projectId = new ObjectID(PROJECT_ID);
    dashboard.name = "Operations wall";
    dashboard.description = "Monitors, pods, incidents and endpoints";
    dashboard.isArchived = false;
    dashboard.dashboardViewConfig = storedConfig();
    return dashboard;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.updateById = async (options) => {
  const table = tableOf(options);

  if (table === "Dashboard" && idOf(options.id) === DASHBOARD_ID) {
    const config = JSON.parse(JSON.stringify(options.data.dashboardViewConfig));

    record.saves.push({ dashboardViewConfig: config });
    storeConfig(config);
    return new HTTPResponse(200, {}, {});
  }

  unexpected(`updateById ${table}`);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const rows = TABLES[table];

  if (rows) {
    const data = readTable({
      rows: rows(),
      query: options.query,
      sort: options.sort,
      limit: options.limit,
    });

    record.lists.push({
      table,
      sort: plain(options.sort),
      phase: describePhase(options.query),
      limit: options.limit,
      select: plain(options.select),
    });

    return { data, count: data.length, skip: 0, limit: options.limit };
  }

  if (table === "MetricType") {
    const data = METRIC_TYPES.map(([name, unit]) => {
      const metricType = new MetricType();
      metricType.name = name;
      metricType.unit = unit;
      return metricType;
    });

    return { data, count: data.length, skip: 0, limit: data.length };
  }

  if (CHOICE_TABLES.includes(table)) {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }

  unexpected(`getList ${table}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.count = async (options) => {
  unexpected(`count ${tableOf(options)}`);
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

// The security events list: ClickHouse, ordered by the read's sort.
AnalyticsModelAPI.getList = async (options) => {
  const table = tableOf(options);

  if (table === "SecurityEventItemV1") {
    const data = readTable({
      rows: securityEvents(NOW),
      query: {},
      sort: options.sort,
      limit: options.limit,
    });

    record.lists.push({
      table: "SecurityEvent",
      sort: plain(options.sort),
      phase: null,
      limit: options.limit,
      select: plain(options.select),
    });

    return { data, count: data.length, skip: 0, limit: options.limit };
  }

  unexpected(`analytics getList ${table}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

AnalyticsModelAPI.count = async (options) => {
  unexpected(`analytics count ${tableOf(options)}`);
  return 0;
};

// The metric table's requests per service, grouped by service.name.
AnalyticsModelAPI.aggregate = async (options) => {
  const aggregateBy = options.aggregateBy || {};
  const keys = aggregateBy.groupByAttributeKeys || [];

  record.aggregates.push({
    metricName: aggregateBy.query && aggregateBy.query.name,
    groupByAttributeKeys: keys,
  });

  const time = new Date(NOW - 30 * 60 * 1000);

  return {
    data: REQUESTS_BY_SERVICE.map(([service, value]) => {
      return {
        timestamp: time,
        value,
        attributes: { "service.name": service },
      };
    }),
  };
};

// The trace table's columns, as the server's ORDER BY reads them.
const TRACE_COLUMN_VALUES = {
  group: (row) => row.groupValues.name,
  count: (row) => row.count,
  errorCount: (row) => row.errorCount,
  avg: (row) => row.avgDurationMs,
  p50: (row) => row.p50DurationMs,
  p90: (row) => row.p90DurationMs,
  p95: (row) => row.p95DurationMs,
  p99: (row) => row.p99DurationMs,
  min: (row) => row.minDurationMs,
  max: (row) => row.maxDurationMs,
};

API.post = async (options) => {
  const url = String(options && options.url);

  if (url.indexOf("/telemetry/traces/analytics") >= 0) {
    const tableSort = options.data && options.data.tableSort;
    const valueOf =
      (tableSort && TRACE_COLUMN_VALUES[tableSort.column]) ||
      TRACE_COLUMN_VALUES.count;
    const direction = tableSort && tableSort.direction === "asc" ? 1 : -1;

    record.traceTables.push({ tableSort: tableSort || null });

    const data = traceGroups().sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);

      if (av === bv) {
        // Busiest first among ties.
        return b.count - a.count;
      }

      return (av < bv ? -1 : 1) * direction;
    });

    return new HTTPResponse(200, { data }, {});
  }

  // The settings' attribute suggestions, loaded in the background.
  if (url.indexOf("/telemetry/metrics/get-attributes") >= 0) {
    return new HTTPResponse(200, { attributes: ["service.name"] }, {});
  }

  if (url.indexOf("/telemetry/traces/get-attributes") >= 0) {
    return new HTTPResponse(200, { attributes: ["http.route"] }, {});
  }

  unexpected(`API.post ${url}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  unexpected(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

// ---- the Dashboard's words --------------------------------------------------

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

// ---- the page ------------------------------------------------------------------

function LayoutShell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <DashboardViewLayout
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

function Page() {
  return (
    <DashboardViewPage
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={project}
      hasPaymentMethod={true}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/dashboards/:id"
        element={<LayoutShell />}
      >
        <PageRoute index element={<Page />} />
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);
