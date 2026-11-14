/*
 * Offline fixture for Ask AI: the panel (Components/AIChat/AskAiPanel)
 * beside a Dashboard page, as App.tsx mounts it - once, for the whole app -
 * with every way in the page offers: the header's Ask AI, Ctrl/Cmd + I, an
 * "Explain with AI" button with a prepared question, and the chat's own
 * address (Pages/AICopilot), which opens the panel beside the page it came
 * from. The page's links go to its other pages with the panel open, and it
 * opens one of the app's own side panels (SideOver) beside it.
 *
 * The panel and every component in it are the production ones from this
 * branch; only the ModelAPI / API data boundary, the realtime socket and
 * the signed-in user are replaced. A conversation is answered by an
 * in-page server that writes a run's steps as the panel polls, as the
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
 *                    row of figures, a wide table and a trace; actions, one
 *                    waiting to post a public status update on incident
 *                    #42 and add a private note to it, each with its
 *                    arguments, which leave their two cards once run;
 *                    code, one waiting to commit four files whose card
 *                    names what it would write over unseen - a file
 *                    changed since Ask AI read it, one read in an earlier
 *                    answer, one read earlier in this answer, left out of
 *                    the conversation since (issue #6570), and one read
 *                    whole in two parts, the first left out since (issue
 *                    #6984);
 *                    monitors, "Which monitors are down right now?"
 *                    answered with two monitors read by id - one
 *                    Offline, one whose monitoring is off - and the
 *                    monitors table, its long names beside "Operational"
 *                    (issues #6968 and #6969); each card's words as
 *                    query_monitors stores them, so they are drawn in
 *                    the reader's language (issue #7175);
 *                    readcards, "What do we have for payments?" answered
 *                    with every card a read leaves - a monitor, an SLO, a
 *                    team, an on-call policy and schedule, a status page,
 *                    a runbook, a workflow and a security case - each
 *                    built by its tool's own builder (issue #7175);
 *                    setup, one waiting on a
 *                    setup plan - a website monitor and the project's
 *                    first on-call policy, the SMS the person asked for
 *                    missing a number (issue #6829) - whose approved
 *                    parts leave their cards and the test page offer;
 *                    setup-busy, the same in a busy project, which pages
 *                    people already and has a status page: a website
 *                    monitor, and that monitor put on the page
 *   - run=hold       an answer being written stays written-so-far until
 *                    window.__askAiFixture.finish() is called (it finishes
 *                    on its own, a step a poll, by default)
 *   - providers=two  two LLM providers to choose between (one by default)
 *   - ai=off         AI is switched off for the project; noProvider, no
 *                    LLM provider
 *   - fail=send      sending a question fails; conversations, the history
 *                    cannot be read
 *   - lang=de        the Dashboard's German words (fa: Persian, ar:
 *                    Arabic, each right to left)
 *   - words=none     the approval card's action was saved before actions
 *                    stored their words: only its English, as conversations
 *                    saved then read
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
import AskAiPanel from "../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanel";
import { openAskAi } from "../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";
import AskAI from "../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import AICopilot from "../../../App/FeatureSet/Dashboard/src/Pages/AICopilot/AICopilot";
import EventName from "../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import AR from "../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_CODE_FILE,
  AI_ACTION_LINES,
  AI_ACTION_NAME,
  AI_ACTION_NEW_MONITOR,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_PLURAL_TITLES,
  AI_ACTION_TITLES,
  aiActionCardFact,
  aiActionList,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionCardWords,
  describeAIActionWords,
} from "Common/Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIChatToolActionStatus,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import WidgetBuilder from "Common/Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  getEmptyRunbookCardWords,
  getEmptyTeamCardWords,
  getMonitorCardWords,
  getOnCallPolicyCardWords,
  getOnCallScheduleCardWords,
  getSecurityCaseCardWords,
  getSloCardWords,
  getStatusPageCardWords,
  getUnrunWorkflowCardWords,
} from "Common/Server/Utils/AI/Toolbox/ReadCardWords";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
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
// The project's incident states, top first: Identified, then Resolved.
const OPEN_STATE_ID = "50000000-0000-4000-8000-000000000001";
const RESOLVED_STATE_ID = "50000000-0000-4000-8000-000000000002";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa", "ar"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const historyKind = ["some", "many"].includes(params.get("history"))
  ? params.get("history")
  : "none";
const threadKind = [
  "answered",
  "approval",
  "error",
  "rich",
  "actions",
  "code",
  "monitors",
  "readcards",
  "setup",
  "setup-busy",
].includes(params.get("thread"))
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
// Where the incident under the dialog stands: open (the default) or resolved.
const isIncidentResolved = params.get("incident") === "resolved";
// An action saved before actions stored their words: its English only.
const isSavedBeforeWords = params.get("words") === "none";

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

/*
 * What the server stores for the card create_alert leaves
 * (WidgetBuilder.actionCard): its kind, its line and its facts as terms and
 * sentences of Common/Types/AI/AIActionWords, which the card says in the
 * reader's language, and the same words in English beside them.
 */
const ALERT_CARD_WORDS = {
  kind: aiActionTerm(AI_ACTION_CARD_KINDS.alert),
  line: [aiActionSentence(AI_ACTION_CARD_LINES.severity, { severity: "High" })],
  facts: [
    aiActionCardFact(
      AI_ACTION_CARD_FACTS.affectedResources,
      aiActionList([aiActionResourceByName({ noun: "host", name: "test01" })]),
    ),
  ],
};

/*
 * The card an alert Ask AI raised leaves: its facts said once. With
 * ?words=none it is a card saved before cards had words: its English only.
 */
function alertCard() {
  const english = describeAIActionCardWords(ALERT_CARD_WORDS);

  return {
    id: "W1",
    type: AIChatWidgetType.ResourceCard,
    title: "Alert created",
    data: {
      resourceType: isSavedBeforeWords ? "Alert" : english.kind,
      heading: "ALT-12 · High memory usage on test01",
      subheading: isSavedBeforeWords ? "Severity: High" : english.line,
      fields: isSavedBeforeWords
        ? [
            { label: "Number", value: "ALT-12" },
            { label: "Severity", value: "High" },
            { label: "Affected resources", value: 'host "test01"' },
          ]
        : english.facts,
      ...(isSavedBeforeWords ? {} : { words: ALERT_CARD_WORDS }),
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: "40000000-0000-4000-8000-000000000012" },
      },
    },
  };
}

/*
 * What the server stores for create_alert's card: its title and its line as
 * sentences (Common/Types/AI/AIActionWords), which the card says in the
 * reader's language, the alert's title, its severity and the host's name as
 * data - and their English, which the model and the exports read.
 */
const ALERT_ACTION_WORDS = {
  title: aiActionSentence(AI_ACTION_TITLES.createAlert, {
    title: "High memory usage on test01",
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.severity, { severity: "High" }),
    aiActionSentence(AI_ACTION_LINES.linkedTo, {
      resources: aiActionList([
        aiActionResourceByName({ noun: "host", name: "test01" }),
      ]),
    }),
  ],
};

function alertAction(status) {
  const english = describeAIActionWords(ALERT_ACTION_WORDS);

  return {
    id: "call_alert_1",
    toolName: "create_alert",
    // "Create alert: High memory usage on test01"
    title: english.title,
    // 'Severity: High. Linked to host "test01".'
    description: english.description,
    ...(isSavedBeforeWords ? {} : { words: ALERT_ACTION_WORDS }),
    /*
     * Once it ran, the card it left (W1), as the server records it: the
     * answer's actions do not list it again under that card. An action
     * saved before actions named their cards has none.
     */
    ...(status === AIChatToolActionStatus.Executed && !isSavedBeforeWords
      ? { widgetId: "W1" }
      : {}),
    arguments: {
      title: "High memory usage on test01",
      description: "Memory has been above 92% for 20 minutes.",
    },
    isMutation: true,
    requiresApproval: true,
    status,
  };
}

/*
 * A public status update and a private note on incident #42, as the server
 * stores them: each title a sentence naming the incident by its number
 * (so the card leaves its ID out), and the arguments the person approves
 * - the update's note and whether subscribers hear of it, the note's text.
 */
const STATUS_UPDATE_NOTE =
  "We have found the cause of the slow checkouts and are rolling out a fix. Payments are not affected, and orders placed during the slowdown will go through.";
const INTERNAL_NOTE =
  "pgbouncer on test01 held 400 connections to the old primary after the failover. Restarted it at 14:25.";

function incidentNoteActions(status) {
  const statusUpdateWords = {
    title: aiActionSentence(AI_ACTION_TITLES.postIncidentStatusUpdate, {
      incident: "#42",
    }),
    namedArguments: ["incidentId"],
  };
  const noteWords = {
    title: aiActionSentence(AI_ACTION_TITLES.addIncidentNote, {
      incident: "#42",
    }),
    namedArguments: ["incidentId"],
  };
  const isExecuted = status === AIChatToolActionStatus.Executed;

  return [
    {
      id: "call_status_update",
      toolName: "post_incident_status_update",
      title: describeAIActionWords(statusUpdateWords).title,
      words: statusUpdateWords,
      ...(isExecuted ? { widgetId: "W1" } : {}),
      arguments: {
        incidentId: INCIDENT_ID,
        note: STATUS_UPDATE_NOTE,
        notifySubscribers: true,
      },
      isMutation: true,
      requiresApproval: true,
      status,
    },
    {
      id: "call_internal_note",
      toolName: "create_incident_note",
      title: describeAIActionWords(noteWords).title,
      words: noteWords,
      ...(isExecuted ? { widgetId: "W2" } : {}),
      arguments: { incidentId: INCIDENT_ID, note: INTERNAL_NOTE },
      isMutation: true,
      requiresApproval: true,
      status,
    },
  ];
}

/*
 * A commit of four files on fix/login, as the server stores it
 * (CodeWriteTools, CodeFilesSeen): its title, and a caution for each kind
 * of file it would write over unseen, in the order the card weighs them -
 * a file changed on the branch since Ask AI read it, one read in an
 * earlier answer, one read earlier in this answer whose read the
 * conversation has left out since (issue #6570), and one Ask AI read all
 * of in two parts, the first of them left out since: read, and no longer
 * all in hand - never "read only part of" (issue #6984). Ask AI writes
 * each file whole, so the card names them before anyone approves it.
 */
const CODE_BRANCH = "fix/login";

function codeFiles(paths) {
  return aiActionList(
    paths.map((file) => {
      return aiActionSentence(AI_ACTION_CODE_FILE, { file });
    }),
  );
}

const CODE_CHANGE_WORDS = {
  title: aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 4, {
    branch: CODE_BRANCH,
  }),
  description: [
    aiActionPluralSentence(
      AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead,
      1,
      {
        branch: CODE_BRANCH,
        files: codeFiles(["src/billing/refund.ts"]),
      },
    ),
    aiActionPluralSentence(
      AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
      1,
      { files: codeFiles(["README.md"]) },
    ),
    aiActionPluralSentence(
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
      1,
      { files: codeFiles(["src/billing/charge.ts"]) },
    ),
    aiActionPluralSentence(
      AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
      1,
      { files: codeFiles(["src/billing/ledger.ts"]) },
    ),
  ],
};

function codeChangeAction(status) {
  const english = describeAIActionWords(CODE_CHANGE_WORDS);

  return {
    id: "call_commit_1",
    toolName: "commit_code_to_branch",
    title: english.title,
    description: english.description,
    words: CODE_CHANGE_WORDS,
    arguments: {
      branchName: CODE_BRANCH,
      commitMessage: "fix: round charges and refunds to the cent",
      changes: [
        { filePath: "src/billing/refund.ts", content: "export {};\n" },
        { filePath: "README.md", content: "# Billing\n" },
        { filePath: "src/billing/charge.ts", content: "export {};\n" },
        { filePath: "src/billing/ledger.ts", content: "export {};\n" },
      ],
    },
    isMutation: true,
    requiresApproval: true,
    status,
  };
}

/*
 * "Monitor example.com every minute and text me if it is down" (issue
 * #6829): one plan on one card, as the server stores it (SetupTools) - a
 * website monitor and the project's first on-call policy, each said in
 * plain words, the paging part saying the number for texts is missing.
 */
const SETUP_QUESTION =
  "Monitor example.com every minute and text me if it is down.";
const SETUP_POLICY_NAME = "Default on-call policy";
const SETUP_POLICY_ID = "70000000-0000-4000-8000-000000000001";
const SETUP_MONITOR_ID = "60000000-0000-4000-8000-000000000001";

const SETUP_MONITOR_WORDS = {
  title: aiActionSentence(AI_ACTION_TITLES.setUpWebsiteMonitoring, {
    address: "example.com",
  }),
  description: [
    aiActionPluralSentence(AI_ACTION_PLURAL_LINES.websiteMonitorChecks, 1, {
      url: "https://example.com",
    }),
    aiActionPluralSentence(AI_ACTION_PLURAL_LINES.checkedFromLocations, 2),
    aiActionSentence(AI_ACTION_LINES.monitorOpensIncident, {
      severity: "Critical Incident",
    }),
    aiActionSentence(AI_ACTION_LINES.monitorOwnerEmailed),
  ],
  describedArguments: ["address", "isApi", "checkEveryMinutes"],
};

const SETUP_PAGING_WORDS = {
  title: aiActionSentence(AI_ACTION_TITLES.createOnCallPolicy, {
    policy: JSON.stringify(SETUP_POLICY_NAME),
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.pagesYouForEveryNewEvent),
    aiActionSentence(AI_ACTION_LINES.noVerifiedPhoneForSms),
  ],
  describedArguments: [
    "includeMe",
    "reachMeBy",
    "userIds",
    "teamIds",
    "otherPeople",
    "pagedTeams",
  ],
};

// The plan's two parts, each with the status the person's decision left it.
function setupActions(monitorStatus, pagingStatus) {
  const monitor = describeAIActionWords(SETUP_MONITOR_WORDS);
  const paging = describeAIActionWords(SETUP_PAGING_WORDS);

  return [
    {
      id: "call_setup_monitor",
      toolName: "set_up_website_monitoring",
      title: monitor.title,
      description: monitor.description,
      words: SETUP_MONITOR_WORDS,
      ...(monitorStatus === AIChatToolActionStatus.Executed
        ? { widgetId: "W1" }
        : {}),
      arguments: {
        address: "example.com",
        checkEveryMinutes: 1,
        isApi: false,
      },
      isMutation: true,
      requiresApproval: true,
      status: monitorStatus,
    },
    {
      id: "call_setup_paging",
      toolName: "set_up_paging",
      title: paging.title,
      description: paging.description,
      words: SETUP_PAGING_WORDS,
      ...(pagingStatus === AIChatToolActionStatus.Executed
        ? { widgetId: "W2" }
        : {}),
      arguments: {
        reachMeBy: ["sms"],
        includeMe: true,
        userIds: [USER_ID],
        teamIds: [],
        otherPeople: [],
        pagedTeams: [],
      },
      isMutation: true,
      requiresApproval: true,
      status: pagingStatus,
    },
  ];
}

// The card the approved monitor leaves: it offers a test page to yourself.
function setupMonitorCard(minutes) {
  return [
    "W1",
    "Monitor set up",
    "example.com",
    {
      kind: aiActionTerm(AI_ACTION_CARD_KINDS.monitor),
      line: [
        aiActionPluralSentence(
          AI_ACTION_PLURAL_LINES.checkedEveryMinutes,
          minutes,
        ),
      ],
      facts: [
        aiActionCardFact(AI_ACTION_CARD_FACTS.address, "https://example.com"),
      ],
    },
    {
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: SETUP_MONITOR_ID },
    },
    { kind: "self" },
  ];
}

// Cards as WidgetBuilder.actionCard writes them.
function toSetupCards(cards) {
  return cards.map(([id, title, heading, words, link, testPage]) => {
    const english = describeAIActionCardWords(words);
    return {
      id,
      type: AIChatWidgetType.ResourceCard,
      title,
      data: {
        resourceType: english.kind,
        heading,
        subheading: english.line,
        fields: english.facts,
        words,
        link,
        ...(testPage ? { testPage } : {}),
      },
    };
  });
}

/*
 * The same kind of request in a busy project (?thread=setup-busy): its own
 * on-call policies page people already, so no policy is proposed beside
 * them, and it has a status page - "Monitor example.com and show it on our
 * status page" is the monitor, checked every 5 minutes as nobody asked for
 * another interval, and that monitor put on the project's status page.
 */
const SETUP_BUSY_QUESTION =
  "Monitor example.com and show it on our status page.";
const SETUP_STATUS_PAGE_NAME = "Acme status";
const SETUP_STATUS_PAGE_ID = "80000000-0000-4000-8000-000000000001";

const SETUP_BUSY_MONITOR_WORDS = {
  ...SETUP_MONITOR_WORDS,
  description: [
    aiActionPluralSentence(AI_ACTION_PLURAL_LINES.websiteMonitorChecks, 5, {
      url: "https://example.com",
    }),
    aiActionPluralSentence(AI_ACTION_PLURAL_LINES.checkedFromLocations, 2),
    aiActionSentence(AI_ACTION_LINES.monitorOpensIncident, {
      severity: "Critical Incident",
    }),
    aiActionSentence(AI_ACTION_LINES.monitorOwnerEmailed),
  ],
};

const SETUP_STATUS_PAGE_WORDS = {
  title: aiActionSentence(AI_ACTION_TITLES.addMonitorsToStatusPage, {
    statusPage: JSON.stringify(SETUP_STATUS_PAGE_NAME),
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.adds, {
      resources: aiActionList([
        aiActionSentence(AI_ACTION_NEW_MONITOR, {
          name: JSON.stringify("example.com"),
        }),
      ]),
    }),
  ],
  namedArguments: ["statusPage", "statusPageId"],
  describedArguments: ["monitors"],
};

// The busy project's plan: the monitor, and its place on the status page.
function setupBusyActions(monitorStatus, statusPageStatus) {
  const monitor = describeAIActionWords(SETUP_BUSY_MONITOR_WORDS);
  const statusPage = describeAIActionWords(SETUP_STATUS_PAGE_WORDS);

  return [
    {
      id: "call_setup_monitor",
      toolName: "set_up_website_monitoring",
      title: monitor.title,
      description: monitor.description,
      words: SETUP_BUSY_MONITOR_WORDS,
      ...(monitorStatus === AIChatToolActionStatus.Executed
        ? { widgetId: "W1" }
        : {}),
      arguments: { address: "example.com", isApi: false },
      isMutation: true,
      requiresApproval: true,
      status: monitorStatus,
    },
    {
      id: "call_setup_status_page",
      toolName: "add_monitors_to_status_page",
      title: statusPage.title,
      description: statusPage.description,
      words: SETUP_STATUS_PAGE_WORDS,
      ...(statusPageStatus === AIChatToolActionStatus.Executed
        ? { widgetId: "W2" }
        : {}),
      arguments: {
        statusPage: SETUP_STATUS_PAGE_NAME,
        statusPageId: SETUP_STATUS_PAGE_ID,
        monitors: ["example.com"],
      },
      isMutation: true,
      requiresApproval: true,
      status: statusPageStatus,
    },
  ];
}

// The cards the busy project's approved parts leave.
function setupBusyCards(data) {
  const cards = [];

  if (data.monitor) {
    cards.push(setupMonitorCard(5));
  }

  if (data.statusPage) {
    cards.push([
      "W2",
      "Monitors added to the status page",
      SETUP_STATUS_PAGE_NAME,
      {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.statusPage),
        line: [
          aiActionSentence(AI_ACTION_CARD_LINES.monitorsAdded, {
            monitors: aiActionList([
              aiActionSentence(AI_ACTION_NAME, {
                name: JSON.stringify("example.com"),
              }),
            ]),
          }),
        ],
      },
      {
        type: AIChatCitationTargetType.StatusPageView,
        params: { statusPageId: SETUP_STATUS_PAGE_ID },
      },
      null,
    ]);
  }

  return toSetupCards(cards);
}

// The cards the approved parts leave, each offering its test page.
function setupCards(data) {
  const cards = [];

  if (data.monitor) {
    cards.push(setupMonitorCard(1));
  }

  if (data.paging) {
    cards.push([
      "W2",
      "On-call policy created",
      SETUP_POLICY_NAME,
      {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.onCallPolicy),
        line: [aiActionSentence(AI_ACTION_CARD_LINES.pagesYouForEveryNewEvent)],
      },
      {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: SETUP_POLICY_ID },
      },
      {
        kind: "policy",
        policyId: SETUP_POLICY_ID,
        policyName: SETUP_POLICY_NAME,
      },
    ]);
  }

  return toSetupCards(cards);
}

// The cards the two leave once run (WidgetBuilder.actionCard).
function incidentNoteCards() {
  const heading = "#42 · Checkout latency above 2s";
  const link = {
    type: AIChatCitationTargetType.IncidentView,
    params: { incidentId: INCIDENT_ID },
  };
  const statusUpdateWords = {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
    line: [
      aiActionSentence(
        AI_ACTION_CARD_LINES.statusUpdatePostedSubscribersNotified,
      ),
    ],
    facts: [
      aiActionCardFact(AI_ACTION_CARD_FACTS.statusUpdate, STATUS_UPDATE_NOTE),
    ],
  };
  const noteWords = {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
    line: [aiActionSentence(AI_ACTION_CARD_LINES.privateNoteAddedToIncident)],
    facts: [aiActionCardFact(AI_ACTION_CARD_FACTS.note, INTERNAL_NOTE)],
  };

  return [
    ["W1", "Status update posted", statusUpdateWords],
    ["W2", "Internal note added", noteWords],
  ].map(([id, title, words]) => {
    const english = describeAIActionCardWords(words);
    return {
      id,
      type: AIChatWidgetType.ResourceCard,
      title,
      data: {
        resourceType: english.kind,
        heading,
        subheading: english.line,
        fields: english.facts,
        words,
        link,
      },
    };
  });
}

const LATENCY_QUESTION = "Why did checkout latency spike this afternoon?";

/*
 * An answer that carries what a tool returns at its widest: four figures,
 * a table whose first and last columns hold long values (an endpoint with
 * no spaces to wrap at, a service with a long name), and a trace. Each has
 * to fit the dialog's column at 1280 pixels and a phone's whole screen.
 */
let richConversation = null;
// The conversation waiting to post a status update and a note (?thread=actions).
let actionsConversation = null;
// The conversation waiting to commit three files (?thread=code).
let codeConversation = null;
// The conversation waiting on a setup plan (?thread=setup).
let setupConversation = null;
// The same in a project that pages people already (?thread=setup-busy).
let setupBusyConversation = null;
// The conversation that looked monitors up (?thread=monitors).
let monitorsConversation = null;

/*
 * The card query_monitors leaves for a monitor read by id, built as the
 * tool builds it (WidgetBuilder.resourceCard): a read's, drawn plain, with
 * its status's own colour - gray when its monitoring is off (issue #6968) -
 * and its words, which the chat says in the reader's language: its type,
 * "Last status" and "Off - not checked" OneUptime's words, its status as
 * the project named it (issue #7175).
 */
function monitorCard({
  id,
  name,
  monitorId,
  monitorType,
  statusName,
  isMonitoringOff,
  statusColor,
}) {
  return {
    ...WidgetBuilder.resourceCard({
      title: `Monitor ${name}`,
      heading: name,
      words: getMonitorCardWords({
        monitorType,
        statusName,
        isMonitoringOff,
        isArchived: false,
      }),
      statusColor,
      link: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId },
      },
    }),
    id,
  };
}

/*
 * "Which monitors are down right now?", answered: the two monitors it read
 * by id, and the monitors table query_monitors lists them in - a monitor
 * named by its URL, with no spaces to wrap at, beside statuses that are
 * one word each (issue #6969).
 */
function seedMonitorsAnswer() {
  monitorsConversation = conversationOf("Monitors down right now", 2);
  messageOf(monitorsConversation.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: "Which monitors are down right now?",
    createdAt: minutesAgo(3),
  });
  messageOf(monitorsConversation.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown:
      "One monitor is down: **Checkout API** has been Offline since its last check. **Backup Job** is not checked: its monitoring is off, so its status is the last one it had.",
    widgets: [
      monitorCard({
        id: "W1",
        name: "Checkout API",
        monitorId: "60000000-0000-4000-8000-000000000001",
        monitorType: MonitorType.Website,
        statusName: "Offline",
        isMonitoringOff: false,
        statusColor: "#fd625e",
      }),
      monitorCard({
        id: "W2",
        name: "Backup Job",
        monitorId: "60000000-0000-4000-8000-000000000004",
        monitorType: MonitorType.IncomingRequest,
        statusName: "Operational",
        isMonitoringOff: true,
        statusColor: "#6b7280",
      }),
      {
        id: "W3",
        type: AIChatWidgetType.Table,
        title: "Monitors (4)",
        data: {
          columns: [
            { key: "name", title: "Monitor", type: "text" },
            { key: "type", title: "Type", type: "text" },
            { key: "currentStatus", title: "Status", type: "text" },
          ],
          rows: [
            {
              name: "Checkout API",
              type: "Website",
              currentStatus: "Offline",
            },
            {
              name: "https://payments.example.com/api/v2/health/checkout",
              type: "Website",
              currentStatus: "Operational",
            },
            {
              name: "legacy-payments-api",
              type: "API",
              currentStatus: "Operational",
            },
            {
              name: "Backup Job",
              type: "Incoming Request",
              currentStatus: "Disabled",
            },
          ],
          link: { type: AIChatCitationTargetType.Monitors },
        },
      },
    ],
    createdAt: minutesAgo(2),
  });
}

// The conversation that looked up one of each record a read leaves a card for (?thread=readcards).
let readCardsConversation = null;

/*
 * Every card a read leaves, each built as its tool builds it
 * (WidgetBuilder.resourceCard with its builder in ReadCardWords): the
 * kind, the line and each fact's name are OneUptime's words, which the
 * chat says in the reader's language, and the names, the statuses the
 * project chose, a URL and an entity's value are data, drawn as written
 * (issue #7175). One of each, with the facts each tool says most.
 */
function readCards() {
  const read = (id, title, heading, words, link, statusColor) => {
    return {
      ...WidgetBuilder.resourceCard({
        title,
        heading,
        words,
        link,
        ...(statusColor ? { statusColor } : {}),
      }),
      id,
    };
  };

  return [
    read(
      "R1",
      "Monitor payments-api",
      "payments-api",
      getMonitorCardWords({
        monitorType: MonitorType.API,
        statusName: "Degraded",
        isMonitoringOff: false,
        isArchived: false,
        ownerTeamNames: "Payments, SRE",
        ownerUserNames: "Ana Souza",
      }),
      {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: "60000000-0000-4000-8000-000000000002" },
      },
      "#f59e0b",
    ),
    read(
      "R2",
      "SLO Checkout availability",
      "Checkout availability",
      getSloCardWords({
        description: "Checkout requests that succeed, over 30 days.",
        targetPercentage: 99.9,
        windowType: SloWindowType.Rolling,
        windowDays: 30,
        sliType: SliType.MonitorUptime,
        isArchived: false,
        isEnabled: true,
        sloStatus: SloStatus.AtRisk,
        currentSliPercentage: 99.874,
        errorBudgetRemainingPercentage: 12.5,
        currentBurnRate: 2.4,
        monitorNames: "Checkout API, payments-api",
        monitorRules: { isVisible: true, count: 2, enabledCount: 1 },
        burnRateRules: { isVisible: true, count: 3 },
        policyTiers: {
          currentName: "Freeze risky deploys",
          isVisible: true,
          count: 2,
        },
        deploymentsAllowed: false,
      }),
      {
        type: AIChatCitationTargetType.SloView,
        params: { sloId: "61000000-0000-4000-8000-000000000001" },
      },
    ),
    read(
      "R3",
      "Team",
      "Database reliability",
      getEmptyTeamCardWords({
        description: "Owns the payments databases and their backups.",
      }),
      { type: AIChatCitationTargetType.Teams },
    ),
    read(
      "R4",
      "On-call policy: Payments primary",
      "Payments primary",
      getOnCallPolicyCardWords({
        description: "Pages for every payments incident.",
        isArchived: false,
        rules: [
          {
            order: 1,
            users: ["Ana Souza"],
            teams: ["SRE"],
            schedules: [],
            escalateAfterInMinutes: 15,
          },
          {
            order: 2,
            name: "Database team",
            users: [],
            teams: [],
            schedules: ["Payments weekly rotation"],
            escalateAfterInMinutes: 30,
          },
          {
            order: 3,
            users: [],
            teams: [],
            schedules: [],
            escalateAfterInMinutes: 0,
          },
        ],
      }),
      {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: "62000000-0000-4000-8000-000000000001" },
      },
    ),
    read(
      "R5",
      "On-call schedule 'Payments weekly rotation'",
      "Payments weekly rotation",
      getOnCallScheduleCardWords({
        onCallNow: "Ana Souza",
        rosterStartAt: minutesAgo(60 * 26),
        rosterHandoffAt: minutesAgo(-60 * 142),
        nextUp: "Jonas Müller",
        rosterNextStartAt: minutesAgo(-60 * 142),
      }),
      { type: AIChatCitationTargetType.OnCallPolicies },
    ),
    read(
      "R6",
      "Status page: Acme Status",
      "Acme Status",
      getStatusPageCardWords({
        description: "Checkout, payments and backups, for our customers.",
        isPublic: true,
        isArchived: false,
        publicUrl: "https://status.acme.example.com",
        resourceCount: 3,
        resources: [
          {
            name: "Checkout",
            source: { name: "Checkout API", isMonitorGroup: false },
            isNotMonitored: false,
          },
          {
            name: "Payments",
            source: { name: "Payments stack", isMonitorGroup: true },
            isNotMonitored: false,
          },
          { name: "Backups", isNotMonitored: true },
        ],
        activeSubscribers: 1284,
      }),
      {
        type: AIChatCitationTargetType.StatusPageView,
        params: { statusPageId: "63000000-0000-4000-8000-000000000001" },
      },
    ),
    read(
      "R7",
      "Runbook",
      "Restart the payments worker",
      getEmptyRunbookCardWords({
        description: "Drains the queue, then restarts the worker.",
        isEnabled: false,
      }),
      {
        type: AIChatCitationTargetType.RunbookView,
        params: { runbookId: "64000000-0000-4000-8000-000000000001" },
      },
    ),
    read(
      "R8",
      'Workflow "Page on-call when a deploy fails"',
      "Page on-call when a deploy fails",
      getUnrunWorkflowCardWords({
        description: "Runs on every failed deploy of payments-api.",
        isEnabled: true,
        isArchived: false,
      }),
      {
        type: AIChatCitationTargetType.WorkflowView,
        params: { workflowId: "65000000-0000-4000-8000-000000000001" },
      },
    ),
    read(
      "R9",
      "Security case",
      "SC-17 Sign-ins from a new country",
      getSecurityCaseCardWords({
        statusName: "Investigating",
        priorityName: "High",
        detectionCount: 4,
        entities: [
          { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
          { type: SecurityEntityType.User, value: "ana@acme.example.com" },
        ],
      }),
      {
        type: AIChatCitationTargetType.SecurityCaseView,
        params: { securityCaseId: "66000000-0000-4000-8000-000000000001" },
      },
    ),
  ];
}

function seedReadCardsAnswer() {
  readCardsConversation = conversationOf("What we have for payments", 2);
  messageOf(readCardsConversation.id.toString(), AIChatMessageRole.User, {
    contentInMarkdown: "What do we have set up for payments?",
    createdAt: minutesAgo(3),
  });
  messageOf(readCardsConversation.id.toString(), AIChatMessageRole.Assistant, {
    contentInMarkdown:
      "Here is everything set up for payments: its monitor, SLO, team, on-call, status page, runbook, workflow and open security case.",
    widgets: readCards(),
    createdAt: minutesAgo(2),
  });
}

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
      /*
       * What search_security_events puts beside an answer (SecurityEventTools):
       * dates, as JSON carries them, under column names the tool marks as
       * keys, so the chat draws them in the reader's language.
       */
      {
        id: "W4",
        type: AIChatWidgetType.Table,
        title: "Security Events (3)",
        data: {
          columns: [
            { key: "time", title: "Time", type: "date" },
            { key: "severity", title: "Severity", type: "text" },
            { key: "eventShown", title: "Event", type: "text" },
            { key: "principalHost", title: "Host", type: "text" },
          ],
          rows: [
            {
              time: minutesAgo(3).toISOString(),
              severity: "High",
              eventShown: "Brute force from one address · sshd",
              principalHost: "web-01",
            },
            {
              time: minutesAgo(41).toISOString(),
              severity: "Medium",
              eventShown: "Process Activity: Inject · lsass.exe",
              principalHost: "win-dc-02",
            },
            {
              time: minutesAgo(60 * 26).toISOString(),
              severity: "Low",
              eventShown: "User login to Okta (Failure)",
              principalHost: "vpn-gw",
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

  if (threadKind === "code") {
    codeConversation = conversationOf("Round billing to the cent", 4);
    messageOf(codeConversation.id.toString(), AIChatMessageRole.User, {
      contentInMarkdown:
        "Charges and refunds differ by a cent. Fix it on fix/login.",
      createdAt: minutesAgo(4),
    });
    messageOf(codeConversation.id.toString(), AIChatMessageRole.Assistant, {
      contentInMarkdown: "",
      status: AIChatMessageStatus.WaitingForApproval,
      toolActions: [codeChangeAction(AIChatToolActionStatus.Pending)],
      createdAt: minutesAgo(4),
    });
  }

  if (threadKind === "setup") {
    setupConversation = conversationOf("Monitor example.com and text me", 2);
    messageOf(setupConversation.id.toString(), AIChatMessageRole.User, {
      contentInMarkdown: SETUP_QUESTION,
      createdAt: minutesAgo(2),
    });
    messageOf(setupConversation.id.toString(), AIChatMessageRole.Assistant, {
      contentInMarkdown: "",
      status: AIChatMessageStatus.WaitingForApproval,
      toolActions: setupActions(
        AIChatToolActionStatus.Pending,
        AIChatToolActionStatus.Pending,
      ),
      createdAt: minutesAgo(2),
    });
  }

  if (threadKind === "setup-busy") {
    setupBusyConversation = conversationOf(
      "Monitor example.com on our status page",
      2,
    );
    messageOf(setupBusyConversation.id.toString(), AIChatMessageRole.User, {
      contentInMarkdown: SETUP_BUSY_QUESTION,
      createdAt: minutesAgo(2),
    });
    messageOf(
      setupBusyConversation.id.toString(),
      AIChatMessageRole.Assistant,
      {
        contentInMarkdown: "",
        status: AIChatMessageStatus.WaitingForApproval,
        toolActions: setupBusyActions(
          AIChatToolActionStatus.Pending,
          AIChatToolActionStatus.Pending,
        ),
        createdAt: minutesAgo(2),
      },
    );
  }

  if (threadKind === "actions") {
    actionsConversation = conversationOf("Update the status page", 5);
    messageOf(actionsConversation.id.toString(), AIChatMessageRole.User, {
      contentInMarkdown:
        "Post a status update that we found the cause, and note what we did.",
      createdAt: minutesAgo(5),
    });
    messageOf(actionsConversation.id.toString(), AIChatMessageRole.Assistant, {
      contentInMarkdown: "",
      status: AIChatMessageStatus.WaitingForApproval,
      toolActions: incidentNoteActions(AIChatToolActionStatus.Pending),
      createdAt: minutesAgo(5),
    });
  }

  if (threadKind === "monitors") {
    seedMonitorsAnswer();
  }

  if (threadKind === "readcards") {
    seedReadCardsAnswer();
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
  actions: actionsConversation?.id.toString(),
  code: codeConversation?.id.toString(),
  monitors: monitorsConversation?.id.toString(),
  readcards: readCardsConversation?.id.toString(),
  setup: setupConversation?.id.toString(),
  "setup-busy": setupBusyConversation?.id.toString(),
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

  // The project's incident states, which tell whether the incident is resolved.
  if (table === "IncidentState") {
    const states = [
      Object.assign(new IncidentState(), {
        _id: OPEN_STATE_ID,
        id: new ObjectID(OPEN_STATE_ID),
        order: 1,
        isCreatedState: true,
      }),
      Object.assign(new IncidentState(), {
        _id: RESOLVED_STATE_ID,
        id: new ObjectID(RESOLVED_STATE_ID),
        order: 2,
        isResolvedState: true,
      }),
    ];
    return { data: states, count: states.length, skip: 0, limit: 100 };
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
      // Its state, when the read asks for it, as the API answers.
      ...(options.select?.currentIncidentStateId
        ? {
            currentIncidentStateId: new ObjectID(
              isIncidentResolved ? RESOLVED_STATE_ID : OPEN_STATE_ID,
            ),
          }
        : {}),
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

  /*
   * A setup plan: each part as the person decided it - an approved one
   * leaves its card, which offers its test page, a skipped one is not made.
   */
  if (data.conversationId === setupConversation?.id.toString()) {
    const isApproved = (id) => {
      return (data.decisions || []).some((decision) => {
        return decision.toolCallId === id && decision.approved;
      });
    };
    const monitor = isApproved("call_setup_monitor");
    const paging = isApproved("call_setup_paging");
    const statusOf = (approvedPart) => {
      return approvedPart
        ? AIChatToolActionStatus.Executed
        : AIChatToolActionStatus.Denied;
    };

    message.toolActions = setupActions(statusOf(monitor), statusOf(paging));
    message.status = AIChatMessageStatus.Completed;
    message.contentInMarkdown =
      monitor || paging
        ? "example.com is checked every minute, and the Default on-call policy pages you for every new incident and alert. Texts reach you once you add and verify your phone number in Notification Methods. Send yourself a test page to be sure it works."
        : "I did not set anything up.";
    message.widgets = setupCards({ monitor, paging });
    message.aiRunId = runOf({ toolCallCount: 4, totalTokens: 7310 }).id;
    return {};
  }

  // The busy project's plan: its own policies still decide who is paged.
  if (data.conversationId === setupBusyConversation?.id.toString()) {
    const isApproved = (id) => {
      return (data.decisions || []).some((decision) => {
        return decision.toolCallId === id && decision.approved;
      });
    };
    const monitor = isApproved("call_setup_monitor");
    const statusPage = isApproved("call_setup_status_page");
    const statusOf = (approvedPart) => {
      return approvedPart
        ? AIChatToolActionStatus.Executed
        : AIChatToolActionStatus.Denied;
    };

    message.toolActions = setupBusyActions(
      statusOf(monitor),
      statusOf(statusPage),
    );
    message.status = AIChatMessageStatus.Completed;
    message.contentInMarkdown =
      monitor || statusPage
        ? "example.com is checked every 5 minutes and shown on Acme status. Your project's own on-call policies decide who is paged when it goes down: ask who is told when example.com goes down to see them. Send yourself a test page to be sure it reaches you."
        : "I did not set anything up.";
    message.widgets = setupBusyCards({ monitor, statusPage });
    message.aiRunId = runOf({ toolCallCount: 5, totalTokens: 8120 }).id;
    return {};
  }

  // The status update and the note: both run, and leave their two cards.
  if (data.conversationId === actionsConversation?.id.toString()) {
    message.toolActions = incidentNoteActions(
      approved
        ? AIChatToolActionStatus.Executed
        : AIChatToolActionStatus.Denied,
    );
    message.status = AIChatMessageStatus.Completed;
    message.contentInMarkdown = approved
      ? "I posted the status update, and added the note for your team."
      : "I did not post anything.";
    message.widgets = approved ? incidentNoteCards() : [];
    message.aiRunId = runOf({ toolCallCount: 2, totalTokens: 5120 }).id;
    return {};
  }

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
    ar: { translation: AR },
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

// A link inside the app, as the Dashboard's menus and tables have them.
function PageLink(props) {
  return (
    <a
      href={props.to}
      data-testid={props.testId}
      onClick={(event) => {
        event.preventDefault();
        fixture.navigate(props.to);
      }}
      className="rounded-md px-3 py-2 hover:bg-gray-100"
    >
      {props.children}
    </a>
  );
}

/*
 * A Dashboard page to work on beside the panel: the header with the real
 * Ask AI button, links to the other pages, one of the app's own side panels
 * to open, and a page of cards. What matters is that it is busy, real-looking
 * and all there while the panel is open: nothing behind it, and all of it
 * answering.
 */
function Frame(props) {
  const [isSideOverOpen, setIsSideOverOpen] = React.useState(false);

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
            <PageLink to={PAGE_PATHS.home} testId="fixture-link-home">
              Home
            </PageLink>
            <PageLink to={PAGE_PATHS.logs} testId="fixture-link-logs">
              Logs
            </PageLink>
            <PageLink to={PAGE_PATHS.incident} testId="fixture-link-incident">
              Incident
            </PageLink>
          </nav>
          {/*
           * Search is a wide-screen entry, as in the Dashboard's header,
           * which leaves it off below lg (max-lg:hidden). Ask AI stays at
           * every width - the suite opens the panel from it on a phone -
           * and takes the room: its label is the reader's, and Persian's
           * ("پرسش از هوش مصنوعی") is three times as long as "Ask AI".
           */}
          <div className="ms-auto flex items-center">
            <button
              type="button"
              data-testid="fixture-page-button"
              className="max-lg:hidden me-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
            >
              Search
            </button>
            <AskAI />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {props.children}
        <button
          type="button"
          data-testid="fixture-open-side-over"
          onClick={() => {
            setIsSideOverOpen(true);
          }}
          className="mt-6 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          Open details
        </button>
      </main>
      {isSideOverOpen ? (
        <SideOver
          title="Span details"
          description="The span the trace was slowest in."
          onClose={() => {
            setIsSideOverOpen(false);
          }}
        >
          <p className="p-6 text-sm text-gray-600">checkout-api · 2.4 s</p>
        </SideOver>
      ) : (
        <></>
      )}
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
      <AskAiPanel />
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

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
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
