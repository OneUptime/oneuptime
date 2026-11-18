/*
 * The server's side of Admin Dashboard > Settings > Products, in the page
 * (#7480): GET and POST /global-config/server-products, answered by the
 * rules the server answers them with (Common/Types/Product/ServerProducts:
 * what is off and why, the preset the switches match, what a preset or a
 * switch saves). Only the data boundary is replaced: API, ModelAPI and the
 * signed-in master admin.
 *
 * Steered by the query string:
 *   - scene=fresh       a new server (the default): SERVER_PRODUCTS unset,
 *                       nothing saved, every product on, ingestion running
 *   - scene=profile     the Monitoring and status pages profile, as the
 *                       install docs give it: SERVER_PRODUCTS=
 *                       monitoring-and-status-pages, nothing saved yet, and
 *                       telemetry ingestion stopped
 *                       (DISABLE_TELEMETRY_INGESTION=true)
 *   - lang=de|fa        the Admin Dashboard's German or Persian
 *
 * Recorded on window.__serverProductsFixture: every read the page makes
 * (reads), every write it sends (writes) and every read or write the fixture
 * does not model (unmodeled), which each spec expects to stay empty.
 */
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import {
  getOffByPreset,
  getPresetOf,
  getServerProductsOff,
  shouldSuggestStoppingIngestion,
  withPreset,
  withProductSwitched,
} from "Common/Types/Product/ServerProducts";
import {
  SERVER_PRODUCTS_ROUTE,
  ServerProductsSource,
  toServerProductsAnswerJSON,
} from "Common/Types/Product/ServerProductsAnswer";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";

export const ADMIN_ID = "80000000-0000-4000-8000-000000000071";

const params = new URLSearchParams(window.location.search);

export const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

export const scene = params.get("scene") === "profile" ? "profile" : "fresh";

const record = { reads: [], writes: [], unmodeled: [] };
window.__serverProductsFixture = record;

// What config.env says, and what an admin saved (nothing, until a write).
const STARTING_VALUE =
  scene === "profile" ? "monitoring-and-status-pages" : "";
const STARTING_OFF =
  scene === "profile" ? getOffByPreset("monitoring-and-status-pages") : [];
const IS_INGESTION_STOPPED = scene === "profile";

// A fixed time, so a save says the same on every run.
const NOW = new Date("2026-11-18T09:30:00.000Z");

let saved = null;

function answer() {
  const switchedOff = saved ? saved.off : STARTING_OFF;
  const off = getServerProductsOff({
    settings: saved,
    startingValue: STARTING_OFF,
    isTelemetryIngestionStopped: IS_INGESTION_STOPPED,
  });

  return toServerProductsAnswerJSON({
    off: off,
    switchedOff: [...switchedOff],
    preset: getPresetOf(switchedOff),
    source: saved
      ? ServerProductsSource.Saved
      : ServerProductsSource.StartingValue,
    startingValue: STARTING_VALUE,
    startingValueUnknownNames: [],
    isTelemetryIngestionStopped: IS_INGESTION_STOPPED,
    shouldSuggestStoppingIngestion: shouldSuggestStoppingIngestion({
      off: off,
      isTelemetryIngestionStopped: IS_INGESTION_STOPPED,
    }),
    changedAt: saved ? saved.changedAt : null,
  });
}

// ---- the signed-in master admin ---------------------------------------------

UserUtil.isMasterAdmin = () => {
  return true;
};
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(ADMIN_ID);
};
PermissionUtil.getAllPermissions = () => {
  return [];
};
PermissionUtil.getProjectPermissions = () => {
  return null;
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

// ---- the API ----------------------------------------------------------------

function tableOf(options) {
  return options && options.modelType
    ? new options.modelType().tableName
    : "unknown";
}

ModelAPI.getItem = async (options) => {
  record.unmodeled.push({ what: "getItem", table: tableOf(options) });
  return null;
};

ModelAPI.getList = async (options) => {
  record.unmodeled.push({ what: "getList", table: tableOf(options) });
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};

ModelAPI.count = async (options) => {
  record.unmodeled.push({ what: "count", table: tableOf(options) });
  return 0;
};

function urlOf(options) {
  return String((options && options.url) || "").split("?")[0];
}

function isServerProducts(url) {
  return url.endsWith(SERVER_PRODUCTS_ROUTE);
}

function ok(body) {
  return new HTTPResponse(200, body, {});
}

function notModelled(what, url) {
  record.unmodeled.push({ what, url });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.fetch = async (options) => {
  const url = urlOf(options);
  record.reads.push(url);
  return isServerProducts(url) ? ok(answer()) : notModelled("fetch", url);
};

API.get = async (options) => {
  const url = urlOf(options);
  record.reads.push(url);
  return isServerProducts(url) ? ok(answer()) : notModelled("get", url);
};

// A preset, or one switch: saved as the server saves it, then the new answer.
API.post = async (options) => {
  const url = urlOf(options);

  if (!isServerProducts(url)) {
    return notModelled("post", url);
  }

  const body = (options && options.data) || {};
  record.writes.push(body);

  if (typeof body.preset === "string") {
    saved = withPreset({ preset: body.preset, userId: ADMIN_ID, now: NOW });
    return ok(answer());
  }

  if (typeof body.product === "string" && typeof body.isOn === "boolean") {
    saved = withProductSwitched({
      currentOff: saved ? saved.off : STARTING_OFF,
      product: body.product,
      isOn: body.isOn,
      userId: ADMIN_ID,
      now: NOW,
    });
    return ok(answer());
  }

  return new HTTPErrorResponse(400, { message: "Choose a preset." }, {});
};
