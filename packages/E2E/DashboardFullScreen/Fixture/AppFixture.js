/*
 * A dashboard shown full screen (issue #10409), as a signed-in member opens
 * it: the real Dashboards routes (Routes/DashboardRoutes - the Dashboards
 * list, a dashboard's page with its layout, side menu and breadcrumbs)
 * inside the real master page (Common/UI/Components/MasterPage) with a
 * stand-in header, product bar and footer, a stand-in for the app's own
 * layers beside the routes in its <main> (Ask AI's pill), and the app's
 * notes beside the app in its root (ToastRegion) - the shape src/Index.tsx
 * and App.tsx draw. Only the data boundary is replaced: ModelAPI,
 * AnalyticsModelAPI and API.
 *
 * The fixture keeps each dashboard's saved config for the browser
 * (localStorage), so a save followed by a reload, or a new tab, shows what
 * was saved. Steered by the query string, read before the app starts:
 *
 *   - role=viewer    a Viewer: reads every dashboard, edits none
 *   - lang=de|ja|fa  the Dashboard's German, Japanese or Persian words
 *   - theme=dark     (read by server.js) the dark theme
 *
 * Everything the pages ask for is recorded on window.__dashboardFullScreenFixture:
 * each read of a dashboard, each metric read with the window it asked for,
 * each save with the config it wrote, and every read the fixture does not
 * model (unexpected - the suite fails on any).
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import DashboardRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/DashboardRoutes";
import MasterPage from "Common/UI/Components/MasterPage/MasterPage";
import ToastRegion from "Common/UI/Components/Toast/ToastRegion";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import {
  DASHBOARDS,
  METRIC_TYPES,
  PROJECT_ID,
  buildConfig,
  getDashboardById,
  seriesFor,
} from "./Boards";

const USER_ID = "40000000-0000-4000-8000-0000000000f4";
const SERVER_KEY = "dashboard-full-screen-fixture-server";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const record = {
  dashboardReads: [],
  dashboardLists: 0,
  aggregates: [],
  saves: [],
  unexpected: [],
};

window.__dashboardFullScreenFixture = { record };

function unexpected(call) {
  record.unexpected.push(call);
}

// ---- the fixture's server: each dashboard's saved config, for the browser ----

function readServer() {
  try {
    return JSON.parse(window.localStorage.getItem(SERVER_KEY) || "{}");
  } catch {
    return {};
  }
}

function storedConfigOf(dashboard) {
  return readServer()[dashboard.id] || buildConfig(dashboard);
}

function storeConfig(id, config) {
  const server = readServer();

  server[id] = config;
  window.localStorage.setItem(SERVER_KEY, JSON.stringify(server));
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

function toDashboard(stored) {
  const dashboard = new Dashboard();
  dashboard._id = stored.id;
  dashboard.id = new ObjectID(stored.id);
  dashboard.projectId = new ObjectID(PROJECT_ID);
  dashboard.name = stored.name;
  dashboard.description = stored.description;
  dashboard.isArchived = false;
  dashboard.labels = [];
  return dashboard;
}

// ---- who is signed in -------------------------------------------------------

const heldPermissions =
  role === "viewer" ? [Permission.Viewer] : [Permission.ProjectOwner];

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
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
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary -------------------------------------------------------

function tableOf(options) {
  return new options.modelType().tableName;
}

// Tables the pages read that hold nothing here: saved views, owners and the like.
const EMPTY_TABLES = [
  "TableView",
  "Incident",
  "Alert",
  "Label",
  "DashboardOwnerUser",
  "DashboardOwnerTeam",
];

function sorted(items, sort) {
  const [column, direction] = Object.entries(sort || {})[0] || [];

  if (!column) {
    return items;
  }

  const sign = direction === SortOrder.Descending ? -1 : 1;

  return [...items].sort((first, second) => {
    return (
      String(first[column] ?? "").localeCompare(String(second[column] ?? "")) *
      sign
    );
  });
}

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);
  const id = idOf(options.id);

  if (table === "Dashboard") {
    record.dashboardReads.push({ id, at: Date.now() });

    const stored = getDashboardById(id);

    if (!stored) {
      return null;
    }

    const dashboard = toDashboard(stored);
    dashboard.dashboardViewConfig = storedConfigOf(stored);
    return dashboard;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  if (table === "Dashboard") {
    record.dashboardLists++;

    const data = sorted(Object.values(DASHBOARDS).map(toDashboard), options.sort);

    return {
      data: data.slice(skip, skip + limit),
      count: data.length,
      skip,
      limit,
    };
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

  if (EMPTY_TABLES.includes(table)) {
    return { data: [], count: 0, skip, limit };
  }

  unexpected(`getList ${table}`);
  return { data: [], count: 0, skip, limit };
};

ModelAPI.count = async (options) => {
  const table = tableOf(options);

  if (table === "Dashboard") {
    return Object.keys(DASHBOARDS).length;
  }

  if (EMPTY_TABLES.includes(table)) {
    return 0;
  }

  unexpected(`count ${table}`);
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.updateById = async (options) => {
  const table = tableOf(options);
  const id = idOf(options.id);

  if (table === "Dashboard" && getDashboardById(id)) {
    const config = JSON.parse(JSON.stringify(options.data.dashboardViewConfig));

    record.saves.push({ id, dashboardViewConfig: config, at: Date.now() });
    storeConfig(id, config);
    return new HTTPResponse(200, {}, {});
  }

  unexpected(`updateById ${table}`);
  return new HTTPResponse(200, {}, {});
};

function timestampOf(value) {
  return value ? new Date(value).getTime() : null;
}

// The template's log stream reads the window's logs: none here.
AnalyticsModelAPI.getList = async () => {
  return { data: [], count: 0, skip: 0, limit: 10 };
};

AnalyticsModelAPI.count = async (options) => {
  unexpected(`analytics count ${tableOf(options)}`);
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const aggregateBy = options.aggregateBy || {};
  const start = timestampOf(aggregateBy.startTimestamp);
  const end = timestampOf(aggregateBy.endTimestamp);
  const metricName =
    (aggregateBy.query && aggregateBy.query.name) || "unknown.metric";

  record.aggregates.push({ metricName, start, end, at: Date.now() });

  return {
    data: seriesFor({
      start: start || Date.now() - 60 * 60 * 1000,
      end: end || Date.now(),
      metricName,
      aggregationInterval: aggregateBy.aggregationInterval,
    }),
  };
};

API.post = async (options) => {
  const url = String(options && options.url);

  // The editor's attribute suggestions, loaded in the background.
  if (url.indexOf("/telemetry/metrics/get-attributes") >= 0) {
    return new HTTPResponse(
      200,
      { attributes: ["service.name", "http.route"] },
      {},
    );
  }

  // The template's `service` variable's picker.
  if (url.indexOf("/telemetry/metrics/get-attribute-values") >= 0) {
    return new HTTPResponse(
      200,
      { values: ["checkout", "payments", "search"] },
      {},
    );
  }

  unexpected(`API.post ${url}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  unexpected(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

// ---- the Dashboard's words --------------------------------------------------

/*
 * English, the fallback, is in the bundle; German, Japanese and Persian are
 * each a chunk of its own, loaded only by a page drawn in that language, as
 * the Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as
 * the Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  ja: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/ja.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// ---- the page ------------------------------------------------------------------

/*
 * What the app draws beside the page in its <main>, over every page: Ask
 * AI's pill, at the window's end, as App.tsx's AskAiPanel draws it. A
 * dashboard shown full screen covers it, but never puts it out of reach.
 */
function AppLayerStandIn() {
  return (
    <div
      className="fixed end-4 top-20 z-[25] rounded-full bg-white p-1 shadow-lg ring-1 ring-black/5"
      data-testid="fixture-app-layer"
    >
      <button
        type="button"
        className="rounded-full px-3 py-1 text-xs font-medium text-gray-700"
      >
        Ask AI
      </button>
    </div>
  );
}

/*
 * The Dashboards routes as App.tsx mounts them, inside the master page, once
 * the router's hooks are handed to Navigation. The header, the product bar
 * and the footer are stand-ins: a dashboard shown full screen covers them
 * and puts them out of reach.
 */
function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <MasterPage
      isLoading={false}
      error=""
      className="flex flex-col min-h-screen"
      header={
        <header
          className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-6 text-sm font-semibold text-gray-800"
          data-testid="fixture-app-header"
        >
          <a href={`/dashboard/${PROJECT_ID}/dashboards`}>OneUptime</a>
        </header>
      }
      navBar={
        <nav
          aria-label="Products"
          className="flex h-11 items-center gap-6 border-b border-gray-200 bg-white px-6 text-sm text-gray-600"
          data-testid="fixture-app-nav"
        >
          <a href={`/dashboard/${PROJECT_ID}/dashboards`}>Dashboards</a>
          <a href={`/dashboard/${PROJECT_ID}/dashboards/playlists`}>
            Playlists
          </a>
        </nav>
      }
      footer={
        <footer
          className="px-6 py-4 text-xs text-gray-500"
          data-testid="fixture-app-footer"
        >
          <a href="#docs">Documentation</a>
        </footer>
      }
    >
      <AppLayerStandIn />
      <DashboardRoutes
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MasterPage>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters). The notes
 * are drawn beside the app, in its root, as its root draws them.
 */
createRoot(document.getElementById("root")).render(
  <>
    <BrowserRouter useTransitions={false}>
      <Routes>
        <PageRoute
          path="/dashboard/:projectId/dashboards/*"
          element={<Shell />}
        />
      </Routes>
    </BrowserRouter>
    <ToastRegion />
  </>,
);
