/*
 * The dashboard inside OneUptime, as a signed-in member opens it: the real
 * view layout (Pages/Dashboards/View/Layout) around the real Dashboard page
 * (Pages/Dashboards/View/Index -> Components/Dashboard/DashboardView), with
 * only the data boundary replaced: ModelAPI, AnalyticsModelAPI and API.
 *
 * Every metric read is answered NEWEST bucket first, as the metrics API
 * answers it (Boards.js). A save (Save Changes) is kept for the tab
 * (sessionStorage), so a reload opens what was saved. Steered by the query
 * string, read before the app starts:
 *
 *   - lang=de|fa   the Dashboard's German or Persian (right-to-left) words
 *   - theme=dark   (read by server.js) the dark theme
 *
 * Everything the page asks for is recorded on
 * window.__dashboardTableThresholdsFixture: every metric read with its
 * window and grouping (aggregates), every save (saves), and every read the
 * fixture does not model (unexpected - the suite fails on any).
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
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  CPU_OVER_TIME,
  DASHBOARD_ID,
  HOSTS,
  METRIC_TYPES,
  PROJECT_ID,
  buildConfig,
  pointsFor,
} from "./Boards";

const USER_ID = "40000000-0000-4000-8000-000000005231";

const BOARD_KEY = "dashboard-table-thresholds-fixture-board";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const record = {
  aggregates: [],
  saves: [],
  unexpected: [],
  // What the metric reads are answered with, for the suite to work out each cell.
  readings: { hosts: HOSTS, cpuOverTime: CPU_OVER_TIME },
};

window.__dashboardTableThresholdsFixture = record;

function unexpected(call) {
  record.unexpected.push(call);
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

// The board as last saved in this tab, or as the fixture ships it.
function storedConfig() {
  try {
    const stored = window.sessionStorage.getItem(BOARD_KEY);

    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // A board that cannot be read is the shipped one.
  }

  return buildConfig();
}

function storeConfig(config) {
  window.sessionStorage.setItem(BOARD_KEY, JSON.stringify(config));
}

// ---- who is signed in -------------------------------------------------------

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

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);

  if (table === "Dashboard" && idOf(options.id) === DASHBOARD_ID) {
    const dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;
    dashboard.projectId = new ObjectID(PROJECT_ID);
    dashboard.name = "Fleet health";
    dashboard.description = "CPU, memory and disk, per host";
    dashboard.isArchived = false;
    dashboard.dashboardViewConfig = storedConfig();
    return dashboard;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);

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

function timestampOf(value) {
  return value ? new Date(value).getTime() : null;
}

AnalyticsModelAPI.getList = async (options) => {
  unexpected(`analytics getList ${tableOf(options)}`);
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
  const points = pointsFor({
    start: start || Date.now() - 60 * 60 * 1000,
    end: end || Date.now(),
    metricName,
    groupByAttributeKeys: aggregateBy.groupByAttributeKeys,
  });

  record.aggregates.push({
    start,
    end,
    metricName,
    groupByAttributeKeys: aggregateBy.groupByAttributeKeys || [],
    count: points.length,
  });

  // Newest first, as the metrics API answers.
  return {
    data: points
      .slice()
      .reverse()
      .map((point) => {
        return {
          timestamp: new Date(point.time),
          value: point.value,
          ...(point.attributes ? { attributes: point.attributes } : {}),
        };
      }),
  };
};

API.post = async (options) => {
  const url = String(options && options.url);

  // The editor's attribute suggestions, loaded in the background.
  if (url.indexOf("/telemetry/metrics/get-attributes") >= 0) {
    return new HTTPResponse(200, { attributes: ["host.name"] }, {});
  }

  if (url.indexOf("/telemetry/metrics/get-attribute-values") >= 0) {
    return new HTTPResponse(200, { values: [] }, {});
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
