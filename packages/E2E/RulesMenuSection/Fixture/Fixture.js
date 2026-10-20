/*
 * Offline fixture for the side menus of a status page and an SLO, around
 * their real view layouts:
 *
 *   - Pages/StatusPages/View/Layout: ModelPage's header and breadcrumbs, the
 *     archived banner, and the status page's side menu, whose Rules section
 *     holds Monitor Rules;
 *   - Pages/Slo/View/Layout: the same for an SLO, whose Rules section holds
 *     Monitor Rules and Burn Rate Rules.
 *
 * Each layout is one route the pages are children of, so it stays mounted
 * while the pages change, as in the Dashboard: a section someone opened
 * stays open from page to page. The pages inside are stand-ins that name
 * the page they stand for - this suite is about the menu beside them.
 *
 * Only the ModelAPI / API data boundary and the signed-in user are
 * replaced. Steered by the query string:
 *   - groups=1     the project has monitor groups on: a status page's
 *                  resources entry reads Resources rather than Monitors
 *   - lang=de      the Dashboard's German words
 *   - theme=dark   dark mode
 *
 * Every read the fixture does not model is recorded on
 * window.__rulesMenuFixture.unhandled, which the spec holds to empty: the
 * menus must not start asking for more than their badges and the record's
 * name without the fixture (and this note) saying so.
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
import StatusPageViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Layout";
import SloViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Layout";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_ID = "20000000-0000-4000-8000-0000000000f2";
const SLO_ID = "30000000-0000-4000-8000-0000000000f3";
const USER_ID = "40000000-0000-4000-8000-0000000000f4";

const params = new URLSearchParams(window.location.search);
const monitorGroupsOn = params.get("groups") === "1";
const language = params.get("lang") === "de" ? "de" : "en";

window.__rulesMenuFixture = { unhandled: [] };

function unhandled(call, detail) {
  window.__rulesMenuFixture.unhandled.push({ call, detail });
}

// ---- who is signed in, in which project --------------------------------------

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: [
    {
      _type: "UserPermission",
      permission: Permission.ProjectOwner,
      labelIds: [],
    },
  ],
  isBlockPermission: false,
});

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";
project.isFeatureFlagMonitorGroupsEnabled = monitorGroupsOn;

ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the records -------------------------------------------------------------

const statusPage = new StatusPage();
statusPage._id = STATUS_PAGE_ID;
statusPage.name = "Acme Public Status";

const slo = new ServiceLevelObjective();
slo._id = SLO_ID;
slo.name = "Checkout availability";

function state(model, id, name, order, isResolvedState) {
  const record = new model();
  record._id = id;
  record.name = name;
  record.order = order;
  record.isResolvedState = isResolvedState;
  return record;
}

// What the SLO menu's Incidents and Alerts badges count as still open.
const incidentStates = [
  state(
    IncidentState,
    "50000000-0000-4000-8000-0000000000f5",
    "Identified",
    1,
    false,
  ),
  state(
    IncidentState,
    "50000000-0000-4000-8000-0000000000f6",
    "Acknowledged",
    2,
    false,
  ),
  state(
    IncidentState,
    "50000000-0000-4000-8000-0000000000f7",
    "Resolved",
    3,
    true,
  ),
];
const alertStates = [
  state(
    AlertState,
    "60000000-0000-4000-8000-0000000000f8",
    "Identified",
    1,
    false,
  ),
  state(
    AlertState,
    "60000000-0000-4000-8000-0000000000f9",
    "Acknowledged",
    2,
    false,
  ),
  state(
    AlertState,
    "60000000-0000-4000-8000-0000000000fa",
    "Resolved",
    3,
    true,
  ),
];

// ---- the data boundary -------------------------------------------------------

function tableOf(options) {
  return new options.modelType().tableName;
}

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);

  // The layout's header and the archived banner read the record they show.
  if (table === "StatusPage") {
    return Object.assign(new StatusPage(), statusPage);
  }

  if (table === "ServiceLevelObjective") {
    return Object.assign(new ServiceLevelObjective(), slo);
  }

  unhandled("getItem", table);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  const itemsByTable = {
    IncidentState: incidentStates,
    AlertState: alertStates,
  };
  const items = itemsByTable[table];

  if (!items) {
    unhandled("getList", table);
  }

  const data = items || [];

  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip,
    limit,
  };
};

// The SLO menu's badges: one incident still open, no alert.
ModelAPI.count = async (options) => {
  const table = tableOf(options);

  if (table === "Incident") {
    return 1;
  }

  if (table === "Alert") {
    return 0;
  }

  unhandled("count", table);
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

API.get = async (options) => {
  unhandled("API.get", String(options?.url || options));
  return new HTTPResponse(200, {}, {});
};
API.post = async (options) => {
  unhandled("API.post", String(options?.url || options));
  return new HTTPResponse(200, {}, {});
};

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

// ---- the pages ---------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleCase(segment) {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => {
      return word.slice(0, 1).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/*
 * What a stand-in page is called: the Overview at the record's own address,
 * one rule on a rule's own page, and otherwise the page's last segment
 * (monitor-rules: Monitor Rules).
 */
function standInTitle(pathname, recordId) {
  const segments = pathname.split("/").filter(Boolean);
  const below = segments.slice(segments.indexOf(recordId) + 1);

  if (below.length === 0) {
    return "Overview";
  }

  const last = below[below.length - 1];

  if (UUID.test(last)) {
    return `One of the ${titleCase(below[below.length - 2] || "")}`;
  }

  return titleCase(last);
}

function StandInPage(props) {
  const location = useLocation();

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      data-testid="fixture-page"
    >
      <h2 className="text-base font-semibold text-gray-900">
        {standInTitle(location.pathname, props.recordId)}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        A stand-in for the page: this fixture draws the side menu beside it.
      </p>
    </div>
  );
}

/*
 * The record's real view layout around the page, as the Dashboard draws
 * it. One route the pages are children of, so it stays mounted.
 */
function LayoutShell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Layout = props.layout;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      <Layout
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/status-pages/:id"
        element={<LayoutShell layout={StatusPageViewLayout} />}
      >
        <PageRoute index element={<StandInPage recordId={STATUS_PAGE_ID} />} />
        <PageRoute
          path="*"
          element={<StandInPage recordId={STATUS_PAGE_ID} />}
        />
      </PageRoute>
      <PageRoute
        path="/dashboard/:projectId/slos/:id"
        element={<LayoutShell layout={SloViewLayout} />}
      >
        <PageRoute index element={<StandInPage recordId={SLO_ID} />} />
        <PageRoute path="*" element={<StandInPage recordId={SLO_ID} />} />
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);
