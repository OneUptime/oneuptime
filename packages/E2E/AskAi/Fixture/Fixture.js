/*
 * Offline fixture for Ask AI: the dialog (Components/AIChat/AskAiDialog)
 * over a Dashboard page, as App.tsx mounts it - once, for the whole app -
 * with every way in the page offers: the header's Ask AI, Ctrl/Cmd + I, an
 * "Explain with AI" button with a prepared question, and the chat's own
 * address (Pages/AICopilot), which opens the dialog over the page it came
 * from.
 *
 * The dialog and every component in it are the production ones from this
 * branch; only the ModelAPI / API data boundary, the realtime socket and
 * the signed-in user are replaced. A conversation is answered by an
 * in-page server that writes a run's steps as the dialog polls, as the
 * real one does.
 *
 * Steered by the query string:
 *   - page=incident  the page behind: an incident (#42 Checkout latency
 *                    above 2s) - the default; home, Home (no page context);
 *                    logs, the logs explorer with Explain with AI
 *   - open=1         Ask AI is opened as the page loads
 *   - history=some   five past conversations (none by default);
 *                    many, twenty-five
 *   - thread=answered  Ask AI opens on a conversation already answered;
 *                    approval, one waiting on an approval card; error, one
 *                    whose answer failed; rich, one whose answer carries a
 *                    row of figures, a wide table and a trace
 *   - run=hold       an answer being written stays written-so-far until
 *                    window.__askAiFixture.finish() is called (it finishes
 *                    on its own, a step a poll, by default)
 *   - providers=two  two LLM providers to choose between (one by default)
 *   - ai=off         AI is switched off for the project; noProvider, no
 *                    LLM provider
 *   - fail=send      sending a question fails; conversations, the history
 *                    cannot be read
 *   - lang=de        the Dashboard's German words (fa: Persian, right to
 *                    left)
 *   - theme=dark     dark mode (set before the bundle by server.js)
 *
 * What the page sends is recorded on window.__askAiFixture.state: `sent`
 * (each question, with the page context it carried), `approvals`,
 * `feedback`, `cancelled`, `deleted` and `unhandled` (any request this
 * fixture does not model - the spec fails on one).
 *
 * window.__askAiFixture.navigate(path) moves the router as a link inside
 * the app does (the chat's address in an incident's Slack message opened
 * in this tab, say).
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
import AskAiDialog from "../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiDialog";
import { openAskAi } from "../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";
import AskAI from "../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import AICopilot from "../../../App/FeatureSet/Dashboard/src/Pages/AICopilot/AICopilot";
import EventName from "../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import Incident from "Common/Models/DatabaseModels/Incident";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  AIChatCitationTargetType,
  AIChatToolActionStatus,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const INCIDENT_ID = "20000000-0000-4000-8000-000000000042";
const PROVIDER_ID = "9d9d9d9d-0000-4000-8000-000000000001";
const SECOND_PROVIDER_ID = "9d9d9d9d-0000-4000-8000-000000000002";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const historyKind = ["some", "many"].includes(params.get("history"))
  ? params.get("history")
  : "none";
const threadKind = ["answered", "approval", "error", "rich"].includes(
  params.get("thread"),
)
  ? params.get("thread")
  : "";
const isRunHeld = params.get("run") === "hold";
const providersKind = params.get("providers") === "two" ? "two" : "one";
const aiKind = ["off", "noProvider"].includes(params.get("ai"))
  ? params.get("ai")
  : "on";
const failKind = ["send", "conversations"].includes(params.get("fail"))
  ? params.get("fail")
  : "";

// ---- who is signed in -------------------------------------------------------

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
UserUtil.getName = () => "Maya Chen";
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
Realtime.listenToModelEvent = () => {
  return () => {};
};

// ---- what the server holds ---------------------------------------------------

window.__askAiFixture = {
  state: {
    sent: [],
    approvals: [],
    feedback: [],
    cancelled: 0,
    deleted: [],
    unhandled: [],
  },
};

const fixture = window.__askAiFixture;
const state = fixture.state;

const NOW = Date.now();

function minutesAgo(minutes) {
  return new Date(NOW - minutes * 60 * 1000);
}

let idCounter = 1;

function nextId(prefix) {
  const suffix = String(idCounter++).padStart(12, "0");
  return `${prefix}-0000-4000-8000-${suffix}`;
}

const conversations = [];
const messagesByConversation = new Map();
const runs = new Map();
const eventsByRun = new Map();

function conversationOf(title, lastMinutesAgo) {
  const id = nextId("c0000000");
  const conversation = Object.assign(new AIConversation(), {
    _id: id,
    id: new ObjectID(id),
    title,
    lastMessageAt: minutesAgo(lastMinutesAgo),
    llmProviderId: new ObjectID(PROVIDER_ID),
  });
  conversations.push(conversation);
  messagesByConversation.set(id, []);
  return conversation;
}

function messageOf(conversationId, role, extra) {
  const id = nextId("a0000000");
  const message = Object.assign(new AIConversationMessage(), {
    _id: id,
    id: new ObjectID(id),
    conversationId: new ObjectID(conversationId),
    role,
    status: AIChatMessageStatus.Completed,
    createdAt: minutesAgo(1),
    citations: [],
    widgets: [],
    toolActions: [],
    ...extra,
  });
  messagesByConversation.get(conversationId).push(message);
  return message;
}

function runOf(stats) {
  const id = nextId("d0000000");
  const run = Object.assign(new AIRun(), {
    _id: id,
    id: new ObjectID(id),
    totalTokens: 18432,
    totalCostInUSDCents: 1.84,
    toolCallCount: 4,
    llmCallCount: 3,
    egressManifest: { modelName: "claude-sonnet-5-5" },
    ...stats,
  });
  runs.set(id, run);
  eventsByRun.set(id, []);
  return run;
}

// The answer a latency question gets: cited, with its chart.
const LATENCY_ANSWER = [
  "Checkout slowed down because **payments-db** ran out of connections at 14:02 [C1]: the p95 of `checkout-api` went from 180 ms to 2.4 s [C2], and the slow requests were all waiting for a connection [C3].",
  "",
  "- The pool reached its limit of 100 connections at 14:02 and stayed there [C1].",
  "- 4,812 requests to `checkout-api` timed out in that window [C3].",
  "- Nothing was deployed in the hour before it started [C4].",
].join("\n");

function latencyCitations() {
  return [
    {
      id: "C1",
      toolName: "query_metrics",
      label: "Metrics: payments-db connections, last 2 hours",
      queryArguments: {},
      rowCount: 120,
      target: { type: AIChatCitationTargetType.Metrics },
    },
    {
      id: "C2",
      toolName: "query_traces",
      label: "Traces: checkout-api p95 duration, last 2 hours",
      queryArguments: {},
      rowCount: 24,
      target: { type: AIChatCitationTargetType.Traces },
    },
    {
      id: "C3",
      toolName: "search_logs",
      label: "Logs: checkout-api errors since 14:00",
      queryArguments: {},
      rowCount: 4812,
      target: { type: AIChatCitationTargetType.Logs },
    },
    {
      id: "C4",
      toolName: "recent_changes",
      label: "Recent changes, last 3 hours",
      queryArguments: {},
      rowCount: 0,
    },
  ];
}

function latencyChart() {
  const points = [];

  for (let index = 0; index < 24; index++) {
    const time = new Date(NOW - (23 - index) * 5 * 60 * 1000);
    const value =
      index < 14 ? 170 + ((index * 37) % 25) : 2100 + ((index * 53) % 400);
    points.push({ x: time.toISOString(), y: value });
  }

  return {
    id: "W1",
    citationId: "C2",
    type: AIChatWidgetType.TimeSeriesChart,
    title: "p95 latency · checkout-api",
    description: `${new Date(NOW - 2 * 60 * 60 * 1000).toISOString()} – ${new Date(NOW).toISOString()}`,
    data: {
      series: [{ name: "p95", points }],
      unit: "ms",
      xIsTime: true,
      link: { type: AIChatCitationTargetType.Traces },
    },
  };
}

// The card an alert Ask AI raised leaves: its facts said once.
function alertCard() {
  return {
    id: "W1",
    type: AIChatWidgetType.ResourceCard,
    title: "Alert created",
    data: {
      resourceType: "Alert",
      heading: "ALT-12 · High memory usage on test01",
      subheading: "Severity: High",
      fields: [
        { label: "Number", value: "ALT-12" },
        { label: "Severity", value: "High" },
        { label: "Affected resources", value: 'host "test01"' },
      ],
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: "40000000-0000-4000-8000-000000000012" },
      },
    },
  };
}

function alertAction(status) {
  return {
    id: "call_alert_1",
    toolName: "create_alert",
    title: "Create alert: High memory usage on test01",
    description: 'Severity: High. Linked to host "test01".',
    arguments: {
      title: "High memory usage on test01",
      description: "Memory has been above 92% for 20 minutes.",
    },
    isMutation: true,
    requiresApproval: true,
    status,
  };
}

const LATENCY_QUESTION = "Why did checkout latency spike this afternoon?";

/*
 * An answer that carries what a tool returns at its widest: four figures,
 * a table whose first and last columns hold long values (an endpoint with
 * no spaces to wrap at, a service with a long name), and a trace. Each has
 * to fit the dialog's column at 1280 pixels and a phone's whole screen.
 */
let richConversation = null;

function seedRichAnswer() {
  richConversation = conversationOf("Payments health this week", 3);
  messageOf(richConversation.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: "How healthy were payments this week?",
    createdAt: minutesAgo(4),
  });
  messageOf(richConversation.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown:
      "Payments were healthy except for **Tuesday afternoon**, when `payments-db` ran out of connections [C1].",
    citations: [latencyCitations()[0]],
    widgets: [
      {
        id: "W1",
        type: AIChatWidgetType.StatCards,
        title: "This week",
        data: {
          stats: [
            { label: "Requests", value: "1.36M" },
            { label: "Error rate", value: "0.36", unit: "%" },
            { label: "p95 latency", value: "412", unit: "ms" },
            { label: "Incidents", value: 2 },
          ],
        },
      },
      {
        id: "W2",
        type: AIChatWidgetType.Table,
        title: "Slowest endpoints",
        data: {
          columns: [
            { key: "endpoint", title: "Endpoint" },
            { key: "p95", title: "p95 (ms)", type: "number" },
            { key: "calls", title: "Calls", type: "number" },
            { key: "service", title: "Service" },
          ],
          rows: [
            {
              endpoint: "POST /api/v2/checkout/sessions/{sessionId}/confirm",
              p95: 2412,
              calls: 120443,
              service: "checkout-api",
            },
            {
              endpoint: "GET /api/v2/payments/{paymentId}",
              p95: 380,
              calls: 98221,
              service: "payments-worker-eu-west-1-production",
            },
            {
              endpoint: "POST /ledger/entries",
              p95: 95,
              calls: 55002,
              service: "ledger",
            },
          ],
        },
      },
      {
        id: "W3",
        type: AIChatWidgetType.TraceWaterfall,
        title: "Slowest checkout trace",
        data: {
          totalDurationMs: 2480,
          spans: [
            {
              spanId: "s1",
              name: "POST /api/v2/checkout/sessions/{sessionId}/confirm",
              startOffsetMs: 0,
              durationMs: 2480,
              isError: false,
              serviceName: "checkout-api",
            },
            {
              spanId: "s2",
              parentSpanId: "s1",
              name: "pgbouncer acquire connection",
              startOffsetMs: 12,
              durationMs: 2210,
              isError: true,
              serviceName: "payments-db",
            },
            {
              spanId: "s3",
              parentSpanId: "s1",
              name: "SELECT * FROM payments WHERE id = $1",
              startOffsetMs: 2230,
              durationMs: 180,
              isError: false,
              serviceName: "payments-db",
            },
          ],
        },
      },
    ],
    createdAt: minutesAgo(3),
  });
}

function seedHistory() {
  if (historyKind === "none" && !threadKind) {
    return;
  }

  const answered = conversationOf("Why did checkout latency spike?", 95);
  const run = runOf({});
  messageOf(answered.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: LATENCY_QUESTION,
    createdAt: minutesAgo(96),
  });
  messageOf(answered.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown: LATENCY_ANSWER,
    citations: latencyCitations(),
    widgets: [latencyChart()],
    aiRunId: run.id,
    createdAt: minutesAgo(95),
  });

  const approval = conversationOf(
    "Raise an alert for test01's memory",
    60 * 26,
  );
  messageOf(approval.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: "Raise an alert for high memory on test01.",
    createdAt: minutesAgo(60 * 26),
  });
  messageOf(approval.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown: "",
    status: AIChatMessageStatus.WaitingForApproval,
    toolActions: [alertAction(AIChatToolActionStatus.Pending)],
    createdAt: minutesAgo(60 * 26),
  });

  const failed = conversationOf("Error log volume by service", 60 * 50);
  messageOf(failed.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: "Show error log volume by service for today.",
    createdAt: minutesAgo(60 * 50),
  });
  messageOf(failed.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown: "",
    status: AIChatMessageStatus.Error,
    errorMessage: "The LLM provider did not answer in time.",
    createdAt: minutesAgo(60 * 50),
  });

  if (threadKind === "rich") {
    seedRichAnswer();
  }

  if (historyKind === "none") {
    return;
  }

  const more = [
    ["Top exceptions this week", 60 * 24 * 4],
    ["Payments API incidents in October", 60 * 24 * 9],
  ];

  if (historyKind === "many") {
    for (let index = 0; index < 20; index++) {
      more.push([
        `Database connections on db-${index + 1}`,
        60 * 24 * (10 + index),
      ]);
    }
  }

  for (const [title, ago] of more) {
    const conversation = conversationOf(title, ago);
    messageOf(conversation.id.toString(), AIChatMessageRole.User, {
      contentInMarkdown: title,
      createdAt: minutesAgo(ago + 1),
    });
    messageOf(conversation.id.toString(), AIChatMessageRole.Assistant, {
      contentInMarkdown: `Here is a short answer about ${title.toLowerCase()} [C1].`,
      citations: [latencyCitations()[0]],
      createdAt: minutesAgo(ago),
    });
  }
}

seedHistory();

fixture.conversationIds = {
  answered: conversations[0]?.id.toString(),
  approval: conversations[1]?.id.toString(),
  error: conversations[2]?.id.toString(),
  rich: richConversation?.id.toString(),
};

// ---- a run, written step by step as the dialog polls --------------------------

const RUN_STEPS = [
  [AIRunEventType.RunStarted],
  [AIRunEventType.LlmCallStarted],
  [AIRunEventType.LlmCallCompleted],
  [AIRunEventType.ToolCallStarted, "query_metrics"],
  [
    AIRunEventType.ToolCallCompleted,
    "query_metrics",
    { rowCount: 120, durationInMs: 640 },
  ],
  [AIRunEventType.ToolCallStarted, "query_traces"],
  [
    AIRunEventType.ToolCallCompleted,
    "query_traces",
    { rowCount: 24, durationInMs: 910 },
  ],
  [AIRunEventType.ToolCallStarted, "search_logs"],
  [
    AIRunEventType.ToolCallCompleted,
    "search_logs",
    { rowCount: 4812, durationInMs: 380 },
  ],
  [AIRunEventType.LlmCallStarted],
];

// The answer being written now, if one is.
let liveRun = null;

function addRunEvent(run, step) {
  const events = eventsByRun.get(run.id.toString());
  const id = nextId("e0000000");
  events.push(
    Object.assign(new AIRunEvent(), {
      _id: id,
      id: new ObjectID(id),
      aiRunId: run.id,
      sequence: events.length,
      eventType: step[0],
      toolName: step[1],
      resultSummary: step[2],
    }),
  );
}

function finishLiveRun() {
  if (!liveRun) {
    return;
  }

  const { message, kind } = liveRun;
  liveRun = null;

  if (kind === "alert") {
    message.status = AIChatMessageStatus.WaitingForApproval;
    message.toolActions = [alertAction(AIChatToolActionStatus.Pending)];
    return;
  }

  if (kind === "error") {
    message.status = AIChatMessageStatus.Error;
    message.errorMessage = "The LLM provider did not answer in time.";
    return;
  }

  message.status = AIChatMessageStatus.Completed;
  message.contentInMarkdown = LATENCY_ANSWER;
  message.citations = latencyCitations();
  message.widgets = [latencyChart()];
}

// One more step of the answer being written, as a poll reads it.
function advanceLiveRun() {
  if (!liveRun || isRunHeld) {
    return;
  }

  if (liveRun.step < RUN_STEPS.length) {
    addRunEvent(liveRun.run, RUN_STEPS[liveRun.step]);
    liveRun.step++;
    return;
  }

  finishLiveRun();
}

fixture.addSteps = (count) => {
  if (!liveRun) {
    return;
  }

  for (
    let index = 0;
    index < count && liveRun.step < RUN_STEPS.length;
    index++
  ) {
    addRunEvent(liveRun.run, RUN_STEPS[liveRun.step]);
    liveRun.step++;
  }
};

fixture.finish = () => {
  finishLiveRun();
};

// ---- the API -------------------------------------------------------------------

function copy(item) {
  return Object.assign(new item.constructor(), item);
}

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function idString(value) {
  return value ? value.toString() : "";
}

ModelAPI.getList = async (options) => {
  const table = tableName(options.modelType);

  if (table === "AIConversation") {
    if (failKind === "conversations") {
      throw new HTTPErrorResponse(
        500,
        { message: "Could not load your conversations." },
        {},
      );
    }

    const sorted = [...conversations].sort((a, b) => {
      return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    });
    return {
      data: sorted.slice(0, options.limit || 25).map(copy),
      count: sorted.length,
      skip: 0,
      limit: options.limit || 25,
    };
  }

  if (table === "AIConversationMessage") {
    const conversationId = idString(options.query?.conversationId);
    advanceLiveRun();
    const messages = (messagesByConversation.get(conversationId) || []).map(
      copy,
    );
    // Newest first, as the dialog asks.
    messages.reverse();
    return { data: messages, count: messages.length, skip: 0, limit: 50 };
  }

  if (table === "AIRunEvent") {
    const events = (
      eventsByRun.get(idString(options.query?.aiRunId)) || []
    ).map(copy);
    return { data: events, count: events.length, skip: 0, limit: 100 };
  }

  state.unhandled.push(`getList ${table}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.getItem = async (options) => {
  const table = tableName(options.modelType);

  if (table === "Incident") {
    return Object.assign(new Incident(), {
      _id: INCIDENT_ID,
      id: new ObjectID(INCIDENT_ID),
      title: "Checkout latency above 2s",
      incidentNumber: 42,
    });
  }

  if (table === "AIRun") {
    const run = runs.get(idString(options.id));
    return run ? copy(run) : null;
  }

  state.unhandled.push(`getItem ${table}`);
  return null;
};

ModelAPI.deleteItem = async (options) => {
  const id = idString(options.id);
  state.deleted.push(id);
  const index = conversations.findIndex((conversation) => {
    return conversation.id.toString() === id;
  });

  if (index >= 0) {
    conversations.splice(index, 1);
  }

  return new HTTPResponse(200, {}, {});
};

// The request's path, parsed: the page's API addresses are absolute URLs.
function pathOf(options) {
  return new URL(options.url.toString(), window.location.origin).pathname;
}

function providersResponse() {
  if (aiKind === "noProvider") {
    return { isAIEnabledForProject: true, providers: [] };
  }

  const providers = [
    {
      id: PROVIDER_ID,
      name: "OneUptime AI",
      isGlobal: true,
      isDefault: true,
    },
  ];

  if (providersKind === "two") {
    providers.push({
      id: SECOND_PROVIDER_ID,
      name: "Azure OpenAI",
      description: "gpt-5 in West Europe",
      isGlobal: false,
      isDefault: false,
    });
  }

  return {
    isAIEnabledForProject: aiKind !== "off",
    defaultProviderId: PROVIDER_ID,
    providers,
  };
}

function kindOfQuestion(content) {
  const text = content.toLowerCase();

  if (text.includes("alert")) {
    return "alert";
  }

  if (text.includes("fail")) {
    return "error";
  }

  return "answer";
}

function sendMessage(data) {
  if (failKind === "send") {
    throw new HTTPErrorResponse(
      500,
      { message: "Ask AI could not send your question. Try again." },
      {},
    );
  }

  state.sent.push(JSON.parse(JSON.stringify(data)));

  let conversationId = data.conversationId;

  if (!conversationId) {
    const conversation = conversationOf(
      data.content.length > 48 ? `${data.content.slice(0, 45)}…` : data.content,
      0,
    );
    conversationId = conversation.id.toString();
  }

  const conversation = conversations.find((item) => {
    return item.id.toString() === conversationId;
  });

  if (conversation) {
    conversation.lastMessageAt = new Date();
  }

  messageOf(conversationId, AIChatMessageRole.User, {
    contentInMarkdown: data.content,
    createdAt: new Date(),
  });

  const run = runOf({});
  const message = messageOf(conversationId, AIChatMessageRole.Assistant, {
    contentInMarkdown: "",
    status: AIChatMessageStatus.InProgress,
    aiRunId: run.id,
    createdAt: new Date(),
  });

  liveRun = { run, message, step: 0, kind: kindOfQuestion(data.content) };

  return { conversationId };
}

function respondToApproval(data) {
  state.approvals.push(JSON.parse(JSON.stringify(data)));
  const messages = messagesByConversation.get(data.conversationId) || [];
  const message = messages.find((item) => {
    return item.id.toString() === data.assistantMessageId;
  });

  if (!message) {
    return {};
  }

  const approved = (data.decisions || []).some((decision) => {
    return decision.approved;
  });

  message.toolActions = [
    alertAction(
      approved
        ? AIChatToolActionStatus.Executed
        : AIChatToolActionStatus.Denied,
    ),
  ];
  message.status = AIChatMessageStatus.Completed;
  message.contentInMarkdown = approved
    ? "I raised **ALT-12** for test01's memory, linked to the host."
    : "I did not raise the alert.";
  message.widgets = approved ? [alertCard()] : [];
  const run = runOf({ toolCallCount: 2, totalTokens: 6240 });
  message.aiRunId = run.id;
  return {};
}

API.post = async (options) => {
  const path = pathOf(options);
  const data = options.data || {};

  if (path.endsWith("/ai-chat/providers")) {
    return new HTTPResponse(200, providersResponse(), {});
  }

  if (path.endsWith("/ai-chat/send-message")) {
    return new HTTPResponse(200, sendMessage(data), {});
  }

  if (path.endsWith("/ai-chat/respond-to-approval")) {
    return new HTTPResponse(200, respondToApproval(data), {});
  }

  if (path.endsWith("/ai-chat/cancel-run")) {
    state.cancelled++;

    if (liveRun) {
      liveRun.message.status = AIChatMessageStatus.Cancelled;
      liveRun.message.contentInMarkdown = "Stopped by user.";
      liveRun = null;
    }

    return new HTTPResponse(200, {}, {});
  }

  if (path.endsWith("/ai-chat/message-feedback")) {
    state.feedback.push(JSON.parse(JSON.stringify(data)));
    return new HTTPResponse(200, {}, {});
  }

  state.unhandled.push(`POST ${path}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  state.unhandled.push(`GET ${pathOf(options)}`);
  return new HTTPResponse(200, {}, {});
};

// ---- the pages ---------------------------------------------------------------

/*
 * The production helpers, handed the page's i18next instance before it
 * starts: <html> takes the language's lang and reading direction, and
 * dates are written in it ("vor 2 Stunden").
 */
followLanguageForPage(i18next);
followLanguageForDates(i18next);

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
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const PAGE_PATHS = {
  incident: `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
  home: `/dashboard/${PROJECT_ID}/home/`,
  logs: `/dashboard/${PROJECT_ID}/logs/`,
};

fixture.paths = {
  ...PAGE_PATHS,
  chat: `/dashboard/${PROJECT_ID}/ai/chat`,
  chatConversation: (id) => `/dashboard/${PROJECT_ID}/ai/chat/${id}`,
};

// What App.tsx does for every page: Navigation follows the router.
function NavigationShell(props) {
  const navigate = useNavigate();
  Navigation.setNavigateHook(navigate);
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  fixture.navigate = (path) => {
    navigate(path);
  };
  return props.children;
}

/*
 * A Dashboard page to look at through the blur: the header with the real
 * Ask AI button, and a page of cards. What matters is that it is busy,
 * real-looking and behind the dialog - inert while the dialog is open.
 */
function Frame(props) {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="fixture-page">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            O
          </div>
          <span className="text-sm font-semibold text-gray-900">
            Acme Production
          </span>
          <nav className="max-md:hidden flex items-center gap-1 text-sm text-gray-600 md:flex">
            <a href="#" className="rounded-md px-3 py-2 hover:bg-gray-100">
              Home
            </a>
            <a href="#" className="rounded-md px-3 py-2 hover:bg-gray-100">
              Products
            </a>
          </nav>
          <div className="ms-auto flex items-center">
            <button
              type="button"
              data-testid="fixture-page-button"
              className="me-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
            >
              Search
            </button>
            <AskAI />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {props.children}
      </main>
    </div>
  );
}

function Card(props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{props.title}</h2>
      <div className="mt-3 space-y-2 text-sm text-gray-600">
        {props.children}
      </div>
    </section>
  );
}

function IncidentPage() {
  return (
    <Frame>
      <p className="text-sm font-medium text-red-600">
        Incident #42 · Critical
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900">
        Checkout latency above 2s
      </h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Description">
            <p>
              The p95 latency of checkout-api went above 2 seconds at 14:02 and
              has stayed there. Payments are slow for every customer.
            </p>
          </Card>
          <Card title="Timeline">
            <p>14:02 · Monitor “Checkout API” went Degraded</p>
            <p>14:03 · Incident declared by OneUptime</p>
            <p>14:05 · Alice acknowledged</p>
            <p>14:09 · Note: looking at payments-db</p>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Affected">
            <p>checkout-api</p>
            <p>payments-db</p>
          </Card>
          <Card title="On call">
            <p>Alice Martin · Payments</p>
          </Card>
        </div>
      </div>
    </Frame>
  );
}

function HomePage() {
  return (
    <Frame>
      <h1 className="text-2xl font-semibold text-gray-900">Home</h1>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Card title="Active incidents">
          <p>2 active</p>
        </Card>
        <Card title="Monitors">
          <p>148 operational, 2 degraded</p>
        </Card>
        <Card title="On call now">
          <p>Alice Martin</p>
        </Card>
      </div>
    </Frame>
  );
}

// The logs explorer's error pattern, with its Explain with AI.
const EXPLAIN_PROMPT =
  "Explain this error pattern: 'connection pool exhausted' in checkout-api, 4,812 times since 14:00.";

function LogsPage() {
  return (
    <Frame>
      <h1 className="text-2xl font-semibold text-gray-900">Logs</h1>
      <div className="mt-6">
        <Card title="Error pattern: connection pool exhausted">
          <p>4,812 occurrences since 14:00 in checkout-api.</p>
          <button
            type="button"
            data-testid="fixture-explain-with-ai"
            onClick={() => {
              GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
                prompt: EXPLAIN_PROMPT,
              });
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            Explain with AI
          </button>
        </Card>
      </div>
    </Frame>
  );
}

fixture.explainPrompt = EXPLAIN_PROMPT;

function App() {
  return (
    <NavigationShell>
      {/* As App.tsx mounts it: once, before the routed pages. */}
      <AskAiDialog />
      <Routes>
        <PageRoute
          path="/dashboard/:projectId/incidents/:modelId"
          element={<IncidentPage />}
        />
        <PageRoute path="/dashboard/:projectId/home/*" element={<HomePage />} />
        <PageRoute path="/dashboard/:projectId/logs/*" element={<LogsPage />} />
        <PageRoute
          path="/dashboard/:projectId/ai/chat"
          element={<AICopilot />}
        />
        <PageRoute
          path="/dashboard/:projectId/ai/chat/:modelId"
          element={<AICopilot />}
        />
        <PageRoute path="*" element={<IncidentPage />} />
      </Routes>
    </NavigationShell>
  );
}

const pageKind = ["home", "logs"].includes(params.get("page"))
  ? params.get("page")
  : "incident";

if (window.location.pathname === "/" || window.location.pathname === "") {
  window.history.replaceState(
    null,
    "",
    `${PAGE_PATHS[pageKind]}${window.location.search}`,
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);

/*
 * Opened as the page loads: on a thread, or at its start. As the chat's own
 * address asks, through openAskAi, whose request waits for the dialog if
 * it is not listening yet.
 */
if (params.get("open") === "1" || threadKind) {
  openAskAi(
    threadKind ? { conversationId: fixture.conversationIds[threadKind] } : {},
  );
}

fixture.ready = true;
