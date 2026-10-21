/*
 * Offline fixture for a runbook's Triggers page (Pages/Runbook/View/Triggers),
 * its Executions list and one run's page - and, inside the runbook's view
 * layout (?menu=1), its Overview.
 *
 * Only the ModelAPI / API data boundary, the plain client the webhook test
 * calls through, and the synthetic user's permission snapshot are replaced.
 * The page, both cards, the schedule dialog (its form, Repeat menu, day
 * buttons, time zone menu and preview), the switches, the Executions table
 * and the run's page are the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=executions      the runbook's Executions list, its runs started
 *                          every way a run starts
 *   - page=execution       one run's page (the path names the run); the run
 *                          is the one ?run= names: webhook (default) or
 *                          schedule
 *   - role=editor          may edit runbooks but not run them (Edit Runbook)
 *   - role=runner          may run runbooks but not edit them (Runbook
 *                          Member)
 *   - role=viewer          may read runbooks only (Runbook Viewer); the
 *                          default is a project owner
 *   - schedule=weekdays    a schedule already set: every weekday at 09:00 in
 *                          Europe/London; every15 (every 15 minutes, UTC),
 *                          cron (0 2 1 * *, America/New_York) or paused
 *                          (weekdays, switched off)
 *   - webhook=on           the webhook already on, with a key
 *   - runbook=off          the runbook turned off; nosteps: no steps yet
 *   - queued=1             a scheduled run waiting for the one before it
 *   - lastrun=1            the schedule has started a run before
 *   - lastrunby=incident   the newest run was started for an incident (its
 *                          rule), which the Overview's Last Run links to
 *   - test=refused         the webhook refuses the test request (403)
 *   - keyrefused=1         the server refuses to show the key (422)
 *   - delay=<ms>           how long a save takes, so its state can be seen
 *   - lang=de|ja           the Dashboard's German or Japanese words
 *   - theme=dark           dark mode
 *   - menu=1               the pages inside the runbook's real view layout
 *                          (Pages/Runbook/View/Layout: its header,
 *                          breadcrumbs and side menu), which stays mounted
 *                          from page to page as in the Dashboard; the pages
 *                          this fixture does not model are a stand-in there
 *                          (data-testid fixture-page-not-modelled).
 *                          page=overview opens the runbook's own address:
 *                          its real Overview, with its Activity card
 *
 * What the page sends is recorded on window.__fixture: `updates` (each
 * updateById's data), `keyReads`, `keyResets` and `webhookCalls` (the URL,
 * body and headers of each test request), so the spec checks what was sent,
 * not only what was drawn.
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
import RunbookTriggersPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Triggers";
import RunbookExecutionsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Executions";
import RunbookExecutionPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView";
import RunbookViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Layout";
import RunbookOverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
} from "Common/Types/Runbook/RunbookSchedule";
import { RunbookWebhookMessages } from "Common/Types/Runbook/RunbookWebhook";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PlainAPI from "Common/Utils/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import OneUptimeDate from "Common/Types/Date";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID = "20000000-0000-4000-8000-0000000000b1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const FIRST_KEY = "q8Lz3VwN0rT5yH2kP7mC4xB9sD1fG6jA0eR3uI8oW5n";
const SECOND_KEY = "Xc7Vb2Nm5Lk8Jh1Gf4Ds6Aq9Wz3Ex0Rt7Yu2Io5Pp8l";

const RUN_IDS = {
  webhook: "40000000-0000-4000-8000-0000000000d1",
  schedule: "40000000-0000-4000-8000-0000000000d2",
  catchUp: "40000000-0000-4000-8000-0000000000d3",
  manual: "40000000-0000-4000-8000-0000000000d4",
  test: "40000000-0000-4000-8000-0000000000d9",
};

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "triggers";
const withMenu = params.get("menu") === "1";
const role = params.get("role") || "owner";
const scheduleParam = params.get("schedule") || "none";
const delay = Math.max(0, Number(params.get("delay") || 0));
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

window.__fixture = {
  updates: [],
  keyReads: 0,
  keyResets: 0,
  webhookCalls: [],
};

// ---- the runbook, as the server holds it --------------------------------

const SCHEDULES = {
  none: {},
  weekdays: {
    isScheduleEnabled: true,
    scheduleCron: "0 9 * * 1,2,3,4,5",
    scheduleTimezone: "Europe/London",
  },
  paused: {
    isScheduleEnabled: false,
    scheduleCron: "0 9 * * 1,2,3,4,5",
    scheduleTimezone: "Europe/London",
  },
  every15: {
    isScheduleEnabled: true,
    scheduleCron: "*/15 * * * *",
    scheduleTimezone: "UTC",
  },
  cron: {
    isScheduleEnabled: true,
    scheduleCron: "0 2 1 * *",
    scheduleTimezone: "America/New_York",
  },
};

// The runbook's one step, as the Steps page saves it.
const STEP = {
  id: "50000000-0000-4000-8000-0000000000e1",
  order: 1,
  type: RunbookStepType.Bash,
  title: "Restart the web service",
  config: {
    script: 'systemctl restart "web@$ONEUPTIME_INPUT_HOST"',
    agentId: "60000000-0000-4000-8000-0000000000f1",
  },
};

const stored = {
  isEnabled: params.get("runbook") !== "off",
  steps: params.get("runbook") === "nosteps" ? [] : [STEP],
  isScheduleEnabled: false,
  scheduleCron: null,
  scheduleTimezone: null,
  scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.Skip,
  scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.RunOnce,
  scheduleQueuedRunAt:
    params.get("queued") === "1" ? new Date(Date.now() - 60000) : null,
  isWebhookEnabled: params.get("webhook") === "on",
  ...(SCHEDULES[scheduleParam] || {}),
};

let storedKey = stored.isWebhookEnabled ? FIRST_KEY : null;

function readRunbook() {
  const runbook = new Runbook();
  runbook._id = RUNBOOK_ID;
  runbook.projectId = new ObjectID(PROJECT_ID);
  runbook.name = "Restart the web tier";
  for (const [key, value] of Object.entries(stored)) {
    if (value !== null && value !== undefined) {
      runbook[key] = value;
    }
  }
  return runbook;
}

// ---- runs ---------------------------------------------------------------

const ADA = (() => {
  const user = new User();
  user._id = USER_ID;
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
})();

function run(data) {
  const execution = new RunbookExecution();
  execution._id = data.id;
  execution.runbookId = new ObjectID(RUNBOOK_ID);
  execution.projectId = new ObjectID(PROJECT_ID);
  execution.runbookNameSnapshot = "Restart the web tier";
  execution.status = data.status;
  execution.createdAt = data.at;
  execution.startedAt = data.at;
  if (data.status === RunbookExecutionStatus.Completed) {
    execution.completedAt = new Date(data.at.getTime() + 42000);
  }
  execution.stepExecutions = [
    {
      step: STEP,
      status:
        data.status === RunbookExecutionStatus.Completed
          ? RunbookStepExecutionStatus.Completed
          : RunbookStepExecutionStatus.Failed,
      startedAt: data.at.toISOString(),
      completedAt: new Date(data.at.getTime() + 42000).toISOString(),
      output:
        data.status === RunbookExecutionStatus.Completed
          ? "Restarted web-1 in 4.2s."
          : undefined,
      errorMessage:
        data.status === RunbookExecutionStatus.Completed
          ? undefined
          : "web-1 did not answer its health check after the restart.",
    },
  ];
  if (data.triggerType) {
    execution.triggerType = data.triggerType;
  }
  if (data.triggerDetails) {
    execution.triggerDetails = data.triggerDetails;
  }
  if (data.inputs) {
    execution.inputs = data.inputs;
  }
  if (data.user) {
    execution.triggeredByUser = data.user;
  }
  return execution;
}

const now = Date.now();
const RUNS = [
  run({
    id: RUN_IDS.webhook,
    status: RunbookExecutionStatus.Completed,
    at: new Date(now - 4 * 60000),
    triggerType: RunbookTriggerType.Webhook,
    triggerDetails: { callerIp: "203.0.113.24" },
    inputs: {
      host: "web-1",
      reason: "Disk almost full",
      alert: { id: "A-1042", severity: "critical" },
    },
  }),
  run({
    id: RUN_IDS.schedule,
    status: RunbookExecutionStatus.Completed,
    at: new Date(now - 60 * 60000),
    triggerType: RunbookTriggerType.Schedule,
    triggerDetails: { scheduledFor: new Date(now - 60 * 60000).toISOString() },
  }),
  run({
    id: RUN_IDS.catchUp,
    status: RunbookExecutionStatus.Failed,
    at: new Date(now - 26 * 60 * 60000),
    triggerType: RunbookTriggerType.Schedule,
    triggerDetails: {
      scheduledFor: new Date(now - 26 * 60 * 60000).toISOString(),
      isCatchUp: true,
    },
  }),
  run({
    id: RUN_IDS.manual,
    status: RunbookExecutionStatus.Completed,
    at: new Date(now - 3 * 24 * 60 * 60000),
    triggerType: RunbookTriggerType.Manual,
    user: ADA,
  }),
];

/*
 * ?lastrunby=incident: the newest run was started for an incident, by its
 * runbook rule. The Overview's Last Run names the incident, a link of its
 * own inside the tile that links to the run.
 */
const INCIDENT_ID = "70000000-0000-4000-8000-0000000000a7";
if (params.get("lastrunby") === "incident") {
  RUNS[0] = run({
    id: RUN_IDS.webhook,
    status: RunbookExecutionStatus.Completed,
    at: new Date(now - 4 * 60000),
  });
  RUNS[0].incident = { _id: INCIDENT_ID, title: "Checkout is down" };
}

// ---- who is signed in -------------------------------------------------------

const READS = [
  Permission.ProjectUser,
  Permission.ReadRunbook,
  Permission.ReadRunbookExecution,
];
const HELD = {
  owner: [Permission.ProjectOwner],
  editor: [...READS, Permission.EditRunbook],
  runner: [...READS, Permission.RunbookMember],
  viewer: [...READS, Permission.RunbookViewer],
}[role] || [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
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
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// The browser's clock reads London, as a person in London would see it.
OneUptimeDate.getCurrentTimezone = () => "Europe/London";

// ---- the API ---------------------------------------------------------------

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

ModelAPI.getItem = async (options) => {
  if (options.modelType === Runbook) {
    return readRunbook();
  }
  if (options.modelType === RunbookExecution) {
    return RUNS.find((item) => idOf(item._id) === idOf(options.id)) || null;
  }
  return null;
};

ModelAPI.getList = async (options) => {
  if (options.modelType === RunbookExecution) {
    const query = options.query || {};
    let items = RUNS.slice();
    if (typeof query.triggerType === "string") {
      items = items.filter((item) => item.triggerType === query.triggerType);
    }
    if (params.get("lastrun") !== "1" && query.triggerType) {
      items = [];
    }
    const skip = Number(options.skip || 0);
    const limit = Number(options.limit || 10);
    return {
      data: items.slice(skip, skip + limit),
      count: items.length,
      skip,
      limit,
    };
  }
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.getCount = async () => RUNS.length;
// The Overview counts the runs, and those that completed and failed.
ModelAPI.count = async (options) => {
  const status = options && options.query && options.query.status;
  return status
    ? RUNS.filter((item) => item.status === status).length
    : RUNS.length;
};

ModelAPI.updateById = async (options) => {
  const data = { ...options.data };
  window.__fixture.updates.push(JSON.parse(JSON.stringify(data)));
  if (delay) {
    await wait(delay);
  }
  Object.assign(stored, data);
  // The server works out a key the first time the webhook is on.
  if (data.isWebhookEnabled === true && !storedKey) {
    storedKey = FIRST_KEY;
  }
  return new HTTPResponse(200, {}, {});
};

// The Triggers page's key routes, through the dashboard's session client.
API.post = async (options) => {
  const url = options.url.toString();
  if (params.get("keyrefused") === "1" && url.includes("/webhook-secret/")) {
    return new HTTPErrorResponse(
      422,
      {
        message:
          "You do not have permission to see this runbook's webhook URL.",
      },
      {},
    );
  }
  if (url.endsWith(`/webhook-secret/${RUNBOOK_ID}/reset`)) {
    window.__fixture.keyResets++;
    if (delay) {
      await wait(delay);
    }
    storedKey = SECOND_KEY;
    return new HTTPResponse(200, { secretKey: storedKey }, {});
  }
  if (url.endsWith(`/webhook-secret/${RUNBOOK_ID}`)) {
    window.__fixture.keyReads++;
    return new HTTPResponse(
      200,
      { secretKey: storedKey, isWebhookEnabled: stored.isWebhookEnabled },
      {},
    );
  }
  return new HTTPResponse(200, {}, {});
};
API.get = async () => new HTTPResponse(200, {}, {});

// The webhook itself, called by Send Test Request as another tool would.
PlainAPI.post = async (options) => {
  const url = options.url.toString();
  window.__fixture.webhookCalls.push({
    url,
    data: options.data,
    headers: options.headers || {},
  });
  if (delay) {
    await wait(delay);
  }
  if (!url.endsWith(`/webhook/${RUNBOOK_ID}/${storedKey}`)) {
    return new HTTPErrorResponse(
      404,
      { message: RunbookWebhookMessages.notFound },
      {},
    );
  }
  if (params.get("test") === "refused" || !stored.isEnabled) {
    return new HTTPErrorResponse(
      403,
      { message: RunbookWebhookMessages.runbookOff },
      {},
    );
  }
  // The run the call started, as the server records it.
  RUNS.unshift(
    run({
      id: RUN_IDS.test,
      status: RunbookExecutionStatus.Completed,
      at: new Date(),
      triggerType: RunbookTriggerType.Webhook,
      triggerDetails: { callerIp: "127.0.0.1" },
      inputs: options.data,
    }),
  );
  return new HTTPResponse(
    200,
    { runbookExecutionId: RUN_IDS.test, status: "Scheduled" },
    {},
  );
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Page = props.component;
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        Runbooks / Restart the web tier / {props.trail}
      </div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

/*
 * ?menu=1: the runbook's real view layout around the page, as the
 * Dashboard draws it: ModelPage's header and breadcrumbs, and the runbook's
 * side menu. It is one route the pages are children of, so it stays mounted,
 * and its menu keeps the sections someone opened, from page to page.
 */
function MenuShell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      <RunbookViewLayout
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

// One of the fixture's pages, inside the layout.
function InLayout(props) {
  Navigation.setParams(useParams());
  const Page = props.component;
  return (
    <Page
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={null}
      hasPaymentMethod={true}
    />
  );
}

// A page of the runbook this fixture does not model: the menu still leads to it.
function NotModelled() {
  const location = useLocation();
  return (
    <div
      className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500"
      data-testid="fixture-page-not-modelled"
    >
      {location.pathname}
    </div>
  );
}

const BASE = `/dashboard/:projectId/runbooks/:id`;
const target = {
  overview: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}`,
  triggers: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/triggers`,
  executions: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions`,
  execution: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions/${
    params.get("run") === "schedule" ? RUN_IDS.schedule : RUN_IDS.webhook
  }`,
}[page];

if (target && window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    {withMenu ? (
      <Routes>
        <PageRoute path={BASE} element={<MenuShell />}>
          <PageRoute
            index
            element={<InLayout component={RunbookOverviewPage} />}
          />
          <PageRoute
            path="triggers"
            element={<InLayout component={RunbookTriggersPage} />}
          />
          <PageRoute
            path="executions"
            element={<InLayout component={RunbookExecutionsPage} />}
          />
          <PageRoute
            path="executions/:subModelId"
            element={<InLayout component={RunbookExecutionPage} />}
          />
          <PageRoute path="*" element={<NotModelled />} />
        </PageRoute>
        {/* Where a link out of the runbook lands: an incident's page. */}
        <PageRoute
          path="/dashboard/:projectId/incidents/:incidentId"
          element={<NotModelled />}
        />
      </Routes>
    ) : (
      <Routes>
        <PageRoute
          path={`${BASE}/triggers`}
          element={<Shell component={RunbookTriggersPage} trail="Triggers" />}
        />
        <PageRoute
          path={`${BASE}/executions`}
          element={
            <Shell component={RunbookExecutionsPage} trail="Executions" />
          }
        />
        <PageRoute
          path={`${BASE}/executions/:subModelId`}
          element={<Shell component={RunbookExecutionPage} trail="Execution" />}
        />
      </Routes>
    )}
  </BrowserRouter>,
);
