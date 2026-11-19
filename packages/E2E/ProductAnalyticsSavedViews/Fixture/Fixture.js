/*
 * Saved funnels and retention tables (issue #6718), end to end in a real
 * browser: a RUM application's Funnels and User Retention pages in their
 * production layout (Pages/Rum/View/Layout), and a dashboard inside
 * OneUptime (Pages/Dashboards/View/Layout around the real Dashboard page)
 * that a saved funnel is put on as a Funnel widget. Only the data boundary
 * is replaced - ModelAPI, AnalyticsModelAPI and API - and the signed-in
 * user, a project owner.
 *
 * The saved views and the board live in the tab (sessionStorage), so a save
 * followed by a reload, or a link opened in the same tab, finds what was
 * saved, as the server would. Steered by the query string:
 *
 *   - lang=de, lang=fa  the Dashboard's German or Persian words (Persian
 *                       read right to left)
 *   - theme=dark        (read by server.js) the dark theme
 *   - cohorts=1         the retention read answers one cohort, not three
 *
 * Every read is recorded on window.__productAnalyticsSavedViewsFixture: the
 * funnel and retention reads with what they asked for (reads), and every
 * read the fixture does not model (unexpected).
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import RumLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Layout";
import FunnelsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsFunnels";
import RetentionPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsRetention";
import DashboardViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Layout";
import DashboardViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Index";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Project from "Common/Models/DatabaseModels/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import ToastRegion from "Common/UI/Components/Toast/ToastRegion";
import UserUtil from "Common/UI/Utils/User";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const PROJECT_ID = "10000000-0000-4000-8000-00000000a718";
const APP_ID = "20000000-0000-4000-8000-00000000a718";
const DASHBOARD_ID = "30000000-0000-4000-8000-00000000a718";
const USER_ID = "40000000-0000-4000-8000-00000000a718";
const STORE_KEY = "product-analytics-saved-views-fixture";
const DAY_MS = 24 * 60 * 60 * 1000;

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const oneCohort = params.get("cohorts") === "1";

const record = { reads: [], unexpected: [] };
window.__productAnalyticsSavedViewsFixture = record;

function unexpected(call) {
  record.unexpected.push(call);
}

// ---- the server's records, kept for the tab ---------------------------------

function readStore() {
  try {
    const stored = window.sessionStorage.getItem(STORE_KEY);

    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Nothing kept: nothing saved yet.
  }

  return { views: [], board: null, created: 0 };
}

function writeStore(store) {
  window.sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
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

function tableOf(options) {
  return new options.modelType().tableName;
}

// A saved view's row as the model the pages read.
function toSavedView(row) {
  const view = new RumProductAnalyticsSavedView();
  view._id = row.id;
  view.projectId = new ObjectID(PROJECT_ID);
  view.rumApplicationId = new ObjectID(row.rumApplicationId);
  view.name = row.name;
  view.viewType = row.viewType;
  view.definition = JSON.parse(JSON.stringify(row.definition));
  return view;
}

// ---- who is signed in: the project's owner ----------------------------------

const heldPermissions = [Permission.ProjectOwner];

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme Shop";

const application = new RumApplication();
application._id = APP_ID;
application.projectId = new ObjectID(PROJECT_ID);
application.name = "Storefront Web";
application.appIdentifier = "storefront-web";
application.isSessionReplayEnabled = true;
application.isProductAnalyticsEnabled = true;

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
  globalPermissions: [Permission.Public, Permission.User, Permission.CurrentUser],
  projectIds: [new ObjectID(PROJECT_ID)],
});
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary -------------------------------------------------------

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);

  if (table === "Project") {
    return project;
  }

  if (table === "RumApplication") {
    return application;
  }

  if (table === "RumProductAnalyticsSavedView") {
    const row = readStore().views.find((view) => {
      return view.id === idOf(options.id);
    });

    // A deleted one, as the server answers it: nothing.
    return row ? toSavedView(row) : null;
  }

  if (table === "Dashboard" && idOf(options.id) === DASHBOARD_ID) {
    const dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;
    dashboard.projectId = new ObjectID(PROJECT_ID);
    dashboard.name = "Growth";
    dashboard.description = "Sign-ups and checkout";
    dashboard.isArchived = false;
    dashboard.dashboardViewConfig = readStore().board || {
      _type: "DashboardViewConfig",
      components: [],
      heightInDashboardUnits: 20,
    };
    return dashboard;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const query = options.query || {};

  if (table === "RumProductAnalyticsSavedView") {
    const views = readStore()
      .views.filter((view) => {
        return (
          (!query.viewType || view.viewType === query.viewType) &&
          (!query.rumApplicationId ||
            view.rumApplicationId === idOf(query.rumApplicationId))
        );
      })
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      })
      .map(toSavedView);

    return { data: views, count: views.length, skip: 0, limit: 100 };
  }

  if (table === "RumApplication") {
    return { data: [application], count: 1, skip: 0, limit: 100 };
  }

  // The other choices a page offers (labels, owners...): none.
  return { data: [], count: 0, skip: 0, limit: 10 };
};

// Save funnel / Save retention table (Create), and Edit, which renames one.
ModelAPI.createOrUpdate = async (options) => {
  const table = tableOf(options);

  if (table !== "RumProductAnalyticsSavedView") {
    unexpected(`createOrUpdate ${table}`);
    return new HTTPResponse(200, {}, {});
  }

  const store = readStore();
  const model = options.model;

  if (options.formType === FormType.Create) {
    store.created += 1;
    const row = {
      id: `50000000-0000-4000-8000-${String(store.created).padStart(12, "0")}`,
      name: model.name,
      rumApplicationId: idOf(model.rumApplicationId) || APP_ID,
      viewType: model.viewType,
      definition: JSON.parse(JSON.stringify(model.definition || {})),
    };
    store.views.push(row);
    writeStore(store);

    const response = new HTTPResponse(200, {}, {});
    response.data = toSavedView(row);
    return response;
  }

  const row = store.views.find((view) => {
    return view.id === idOf(model._id);
  });

  if (row && typeof model.name === "string") {
    row.name = model.name;
  }

  writeStore(store);

  const response = new HTTPResponse(200, {}, {});
  response.data = row ? toSavedView(row) : model;
  return response;
};

// Update: a saved view keeps what the page shows; Save Changes keeps a board.
ModelAPI.updateById = async (options) => {
  const table = tableOf(options);
  const store = readStore();

  if (table === "RumProductAnalyticsSavedView") {
    const row = store.views.find((view) => {
      return view.id === idOf(options.id);
    });

    if (row && options.data.definition) {
      row.definition = JSON.parse(JSON.stringify(options.data.definition));
    }

    if (row && typeof options.data.name === "string") {
      row.name = options.data.name;
    }

    writeStore(store);
    return new HTTPResponse(200, {}, {});
  }

  if (table === "Dashboard" && idOf(options.id) === DASHBOARD_ID) {
    store.board = JSON.parse(JSON.stringify(options.data.dashboardViewConfig));
    writeStore(store);
    return new HTTPResponse(200, {}, {});
  }

  unexpected(`updateById ${table}`);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (options) => {
  const table = tableOf(options);

  if (table === "RumProductAnalyticsSavedView") {
    const store = readStore();
    store.views = store.views.filter((view) => {
      return view.id !== idOf(options.id);
    });
    writeStore(store);
    return;
  }

  unexpected(`deleteItem ${table}`);
};

ModelAPI.count = async () => {
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

AnalyticsModelAPI.getList = async (options) => {
  unexpected(`analytics getList ${tableOf(options)}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

// ---- the product analytics reads ---------------------------------------------

// The application's events, the most frequent first.
const EVENT_NAMES = {
  events: [
    { kind: "session", name: "", events: 1800, users: 1000, lastSeenAt: 1 },
    { kind: "page", name: "/pricing", events: 900, users: 610, lastSeenAt: 1 },
    { kind: "custom", name: "Signed up", events: 480, users: 420, lastSeenAt: 1 },
    { kind: "custom", name: "Purchased", events: 160, users: 120, lastSeenAt: 1 },
  ],
  hasMore: false,
  dataStartedAt: Date.now() - 200 * DAY_MS,
};

// Of 1,000 people at the first step, these many reached each next one.
const STEP_PEOPLE = [1000, 420, 120, 60, 30, 10];

function funnelAnswer(data) {
  const steps = Array.isArray(data.steps) ? data.steps : [];

  return {
    windowMs: data.windowMs || DAY_MS,
    steps: steps.map((step, index) => {
      const people = STEP_PEOPLE[index] || 1;
      const previous = index === 0 ? people : STEP_PEOPLE[index - 1];

      return {
        kind: step.kind,
        name: step.name,
        people: people,
        conversionFromStart: people / STEP_PEOPLE[0],
        conversionFromPrevious: index === 0 ? 1 : people / previous,
        droppedOff: index === 0 ? 0 : previous - people,
        medianMsFromPrevious: index === 0 ? null : 90 * 1000 * index,
      };
    }),
  };
}

function retentionAnswer(data) {
  const cohorts = [
    { start: "2026-10-05", people: 200, returning: [200, 90, 40, 20] },
    { start: "2026-10-12", people: 100, returning: [100, 30, 10, null] },
    { start: "2026-10-19", people: 50, returning: [50, 0, null, null] },
  ];

  return {
    period: data.period || "week",
    timeZone: "UTC",
    cohorts: oneCohort ? cohorts.slice(0, 1) : cohorts,
  };
}

API.post = async (options) => {
  const url = String(options && options.url);
  const data = (options && options.data) || {};
  const route = url.slice(url.lastIndexOf("/") + 1);

  if (url.indexOf("/telemetry/rum/product-analytics/") >= 0) {
    record.reads.push({ route: route, data: JSON.parse(JSON.stringify(data)) });

    if (route === "event-names") {
      return new HTTPResponse(200, EVENT_NAMES, {});
    }

    if (route === "event-properties") {
      return new HTTPResponse(
        200,
        { propertyKeys: ["plan"], userPropertyKeys: [] },
        {},
      );
    }

    if (route === "funnel") {
      return new HTTPResponse(200, funnelAnswer(data), {});
    }

    if (route === "retention") {
      return new HTTPResponse(200, retentionAnswer(data), {});
    }
  }

  /*
   * The widget settings' attribute suggestions, loaded in the background
   * whatever the widget: none.
   */
  if (/\/telemetry\/[a-z]+\/get-attributes$/.test(url)) {
    return new HTTPResponse(200, { attributes: [] }, {});
  }

  unexpected(`API.post ${url}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  unexpected(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

window.__productAnalyticsSavedViewsFixture.ids = {
  projectId: PROJECT_ID,
  appId: APP_ID,
  dashboardId: DASHBOARD_ID,
};

// ---- the Dashboard's words --------------------------------------------------

/*
 * English, the fallback, is in the bundle; German and Persian are chunks of
 * their own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (SuiteHelpers/FixtureLocales).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
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
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
document.documentElement.lang = language;
// Persian reads right to left, as the Dashboard sets it (Common/UI/Utils/PageLanguage).
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// ---- the pages ------------------------------------------------------------------

function RumShell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <RumLayout />;
}

function RumPage(props) {
  const Page = props.page;

  return (
    <Page
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={project}
      hasPaymentMethod={true}
    />
  );
}

function DashboardShell() {
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

function DashboardPage() {
  return (
    <DashboardViewPage
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={project}
      hasPaymentMethod={true}
    />
  );
}

// Anywhere else the menus lead: a page that says only where it is.
function ElsewherePage() {
  const location = useLocation();

  return (
    <p data-testid="fixture-elsewhere" className="p-6 text-sm text-gray-700">
      {location.pathname}
    </p>
  );
}

function ElsewhereShell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <ElsewherePage />;
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <>
    <BrowserRouter useTransitions={false}>
      <Routes>
        <PageRoute path="/dashboard/:projectId/rum/:id" element={<RumShell />}>
          <PageRoute
            path="product-analytics-funnels"
            element={<RumPage page={FunnelsPage} />}
          />
          <PageRoute
            path="product-analytics-retention"
            element={<RumPage page={RetentionPage} />}
          />
          <PageRoute path="*" element={<ElsewherePage />} />
        </PageRoute>
        <PageRoute
          path="/dashboard/:projectId/dashboards/:id"
          element={<DashboardShell />}
        >
          <PageRoute index element={<DashboardPage />} />
          <PageRoute path="*" element={<ElsewherePage />} />
        </PageRoute>
        <PageRoute path="*" element={<ElsewhereShell />} />
      </Routes>
    </BrowserRouter>
    <ToastRegion />
  </>,
);
