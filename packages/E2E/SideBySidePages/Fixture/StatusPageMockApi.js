/*
 * The status page API, answered in the page for every page in Pages.js (see
 * StatusPageIndex.js). Every request the app makes - through its own API
 * client and its ModelAPI, which both end in API.fetch - is recorded on
 * window.__sideBySideFixture with the status page its address names, the
 * `status-page-id` header the real client would send and its body, and one
 * the fixture does not answer is recorded as unexpected and answered 404.
 *
 * A private page's password is kept unlocked for the tab (sessionStorage),
 * as the real API keeps it in a cookie, so it holds through the reload the
 * app makes once the password is right.
 */
import API from "../../../App/FeatureSet/StatusPage/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { PASSWORD, getStatusPage } from "./Pages";
import { buildStatusPageAnswers } from "./StatusPageData";

const UNLOCKED_KEY = "side-by-side-fixture-unlocked-status-pages";

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

const API_PREFIX = "/status-page-api";

const ok = (body) => {
  // A copy each time: the app is free to change what it is handed.
  return new HTTPResponse(200, JSON.parse(JSON.stringify(body)), {});
};

const failure = (statusCode, message) => {
  return new HTTPErrorResponse(statusCode, { message }, {});
};

// What the API answers one request for one page.
const answer = (route, page, data) => {
  const answers = buildStatusPageAnswers(page);

  if (route === "master-page") {
    return ok(answers.masterPage);
  }

  if (route === "master-password") {
    if (!page.hasMasterPassword) {
      return failure(
        400,
        "Master password has not been configured for this status page.",
      );
    }

    if (!data || data["password"] !== PASSWORD) {
      return failure(400, "Invalid password.");
    }

    unlock(page.id);

    return ok({});
  }

  /*
   * A private page's content needs its password first: the API answers 401,
   * as it does without the page's password cookie.
   */
  if (page.hasMasterPassword && !unlockedIds().includes(page.id)) {
    return failure(401, "Please enter the password of this status page.");
  }

  switch (route) {
    case "overview":
      return ok(answers.overview);
    case "incidents":
      return ok(answers.incidents);
    case "episodes":
      return ok(answers.episodes);
    case "resources":
      return ok(answers.resources);
    case "subscribe":
    case "manage-subscription":
      return ok({});
    default:
      return null;
  }
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length)
    : url.pathname;

  // /<route>/<statusPageId>/<rest...>
  const [, route, pageId] = apiPath.split("/");

  // What the real client sends with every request: its own and these.
  const headers = { ...API.getDefaultHeaders(), ...(options.headers || {}) };

  record.requests.push({
    method: options.method,
    path: apiPath,
    route: route || "",
    pageId: pageId || "",
    statusPageIdHeader: headers["status-page-id"] || "",
    data: options.data ? JSON.parse(JSON.stringify(options.data)) : null,
  });

  const page = url.pathname.startsWith(API_PREFIX)
    ? getStatusPage(pageId)
    : null;
  const result = page ? answer(route, page, options.data) : null;

  if (result) {
    return result;
  }

  record.unexpected.push(`${options.method} ${url.pathname}`);

  return failure(404, `The fixture does not answer ${url.pathname}`);
};
