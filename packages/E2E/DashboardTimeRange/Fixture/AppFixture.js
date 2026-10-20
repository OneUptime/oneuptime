/*
 * The dashboard inside OneUptime, as a signed-in member opens it: the real
 * view layout (Pages/Dashboards/View/Layout - ModelPage's header,
 * breadcrumbs and side menu) around the real Dashboard page
 * (Pages/Dashboards/View/Index -> Components/Dashboard/DashboardView), with
 * only the data boundary replaced: ModelAPI, AnalyticsModelAPI and API.
 *
 * The fixture's server keeps each dashboard's config for the tab
 * (sessionStorage), so Save Changes followed by a reload opens what was
 * saved, as the real API would. Steered by the query string, read before
 * the app starts:
 *
 *   - role=viewer   a member who may read the dashboard but not edit it
 *   - lang=de|ja|fa the Dashboard's German, Japanese or Persian words
 *   - theme=dark    (read by server.js) the dark theme
 *
 * Everything the page asks for is recorded on window.__dashboardTimeRangeFixture:
 * every metric read with the window it asked for (aggregates), every save
 * with the config it wrote (saves), and every read the fixture does not
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
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  METRIC_TYPES,
  PROJECT_ID,
  buildConfig,
  getScenario,
  seriesFor,
} from "./Boards";

const USER_ID = "40000000-0000-4000-8000-0000000000d4";
const SERVER_KEY = "dashboard-time-range-fixture-server";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const record = {
  aggregates: [],
  lists: [],
  saves: [],
  unexpected: [],
};

window.__dashboardTimeRangeFixture = record;

function unexpected(call) {
  record.unexpected.push(call);
}

// ---- the fixture's server: each dashboard's stored config, for the tab ----

function readServer() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SERVER_KEY) || "{}");
  } catch {
    return {};
  }
}

function storedConfigOf(scenario) {
  const server = readServer();

  return server[scenario.id] || buildConfig(scenario);
}

function storeConfig(id, config) {
  const server = readServer();

  server[id] = config;
  window.sessionStorage.setItem(SERVER_KEY, JSON.stringify(server));
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

// ---- who is signed in -------------------------------------------------------

const heldPermissions =
  role === "viewer" ? [Permission.Viewer] : [Permission.ProjectOwner];

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

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);
  const scenario = getScenario(idOf(options.id));

  if (table === "Dashboard" && scenario) {
    const dashboard = new Dashboard();
    dashboard._id = scenario.id;
    dashboard.projectId = new ObjectID(PROJECT_ID);
    dashboard.name = scenario.name;
    dashboard.description = "Requests, latency and errors across the fleet";
    dashboard.isArchived = false;
    dashboard.dashboardViewConfig = storedConfigOf(scenario);
    return dashboard;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.updateById = async (options) => {
  const table = tableOf(options);
  const id = idOf(options.id);

  if (table === "Dashboard" && getScenario(id)) {
    const config = JSON.parse(JSON.stringify(options.data.dashboardViewConfig));

    record.saves.push({ id, dashboardViewConfig: config });
    storeConfig(id, config);
    return new HTTPResponse(200, {}, {});
  }

  unexpected(`updateById ${table}`);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);

  /*
   * The charts mark the incidents and alerts of their window on them: none
   * here.
   */
  if (table === "Incident" || table === "Alert") {
    return { data: [], count: 0, skip: 0, limit: 10 };
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

  unexpected(`getList ${table}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.count = async (options) => {
  unexpected(`count ${tableOf(options)}`);
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

function timestampOf(value) {
  return value ? new Date(value).getTime() : null;
}

/*
 * The template's log stream reads the window's logs: none here. Recorded
 * like the metric reads, with the window it asked for.
 */
AnalyticsModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const time = options.query && options.query.time;

  record.lists.push({
    table,
    start: time && time.startValue ? timestampOf(time.startValue) : null,
    end: time && time.endValue ? timestampOf(time.endValue) : null,
  });

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

  record.aggregates.push({ start, end, metricName });

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

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// ---- the page ------------------------------------------------------------------

/*
 * The dashboard's real view layout around its page, as the Dashboard draws
 * it, once the router's hooks are handed to Navigation (App.tsx does that
 * for every page).
 */
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
