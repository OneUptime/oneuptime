/*
 * The public dashboard as it ships (App/FeatureSet/PublicDashboard/src/
 * Index.tsx), served with its own index.ejs by server.js, with only the
 * public dashboard API answered here - imported first, so every request the
 * app makes through its own API client, the tables' metric reads included,
 * is answered from Boards.js, NEWEST bucket first, as the public metrics
 * route answers it.
 *
 * ?publicTheme=Dark serves the dashboard with its Dark theme.
 *
 * Everything the page asks for is recorded on
 * window.__dashboardTableThresholdsFixture: every metric read (aggregates),
 * every request (requests) and every request the fixture does not answer
 * (unexpected - the suite fails on any).
 */
import API from "../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import JSONFunctions from "Common/Types/JSONFunctions";
import {
  CPU_OVER_TIME,
  DASHBOARD_ID,
  HOSTS,
  METRIC_TYPES,
  buildConfig,
  pointsFor,
} from "./Boards";

const record = {
  aggregates: [],
  requests: [],
  unexpected: [],
  // What the metric reads are answered with, for the suite to work out each cell.
  readings: { hosts: HOSTS, cpuOverTime: CPU_OVER_TIME },
};

window.__dashboardTableThresholdsFixture = record;

const API_PREFIX = "/public-dashboard-api";

const theme =
  new URLSearchParams(window.location.search).get("publicTheme") === "Dark"
    ? "Dark"
    : "Light";

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
  if (String(dashboardId || "").toLowerCase() !== DASHBOARD_ID) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  switch (route) {
    case "metadata":
      return {
        status: 200,
        body: {
          _id: DASHBOARD_ID,
          name: "Fleet health",
          isPublicDashboard: true,
          enableMasterPassword: false,
          pageTitle: "Fleet health",
          pageDescription: "CPU, memory and disk, per host",
          description: "CPU, memory and disk, per host",
          faviconFile: null,
          logoFile: null,
          theme: theme,
        },
      };
    case "view-config":
      return {
        status: 200,
        body: {
          _id: DASHBOARD_ID,
          name: "Fleet health",
          pageTitle: "Fleet health",
          pageDescription: "CPU, memory and disk, per host",
          dashboardViewConfig: JSONFunctions.serialize(buildConfig()),
        },
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
      const points = pointsFor({
        start: start || Date.now() - 60 * 60 * 1000,
        end: end || Date.now(),
        metricName,
        groupByAttributeKeys: aggregateBy["groupByAttributeKeys"],
      });

      record.aggregates.push({
        start,
        end,
        metricName,
        groupByAttributeKeys: aggregateBy["groupByAttributeKeys"] || [],
        count: points.length,
      });

      // Newest first, as the metrics API answers.
      return {
        status: 200,
        body: {
          data: points
            .slice()
            .reverse()
            .map((point) => {
              return {
                timestamp: {
                  _type: "DateTime",
                  value: new Date(point.time).toISOString(),
                },
                value: point.value,
                ...(point.attributes ? { attributes: point.attributes } : {}),
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
