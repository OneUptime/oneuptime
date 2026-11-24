/*
 * The public dashboard API, answered from Data.js (see Index.js). Every
 * request the app makes - through its own API client, which every widget's
 * read on a public dashboard goes through (PublicDashboardWidgetContext) -
 * is recorded on window.__publicDashboardThemeFixture, and one the fixture
 * does not answer is recorded as unexpected and answered 404.
 *
 * The query string sets the page: `board` (Data.js, the widgets), `data`
 * (`empty` for the widgets' empty states), `variables=1` (the toolbar's
 * variable pickers) and `darkLogo=1` (a logo for the dark theme). The dashboard itself - its theme, password and access -
 * is its id (Scenarios.js). The fixture's own settings are kept for the
 * tab, so they hold through the password prompt and back, which the app
 * reaches by reloading the page.
 */
import API from "../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE,
  DASHBOARD_SSO_ONLY_MESSAGE,
} from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import {
  aggregateAnswer,
  attributeValuesAnswer,
  metadataAnswer,
  metricTypesAnswer,
  passwordAnswer,
  resourceListAnswer,
  sloHistoryAnswer,
  viewConfigAnswer,
} from "./Data";
import { PRIVATE_USER, SIGN_IN_PROVIDERS, getScenario } from "./Scenarios";

const SETTINGS_KEY = "public-dashboard-theme-fixture";

const readSettings = () => {
  const params = new URLSearchParams(window.location.search);
  let kept = {};

  try {
    kept = JSON.parse(window.sessionStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    kept = {};
  }

  const settings = {
    board: params.get("board") || kept.board || "kubernetes",
    isEmpty: params.has("data")
      ? params.get("data") === "empty"
      : Boolean(kept.isEmpty),
    withVariables: params.has("variables")
      ? params.get("variables") === "1"
      : Boolean(kept.withVariables),
    withDarkLogo: params.has("darkLogo")
      ? params.get("darkLogo") === "1"
      : Boolean(kept.withDarkLogo),
  };

  try {
    window.sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The fixture's own memory only.
  }

  return settings;
};

const settings = readSettings();

const UNLOCKED_KEY = "public-dashboard-theme-fixture-unlocked";

const unlockedIds = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(UNLOCKED_KEY) || "[]");
  } catch {
    return [];
  }
};

const isUnlocked = (dashboardId) => {
  return unlockedIds().includes(dashboardId);
};

const unlock = (dashboardId) => {
  window.sessionStorage.setItem(
    UNLOCKED_KEY,
    JSON.stringify([...unlockedIds(), dashboardId]),
  );
};

/*
 * Who is signed in to each dashboard that asks its visitors to (#10250):
 * the server's HttpOnly session cookie, kept for the tab here, as the
 * password's unlock is.
 */
const SIGNED_IN_KEY = "public-dashboard-theme-fixture-signed-in";

const signedInEmails = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(SIGNED_IN_KEY) || "{}");
  } catch {
    return {};
  }
};

const signedInAs = (dashboardId) => {
  return signedInEmails()[dashboardId] || null;
};

const setSignedInAs = (dashboardId, email) => {
  const emails = signedInEmails();

  if (email) {
    emails[dashboardId] = email;
  } else {
    delete emails[dashboardId];
  }

  window.sessionStorage.setItem(SIGNED_IN_KEY, JSON.stringify(emails));
};

const SIGN_IN_REQUIRED = {
  status: 401,
  body: { message: "Sign in to view this dashboard." },
};

const record = {
  requests: [],
  unexpected: [],
  // The addresses Forgot password was asked to send a link to.
  passwordResets: [],
  settings,
};

window.__publicDashboardThemeFixture = record;

const API_PREFIX = "/public-dashboard-api";

// Each answer's metrics, per widget, are drawn on its own scale.
const scaleOf = (body) => {
  const text = JSON.stringify(body || {});

  if (text.indexOf("bytes") >= 0 || text.indexOf("memory") >= 0) {
    return 4 * 1024 * 1024 * 1024;
  }

  if (text.indexOf("duration") >= 0) {
    return 400;
  }

  return 100;
};

/*
 * A dashboard's sign-in routes (/private-user/<route>/<dashboardId>,
 * DashboardPrivateUserAuthentication): its ways in, a password's sign-in -
 * one answer for a wrong password and an address that is no private user's
 * - sign-out, renewal and Forgot password, which answers the same for any
 * address.
 */
const privateUserAnswer = (action, dashboardId, body) => {
  const scenario = getScenario(dashboardId);

  if (!scenario || !scenario.answers || !scenario.requiresSignIn) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  const data = (body && body["data"]) || {};

  switch (action) {
    case "sign-in-methods":
      return {
        status: 200,
        body: {
          isPasswordSignInAllowed: scenario.isPasswordSignInAllowed,
          ...SIGN_IN_PROVIDERS,
        },
      };
    case "login":
      if (!scenario.isPasswordSignInAllowed) {
        return { status: 400, body: { message: DASHBOARD_SSO_ONLY_MESSAGE } };
      }

      if (
        data["email"] === PRIVATE_USER.email &&
        data["password"] === PRIVATE_USER.password
      ) {
        setSignedInAs(dashboardId, PRIVATE_USER.email);
        return { status: 200, body: { email: PRIVATE_USER.email } };
      }

      return {
        status: 400,
        body: { message: DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE },
      };
    case "logout":
      setSignedInAs(dashboardId, null);
      return { status: 200, body: {} };
    case "refresh-token":
      return signedInAs(dashboardId)
        ? { status: 200, body: { email: signedInAs(dashboardId) } }
        : SIGN_IN_REQUIRED;
    case "forgot-password":
      record.passwordResets.push(String(data["email"] || ""));
      return { status: 200, body: {} };
    default:
      return null;
  }
};

/*
 * What the API answers a request for one dashboard: its access first, as
 * every public route decides it (PublicDashboardAccess), then the route.
 */
const answer = (route, dashboardId, rest, body) => {
  if (route === "private-user") {
    // /private-user/<route>/<dashboardId>
    return privateUserAnswer(dashboardId, rest[0], body);
  }

  const scenario = getScenario(dashboardId);

  if (route === "metadata") {
    return metadataAnswer(
      dashboardId,
      isUnlocked(dashboardId),
      signedInAs(dashboardId),
    );
  }

  if (!scenario || !scenario.answers) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  if (scenario.isForbidden) {
    return { status: 403, body: { message: "Access denied." } };
  }

  if (route === "master-password") {
    const result = passwordAnswer(body && body["password"]);

    if (result.status === 200) {
      unlock(dashboardId);
    }

    return result;
  }

  if (scenario.hasPassword && !isUnlocked(dashboardId)) {
    return {
      status: 401,
      body: { message: "Please enter the dashboard password." },
    };
  }

  // Nothing of the dashboard before one of its private users signs in.
  if (scenario.requiresSignIn && !signedInAs(dashboardId)) {
    return SIGN_IN_REQUIRED;
  }

  switch (route) {
    case "view-config":
      return viewConfigAnswer(
        dashboardId,
        settings.board,
        settings.withVariables,
        settings.withDarkLogo,
      );
    case "metric-types":
      return metricTypesAnswer();
    case "metrics-aggregate":
      return aggregateAnswer(body, settings.isEmpty, scaleOf(body));
    case "slo-history-aggregate":
      return sloHistoryAnswer(body, settings.isEmpty);
    case "attribute-values":
      return attributeValuesAnswer();
    case "resource-list":
      return resourceListAnswer(rest[0], body, settings.isEmpty);
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

  // /<route>/<dashboardId>/<rest...>
  const [, route, dashboardId, ...rest] = apiPath.split("/");
  const result = url.pathname.startsWith(API_PREFIX)
    ? answer(route, dashboardId, rest, options.data)
    : null;

  if (result) {
    // A copy each time: the app is free to change what it is handed.
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
