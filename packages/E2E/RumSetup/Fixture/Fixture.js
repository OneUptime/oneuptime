/*
 * A RUM application's setup surfaces (issues #6379, #6457, #6458), end to
 * end in a real browser: its Overview, Logs and Documentation pages in their
 * production layout (Pages/Rum/View/Layout) - the empty Exceptions and Logs
 * charts and the empty Web Vitals card, the empty Logs page, the Setup check
 * with its refusal notices, the Set up logs and Set up exceptions dialogs
 * with their live last step, Pick another key, and the setup guide's key
 * picker. Only the data boundary is replaced - ModelAPI, AnalyticsModelAPI,
 * API and Realtime - and the signed-in user, a project owner.
 *
 * The application has sent page loads (traces) for two days, the last 40
 * minutes ago, and nothing else: no logs, no exceptions, no Web Vitals.
 * Steered by the query string:
 *
 *   - lang=de, lang=fa  the Dashboard's German or Persian words (Persian
 *                       read right to left)
 *   - theme=dark        (read by server.js) the dark theme
 *   - client=mobile     a mobile app (storefront-mobile), not a web app
 *   - refused=off       everything the app's key sent in the past hours
 *                       was refused because the key is turned off
 *   - refused=origin    ... because the page's origin is not on the
 *                       Browser key
 *   - keys=off          the project's only key of the app's type is the
 *                       turned-off one
 *   - keys=none         the project has no key of the app's type
 *   - sessions=errors   Session Replay recorded sessions in the past hour:
 *                       a full page of the newest, none with an error, and
 *                       three with an error further back, which only the
 *                       errors filter finds
 *   - sessions=many-errors  ... and a full page of sessions with an error,
 *                       with more after it
 *
 * window.__rumSetupFixture.arrive("logs" | "exceptions") makes the first
 * log or exception arrive, as ingest would stamp it, and refuse("off" |
 * "origin") makes ingest refuse the turned-off key's sends from then on,
 * as when an app is deployed with it. Every read is
 * recorded there too: the arrival watch's looks (looks), the filters of
 * each Session Replay list read (sessionLists), the keys created
 * (createdKeys), and every read the fixture does not model (unexpected).
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
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
} from "Common/UI/Utils/CodeReadsAsWritten";
import RumLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Layout";
import OverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview";
import LogsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Logs";
import DocumentationPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Documentation";
import Project from "Common/Models/DatabaseModels/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyRefusal from "Common/Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import ToastRegion from "Common/UI/Components/Toast/ToastRegion";
import UserUtil from "Common/UI/Utils/User";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const PROJECT_ID = "10000000-0000-4000-8000-000000006379";
const APP_ID = "20000000-0000-4000-8000-000000006379";
const USER_ID = "40000000-0000-4000-8000-000000006379";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const isMobile = params.get("client") === "mobile";
const refused = ["off", "origin"].includes(params.get("refused"))
  ? params.get("refused")
  : null;
const keysShown = ["off", "none"].includes(params.get("keys"))
  ? params.get("keys")
  : "all";
const sessions = ["errors", "many-errors"].includes(params.get("sessions"))
  ? params.get("sessions")
  : null;

const record = {
  looks: 0,
  sessionLists: [],
  createdKeys: [],
  unexpected: [],
};
window.__rumSetupFixture = record;

function unexpected(call) {
  record.unexpected.push(call);
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

function listOf(data) {
  return { data: data, count: data.length, skip: 0, limit: 100 };
}

// ---- the project, its application and its keys ------------------------------

const now = Date.now();
const appName = isMobile ? "storefront-mobile" : "storefront-web";

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme Shop";

/*
 * Added two days ago, with its arrivals kept from that moment (a new
 * application's), and sending page loads since: 40 minutes ago the last,
 * or - when its key is refused - three hours ago, before the refusals began.
 */
const lastPageLoadAt = new Date(now - (refused ? 3 * HOUR_MS : 40 * MINUTE_MS));
const application = {
  createdAt: new Date(now - 2 * DAY_MS),
  lastSeenAt: lastPageLoadAt,
  tracesLastReceivedAt: lastPageLoadAt,
  logsLastReceivedAt: null,
  metricsLastReceivedAt: null,
  exceptionsLastSeenAt: null,
};

function toApplication() {
  const model = new RumApplication();
  model._id = APP_ID;
  model.projectId = new ObjectID(PROJECT_ID);
  model.name = isMobile ? "Storefront Mobile" : "Storefront Web";
  model.appIdentifier = appName;
  model.clientType = isMobile ? "mobile" : "browser";
  model.sdkLanguage = isMobile ? "swift" : "js";
  model.createdAt = application.createdAt;
  model.signalArrivalsTrackedSince = application.createdAt;
  model.lastSeenAt = application.lastSeenAt;
  model.tracesLastReceivedAt = application.tracesLastReceivedAt;
  model.logsLastReceivedAt = application.logsLastReceivedAt;
  model.metricsLastReceivedAt = application.metricsLastReceivedAt;
  model.sessionReplayLastChunkReceivedAt = sessions ? lastPageLoadAt : null;
  model.isSessionReplayEnabled = Boolean(sessions);
  model.isProductAnalyticsEnabled = false;
  return model;
}

// A recorded session as the Session Replay list reads it.
function toSession(index, hasError) {
  const startTime = new Date(now - 45 * MINUTE_MS - index * MINUTE_MS);

  return {
    sessionId: (hasError ? "e" : "a") + String(index).padStart(31, "0"),
    startTime: startTime.toISOString(),
    endTime: new Date(startTime.getTime() + 2 * MINUTE_MS).toISOString(),
    durationMs: 2 * MINUTE_MS,
    chunkCount: 4,
    missingChunkCount: 0,
    eventCount: 120,
    isFinalized: true,
    hasError: hasError,
    errorCount: hasError ? 1 : 0,
    pageCount: 3,
  };
}

/*
 * The Session Replay list, as the server answers it: a page of the newest,
 * then a cursor when there are more. The newest page holds no session with
 * an error; with the errors filter, three sessions further back have one
 * (or a full page of them, and more).
 */
function sessionList(data) {
  const filters = (data && data.filters) || {};
  const limit = Number(data && data.limit) || 50;
  const errorsOnly = filters.hasError === true;
  const rows = [];
  let hasMore = false;

  if (sessions && !errorsOnly) {
    for (let index = 0; index < limit; index++) {
      rows.push(toSession(index, false));
    }

    hasMore = true;
  }

  if (sessions && errorsOnly) {
    const count = sessions === "many-errors" ? limit : 3;

    for (let index = 0; index < count; index++) {
      rows.push(toSession(limit + index, true));
    }

    hasMore = sessions === "many-errors";
  }

  return {
    sessions: rows,
    // The server's cursor: where the next page starts, newest first.
    nextCursor: hasMore
      ? {
          sortBy: "startTime",
          sortValue: Date.parse(rows[rows.length - 1].startTime),
          sessionId: rows[rows.length - 1].sessionId,
        }
      : null,
  };
}

const KEY_TYPE = isMobile
  ? TelemetryIngestionKeyType.Mobile
  : TelemetryIngestionKeyType.Browser;

/*
 * The project's keys: one of the app's type it sends with, one turned off
 * (the one refused), and a Server key, which a RUM guide never offers.
 */
const keys = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: isMobile ? "Storefront app key" : "Storefront web key",
    secretKey: "8f14e45f-ceea-4e7a-9a1b-6c0d3e2f1a01",
    keyType: KEY_TYPE,
    allowedOrigins: isMobile ? [] : ["https://shop.example.com"],
    pinnedServiceName: isMobile ? appName : null,
    isEnabled: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    // Long enough that a phone's picker cannot show it on one line (#6458).
    name: isMobile
      ? "Old storefront app key from the spring release"
      : "Old storefront web key from the spring release",
    secretKey: "c9f0f895-fb98-4b2e-8c3d-1e2f3a4b5c02",
    keyType: KEY_TYPE,
    allowedOrigins: isMobile ? [] : ["https://old-shop.example.com"],
    pinnedServiceName: isMobile ? appName : null,
    isEnabled: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    name: "Backend services",
    secretKey: "45c48cce-2e2d-4fbd-9a3b-7c6d5e4f3a03",
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
  },
];
const REFUSED_KEY = keys[1];

function keysOfQuery(query) {
  const listed = keys.filter((key) => {
    if (keysShown === "none") {
      return key.keyType === TelemetryIngestionKeyType.Server;
    }

    if (keysShown === "off" && key.keyType === KEY_TYPE) {
      return key.id === REFUSED_KEY.id;
    }

    return true;
  });

  return listed
    .concat(record.createdKeys)
    .filter((key) => {
      return !query.keyType || key.keyType === query.keyType;
    })
    .map(toKey);
}

function toKey(row) {
  const key = new TelemetryIngestionKey();
  key._id = row.id;
  key.projectId = new ObjectID(PROJECT_ID);
  key.name = row.name;
  key.secretKey = new ObjectID(row.secretKey);
  key.keyType = row.keyType;
  key.allowedOrigins = row.allowedOrigins;
  key.pinnedServiceName = row.pinnedServiceName || undefined;
  key.isEnabled = row.isEnabled;
  return key;
}

/*
 * What the turned-off key's sends were refused for: the app's page loads,
 * logs and metrics alike, so one notice says it for all. Refused for the
 * past two hours, the latest six minutes ago - or, once a test calls
 * refuse(), from then on.
 */
let refusing = refused;
let refusingSince = refused ? new Date(now - 2 * HOUR_MS) : null;
let latestRefusedAt = refused ? new Date(now - 6 * MINUTE_MS) : null;

record.refuse = (reason) => {
  refusing = reason;
  refusingSince = new Date();
  latestRefusedAt = new Date();
};

function refusals() {
  if (!refusing) {
    return [];
  }

  const reason =
    refusing === "off"
      ? TelemetryIngestRefusalReason.KeyDisabled
      : TelemetryIngestRefusalReason.OriginNotAllowed;

  return [
    TelemetryIngestSurface.OtelTraces,
    TelemetryIngestSurface.OtelLogs,
    TelemetryIngestSurface.OtelMetrics,
  ].map((surface, index) => {
    const row = new TelemetryIngestionKeyRefusal();
    row._id = `50000000-0000-4000-8000-00000000000${index + 1}`;
    row.reason = reason;
    row.surface = surface;
    row.refusedCount = 120 - index * 40;
    row.firstRefusedAt = refusingSince;
    row.lastRefusedAt = latestRefusedAt;
    row.telemetryIngestionKeyId = new ObjectID(REFUSED_KEY.id);
    const key = new TelemetryIngestionKey();
    key._id = REFUSED_KEY.id;
    key.name = REFUSED_KEY.name;
    key.keyType = REFUSED_KEY.keyType;
    key.pinnedServiceName = REFUSED_KEY.pinnedServiceName || undefined;
    row.telemetryIngestionKey = key;
    return row;
  });
}

// The first log or exception, as ingest would stamp it.
record.arrive = (signal) => {
  const at = new Date();

  if (signal === "logs") {
    application.logsLastReceivedAt = at;
  }

  if (signal === "exceptions") {
    application.exceptionsLastSeenAt = at;
    application.tracesLastReceivedAt = at;
  }

  application.lastSeenAt = at;
};

// ---- who is signed in: the project's owner ----------------------------------

const heldPermissions = [Permission.ProjectOwner];

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
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
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

  if (table === "RumApplication" && idOf(options.id) === APP_ID) {
    const select = Object.keys(options.select || {});

    // The arrival watch's look: the stamps alone.
    if (
      select.length === 2 &&
      select.includes("logsLastReceivedAt") &&
      select.includes("tracesLastReceivedAt")
    ) {
      record.looks += 1;
    }

    return toApplication();
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const query = options.query || {};

  if (table === "TelemetryIngestionKey") {
    return listOf(keysOfQuery(query));
  }

  if (table === "TelemetryIngestionKeyRefusal") {
    return listOf(refusals());
  }

  if (table === "TelemetryException") {
    if (!application.exceptionsLastSeenAt) {
      return listOf([]);
    }

    const exception = new TelemetryException();
    exception._id = "60000000-0000-4000-8000-000000000001";
    exception.lastSeenAt = application.exceptionsLastSeenAt;
    return listOf([exception]);
  }

  if (table === "RumApplication") {
    return listOf([toApplication()]);
  }

  // The other choices a page offers (clients, labels, owners...): none.
  return listOf([]);
};

ModelAPI.count = async () => {
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

// New Key in a guide's key picker: the key, kept for the tab's reads.
ModelAPI.createOrUpdate = async (options) => {
  const table = tableOf(options);

  if (
    table !== "TelemetryIngestionKey" ||
    options.formType !== FormType.Create
  ) {
    unexpected(`createOrUpdate ${table}`);
    return new HTTPResponse(200, {}, {});
  }

  const model = options.model;
  const row = {
    id: `30000000-0000-4000-8000-00000000010${record.createdKeys.length + 1}`,
    name: model.name,
    secretKey: `d3d94468-02a4-4b5e-9f6d-00000000010${record.createdKeys.length + 1}`,
    keyType: model.keyType,
    allowedOrigins: model.allowedOrigins || [],
    pinnedServiceName: model.pinnedServiceName || null,
    isEnabled: model.isEnabled !== false,
    description: model.description || null,
    requestsPerMinuteLimit: model.requestsPerMinuteLimit || null,
  };
  record.createdKeys.push(row);

  const response = new HTTPResponse(200, {}, {});
  response.data = toKey(row);
  return response;
};

ModelAPI.updateById = async (options) => {
  unexpected(`updateById ${tableOf(options)}`);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (options) => {
  unexpected(`deleteItem ${tableOf(options)}`);
};

// Web Vitals and the charts' series: nothing in any range.
AnalyticsModelAPI.getList = async () => {
  return listOf([]);
};
AnalyticsModelAPI.aggregate = async () => {
  return { data: [] };
};
AnalyticsModelAPI.count = async () => {
  return 0;
};

API.post = async (options) => {
  const url = String(options && options.url);

  if (/\/telemetry\/(logs|exceptions|traces)\/histogram$/.test(url)) {
    return new HTTPResponse(200, { buckets: [] }, {});
  }

  if (url.endsWith("/telemetry/traces/analytics")) {
    return new HTTPResponse(200, { data: [] }, {});
  }

  if (url.endsWith("/telemetry/rum/session-replay/list")) {
    record.sessionLists.push(
      JSON.parse(JSON.stringify((options.data && options.data.filters) || {})),
    );
    return new HTTPResponse(200, sessionList(options.data), {});
  }

  /*
   * Session Replay is off for the application, or - with sessions= - on,
   * and recording.
   */
  if (url.endsWith("/telemetry/rum/session-replay/ingest-status")) {
    return new HTTPResponse(
      200,
      {
        isProjectAllowed: true,
        isApplicationEnabled: Boolean(sessions),
        appIdentifier: appName,
        allowedOrigins: sessions ? ["https://shop.example.com"] : [],
        samplePercentage: 100,
        captureTrigger: "Always",
        consentMode: "NotRequired",
        maskingMode: "MaskInputsOnly",
        retentionInDays: 30,
        publishedRecorderVersion: "13.0.0",
        lastChunkReceivedAt: sessions ? lastPageLoadAt.toISOString() : null,
        lastConfigFetchAt: sessions ? lastPageLoadAt.toISOString() : null,
        lastSessionStartedAt: sessions ? lastPageLoadAt.toISOString() : null,
        sessionsLast24h: sessions ? 120 : 0,
        playableSessionsLast24h: sessions ? 120 : 0,
        refusalsLast24h: [],
        dropsLast24h: [],
        projectBytesUsedToday: 0,
        dailyByteLimit: 1073741824,
        applicationBytesUsedThisMonth: 0,
        monthlyBudgetInGB: null,
        budgetExceededAt: null,
        recorderCapabilities: [],
      },
      {},
    );
  }

  // The logs viewer's facets and attribute suggestions: none.
  if (
    /\/telemetry\/[a-z-]+\/(facets|get-attributes|get-attribute-values)$/.test(
      url,
    )
  ) {
    return new HTTPResponse(
      200,
      { attributes: [], facets: {}, values: [] },
      {},
    );
  }

  unexpected(`API.post ${url}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  unexpected(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

/*
 * The logs viewer listens for new rows. Nothing is ever sent, and no socket
 * leaves the page.
 */
Realtime.listenToAnalyticsModelEvent = () => {
  return () => {};
};
Realtime.listenToModelEvent = () => {
  return () => {};
};

record.ids = { projectId: PROJECT_ID, appId: APP_ID };

// ---- the Dashboard's words --------------------------------------------------

/*
 * <html lang> and <html dir> follow the language through the production
 * helper, as the Dashboard's own i18n set-up does.
 */
followLanguageForPage(i18next);

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

/*
 * As the Dashboard's locale backend does: a Persian page waits for the
 * rules that set the code in its sentences apart (app://, src/telemetry.ts),
 * and every sentence is handed through them.
 */
await whenCodeCanBeSetApart(language);
await i18next
  .use(initReactI18next)
  .use(codeReadsAsWrittenPostProcessor)
  .init({
    lng: language,
    fallbackLng: "en",
    resources: await localeResources({
      language: language,
      english: EN,
      loaders: LOCALE_LOADERS,
    }),
    postProcess: getTranslationPostProcess(),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

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

// Anywhere else the pages lead (a key's page, the docs): where it is.
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
          <PageRoute index element={<RumPage page={OverviewPage} />} />
          <PageRoute path="logs" element={<RumPage page={LogsPage} />} />
          <PageRoute
            path="documentation"
            element={<RumPage page={DocumentationPage} />}
          />
          <PageRoute path="*" element={<ElsewherePage />} />
        </PageRoute>
        <PageRoute path="*" element={<ElsewhereShell />} />
      </Routes>
    </BrowserRouter>
    <ToastRegion />
  </>,
);
