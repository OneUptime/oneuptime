/*
 * Offline fixture for Metrics' real AI tab, and its Insights tab.
 *
 * Metrics' layout (Pages/Metrics/Layout, its tabs and breadcrumbs) and its
 * AI section (Pages/Metrics/AI: the side menu, Insights, a finding's page
 * with Fix with AI, Logs and Settings) are the production components from
 * this branch. Only the ModelAPI / AnalyticsModelAPI / API data boundary and
 * the synthetic user are replaced - by MetricFindings.js, which answers the
 * pages' reads the way the server does: OneUptime has found four problems
 * in the project's metrics - checkout's request counter records its users'
 * ids (no fix yet), checkout's request duration histogram puts nearly all
 * its values in its smallest bucket (a pull request OneUptime opened on its
 * own), worker's metric names carry job ids, and payments sends traces but
 * no metrics.
 *
 * The Insights tab (Pages/Metrics/List: the services reporting metrics, a
 * card each) reads services, metric types and metric points, answered by
 * MetricsInsights.js.
 *
 * Scenarios are picked with query parameters (see MetricFindings.js and
 * MetricsInsights.js), and ?theme=dark is read by server.js. Every read and
 * write is recorded on window.__metricsAiFixture so a spec can check what
 * the page asked for.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import MetricsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/Layout";
import MetricsAILayout from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/Layout";
import MetricsAIInsights from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/Insights";
import MetricsAIInsightView from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/InsightView";
import MetricsAILogs from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/Logs";
import MetricsAISettings from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/Settings";
import MetricsInsightsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Metrics/List";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Project from "Common/Models/DatabaseModels/Project";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import {
  AI_TASK_IDS,
  SERVICE_IDS,
  SERVICE_NAMES,
  aiInsights,
  aiLogs,
  aiProject,
  aiProviders,
  aiReadiness,
  aiRules,
  filterInsights,
  fixSuggestion,
  saveProjectSwitches,
} from "./MetricFindings";
import {
  insightsMetricTypes,
  insightsMetrics,
  insightsServices,
} from "./MetricsInsights";

const params = new URLSearchParams(window.location.search);
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const failures = new Set(
  (params.get("fail") || "").split(",").filter((value) => value.length > 0),
);

/*
 * Every time is relative to page load. The spec pins the browser clock, so
 * "4 minutes ago" stays deterministic.
 */
const NOW = Date.now();

const SERVICES = Object.values(SERVICE_IDS).map((id) => {
  return { id, name: SERVICE_NAMES[id] };
});

const fixture = {
  apiRequests: [],
  modelListRequests: [],
  // The Insights tab's reads of metric points.
  analyticsListRequests: [],
  fixRequests: [],
  // The project switches the AI settings saved.
  switchSaves: [],
};

// The fixes started on this page, by finding: a second ask finds them running.
const startedTaskIds = {};

window.__metricsAiFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function fail(status, message) {
  throw new HTTPErrorResponse(status, { message }, {});
}

function findInsight(id) {
  return (
    aiInsights(NOW).find((row) => {
      return row.id && row.id.toString() === id;
    }) || null
  );
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data);
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/telemetry-ai/readiness")) {
    return ok(aiReadiness());
  }

  if (url.includes("/telemetry-ai/logs")) {
    const logs = aiLogs(NOW, Number(body.skip) || 0);
    if (!logs) {
      fail(500, "The AI logs could not be read.");
    }
    return ok(logs);
  }

  if (url.includes("/telemetry-ai/fix-suggestion")) {
    return ok(fixSuggestion(findInsight(body.insightId), startedTaskIds));
  }

  if (url.includes("/telemetry-ai/fix")) {
    fixture.fixRequests.push(body);
    if (failures.has("fix")) {
      fail(400, "Pick the repository that holds this code.");
    }
    startedTaskIds[body.insightId] = AI_TASK_IDS.started;
    return ok({ taskId: AI_TASK_IDS.started });
  }

  if (url.includes("/ai-chat/providers")) {
    return ok(aiProviders());
  }

  if (url.includes("/ai-insight/triage-run")) {
    return ok({ run: null, events: [] });
  }

  return ok({});
}

UserUtil.isMasterAdmin = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => {
  return aiProject(PROJECT_ID);
};
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

function idsOf(query) {
  const value = query && query._id;
  if (!value) {
    return null;
  }
  if (Array.isArray(value.values)) {
    return value.values.map((id) => id.toString());
  }
  if (Array.isArray(value)) {
    return value.map((id) => id.toString());
  }
  return [value.toString()];
}

function serviceRow(service) {
  return Object.assign(new Service(), { _id: service.id, name: service.name });
}

// Whether the page drawn is the Insights tab, which reads services of its own.
function isInsightsTab() {
  return window.location.pathname.endsWith("/metrics/insights");
}

ModelAPI.getList = async (options) => {
  const model = new options.modelType();
  fixture.modelListRequests.push({
    modelName: model.tableName,
    query: serialize(options.query),
  });

  if (options.modelType === Service && isInsightsTab()) {
    const services = insightsServices();
    return { data: services, count: services.length, skip: 0, limit: 100 };
  }

  if (options.modelType === MetricType) {
    const types = insightsMetricTypes();
    return { data: types, count: types.length, skip: 0, limit: 100 };
  }

  if (options.modelType === Service) {
    const ids = idsOf(options.query);
    const services = SERVICES.filter((service) => {
      return !ids || ids.includes(service.id);
    }).map(serviceRow);
    return { data: services, count: services.length, skip: 0, limit: 100 };
  }

  if (options.modelType === AIInsight) {
    const rows = filterInsights(aiInsights(NOW), options.query);
    return {
      data: rows.slice(options.skip || 0, (options.skip || 0) + options.limit),
      count: rows.length,
      skip: options.skip || 0,
      limit: options.limit,
    };
  }

  if (options.modelType === AutoRemediationRule) {
    const rules = aiRules();
    return { data: rules, count: rules.length, skip: 0, limit: 10 };
  }

  return { data: [], count: 0, skip: 0, limit: 10 };
};
ModelAPI.getItem = async (options) => {
  if (options.modelType === Project) {
    return aiProject(PROJECT_ID);
  }

  if (options.modelType === AIInsight) {
    return findInsight(options.id ? options.id.toString() : "");
  }

  // A rule's edit dialog reads the rule it opens on.
  if (options.modelType === AutoRemediationRule) {
    const id = options.id ? options.id.toString() : "";
    return (
      aiRules().find((rule) => {
        return rule.id && rule.id.toString() === id;
      }) || null
    );
  }

  if (options.modelType === Service) {
    const id = options.id ? options.id.toString() : "";
    const service = SERVICES.find((candidate) => candidate.id === id);
    return service ? serviceRow(service) : null;
  }

  return null;
};
ModelAPI.getCount = async () => 0;
ModelAPI.count = async (options) => {
  if (options.modelType === AIInsight) {
    return filterInsights(aiInsights(NOW), options.query).length;
  }

  if (options.modelType === AutoRemediationRule) {
    return aiRules().filter((rule) => {
      return rule.isEnabled;
    }).length;
  }

  return 0;
};
ModelAPI.updateById = async (options) => {
  const data = serialize(options.data);
  fixture.switchSaves.push(data);
  if (options.modelType === Project) {
    saveProjectSwitches(data);
  }
  return ok({});
};

AnalyticsModelAPI.getList = async (options) => {
  fixture.analyticsListRequests.push({
    modelName: new options.modelType().tableName,
    query: serialize(options.query),
    limit: options.limit,
  });

  if (options.modelType === Metric) {
    if (failures.has("metrics")) {
      fail(500, "The metrics could not be read.");
    }

    // The services the page is scoped to, when it is.
    const scoped =
      options.query &&
      options.query.primaryEntityId &&
      Array.isArray(options.query.primaryEntityId.values)
        ? options.query.primaryEntityId.values.map((id) => id.toString())
        : null;
    const points = insightsMetrics(PROJECT_ID, NOW).filter((point) => {
      return !scoped || scoped.includes(point.primaryEntityId.toString());
    });

    return {
      data: points.slice(0, options.limit),
      count: points.length,
      skip: 0,
      limit: options.limit,
    };
  }

  return { data: [], count: 0, skip: 0, limit: 10 };
};
AnalyticsModelAPI.count = async () => 0;

API.get = async (options) => handleApi("GET", options);
API.post = async (options) => handleApi("POST", options);

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function RouterHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <Outlet />;
}

function PlaceholderPage(props) {
  const routeParams = useParams();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p
        data-testid={props.testId}
        className="mt-2 text-sm text-gray-600 [overflow-wrap:anywhere]"
      >
        {routeParams.modelId || window.location.pathname}
        {window.location.search}
      </p>
    </main>
  );
}

/*
 * The routes, drawn again on every navigation as the Dashboard's App draws
 * them (it reads the location and hands its pages new props): the tabs and
 * the side menu mark the page that is open, not the one the fixture opened
 * on.
 */
function FixtureRoutes() {
  useLocation();

  return (
    <Routes>
      <Route element={<RouterHooks />}>
        <Route path="/dashboard/:projectId/metrics" element={<MetricsLayout />}>
          {/* Names with ids open the Viewer's list, searched for them. */}
          <Route
            index
            element={
              <PlaceholderPage
                title="Metrics viewer"
                testId="metrics-viewer-page"
              />
            }
          />
          {/* The services reporting metrics, a card each. */}
          <Route path="insights" element={<MetricsInsightsPage />} />
          {/* Open in Metrics lands on the metric, its query in the address. */}
          <Route
            path="view"
            element={
              <PlaceholderPage
                title="Metric Explorer"
                testId="metric-view-page"
              />
            }
          />
          {/* The AI section: what OneUptime found, what it did, its settings. */}
          <Route element={<MetricsAILayout />}>
            <Route path="ai/insights" element={<MetricsAIInsights />} />
            <Route path="ai/insights/:id" element={<MetricsAIInsightView />} />
            <Route path="ai/logs" element={<MetricsAILogs />} />
            <Route path="ai/settings" element={<MetricsAISettings />} />
          </Route>
        </Route>
        {/* A service with no metrics opens its spans in Traces. */}
        <Route
          path="/dashboard/:projectId/traces"
          element={
            <PlaceholderPage
              title="Traces viewer"
              testId="traces-viewer-page"
            />
          }
        />
        <Route
          path="/dashboard/:projectId/code/tasks/:modelId"
          element={
            <PlaceholderPage title="Code Task" testId="code-task-page" />
          }
        />
        <Route
          path="/dashboard/:projectId/code"
          element={<PlaceholderPage title="Code" testId="code-page" />}
        />
        <Route
          path="/dashboard/:projectId/service/:modelId/*"
          element={<PlaceholderPage title="Service" testId="service-page" />}
        />
        <Route
          path="/dashboard/:projectId/settings/*"
          element={
            <PlaceholderPage
              title="Project Settings"
              testId="project-settings-page"
            />
          }
        />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-5">
        <span className="text-lg font-semibold text-gray-900">OneUptime</span>
        <span className="text-sm text-gray-500">Commerce</span>
      </div>
      <span className="text-xs text-gray-500">
        Preview workspace · Synthetic metrics
      </span>
    </header>
    <div className="mx-auto max-w-[1600px] px-4 sm:px-8">
      <FixtureRoutes />
    </div>
  </BrowserRouter>,
);
