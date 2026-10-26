/*
 * The public dashboard API, answered in the page for every dashboard in
 * Pages.js (see PublicDashboardIndex.js). Every request the app makes - its
 * own API client is the only one a public dashboard reads through - is
 * recorded on window.__sideBySideFixture with the dashboard its address
 * names, the `dashboard-id` header the real client would send and its body,
 * and one the fixture does not answer is recorded as unexpected and answered
 * 404.
 *
 * A dashboard's password is kept unlocked for the tab (sessionStorage), as
 * the real API keeps it in a cookie, so it holds through the reload the app
 * makes once the password is right.
 */
import API from "../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { PASSWORD, getDashboard } from "./Pages";
import { metadataAnswer, viewConfigAnswer } from "./PublicDashboardData";

const UNLOCKED_KEY = "side-by-side-fixture-unlocked-dashboards";

const unlockedIds = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(UNLOCKED_KEY) || "[]");
  } catch {
    return [];
  }
};

const unlock = (id) => {
  window.sessionStorage.setItem(
    UNLOCKED_KEY,
    JSON.stringify([...unlockedIds(), id]),
  );
};

const record = {
  requests: [],
  unexpected: [],
};

window.__sideBySideFixture = record;

const API_PREFIX = "/public-dashboard-api";

const ok = (body) => {
  // A copy each time: the app is free to change what it is handed.
  return new HTTPResponse(200, JSON.parse(JSON.stringify(body)), {});
};

const failure = (statusCode, message) => {
  return new HTTPErrorResponse(statusCode, { message }, {});
};

// What the API answers one request for one dashboard.
const answer = (route, dashboard, data) => {
  const isUnlocked = unlockedIds().includes(dashboard.id);

  if (route === "metadata") {
    return ok(metadataAnswer(dashboard, isUnlocked));
  }

  if (route === "master-password") {
    if (!dashboard.hasPassword) {
      return failure(
        400,
        "Master password has not been configured for this dashboard.",
      );
    }

    if (!data || data["password"] !== PASSWORD) {
      return failure(400, "Invalid password.");
    }

    unlock(dashboard.id);

    return ok({});
  }

  // Without its password a dashboard answers 401, as the real API does.
  if (dashboard.hasPassword && !isUnlocked) {
    return failure(401, "Please enter the dashboard password.");
  }

  if (route === "view-config") {
    return ok(viewConfigAnswer(dashboard));
  }

  // The units of the project's metrics, which every dashboard reads: none.
  if (route === "metric-types") {
    return ok({ metricTypes: [] });
  }

  return null;
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length)
    : url.pathname;

  // /<route>/<dashboardId>/<rest...>
  const [, route, pageId] = apiPath.split("/");

  // What the real client sends with every request: its own and these.
  const headers = { ...API.getDefaultHeaders(), ...(options.headers || {}) };

  record.requests.push({
    method: options.method,
    path: apiPath,
    route: route || "",
    pageId: pageId || "",
    dashboardIdHeader: headers["dashboard-id"] || "",
    data: options.data ? JSON.parse(JSON.stringify(options.data)) : null,
  });

  const dashboard = url.pathname.startsWith(API_PREFIX)
    ? getDashboard(pageId)
    : null;
  const result = dashboard ? answer(route, dashboard, options.data) : null;

  if (result) {
    return result;
  }

  record.unexpected.push(`${options.method} ${url.pathname}`);

  return failure(404, `The fixture does not answer ${url.pathname}`);
};
