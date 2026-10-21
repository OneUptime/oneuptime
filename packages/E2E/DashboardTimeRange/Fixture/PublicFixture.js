/*
 * The public dashboard as it ships (App/FeatureSet/PublicDashboard/src/
 * Index.tsx), served with its own index.ejs by server.js, with only the
 * public dashboard API answered here - imported first, so every request the
 * app makes through its own API client, the widgets' reads included, is
 * answered from Boards.js.
 *
 * Everything the page asks for is recorded on window.__dashboardTimeRangeFixture:
 * every metric read with the window it asked for (aggregates), and every
 * request the fixture does not answer (unexpected - the suite fails on any).
 */
import API from "../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import JSONFunctions from "Common/Types/JSONFunctions";
import { METRIC_TYPES, buildConfig, getScenario, seriesFor } from "./Boards";

const record = {
  aggregates: [],
  requests: [],
  unexpected: [],
};

window.__dashboardTimeRangeFixture = record;

const API_PREFIX = "/public-dashboard-api";

const timestampOf = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && value.value) {
    return new Date(value.value).getTime();
  }

  return new Date(value).getTime();
};

const answer = (route, dashboardId, body) => {
  const scenario = getScenario(dashboardId);

  if (!scenario) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  switch (route) {
    case "metadata":
      return {
        status: 200,
        body: {
          _id: scenario.id,
          name: scenario.name,
          isPublicDashboard: true,
          enableMasterPassword: false,
          pageTitle: scenario.name,
          pageDescription: "Requests, latency and errors across the fleet",
          description: "Requests, latency and errors across the fleet",
          faviconFile: null,
          logoFile: null,
          theme: "Light",
        },
      };
    case "view-config":
      return {
        status: 200,
        body: {
          _id: scenario.id,
          name: scenario.name,
          pageTitle: scenario.name,
          pageDescription: "Requests, latency and errors across the fleet",
          dashboardViewConfig: JSONFunctions.serialize(buildConfig(scenario)),
        },
      };
    // The template's `service` variable's picker.
    case "attribute-values":
      return {
        status: 200,
        body: { values: ["checkout", "payments", "search"] },
      };
    // The template's log stream: no logs in the window.
    case "resource-list":
      return {
        status: 200,
        body: { data: [], count: 0, skip: 0, limit: 10 },
      };
    case "metric-types":
      return {
        status: 200,
        body: {
          metricTypes: METRIC_TYPES.map(([name, unit]) => {
            return { name, unit };
          }),
        },
      };
    case "metrics-aggregate": {
      const aggregateBy = (body && body["aggregateBy"]) || {};
      const start = timestampOf(aggregateBy["startTimestamp"]);
      const end = timestampOf(aggregateBy["endTimestamp"]);
      const metricName =
        (aggregateBy["query"] && aggregateBy["query"]["name"]) ||
        "unknown.metric";

      record.aggregates.push({ start, end, metricName });

      const series = seriesFor({
        start: start || Date.now() - 60 * 60 * 1000,
        end: end || Date.now(),
        metricName,
        aggregationInterval: aggregateBy["aggregationInterval"],
      });

      return {
        status: 200,
        body: {
          data: series.map((point) => {
            return {
              timestamp: {
                _type: "DateTime",
                value: point.timestamp.toISOString(),
              },
              value: point.value,
            };
          }),
        },
      };
    }
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

  // /<route>/<dashboardId>
  const [, route, dashboardId] = apiPath.split("/");
  const result = url.pathname.startsWith(API_PREFIX)
    ? answer(route, dashboardId, options.data)
    : null;

  if (result) {
    const body = JSON.parse(JSON.stringify(result.body));

    if (result.status === 200) {
      return new HTTPResponse(200, body, {});
    }

    return new HTTPErrorResponse(result.status, body, {});
  }

  record.unexpected.push(`${options.method} ${url.pathname}`);

  return new HTTPErrorResponse(
    404,
    { message: `The fixture does not answer ${url.pathname}` },
    {},
  );
};
