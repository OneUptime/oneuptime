/*
 * Offline fixture for the Security Events pages of a project that has not
 * sent or connected anything yet.
 *
 * The Security Events Layout (Page, breadcrumbs, nav tabs), the Security
 * Events page (SecurityEventsViewer inside TelemetryViewer), the
 * Connections page (SecurityEventConnectionsTable inside ModelTable) and the
 * Add connection form are the production components from this branch,
 * mounted under their real RouteMap patterns. Only the data boundary
 * (ModelAPI / AnalyticsModelAPI / API) and the signed-in user are replaced:
 * every table answers empty, so both pages show their empty state.
 *
 * Scenarios, parsed once per page load:
 *
 *   ?role=   owner (default) | viewer. A viewer holds Security Viewer only:
 *            it can read connections but not create them, so Add connection
 *            is disabled and says which permission is missing.
 *   ?theme=  dark adds html.dark (handled by server.js).
 *   ?latest= none (default) | pending | old. Once its time window comes
 *            back empty, the Security Events page looks up the project's
 *            newest event (one row, no time window) to tell "nothing ever
 *            arrived" from "nothing in this window".
 *            none: there is no event at all, so the page shows its empty
 *            state. pending: that lookup does not answer until the spec
 *            calls window.__securityEventsEmptyStatesFixture
 *            .resolveLatestEvent(). old: the newest event arrived at
 *            OLD_EVENT_TIME, outside the default one-day window.
 *
 * Every read is recorded on window.__securityEventsEmptyStatesFixture:
 * listRequests (analytics lists carry analytics: true), countRequests,
 * aggregateRequests, apiRequests, creates, and unhandled: anything the
 * fixture does not model (a model table, an analytics query or an API URL).
 * The spec asserts `unhandled` is empty.
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
import SecurityEventsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Layout";
import SecurityEventsPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Index";
import SecurityEventsConnectionsPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Connections";
import RouteMap, {
  SecurityEventsRoutePath,
} from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import Service from "Common/Models/DatabaseModels/Service";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const rolePermissions =
  role === "viewer" ? [Permission.SecurityViewer] : [Permission.ProjectOwner];
const latest = ["pending", "old"].includes(params.get("latest"))
  ? params.get("latest")
  : "none";
// ?latest=old: well before the spec's pinned clock (2026-09-22T12:00:00Z).
const OLD_EVENT_TIME = "2026-09-01T09:30:00.000Z";

let releaseLatestEvent = () => {};
const latestEventReleased = new Promise((resolve) => {
  releaseLatestEvent = resolve;
});

const fixture = {
  role,
  latest,
  listRequests: [],
  countRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  creates: [],
  unhandled: [],
  // ?latest=pending: answer the newest-event lookup now.
  resolveLatestEvent: () => {
    releaseLatestEvent();
  },
};
window.__securityEventsEmptyStatesFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

// The tables the two pages read. Every one of them is empty.
const MODEL_TABLES = [tableName(SecurityEventConnection), tableName(Service)];
const ANALYTICS_TABLES = [tableName(SecurityEvent)];

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(USER_ID);
};
UserUtil.getName = () => {
  return "Maya Chen";
};
UserUtil.getEmail = () => {
  return "maya.chen@acme-commerce.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};
AnalyticsModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getItem = async (options) => {
  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    skip,
    limit,
  });
  if (!MODEL_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "getList", modelName });
  }
  return { data: [], count: 0, skip, limit };
};

ModelAPI.getCount = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });
  if (!MODEL_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "getCount", modelName });
  }
  return 0;
};

ModelAPI.create = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.creates.push({ modelName, data: serialize(options.model) });
  fixture.unhandled.push({ kind: "create", modelName });
  return { data: options.model, miscData: {} };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    analytics: true,
    query: serialize(options.query),
    skip,
    limit,
  });
  if (!ANALYTICS_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "analytics.getList", modelName });
  }
  // The newest-event lookup: one row, no time window (see ?latest=).
  const isLatestEventLookup =
    modelName === tableName(SecurityEvent) &&
    limit === 1 &&
    !(options.query && options.query.time);
  if (isLatestEventLookup && latest === "pending") {
    await latestEventReleased;
  }
  if (isLatestEventLookup && latest === "old") {
    return { data: [{ time: new Date(OLD_EVENT_TIME) }], count: 1, skip, limit };
  }
  return { data: [], count: 0, skip, limit };
};

AnalyticsModelAPI.count = async (modelType, query) => {
  const modelName = tableName(modelType);
  fixture.countRequests.push({
    modelName,
    analytics: true,
    query: serialize(query),
  });
  if (!ANALYTICS_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "analytics.count", modelName });
  }
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.aggregateRequests.push({
    modelName,
    aggregateBy: serialize(options.aggregateBy),
  });
  if (!ANALYTICS_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "analytics.aggregate", modelName });
  }
  return { data: [] };
};

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url, body: serialize(options.data) });
  const parsed = new window.URL(url);

  // The search bar's attribute-key completion: nothing has been seen yet.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/security-events/get-attributes")
  ) {
    return new HTTPResponse(200, { attributes: [] }, {});
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return new HTTPResponse(200, { data: [], count: 0 }, {});
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

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function StubPage(props) {
  const location = useLocation();
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-8 py-12">
      <h2 className="text-xl font-semibold text-gray-900">{props.title}</h2>
      <p
        data-testid="stub-page"
        data-page={props.pageKey}
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </div>
  );
}

// Every other Security Events tab: the empty states link to some of them.
const STUB_TABS = [
  [PageMap.SECURITY_EVENTS_CORRELATE, "Correlate"],
  [PageMap.SECURITY_EVENTS_DETECTION_RULES, "Detection Rules"],
  [PageMap.SECURITY_EVENTS_MONITORS, "Monitors"],
  [PageMap.SECURITY_EVENTS_THREAT_INTEL, "Threat Intel"],
  [PageMap.SECURITY_EVENTS_DOCUMENTATION, "Documentation"],
];

function FixtureLayout() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <SecurityEventsLayout {...pageProps(undefined)} />;
}

/*
 * Like the dashboard's App, this reads the location on every navigation so
 * Navigation always knows the current route.
 */
function FixtureApp() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);

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
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Routes>
          <Route
            path={RouteMap[PageMap.SECURITY_EVENTS].toString()}
            element={<FixtureLayout />}
          >
            <Route
              index
              element={
                <SecurityEventsPage {...pageProps(PageMap.SECURITY_EVENTS)} />
              }
            />
            <Route
              path={SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CONNECTIONS]}
              element={
                <SecurityEventsConnectionsPage
                  {...pageProps(PageMap.SECURITY_EVENTS_CONNECTIONS)}
                />
              }
            />
            {STUB_TABS.map(([pageKey, title]) => {
              return (
                <Route
                  key={pageKey}
                  path={SecurityEventsRoutePath[pageKey]}
                  element={<StubPage pageKey={pageKey} title={title} />}
                />
              );
            })}
          </Route>
          <Route
            path="*"
            element={<StubPage pageKey="unknown" title="Not modelled" />}
          />
        </Routes>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
