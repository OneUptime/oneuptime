/*
 * Offline fixture for AI Insights (AI → Insights): the REAL Incidents and
 * Alerts route groups (Routes/IncidentsRoutes, Routes/AlertRoutes - their
 * layouts, side menus, trails and AI Insights pages), under their real
 * RouteMap patterns, as App.tsx mounts them. Only the data boundary
 * (ModelAPI, API, Realtime) and the signed-in user are replaced. Every
 * record is fabricated for an "Acme Shop" project.
 *
 * The insights are worked out as the server works them out: the fixture
 * keeps the rows the server reads - the window's incidents (or alerts) with
 * the monitors that raised them and the services they hit, each
 * investigation of them, the fixes OneUptime AI proposed or ran (where each
 * was approved: on the card, in Slack or in Microsoft Teams), the fix pull
 * requests, and why the others were not investigated - and hands them to
 * the server's own builder (IncidentAlertAiInsightsBuilder), whose answer
 * the page reads as it reads the route's.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=   (default: a busy month) | empty (nothing investigated: every
 *             incident was skipped, and the page says why)
 *   ?fixes=   hidden (the reader may not read fixes: no fix numbers at all)
 *   ?fail=    insights (the first read of the insights fails; Try again
 *             answers)
 *   ?ai=      off (Enable AI is off for the project)
 *   ?role=    member (a Project Member, who may not turn Enable AI on) |
 *             runbook-blocked (a Project Member whose team blocks Create
 *             Runbook Execution: the fixes that wait, wait for approval -
 *             never theirs)
 *   ?lang=    de | fa (Persian, laid out right to left, as production does)
 *   ?theme=   dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__aiInsightsFixture: listRequests,
 * countRequests, itemRequests, apiRequests and unhandled - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import IncidentsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/IncidentsRoutes";
import AlertRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/AlertRoutes";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import IncidentAlertAiInsightsBuilder from "Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsBuilder";
import Project from "Common/Models/DatabaseModels/Project";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "Common/Types/AI/AIRunAutoGrade";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationApprovalSource from "Common/Types/AutoRemediation/AutoRemediationApprovalSource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import { setPageLanguage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const EMPTY = params.get("state") === "empty";
const FIXES_HIDDEN = params.get("fixes") === "hidden";
const AI_OFF = params.get("ai") === "off";
const ROLE = ["member", "runbook-blocked"].includes(params.get("role"))
  ? params.get("role")
  : "owner";
// The reads that fail once, then answer when tried again.
const FAILING = new Set(
  (params.get("fail") || "").split(",").filter((kind) => {
    return ["insights"].includes(kind);
  }),
);
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: LANGUAGE,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Persian reads right to left, as production's followLanguageForPage sets it.
setPageLanguage(LANGUAGE);
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * The project and its reader
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date();
const WINDOW_IN_DAYS = 30;

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// A moment `days` days (and `hours` hours) before now.
function ago(days, hours = 0) {
  return new Date(NOW.getTime() - days * DAY - hours * HOUR);
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Shop",
  enableAi: !AI_OFF,
});

ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const GRANTED =
  ROLE === "owner" ? [Permission.ProjectOwner] : [Permission.ProjectMember];
// ?role=runbook-blocked: a team of theirs blocks starting runbook runs.
const BLOCKED =
  ROLE === "runbook-blocked" ? [Permission.CreateRunbookExecution] : [];

PermissionUtil.getAllPermissions = () => {
  return GRANTED;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      ...GRANTED.map((permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
      ...BLOCKED.map((permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
        };
      }),
    ],
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

/*
 * ---------------------------------------------------------------------------
 * What came up this month, and what OneUptime AI did with it
 * ---------------------------------------------------------------------------
 */

// The monitors and services the incidents and alerts were raised for and hit.
const MONITORS = {
  checkout: { id: uuid("71000000", 1), name: "Checkout API" },
  payments: { id: uuid("71000000", 2), name: "Payments webhook" },
  database: { id: uuid("71000000", 3), name: "orders-db disk" },
  search: { id: uuid("71000000", 4), name: "Search latency" },
};
const SERVICES = {
  checkout: { id: uuid("72000000", 1), name: "checkout" },
  payments: { id: uuid("72000000", 2), name: "payments" },
  orders: { id: uuid("72000000", 3), name: "orders" },
};

// What the incidents (and alerts) are called, as their monitors named them.
const TITLES = {
  checkout: "Checkout API latency above 2s",
  payments: "Payments webhook failing",
  database: "orders-db disk almost full",
  search: "Search latency above 800ms",
};

/*
 * One kind's month: its incidents (or alerts) - what raised each, when, and
 * how OneUptime AI's investigation of it went - and the fixes and fix pull
 * requests that followed. Times are hours after midnight UTC, so the
 * checkout problem keeps to the small hours, as the page says.
 */
function monthOf(kind) {
  const isIncident = kind === "incident";
  const prefix = isIncident ? "INC" : "ALT";
  const idPrefix = isIncident ? "73000000" : "74000000";
  const rows = [];
  let number = isIncident ? 140 : 820;

  function add(row) {
    number += 1;
    rows.push({
      id: uuid(idPrefix, rows.length + 1),
      number: number,
      numberWithPrefix: `${prefix}-${number}`,
      ...row,
    });
  }

  // The checkout API's latency: back nine times, most of them this week.
  for (const [days, hours] of [
    [0, 9],
    [1, 10],
    [2, 9],
    [3, 11],
    [5, 10],
    [8, 9],
    [10, 10],
    [18, 9],
    [25, 11],
  ]) {
    add({
      title: TITLES.checkout,
      monitor: MONITORS.checkout,
      service: SERVICES.checkout,
      createdAt: ago(days, hours),
      run: days === 8 ? AIRunStatus.Error : AIRunStatus.Completed,
    });
  }

  // The payments webhook: four times, then not once since its fix.
  for (const days of [22, 19, 16, 14]) {
    add({
      title: TITLES.payments,
      monitor: MONITORS.payments,
      service: SERVICES.payments,
      createdAt: ago(days, 4),
      run: AIRunStatus.Completed,
    });
  }

  // A disk that filled up once.
  add({
    title: TITLES.database,
    monitor: MONITORS.database,
    service: SERVICES.orders,
    createdAt: ago(4, 6),
    run: AIRunStatus.Completed,
  });

  // The ones OneUptime AI did not look into, and why.
  for (const [days, reason] of [
    [1, "severity_below_threshold"],
    [3, "severity_below_threshold"],
    [6, "severity_below_threshold"],
    [9, "monitor_cooldown"],
    [12, "monitor_cooldown"],
  ]) {
    add({
      title: TITLES.search,
      monitor: MONITORS.search,
      service: SERVICES.checkout,
      createdAt: ago(days, 14),
      run: null,
      reason: reason,
    });
  }

  return rows;
}

// The findings OneUptime AI wrote, in its own words (English, as it wrote them).
const CHECKOUT_FINDING =
  "The checkout pods ran out of memory after the 14:02 rollout.";
const CHECKOUT_NEXT_STEP =
  "Raise the checkout deployment's memory limit to 1 GiB.";
const PAYMENTS_FINDING =
  "The payments webhook's signing secret expired at midnight.";
const PAYMENTS_NEXT_STEP = "Rotate the webhook's signing secret every 90 days.";
const DISK_FINDING = "Container logs filled the orders-db disk.";
const DISK_NEXT_STEP = "Cap the container log size at 100 MB.";

function findingOf(subject) {
  if (subject.monitor === MONITORS.checkout) {
    return { tldr: CHECKOUT_FINDING, nextStep: CHECKOUT_NEXT_STEP };
  }
  if (subject.monitor === MONITORS.payments) {
    return { tldr: PAYMENTS_FINDING, nextStep: PAYMENTS_NEXT_STEP };
  }
  return { tldr: DISK_FINDING, nextStep: DISK_NEXT_STEP };
}

/*
 * The system's own words, which every language shows as they were written:
 * the monitors' and services' names, the incidents' titles and what
 * OneUptime AI wrote. A spec reading a page in another language for English
 * left in it knows these are not.
 */
const SYSTEM_WORDS = [
  ...Object.values(MONITORS).map((monitor) => {
    return monitor.name;
  }),
  ...Object.values(SERVICES).map((service) => {
    return service.name;
  }),
  ...Object.values(TITLES),
  CHECKOUT_FINDING,
  CHECKOUT_NEXT_STEP,
  PAYMENTS_FINDING,
  PAYMENTS_NEXT_STEP,
  DISK_FINDING,
  DISK_NEXT_STEP,
];

/*
 * The fixes OneUptime AI proposed or ran, by the subject's place in the
 * month: one it ran on its own, some approved on the card, in Slack and in
 * Microsoft Teams - one that did not help, one still being checked - one
 * waiting for approval, one dismissed and one for which no fix applied.
 */
const FIX_PLAN = [
  {
    index: 1,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    verification: AutoRemediationVerificationStatus.Verified,
  },
  {
    index: 2,
    status: AutoRemediationSuggestionStatus.Approved,
    verification: AutoRemediationVerificationStatus.Verified,
    approvedFrom: AutoRemediationApprovalSource.Slack,
  },
  {
    index: 3,
    status: AutoRemediationSuggestionStatus.Approved,
    verification: AutoRemediationVerificationStatus.Failed,
    approvedFrom: AutoRemediationApprovalSource.Slack,
  },
  {
    index: 4,
    status: AutoRemediationSuggestionStatus.Approved,
    verification: AutoRemediationVerificationStatus.Pending,
    approvedFrom: AutoRemediationApprovalSource.MicrosoftTeams,
  },
  {
    index: 12,
    status: AutoRemediationSuggestionStatus.Approved,
    verification: AutoRemediationVerificationStatus.Verified,
    approvedFrom: AutoRemediationApprovalSource.Dashboard,
  },
  {
    index: 0,
    status: AutoRemediationSuggestionStatus.Suggested,
  },
  {
    index: 13,
    status: AutoRemediationSuggestionStatus.Dismissed,
  },
  {
    index: 6,
    status: AutoRemediationSuggestionStatus.NoneApplicable,
  },
];

// The fix pull requests OneUptime AI was asked to open.
const FIX_TASK_PLAN = [
  { index: 1, status: AIRunStatus.Completed },
  { index: 2, status: AIRunStatus.Completed },
  { index: 9, status: AIRunStatus.NoFixFound },
];

/*
 * The rows the server reads for one kind's AI Insights
 * (IncidentAlertAiInsightsReader), in the shape it hands its builder.
 */
function insightsInputOf(kind) {
  const month = monthOf(kind);
  const subjects = new Map();
  const investigations = [];
  const notInvestigatedReasons = new Map();

  month.forEach((subject, index) => {
    subjects.set(subject.id, {
      id: subject.id,
      createdAt: subject.createdAt,
      title: subject.title,
      number: subject.number,
      numberWithPrefix: subject.numberWithPrefix,
      monitorIds: [subject.monitor.id],
      serviceIds: [subject.service.id],
    });

    if (EMPTY || !subject.run) {
      notInvestigatedReasons.set(
        subject.id,
        EMPTY
          ? subject.reason || "automatic_investigation_disabled"
          : subject.reason,
      );
      return;
    }

    const finding = findingOf(subject);

    investigations.push({
      aiRunId: uuid(kind === "incident" ? "75000000" : "76000000", index + 1),
      status: subject.run,
      createdAt: new Date(subject.createdAt.getTime() + MINUTE),
      ...(subject.run === AIRunStatus.Completed
        ? {
            completedAt: new Date(subject.createdAt.getTime() + 6 * MINUTE),
            tldr: finding.tldr,
            nextStep: finding.nextStep,
          }
        : {}),
      // Two findings people confirmed, one the grader matched, one rejected.
      ...(index === 1 || index === 9
        ? { humanVerdict: AIRunHumanVerdict.Confirmed }
        : {}),
      ...(index === 13 ? { humanVerdict: AIRunHumanVerdict.Rejected } : {}),
      ...(index === 2 ? { autoGrade: AIRunAutoGrade.Match } : {}),
      subjectId: subject.id,
    });
  });

  const fixes = EMPTY
    ? []
    : FIX_PLAN.map((plan, position) => {
        const subject = month[plan.index];
        const createdAt = new Date(subject.createdAt.getTime() + 10 * MINUTE);

        return {
          id: uuid(kind === "incident" ? "77000000" : "78000000", position + 1),
          status: plan.status,
          verificationStatus: plan.verification,
          createdAt: createdAt,
          ...(plan.approvedFrom
            ? {
                approvedAt: new Date(createdAt.getTime() + 4 * MINUTE),
                approvedFrom: plan.approvedFrom,
              }
            : {}),
          subjectId: subject.id,
        };
      });

  const fixTasks = EMPTY
    ? []
    : FIX_TASK_PLAN.map((plan, position) => {
        return {
          id: uuid(kind === "incident" ? "79000000" : "7a000000", position + 1),
          status: plan.status,
          createdAt: new Date(month[plan.index].createdAt.getTime() + HOUR),
          subjectId: month[plan.index].id,
        };
      });

  return {
    subjectKind: kind,
    now: NOW,
    windowInDays: WINDOW_IN_DAYS,
    investigations: investigations,
    // A reader who may not read fixes gets no fix numbers at all.
    fixes: FIXES_HIDDEN ? null : fixes,
    fixTasks: fixTasks,
    subjects: subjects,
    occurrenceIds: [...month]
      .sort((a, b) => {
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .map((subject) => {
        return subject.id;
      }),
    monitorNames: new Map(
      Object.values(MONITORS).map((monitor) => {
        return [monitor.id, monitor.name];
      }),
    ),
    serviceNames: new Map(
      Object.values(SERVICES).map((service) => {
        return [service.id, service.name];
      }),
    ),
    commands: EMPTY
      ? { total: 0, failed: 0, timedOut: 0 }
      : { total: 37, failed: 2, timedOut: 1 },
    subjectsInWindow: month.length,
    notInvestigatedReasons: notInvestigatedReasons,
    isPartial: false,
  };
}

// The route's answer, as it crosses the wire: plain JSON.
function insightsOf(kind) {
  return JSON.parse(
    JSON.stringify(IncidentAlertAiInsightsBuilder.build(insightsInputOf(kind))),
  );
}

const INSIGHTS = {
  incident: insightsOf("incident"),
  alert: insightsOf("alert"),
};

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  apiRequests: [],
  insightsAnswers: 0,
  unhandled: [],
  insights: INSIGHTS,
  systemWords: SYSTEM_WORDS,
};
window.__aiInsightsFixture = fixture;

// What a read that fails says, as the API's error answer does.
const READ_FAILED = "The server took too long to answer. Try again.";
const failedOnce = new Set();

// A read of this kind fails the first time it is made, and only then.
function failsNow(failure) {
  if (!FAILING.has(failure) || failedOnce.has(failure)) {
    return false;
  }
  failedOnce.add(failure);
  return true;
}

function tableName(modelType) {
  return new modelType().tableName || "";
}

/*
 * The tables the layouts read: the chat workspaces the project connected
 * (Slack and Microsoft Teams, where fixes were approved), and the states
 * that are not resolved, for the side menus' badges. The rest are empty,
 * as a quiet project's are.
 */
const TABLES = {
  WorkspaceProjectAuthToken: [
    { _id: uuid("7b000000", 1), workspaceType: "Slack" },
    { _id: uuid("7b000000", 2), workspaceType: "MicrosoftTeams" },
  ],
  IncidentState: [
    {
      _id: uuid("7c000000", 1),
      name: "Identified",
      order: 1,
      isCreatedState: true,
    },
    {
      _id: uuid("7c000000", 2),
      name: "Resolved",
      order: 3,
      isResolvedState: true,
    },
  ],
  AlertState: [
    {
      _id: uuid("7d000000", 1),
      name: "Created",
      order: 1,
      isCreatedState: true,
    },
    {
      _id: uuid("7d000000", 2),
      name: "Resolved",
      order: 3,
      isResolvedState: true,
    },
  ],
};
const EMPTY_TABLES = ["Incident", "Alert", "IncidentEpisode", "AlertEpisode"];

function isModelled(modelType) {
  const name = tableName(modelType);
  return Boolean(TABLES[name]) || EMPTY_TABLES.includes(name);
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  fixture.listRequests.push({ modelName: name, limit: options.limit });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "list", modelName: name });
  }

  const rows = TABLES[name] || [];

  return {
    data: rows.map((row) => {
      return Object.assign(new options.modelType(), row);
    }),
    count: rows.length,
    skip: 0,
    limit: options.limit || rows.length,
  };
};

ModelAPI.count = async (options) => {
  const name = tableName(options.modelType);
  fixture.countRequests.push({ modelName: name });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "count", modelName: name });
  }

  return (TABLES[name] || []).length;
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);
  fixture.itemRequests.push({ modelName: name, id: options.id.toString() });

  // Enable AI, as the AI notice reads it.
  if (name === "Project") {
    return project;
  }

  fixture.unhandled.push({ kind: "item", modelName: name });
  return null;
};

ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

function answerApi(method, url) {
  // The project's AI provider, as the AI notice reads it.
  if (method === "POST" && url.endsWith("/ai-chat/providers")) {
    return {
      isAIEnabledForProject: !AI_OFF,
      defaultProviderId: uuid("7e000000", 1),
      providers: [
        {
          id: uuid("7e000000", 1),
          name: "OneUptime AI",
          isGlobal: true,
          isDefault: false,
        },
      ],
    };
  }

  return null;
}

async function handleApi(method, options) {
  const url = new URL(options.url.toString(), window.location.origin);
  fixture.apiRequests.push({ method, url: url.pathname });

  const insightsKind = url.pathname.endsWith("/ai-activity/incident/insights")
    ? "incident"
    : url.pathname.endsWith("/ai-activity/alert/insights")
      ? "alert"
      : null;

  if (method === "POST" && insightsKind) {
    if (failsNow("insights")) {
      return new HTTPErrorResponse(504, { message: READ_FAILED }, {});
    }

    fixture.insightsAnswers += 1;
    return new HTTPResponse(200, INSIGHTS[insightsKind], {});
  }

  const answer = answerApi(method, url.pathname);
  if (answer) {
    return new HTTPResponse(200, answer, {});
  }

  fixture.unhandled.push({ kind: "api", method, url: url.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

/*
 * ---------------------------------------------------------------------------
 * Router, as App.tsx mounts the Incidents and Alerts route groups
 * ---------------------------------------------------------------------------
 */
const PAGE_PROPS = {
  currentProject: project,
  hasPaymentMethod: true,
};

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

// A page the views link to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

function IncidentsArea() {
  useNavigationHooks();
  return (
    <IncidentsRoutes
      {...PAGE_PROPS}
      pageRoute={RouteMap[PageMap.INCIDENTS_AI_INSIGHTS]}
    />
  );
}

function AlertsArea() {
  useNavigationHooks();
  return (
    <AlertRoutes
      {...PAGE_PROPS}
      pageRoute={RouteMap[PageMap.ALERTS_AI_INSIGHTS]}
    />
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            OneUptime
          </span>
          <span className="text-sm text-gray-500">Acme Shop</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route
          path={RouteMap[PageMap.INCIDENTS_ROOT].toString()}
          element={<IncidentsArea />}
        />
        <Route
          path={RouteMap[PageMap.ALERTS_ROOT].toString()}
          element={<AlertsArea />}
        />
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

// As the Dashboard mounts it: navigations update synchronously.
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
