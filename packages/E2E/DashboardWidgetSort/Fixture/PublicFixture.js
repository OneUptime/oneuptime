/*
 * The public dashboard as it ships (App/FeatureSet/PublicDashboard/src/
 * Index.tsx), served with its own index.ejs by server.js, with only the
 * public dashboard API answered here - imported first, so every request the
 * app makes through its own API client, the widgets' reads included, is
 * answered from Boards.js.
 *
 * A widget's list is ordered as the public route orders it
 * (Common/Server/API/DashboardAPI.ts): from the stored widget - the
 * viewer's pick (`widgetSort`) when it names one of the widget's sortable
 * columns, else the widget's own sort, else its built-in order - read step
 * by step through the same registry (Common/Utils/Dashboard/
 * DashboardWidgetSorts), whatever order the browser itself asked for.
 *
 * Everything the page asks for is recorded on window.__dashboardWidgetSortFixture:
 * every resource list request's body (resourceLists), and every request the
 * fixture does not answer (unexpected - the suite fails on any).
 */
import API from "../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import JSONFunctions from "Common/Types/JSONFunctions";
import {
  DASHBOARD_WIDGET_SORT_REQUEST_FIELD,
  findDashboardWidgetSortColumn,
  parseDashboardWidgetSortChoice,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import {
  getDashboardWidgetListReadSteps,
  getDashboardWidgetSortColumns,
  readDashboardWidgetListInSteps,
  readDashboardWidgetSavedSort,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import {
  DASHBOARD_ID,
  buildConfig,
  describePhase,
  monitors,
  pods,
  readTable,
} from "./Boards";

const record = {
  resourceLists: [],
  requests: [],
  unexpected: [],
};

window.__dashboardWidgetSortFixture = record;

const API_PREFIX = "/public-dashboard-api";

const ROWS_BY_RESOURCE = {
  monitor: () => monitors(),
  "kubernetes-resource": () => pods(),
};

const widgetOf = (componentId) => {
  return buildConfig({ isPublic: true }).components.find((component) => {
    return component.componentId.toString() === String(componentId);
  });
};

// The order the public route reads a widget in, and the rows it reads.
const readResourceList = async (resource, body) => {
  const widget = widgetOf(body && body["componentId"]);
  const rows = ROWS_BY_RESOURCE[resource];

  if (!widget || !rows) {
    return null;
  }

  const columns = getDashboardWidgetSortColumns(widget.componentType);
  const requested = parseDashboardWidgetSortChoice(
    body[DASHBOARD_WIDGET_SORT_REQUEST_FIELD],
  );
  const choice =
    requested && findDashboardWidgetSortColumn(columns, requested.column)
      ? requested
      : readDashboardWidgetSavedSort(widget.componentType, widget.arguments);

  const steps = getDashboardWidgetListReadSteps({
    componentType: widget.componentType,
    choice,
    query: resource === "kubernetes-resource" ? { kind: "Pod" } : {},
  });

  const phases = [];

  const data = await readDashboardWidgetListInSteps({
    steps,
    limit: widget.arguments.maxRows || 25,
    read: async (step, limit) => {
      phases.push(describePhase(step.query));
      return readTable({ rows: rows(), query: step.query, sort: step.sort, limit });
    },
  });

  record.resourceLists.push({
    resource,
    componentId: body["componentId"],
    widgetSort: body[DASHBOARD_WIDGET_SORT_REQUEST_FIELD] || null,
    phases,
  });

  return {
    status: 200,
    body: { data, count: data.length, skip: 0, limit: data.length },
  };
};

const answer = async (route, dashboardId, rest, body) => {
  if (dashboardId !== DASHBOARD_ID) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  switch (route) {
    case "metadata":
      return {
        status: 200,
        body: {
          _id: DASHBOARD_ID,
          name: "Operations wall",
          isPublicDashboard: true,
          enableMasterPassword: false,
          pageTitle: "Operations wall",
          pageDescription: "Monitors and pods",
          description: "Monitors and pods",
          faviconFile: null,
          logoFile: null,
          theme: "Light",
        },
      };
    case "view-config":
      return {
        status: 200,
        body: {
          _id: DASHBOARD_ID,
          name: "Operations wall",
          pageTitle: "Operations wall",
          pageDescription: "Monitors and pods",
          dashboardViewConfig: JSONFunctions.serialize(
            buildConfig({ isPublic: true }),
          ),
        },
      };
    case "resource-list":
      return readResourceList(rest[0], body);
    case "metric-types":
      return { status: 200, body: { metricTypes: [] } };
    default:
      return null;
  }
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length)
    : url.pathname;

  record.requests.push(`${options.method} ${apiPath}`);

  // /<route>/<dashboardId>[/<resource>]
  const [, route, dashboardId, ...rest] = apiPath.split("/");
  const result = url.pathname.startsWith(API_PREFIX)
    ? await answer(route, dashboardId, rest, options.data)
    : null;

  if (result) {
    const responseBody = JSON.parse(JSON.stringify(result.body));

    if (result.status === 200) {
      return new HTTPResponse(200, responseBody, {});
    }

    return new HTTPErrorResponse(result.status, responseBody, {});
  }

  record.unexpected.push(`${options.method} ${url.pathname}`);

  return new HTTPErrorResponse(
    404,
    { message: `The fixture does not answer ${url.pathname}` },
    {},
  );
};
