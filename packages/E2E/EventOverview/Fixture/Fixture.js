/*
 * Offline fixture for the real event overview pages: Incident, Alert,
 * Scheduled Maintenance, Incident Episode and Alert Episode.
 *
 * Each page's Layout (ModelPage + SideMenu) and Index are the production
 * components from this branch, mounted under their real RouteMap patterns.
 * Only the data boundary (ModelAPI / AnalyticsModelAPI / API) and the
 * signed-in user are replaced.
 *
 * Every record is fabricated for a generic "Acme Commerce" workspace. The
 * clock is pinned: every date is relative to NOW = 2026-09-14T18:20:00Z and
 * the spec fixes the browser clock to the same instant.
 *
 * Scenarios are picked with query parameters (parsed once at load, so a
 * scenario change needs a fresh page.goto):
 *
 *   ?state=  resolved (default) | ongoing | created
 *            Incident #1042, Alert #311 and both episodes. "ongoing" stops
 *            them at Acknowledged, "created" before it.
 *   ?ai=     report (default) | none | queued | running | failed | pending
 *            | legacy
 *            What POST /ai-investigation/{incident,alert} returns for
 *            Incident #1042 and Alert #311. Other incidents/alerts have no run.
 *            "legacy" is a completed report from an API replica that predates
 *            structured evidence: no `evidence` or `references` keys.
 *   ?tldr=   default | long
 *            "long" gives Incident #1042 a TL;DR at the server's
 *            320-character cap (InvestigationTldr.MAX_TLDR_CHARS), long
 *            enough to wrap and clamp in the event header.
 *   ?title=  default | long
 *            "long" gives Alert #311 a 67-character title, wider than the
 *            room its header leaves beside the actions from 1280px, so the
 *            title row has to give way somewhere.
 *   ?verdict= none (default) | confirmed | rejected
 *            A responder's verdict already saved on the completed runs of
 *            Incident #1042 and Alert #311, as if rated before the page
 *            loaded.
 *   ?sm=     scheduled (default, starts in 2h) | ongoing | ended | overdue
 *            | overrun
 *            Scheduled Maintenance #58. "overdue" is still Scheduled 20
 *            minutes after its start; "overrun" is still Ongoing 30 minutes
 *            after its end.
 *   ?fail=   comma separated: evidence, verdict, create-fix-task,
 *            investigation, conversation, conversation-send, resend. The
 *            matching API call throws HTTPErrorResponse. "conversation" is
 *            the read of the AI card's thread and "conversation-send" a
 *            question sent to it. "resend" also marks the subscriber
 *            notifications of Incident #1042 and Scheduled Maintenance #58 as
 *            Failed, so the details cards offer a retry that is refused.
 *   ?resources= default | many | none
 *            What Incident #1042 is attached to, for its Affected Resources
 *            card. "many" adds more monitors and services, two hosts, a
 *            Kubernetes cluster and an SLO: five categories, one of them
 *            behind a Show more. "none" leaves Incident #1042 and Scheduled
 *            Maintenance #58 with nothing attached, for the empty state.
 *   ?thread= empty (default) | answered | working | approval | error
 *            | crowded
 *            What the conversation that closes the AI Investigation card of
 *            Incident #1042 and Alert #311 holds: nobody has asked,
 *            two answered questions (one of them the viewer's, with a table,
 *            an executed action and a source), an answer being written with
 *            its live steps, an action waiting for approval, a failed and a
 *            stopped answer, or twelve messages from six people (long enough
 *            to open folded). Sending, approving and stopping are modelled:
 *            see "The investigation card's conversation" below.
 *   ?theme=  dark adds html.dark (handled by server.js).
 *   ?role=   owner (default) | alert-member | loading
 *            Who is signed in. "owner" is a master admin who is also the
 *            Project Owner, so every permission gate is open. "alert-member"
 *            is not a master admin and holds only Alert Member: it may
 *            acknowledge and resolve alerts but not create an incident, so
 *            gated actions show disabled with the reason. "loading" is the
 *            moment before the permission snapshot arrives (no permissions
 *            yet), when gated actions are hidden rather than refused.
 *
 * Every read and write is recorded on window.__eventOverviewFixture:
 *   getItemRequests, listRequests, countRequests, apiRequests, updates,
 *   creates, deletes, and unhandled — anything the fixture does not model
 *   (a model table, an analytics query or an API URL). A spec can assert
 *   `unhandled` is empty for the pages it covers.
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
import IncidentViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Layout";
import IncidentView from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import AlertViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Layout";
import AlertView from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index";
import ScheduledMaintenanceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Layout";
import ScheduledMaintenanceView from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import IncidentEpisodeViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Layout";
import IncidentEpisodeView from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Index";
import AlertEpisodeViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Layout";
import AlertEpisodeView from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Index";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeFeed, {
  AlertEpisodeFeedEventType,
} from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertFeed, {
  AlertFeedEventType,
} from "Common/Models/DatabaseModels/AlertFeed";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import AlertMeasurement from "Common/Models/DatabaseModels/AlertMeasurement";
import AlertMeasurementValue from "Common/Models/DatabaseModels/AlertMeasurementValue";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import AutoRemediationDecision from "Common/Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeFeed, {
  IncidentEpisodeFeedEventType,
} from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentMeasurement from "Common/Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementValue from "Common/Models/DatabaseModels/IncidentMeasurementValue";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenanceMeasurement from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIRunCodeFixRecommendation from "Common/Types/AI/AIRunCodeFixRecommendation";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import {
  AIChatCitationTargetType,
  AIChatToolActionStatus,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import MeasurementAnchorKind from "Common/Types/Measurement/MeasurementAnchorKind";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PositiveNumber from "Common/Types/PositiveNumber";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MeasurementEvaluator from "Common/Utils/Measurement/MeasurementEvaluator";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const stateMode = ["ongoing", "created"].includes(params.get("state"))
  ? params.get("state")
  : "resolved";
const aiMode = params.get("ai") || "report";
const tldrMode = params.get("tldr") === "long" ? "long" : "default";
const titleMode = params.get("title") === "long" ? "long" : "default";
const presetVerdict =
  params.get("verdict") === "confirmed"
    ? "Confirmed"
    : params.get("verdict") === "rejected"
      ? "Rejected"
      : null;
const smMode = params.get("sm") || "scheduled";
const failures = new Set(
  (params.get("fail") || "").split(",").filter((value) => value.length > 0),
);
const roleMode = ["alert-member", "loading"].includes(params.get("role"))
  ? params.get("role")
  : "owner";
const resourcesMode = ["many", "none"].includes(params.get("resources"))
  ? params.get("resources")
  : "default";
/*
 * Which Kubernetes clusters the investigation payload's clusterAccess lists
 * (what OneUptime AI can reach with kubectl now): none (the default, and
 * what a signal with no cluster gets), one it can reach, one it cannot, or
 * both.
 */
const clustersMode = ["reachable", "unreachable", "mixed"].includes(
  params.get("clusters"),
)
  ? params.get("clusters")
  : "none";
/*
 * What the investigation card's shared conversation holds for incident #1042
 * and alert #311 (see "The investigation card's conversation" below): nobody
 * has asked anything (the default), two answered questions, an answer being
 * written, an action waiting for approval, a failed and a stopped answer, or
 * a long thread six people asked in.
 */
const THREAD_MODES = ["answered", "working", "approval", "error", "crowded"];
const threadMode = THREAD_MODES.includes(params.get("thread"))
  ? params.get("thread")
  : "empty";
const isResolved = stateMode === "resolved";
const isAcknowledged = stateMode !== "created";
// Both a current report and a legacy one post the AI root-cause feed item.
const hasReport = aiMode === "report" || aiMode === "legacy";

/*
 * ---------------------------------------------------------------------------
 * Clock and ids
 * ---------------------------------------------------------------------------
 */
const NOW = new Date("2026-09-14T18:20:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * A time on the fixture's "today" (2026-09-14, UTC): at("18:01"),
 * at("18:01:20") or at("18:01", 20).
 */
function at(time, extraSeconds) {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return new Date(
    Date.UTC(2026, 8, 14, hours, minutes, (seconds || 0) + (extraSeconds || 0)),
  );
}

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const ID = {
  incident: (number) => uuid("20000000", number),
  incidentState: (number) => uuid("21000000", number),
  incidentSeverity: (number) => uuid("22000000", number),
  alert: (number) => uuid("30000000", number),
  alertState: (number) => uuid("31000000", number),
  alertSeverity: (number) => uuid("32000000", number),
  scheduledMaintenance: (number) => uuid("40000000", number),
  scheduledMaintenanceState: (number) => uuid("41000000", number),
  incidentEpisode: (number) => uuid("50000000", number),
  alertEpisode: (number) => uuid("60000000", number),
  monitor: (number) => uuid("70000000", number),
  onCallPolicy: (number) => uuid("71000000", number),
  label: (number) => uuid("72000000", number),
  probe: (number) => uuid("73000000", number),
  statusPage: (number) => uuid("74000000", number),
  service: (number) => uuid("75000000", number),
  role: (number) => uuid("76000000", number),
  aiRun: (number) => uuid("77000000", number),
  groupingRule: (number) => uuid("78000000", number),
  user: (number) => uuid("80000000", number),
  team: (number) => uuid("81000000", number),
  task: (number) => uuid("82000000", number),
  host: (number) => uuid("84000000", number),
  kubernetesCluster: (number) => uuid("85000000", number),
  slo: (number) => uuid("86000000", number),
  cluster: (number) => uuid("83000000", number),
  measurement: (number) => uuid("87000000", number),
};
let rowCounter = 0;
function rowId() {
  rowCounter += 1;
  return uuid("90000000", rowCounter);
}

const projectObjectId = new ObjectID(PROJECT_ID);
const dashboard = `/dashboard/${PROJECT_ID}`;

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  now: NOW.toISOString(),
  scenario: {
    state: stateMode,
    ai: aiMode,
    tldr: tldrMode,
    title: titleMode,
    verdict: presetVerdict,
    sm: smMode,
    fail: Array.from(failures),
    role: roleMode,
    resources: resourcesMode,
    clusters: clustersMode,
    thread: threadMode,
  },
  getItemRequests: [],
  listRequests: [],
  countRequests: [],
  apiRequests: [],
  updates: [],
  creates: [],
  deletes: [],
  unhandled: [],
};
window.__eventOverviewFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function ok(data) {
  return new HTTPResponse(200, serialize(data), {});
}

function fail(statusCode, message) {
  return new HTTPErrorResponse(statusCode, { message }, {});
}

function make(modelType, record) {
  return Object.assign(new modelType(), record);
}

/*
 * ---------------------------------------------------------------------------
 * In-memory tables, keyed by model table name. Records are plain objects
 * whose relation values are already model instances; every read hands out a
 * fresh model instance.
 * ---------------------------------------------------------------------------
 */
const tables = new Map();

function table(modelType) {
  const tableName = new modelType().tableName;
  if (!tables.has(tableName)) {
    tables.set(tableName, { modelType, records: [] });
  }
  return tables.get(tableName).records;
}

function insert(modelType, record) {
  const full = { _id: rowId(), projectId: projectObjectId, ...record };
  table(modelType).push(full);
  return make(modelType, full);
}

function comparable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "object" && value.constructor !== Object) {
    return value.toString();
  }
  return value;
}

function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || key === "projectId") {
      continue;
    }
    const actual = record[key];
    if (condition instanceof Includes) {
      if (!condition.values.map(String).includes(String(comparable(actual)))) {
        return false;
      }
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(actual ?? "")
          .toLowerCase()
          .includes(String(condition.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotEqual) {
      if (String(comparable(actual)) === String(comparable(condition.value))) {
        return false;
      }
      continue;
    }
    if (
      condition === null ||
      typeof condition !== "object" ||
      condition instanceof ObjectID
    ) {
      if (String(comparable(actual)) !== String(comparable(condition))) {
        return false;
      }
    }
    // Other operators and nested relation filters are not modelled: match.
  }
  return true;
}

function sortRecords(records, sort) {
  const entries = Object.entries(sort || {});
  if (entries.length === 0) {
    return records;
  }
  return [...records].sort((left, right) => {
    for (const [key, order] of entries) {
      const a = comparable(left[key]);
      const b = comparable(right[key]);
      if (a === b) {
        continue;
      }
      const direction = order === SortOrder.Descending ? -1 : 1;
      if (a === undefined || a === null) {
        return direction;
      }
      if (b === undefined || b === null) {
        return -direction;
      }
      return a > b ? direction : -direction;
    }
    return 0;
  });
}

/*
 * ---------------------------------------------------------------------------
 * Shared catalogue: people, labels, monitors, services, policies, states
 * ---------------------------------------------------------------------------
 */
function person(number, name, email) {
  return make(User, {
    _id: ID.user(number),
    name: new Name(name),
    email: new Email(email),
  });
}

const people = {
  maya: person(1, "Maya Chen", "maya.chen@acme-commerce.example"),
  sam: person(2, "Sam Rivera", "sam.rivera@acme-commerce.example"),
  jordan: person(3, "Jordan Patel", "jordan.patel@acme-commerce.example"),
  alex: person(4, "Alex Kim", "alex.kim@acme-commerce.example"),
};

const project = make(Project, {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

const team = insert(Team, {
  _id: ID.team(1),
  name: "Checkout SRE",
  description: "Owns checkout-api, cart and the orders database.",
});
for (const member of Object.values(people)) {
  insert(TeamMember, {
    teamId: team.id,
    team,
    userId: member.id,
    user: member,
    hasAcceptedInvitation: true,
  });
}

function label(number, name, color) {
  return insert(Label, {
    _id: ID.label(number),
    name,
    color: new Color(color),
  });
}

const labels = {
  checkout: label(1, "team:checkout", "#4f46e5"),
  production: label(2, "env:production", "#059669"),
  payments: label(3, "team:payments", "#0891b2"),
  platform: label(4, "team:platform", "#7c3aed"),
};

const monitorStatus = {
  operational: insert(MonitorStatus, {
    _id: uuid("83000000", 1),
    name: "Operational",
    color: new Color("#10b981"),
  }),
  degraded: insert(MonitorStatus, {
    _id: uuid("83000000", 2),
    name: "Degraded",
    color: new Color("#f59e0b"),
  }),
};

function monitor(number, name, monitorType, status) {
  return insert(Monitor, {
    _id: ID.monitor(number),
    name,
    monitorType,
    currentMonitorStatus: status,
    currentMonitorStatusId: status.id,
  });
}

const monitors = {
  checkoutLatency: monitor(
    1,
    "Checkout API p95 latency",
    MonitorType.API,
    isResolved ? monitorStatus.operational : monitorStatus.degraded,
  ),
  ordersPool: monitor(
    2,
    "Orders DB connection pool",
    MonitorType.Metrics,
    isResolved ? monitorStatus.operational : monitorStatus.degraded,
  ),
  webhookErrors: monitor(
    3,
    "Payment webhook error rate",
    MonitorType.Metrics,
    isResolved ? monitorStatus.operational : monitorStatus.degraded,
  ),
  ordersPrimary: monitor(
    4,
    "orders-db primary (Postgres)",
    MonitorType.Port,
    monitorStatus.operational,
  ),
};

function service(number, name, color) {
  return insert(Service, {
    _id: ID.service(number),
    name,
    serviceColor: new Color(color),
  });
}

const services = {
  checkout: service(1, "checkout-api", "#6366f1"),
  orders: service(2, "orders-db", "#0ea5e9"),
  payments: service(3, "payments-webhooks", "#14b8a6"),
};

/*
 * What Incident #1042 is attached to (?resources=). The default is its two
 * monitors and two services. "many" gives the Affected Resources card five
 * categories, six monitors among them (so two wait behind Show more) and a
 * name too long for the sidebar; its extra records exist only then.
 */
function incidentResources() {
  if (resourcesMode === "none") {
    return { monitors: [], services: [] };
  }

  if (resourcesMode !== "many") {
    return {
      monitors: [monitors.checkoutLatency, monitors.ordersPool],
      services: [services.checkout, services.orders],
    };
  }

  return {
    monitors: [
      monitors.checkoutLatency,
      monitors.ordersPool,
      monitor(
        5,
        "Checkout web journey (synthetic) from eu-west-1 and us-east-1",
        MonitorType.SyntheticMonitor,
        monitorStatus.operational,
      ),
      monitor(
        6,
        "Payments API uptime",
        MonitorType.API,
        monitorStatus.operational,
      ),
      monitor(
        7,
        "Cart API p99 latency",
        MonitorType.API,
        monitorStatus.operational,
      ),
      monitor(
        8,
        "CDN edge eu-west",
        MonitorType.Website,
        monitorStatus.operational,
      ),
    ],
    hosts: [
      insert(Host, { _id: ID.host(1), name: "checkout-api-7f9c" }),
      insert(Host, { _id: ID.host(2), name: "orders-db-primary" }),
    ],
    kubernetesClusters: [
      insert(KubernetesCluster, {
        _id: ID.kubernetesCluster(1),
        name: "prod-eks-eu-west-1",
      }),
    ],
    services: [services.checkout, services.orders, services.payments],
    serviceLevelObjectives: [
      insert(ServiceLevelObjective, {
        _id: ID.slo(1),
        name: "Checkout availability 99.9%",
      }),
    ],
  };
}

const policies = {
  checkout: insert(OnCallDutyPolicy, {
    _id: ID.onCallPolicy(1),
    name: "Checkout primary on-call",
  }),
  payments: insert(OnCallDutyPolicy, {
    _id: ID.onCallPolicy(2),
    name: "Payments on-call",
  }),
};

const probe = insert(Probe, {
  _id: ID.probe(1),
  name: "eu-west-1 probe",
});

const statusPages = {
  public: insert(StatusPage, {
    _id: ID.statusPage(1),
    name: "Acme Commerce Status",
  }),
  internal: insert(StatusPage, {
    _id: ID.statusPage(2),
    name: "Acme Internal Status",
  }),
};

function eventStates(modelType, prefixId) {
  return {
    created: insert(modelType, {
      _id: prefixId(1),
      name: "Created",
      color: new Color("#ef4444"),
      isCreatedState: true,
      order: 1,
    }),
    acknowledged: insert(modelType, {
      _id: prefixId(2),
      name: "Acknowledged",
      color: new Color("#f59e0b"),
      isAcknowledgedState: true,
      order: 2,
    }),
    resolved: insert(modelType, {
      _id: prefixId(3),
      name: "Resolved",
      color: new Color("#10b981"),
      isResolvedState: true,
      order: 3,
    }),
  };
}

const incidentStates = eventStates(IncidentState, ID.incidentState);
const alertStates = eventStates(AlertState, ID.alertState);

const incidentSeverities = {
  sev1: insert(IncidentSeverity, {
    _id: ID.incidentSeverity(1),
    name: "SEV-1",
    color: new Color("#dc2626"),
    order: 1,
  }),
  sev2: insert(IncidentSeverity, {
    _id: ID.incidentSeverity(2),
    name: "SEV-2",
    color: new Color("#ea580c"),
    order: 2,
  }),
  sev3: insert(IncidentSeverity, {
    _id: ID.incidentSeverity(3),
    name: "SEV-3",
    color: new Color("#ca8a04"),
    order: 3,
  }),
};

const alertSeverities = {
  critical: insert(AlertSeverity, {
    _id: ID.alertSeverity(1),
    name: "Critical",
    color: new Color("#dc2626"),
    order: 1,
  }),
  high: insert(AlertSeverity, {
    _id: ID.alertSeverity(2),
    name: "High",
    color: new Color("#ea580c"),
    order: 2,
  }),
  low: insert(AlertSeverity, {
    _id: ID.alertSeverity(3),
    name: "Low",
    color: new Color("#ca8a04"),
    order: 3,
  }),
};

/*
 * A new project starts with Incident Commander alone; this workspace has
 * added two roles of its own, so the role cards show more than one role.
 */
const roles = {
  commander: insert(IncidentRole, {
    _id: ID.role(1),
    name: "Incident Commander",
    color: new Color("#4f46e5"),
    isPrimaryRole: true,
    canAssignMultipleUsers: false,
  }),
  communications: insert(IncidentRole, {
    _id: ID.role(2),
    name: "Communications Lead",
    color: new Color("#0891b2"),
    isPrimaryRole: false,
    canAssignMultipleUsers: false,
  }),
  scribe: insert(IncidentRole, {
    _id: ID.role(3),
    name: "Scribe",
    color: new Color("#64748b"),
    isPrimaryRole: false,
    canAssignMultipleUsers: true,
  }),
};

/*
 * Tables the pages read that are intentionally empty in this workspace (no
 * custom fields, note templates, runbook runs, remediation suggestions or
 * remediation decisions). Registering them marks them as modelled, so they
 * never show up in `unhandled`.
 *
 * The incident and alert Remediation card reads the rule engine's decisions
 * (what auto-remediation did, or why it did nothing) beside the suggestions.
 * With neither, the API answers two empty lists and the card stays hidden,
 * as for an incident or alert from before the rule engine recorded them.
 */
for (const modelType of [
  IncidentCustomField,
  AlertCustomField,
  ScheduledMaintenanceCustomField,
  IncidentNoteTemplate,
  AlertNoteTemplate,
  ScheduledMaintenanceNoteTemplate,
  RunbookExecution,
  AutoRemediationSuggestion,
  AutoRemediationDecision,
]) {
  table(modelType);
}

function incidentLink(number) {
  return `${dashboard}/incidents/${ID.incident(number)}`;
}

function alertLink(number) {
  return `${dashboard}/alerts/${ID.alert(number)}`;
}

function monitorLink(record) {
  return `${dashboard}/monitors/${record._id}`;
}

/*
 * ---------------------------------------------------------------------------
 * Incidents
 * ---------------------------------------------------------------------------
 */
const INCIDENT_EPISODE_NUMBER = 12;
const ALERT_EPISODE_NUMBER = 7;
/*
 * The episodes incident #1038 and alert #305 joined after #12 and #7. A
 * record can be in several episodes, and its own incidentEpisodeId /
 * alertEpisodeId names only the latest (IncidentEpisodeMemberService keeps
 * it so), so these two point at the later ones. Episodes #12 and #7 still
 * list them: an episode's members are its membership rows. Only the link and
 * the membership row are modelled, not the later episodes themselves.
 */
const LATER_INCIDENT_EPISODE_NUMBER = 13;
const LATER_ALERT_EPISODE_NUMBER = 8;

// ?fail=resend: why the first delivery failed, and why the retry is refused.
const RESEND_FAILURE_STATUS_MESSAGE =
  "The email provider rejected the batch: 421 too many connections.";
const RESEND_FAILURE_MESSAGE =
  "Notifications cannot be resent while the email provider is rate limiting this project.";

function stateChangeFeed(kind, number, state, when, byUser) {
  const emoji = state.isResolvedState ? "✅" : "🟡";
  const noun = kind === "incident" ? "Incident" : "Alert";
  const link = kind === "incident" ? incidentLink(number) : alertLink(number);
  return {
    feedInfoInMarkdown: `${emoji} Changed **[${noun} #${number}](${link}) State** to **${state.name}**`,
    displayColor: state.color,
    postedAt: when,
    createdAt: when,
    user: byUser,
  };
}

/*
 * Adds an incident, its state timeline and a baseline feed. `ackAt` and
 * `resolvedAt` are optional; the current state follows the last one given.
 */
function defineIncident(spec) {
  const incidentId = new ObjectID(ID.incident(spec.number));
  const currentState = spec.resolvedAt
    ? incidentStates.resolved
    : spec.ackAt
      ? incidentStates.acknowledged
      : incidentStates.created;

  const record = {
    _id: ID.incident(spec.number),
    title: spec.title,
    description: spec.description,
    incidentNumber: spec.number,
    incidentNumberWithPrefix: `#${spec.number}`,
    declaredAt: spec.createdAt,
    createdAt: spec.createdAt,
    impactStartedAt: spec.impactStartedAt || spec.createdAt,
    incidentSeverity: spec.severity,
    incidentSeverityId: spec.severity.id,
    currentIncidentState: currentState,
    currentIncidentStateId: currentState.id,
    labels: spec.labels || [labels.checkout, labels.production],
    monitors: spec.monitors || [],
    services: spec.services || [],
    // Only ?resources=many attaches these, so every other record keeps its shape.
    ...(spec.hosts ? { hosts: spec.hosts } : {}),
    ...(spec.kubernetesClusters
      ? { kubernetesClusters: spec.kubernetesClusters }
      : {}),
    ...(spec.serviceLevelObjectives
      ? { serviceLevelObjectives: spec.serviceLevelObjectives }
      : {}),
    onCallDutyPolicies: spec.onCallDutyPolicies || [policies.checkout],
    createdByProbe: spec.createdByUser ? undefined : probe,
    createdByProbeId: spec.createdByUser ? undefined : probe.id,
    createdByUser: spec.createdByUser,
    createdByUserId: spec.createdByUser?.id,
    isCreatedAutomatically: !spec.createdByUser,
    subscriberNotificationStatusOnIncidentCreated: spec.notificationFailed
      ? StatusPageSubscriberNotificationStatus.Failed
      : StatusPageSubscriberNotificationStatus.Success,
    subscriberNotificationStatusMessage: spec.notificationFailed
      ? RESEND_FAILURE_STATUS_MESSAGE
      : "Notified 1,284 status page subscribers.",
    isPrivate: false,
    isVisibleOnStatusPage: true,
    rootCause: spec.rootCause,
    remediationNotes: spec.remediationNotes,
    incidentEpisode: spec.episode,
    incidentEpisodeId: spec.episode?.id,
    customFields: {},
  };
  table(Incident).push(record);

  const timeline = [
    [incidentStates.created, spec.createdAt, undefined],
    [incidentStates.acknowledged, spec.ackAt, spec.ackBy],
    [incidentStates.resolved, spec.resolvedAt, spec.resolvedBy],
  ].filter(([, when]) => Boolean(when));
  timeline.forEach(([state, when, byUser], index) => {
    const next = timeline[index + 1];
    insert(IncidentStateTimeline, {
      incidentId,
      incidentStateId: state.id,
      incidentState: state,
      startsAt: when,
      endsAt: next ? next[1] : undefined,
      createdAt: when,
      createdByUser: byUser,
      createdByUserId: byUser?.id,
    });
  });

  let created = `#### 🚨 Incident #${spec.number} Created:\n\n**${spec.title}**:\n\n${spec.description}\n\n🔴 **Incident State**: Created \n\n⚠️ **Severity**: ${spec.severity.name} \n\n`;
  if ((spec.monitors || []).length > 0) {
    created += "🌎 **Resources Affected**:\n";
    for (const item of spec.monitors) {
      created += `- [${item.name}](${monitorLink(item)})\n`;
    }
    created += "\n\n";
  }
  insert(IncidentFeed, {
    incidentId,
    incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
    feedInfoInMarkdown: created,
    displayColor: new Color("#ef4444"),
    postedAt: spec.createdAt,
    createdAt: spec.createdAt,
  });
  if (spec.ackAt) {
    insert(IncidentFeed, {
      incidentId,
      incidentFeedEventType: IncidentFeedEventType.IncidentStateChanged,
      ...stateChangeFeed(
        "incident",
        spec.number,
        incidentStates.acknowledged,
        spec.ackAt,
        spec.ackBy,
      ),
    });
  }
  if (spec.resolvedAt) {
    insert(IncidentFeed, {
      incidentId,
      incidentFeedEventType: IncidentFeedEventType.IncidentStateChanged,
      ...stateChangeFeed(
        "incident",
        spec.number,
        incidentStates.resolved,
        spec.resolvedAt,
        spec.resolvedBy,
      ),
    });
  }
  return { id: incidentId, record };
}

const incidentEpisodeRecord = make(IncidentEpisode, {
  _id: ID.incidentEpisode(INCIDENT_EPISODE_NUMBER),
  title: "Checkout degradation — Sep 14",
});
const laterIncidentEpisodeRecord = make(IncidentEpisode, {
  _id: ID.incidentEpisode(LATER_INCIDENT_EPISODE_NUMBER),
  title: "Cart service errors — Sep 14",
});

const PRIOR_INCIDENT_ROOT_CAUSE =
  "The orders database connection pool was exhausted, so checkout requests queued for a connection.";

// Linked prior incidents (#1017, #1029, #1036): resolved, same project.
defineIncident({
  number: 1017,
  title: "Checkout API p95 latency above 2s",
  description:
    "p95 latency for POST /api/checkout stayed above 2s for 5 consecutive checks.",
  severity: incidentSeverities.sev2,
  createdAt: new Date("2026-08-03T14:22:00.000Z"),
  ackAt: new Date("2026-08-03T14:26:00.000Z"),
  ackBy: people.sam,
  resolvedAt: new Date("2026-08-03T15:00:00.000Z"),
  resolvedBy: people.maya,
  monitors: [monitors.checkoutLatency],
  services: [services.checkout],
  rootCause: `${PRIOR_INCIDENT_ROOT_CAUSE} A batch export held 30 of 40 connections.`,
});
defineIncident({
  number: 1029,
  title: "Checkout requests timing out on orders-db",
  description:
    "Checkout returned 504 for 4% of requests while waiting on orders-db.",
  severity: incidentSeverities.sev2,
  createdAt: new Date("2026-08-21T19:05:00.000Z"),
  ackAt: new Date("2026-08-21T19:09:00.000Z"),
  ackBy: people.alex,
  resolvedAt: new Date("2026-08-21T19:56:00.000Z"),
  resolvedBy: people.alex,
  monitors: [monitors.checkoutLatency, monitors.ordersPool],
  services: [services.checkout, services.orders],
  rootCause: `${PRIOR_INCIDENT_ROOT_CAUSE} A migration left long-running transactions open.`,
});
defineIncident({
  number: 1036,
  title: "Checkout API p95 latency above 2s",
  description:
    "p95 latency for POST /api/checkout stayed above 2s for 3 consecutive checks.",
  severity: incidentSeverities.sev3,
  createdAt: new Date("2026-09-02T17:48:00.000Z"),
  ackAt: new Date("2026-09-02T17:50:00.000Z"),
  ackBy: people.sam,
  resolvedAt: new Date("2026-09-02T18:12:00.000Z"),
  resolvedBy: people.sam,
  monitors: [monitors.checkoutLatency],
  services: [services.checkout],
  rootCause: `${PRIOR_INCIDENT_ROOT_CAUSE} Pool size had been left at 15 after a load test.`,
});

// Incident episode #12 members.
defineIncident({
  number: 1038,
  title: "Cart service 5xx rate above 2%",
  description: "cart-api returned 5xx for 2.6% of requests over 5 minutes.",
  severity: incidentSeverities.sev3,
  createdAt: at("17:56"),
  ackAt: at("18:03"),
  ackBy: people.sam,
  resolvedAt: at("18:10"),
  resolvedBy: people.sam,
  services: [services.checkout],
  // Also in episode #13, which it joined later: see LATER_INCIDENT_EPISODE_NUMBER.
  episode: laterIncidentEpisodeRecord,
});
defineIncident({
  number: 1040,
  title: "Orders DB connection pool saturated",
  description:
    "db.client.connections.usage for checkout-api reached its configured maximum of 10.",
  severity: incidentSeverities.sev2,
  createdAt: at("17:58"),
  ackAt: at("18:04"),
  ackBy: people.sam,
  resolvedAt: isResolved ? at("18:12") : undefined,
  resolvedBy: people.maya,
  monitors: [monitors.ordersPool],
  services: [services.orders],
  episode: incidentEpisodeRecord,
});
defineIncident({
  number: 1041,
  title: "Checkout synthetic check failing in eu-west-1",
  description:
    "The synthetic checkout journey timed out at the payment step from the eu-west-1 probe.",
  severity: incidentSeverities.sev2,
  createdAt: at("18:00"),
  ackAt: at("18:04"),
  ackBy: people.jordan,
  resolvedAt: isResolved ? at("18:13") : undefined,
  resolvedBy: people.jordan,
  services: [services.checkout],
  episode: incidentEpisodeRecord,
});

// The incident under test.
const INCIDENT_NUMBER = 1042;
const mainIncident = defineIncident({
  number: INCIDENT_NUMBER,
  title: "Checkout API p95 latency above 2s",
  description:
    "The API monitor for POST /api/checkout reported p95 latency of 2.4s for 3 consecutive checks from the eu-west-1 probe.",
  severity: incidentSeverities.sev2,
  createdAt: at("18:01"),
  impactStartedAt: at("17:58"),
  ackAt: isAcknowledged ? at("18:04") : undefined,
  ackBy: people.sam,
  resolvedAt: isResolved ? at("18:12") : undefined,
  resolvedBy: people.maya,
  ...incidentResources(),
  episode: incidentEpisodeRecord,
  notificationFailed: failures.has("resend"),
  rootCause: isResolved
    ? "checkout-api 2026.09.14-2 started with DB_POOL_MAX=10 (was 40). Rolled back at 18:10."
    : undefined,
});
insert(IncidentFeed, {
  incidentId: mainIncident.id,
  incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
  feedInfoInMarkdown: `**📞 On Call Policy Started Executing:** On Call Policy **${policies.checkout.name}** started executing for [Incident #${INCIDENT_NUMBER}](${incidentLink(INCIDENT_NUMBER)}). Users on call on this policy will now be notified.`,
  displayColor: new Color("#6366f1"),
  postedAt: at("18:01", 10),
  createdAt: at("18:01", 10),
});
insert(IncidentFeed, {
  incidentId: mainIncident.id,
  incidentFeedEventType: IncidentFeedEventType.IncidentMemberAdded,
  feedInfoInMarkdown: `👤 Added **${people.maya.name}** (${people.maya.email}) as **${roles.commander.name}** to [Incident #${INCIDENT_NUMBER}](${incidentLink(INCIDENT_NUMBER)}).`,
  displayColor: new Color("#6366f1"),
  postedAt: at("18:05"),
  createdAt: at("18:05"),
  user: people.maya,
});
insert(IncidentFeed, {
  incidentId: mainIncident.id,
  incidentFeedEventType: IncidentFeedEventType.PrivateNote,
  feedInfoInMarkdown:
    "🔒 **Private note**: Rolling checkout-api back to 2026.09.14-1 to restore `DB_POOL_MAX=40`. Watching p95 on the checkout dashboard.",
  displayColor: new Color("#64748b"),
  postedAt: at("18:09"),
  createdAt: at("18:09"),
  user: people.maya,
});
insert(IncidentMember, {
  incidentId: mainIncident.id,
  userId: people.maya.id,
  user: people.maya,
  incidentRoleId: roles.commander.id,
  incidentRole: roles.commander,
  createdAt: at("18:05"),
});
insert(IncidentMember, {
  incidentId: mainIncident.id,
  userId: people.jordan.id,
  user: people.jordan,
  incidentRoleId: roles.communications.id,
  incidentRole: roles.communications,
  createdAt: at("18:06"),
});

/*
 * ---------------------------------------------------------------------------
 * Alerts
 * ---------------------------------------------------------------------------
 */
const alertEpisodeRecord = make(AlertEpisode, {
  _id: ID.alertEpisode(ALERT_EPISODE_NUMBER),
  title: "Payment webhook failures — Sep 14",
});
const laterAlertEpisodeRecord = make(AlertEpisode, {
  _id: ID.alertEpisode(LATER_ALERT_EPISODE_NUMBER),
  title: "Payment latency — Sep 14",
});

function defineAlert(spec) {
  const alertId = new ObjectID(ID.alert(spec.number));
  const currentState = spec.resolvedAt
    ? alertStates.resolved
    : spec.ackAt
      ? alertStates.acknowledged
      : alertStates.created;
  const record = {
    _id: ID.alert(spec.number),
    title: spec.title,
    description: spec.description,
    alertNumber: spec.number,
    alertNumberWithPrefix: `#${spec.number}`,
    createdAt: spec.createdAt,
    alertSeverity: spec.severity,
    alertSeverityId: spec.severity.id,
    currentAlertState: currentState,
    currentAlertStateId: currentState.id,
    monitor: spec.monitor,
    monitorId: spec.monitor?.id,
    services: spec.services || [],
    labels: spec.labels || [labels.payments, labels.production],
    onCallDutyPolicies: [policies.payments],
    createdByProbe: probe,
    createdByProbeId: probe.id,
    isCreatedAutomatically: true,
    isPrivate: false,
    alertEpisode: spec.episode,
    alertEpisodeId: spec.episode?.id,
    rootCause: spec.rootCause,
    customFields: {},
  };
  table(Alert).push(record);

  const timeline = [
    [alertStates.created, spec.createdAt, undefined],
    [alertStates.acknowledged, spec.ackAt, spec.ackBy],
    [alertStates.resolved, spec.resolvedAt, spec.resolvedBy],
  ].filter(([, when]) => Boolean(when));
  timeline.forEach(([state, when, byUser], index) => {
    const next = timeline[index + 1];
    insert(AlertStateTimeline, {
      alertId,
      alertStateId: state.id,
      alertState: state,
      startsAt: when,
      endsAt: next ? next[1] : undefined,
      createdAt: when,
      createdByUser: byUser,
      createdByUserId: byUser?.id,
    });
  });

  insert(AlertFeed, {
    alertId,
    alertFeedEventType: AlertFeedEventType.AlertCreated,
    feedInfoInMarkdown: `#### 🔔 Alert #${spec.number} Created:\n\n**${spec.title}**:\n\n${spec.description}\n\n🔴 **Alert State**: Created \n\n⚠️ **Severity**: ${spec.severity.name} \n\n${spec.monitor ? `🌎 **Monitor**: [${spec.monitor.name}](${monitorLink(spec.monitor)})\n\n` : ""}`,
    displayColor: new Color("#ef4444"),
    postedAt: spec.createdAt,
    createdAt: spec.createdAt,
  });
  if (spec.episode) {
    insert(AlertFeed, {
      alertId,
      alertFeedEventType: AlertFeedEventType.AddedToEpisode,
      feedInfoInMarkdown: `🧩 Added to [Episode #${ALERT_EPISODE_NUMBER}](${dashboard}/alerts/episodes/${ID.alertEpisode(ALERT_EPISODE_NUMBER)}) by grouping rule **Payments webhook alerts**.`,
      displayColor: new Color("#6366f1"),
      postedAt: new Date(spec.createdAt.getTime() + 5000),
      createdAt: new Date(spec.createdAt.getTime() + 5000),
    });
  }
  if (spec.ackAt) {
    insert(AlertFeed, {
      alertId,
      alertFeedEventType: AlertFeedEventType.AlertStateChanged,
      ...stateChangeFeed(
        "alert",
        spec.number,
        alertStates.acknowledged,
        spec.ackAt,
        spec.ackBy,
      ),
    });
  }
  if (spec.resolvedAt) {
    insert(AlertFeed, {
      alertId,
      alertFeedEventType: AlertFeedEventType.AlertStateChanged,
      ...stateChangeFeed(
        "alert",
        spec.number,
        alertStates.resolved,
        spec.resolvedAt,
        spec.resolvedBy,
      ),
    });
  }
  return { id: alertId, record };
}

defineAlert({
  number: 298,
  title: "Payment webhook 5xx rate above 5%",
  description:
    "payments-webhooks returned 5xx for 6.1% of provider callbacks over 5 minutes.",
  severity: alertSeverities.high,
  createdAt: new Date("2026-08-29T11:14:00.000Z"),
  ackAt: new Date("2026-08-29T11:17:00.000Z"),
  ackBy: people.alex,
  resolvedAt: new Date("2026-08-29T11:41:00.000Z"),
  resolvedBy: people.alex,
  monitor: monitors.webhookErrors,
  services: [services.payments],
  rootCause: "ledger-api connection timeout was lowered to 1s.",
});

const ALERT_MEMBERS = [
  [305, "Payment webhook latency above 3s", alertSeverities.low, "17:40"],
  [307, "Payment webhook 5xx rate above 2%", alertSeverities.low, "17:52"],
  [
    309,
    "Refund callback queue backlog above 500",
    alertSeverities.low,
    "18:01",
  ],
  [
    310,
    "Payment provider callback retries above 50/min",
    alertSeverities.high,
    "18:03",
  ],
];
for (const [number, title, severity, createdAt] of ALERT_MEMBERS) {
  defineAlert({
    number,
    title,
    description: `${title} on payments-webhooks.`,
    severity,
    createdAt: at(createdAt),
    ackAt: at("18:08"),
    ackBy: people.alex,
    resolvedAt: isResolved ? at("18:15") : undefined,
    resolvedBy: people.alex,
    monitor: monitors.webhookErrors,
    services: [services.payments],
    // #305 is also in episode #8, which it joined later: see LATER_ALERT_EPISODE_NUMBER.
    episode: number === 305 ? laterAlertEpisodeRecord : alertEpisodeRecord,
  });
}

const ALERT_NUMBER = 311;
const ALERT_TITLE =
  titleMode === "long"
    ? "Payment webhook 5xx rate above 5% on the eu-west-1 checkout cluster"
    : "Payment webhook 5xx rate above 5%";
const mainAlert = defineAlert({
  number: ALERT_NUMBER,
  title: ALERT_TITLE,
  description:
    "payments-webhooks returned 5xx for 7.8% of payment provider callbacks over the last 5 minutes.",
  severity: alertSeverities.high,
  createdAt: at("18:06"),
  ackAt: isAcknowledged ? at("18:08") : undefined,
  ackBy: people.alex,
  resolvedAt: isResolved ? at("18:15") : undefined,
  resolvedBy: people.alex,
  monitor: monitors.webhookErrors,
  services: [services.payments],
  episode: alertEpisodeRecord,
});

/*
 * ---------------------------------------------------------------------------
 * Scheduled maintenance #58
 * ---------------------------------------------------------------------------
 */
const smStates = {
  scheduled: insert(ScheduledMaintenanceState, {
    _id: ID.scheduledMaintenanceState(1),
    name: "Scheduled",
    color: new Color("#6366f1"),
    isScheduledState: true,
    order: 1,
  }),
  ongoing: insert(ScheduledMaintenanceState, {
    _id: ID.scheduledMaintenanceState(2),
    name: "Ongoing",
    color: new Color("#f59e0b"),
    isOngoingState: true,
    order: 2,
  }),
  ended: insert(ScheduledMaintenanceState, {
    _id: ID.scheduledMaintenanceState(3),
    name: "Ended",
    color: new Color("#4b5563"),
    isEndedState: true,
    order: 3,
  }),
  completed: insert(ScheduledMaintenanceState, {
    _id: ID.scheduledMaintenanceState(4),
    name: "Completed",
    color: new Color("#10b981"),
    isResolvedState: true,
    order: 4,
  }),
};

const SM_NUMBER = 58;
const smId = new ObjectID(ID.scheduledMaintenance(SM_NUMBER));
const smWindow = {
  scheduled: { startsAt: ago(-2 * HOUR), endsAt: ago(-3 * HOUR) },
  ongoing: { startsAt: at("18:05"), endsAt: at("19:05") },
  ended: { startsAt: at("16:00"), endsAt: at("17:00") },
  // The worker never moved it to Ongoing: 20 minutes past its start.
  overdue: { startsAt: at("18:00"), endsAt: at("19:00") },
  // Started on time, still Ongoing 30 minutes past its planned end.
  overrun: { startsAt: at("16:50"), endsAt: at("17:50") },
}[smMode] || { startsAt: ago(-2 * HOUR), endsAt: ago(-3 * HOUR) };
const smCreatedAt = new Date("2026-09-10T09:00:00.000Z");
const smHasStarted = ["ongoing", "ended", "overrun"].includes(smMode);
const smCurrentState =
  smMode === "ongoing" || smMode === "overrun"
    ? smStates.ongoing
    : smMode === "ended"
      ? smStates.ended
      : smStates.scheduled;

function recurring(intervalType, count) {
  const value = new Recurring();
  value.intervalType = intervalType;
  value.intervalCount = new PositiveNumber(count);
  return value;
}

table(ScheduledMaintenance).push({
  _id: smId.toString(),
  projectId: projectObjectId,
  title: "Primary database failover drill",
  description:
    "Planned failover of the orders database primary to its standby in eu-west-1b. Checkout may be read-only for up to 5 minutes while connections move.",
  scheduledMaintenanceNumber: SM_NUMBER,
  scheduledMaintenanceNumberWithPrefix: `#${SM_NUMBER}`,
  startsAt: smWindow.startsAt,
  endsAt: smWindow.endsAt,
  createdAt: smCreatedAt,
  createdByUser: people.jordan,
  createdByUserId: people.jordan.id,
  currentScheduledMaintenanceState: smCurrentState,
  currentScheduledMaintenanceStateId: smCurrentState.id,
  statusPages: [statusPages.public, statusPages.internal],
  monitors:
    resourcesMode === "none"
      ? []
      : [monitors.ordersPrimary, monitors.checkoutLatency],
  services:
    resourcesMode === "none" ? [] : [services.orders, services.checkout],
  labels: [labels.platform, labels.production],
  subscriberNotificationStatusOnEventScheduled: failures.has("resend")
    ? StatusPageSubscriberNotificationStatus.Failed
    : StatusPageSubscriberNotificationStatus.Success,
  subscriberNotificationStatusMessage: failures.has("resend")
    ? RESEND_FAILURE_STATUS_MESSAGE
    : "Notified 1,284 status page subscribers.",
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
  sendSubscriberNotificationsOnBeforeTheEvent: [
    recurring(EventInterval.Day, 1),
    recurring(EventInterval.Hour, 1),
  ],
  nextSubscriberNotificationBeforeTheEventAt:
    smMode === "scheduled"
      ? new Date(smWindow.startsAt.getTime() - HOUR)
      : undefined,
  isVisibleOnStatusPage: true,
  customFields: {},
});

const smTimeline = [[smStates.scheduled, smCreatedAt, people.jordan]];
if (smHasStarted) {
  smTimeline.push([smStates.ongoing, smWindow.startsAt, people.jordan]);
}
if (smMode === "ended") {
  smTimeline.push([
    smStates.ended,
    new Date(smWindow.endsAt.getTime() + 2 * MINUTE),
    people.jordan,
  ]);
}
smTimeline.forEach(([state, when, byUser], index) => {
  const next = smTimeline[index + 1];
  insert(ScheduledMaintenanceStateTimeline, {
    scheduledMaintenanceId: smId,
    scheduledMaintenanceStateId: state.id,
    scheduledMaintenanceState: state,
    startsAt: when,
    endsAt: next ? next[1] : undefined,
    createdAt: when,
    createdByUser: byUser,
    createdByUserId: byUser?.id,
  });
});

const smFeed = [
  [
    ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
    `#### 🕒 Scheduled Maintenance #${SM_NUMBER} Created:\n\n**Primary database failover drill**:\n\nPlanned failover of the orders database primary to its standby in eu-west-1b.`,
    "#6366f1",
    smCreatedAt,
    people.jordan,
  ],
  [
    ScheduledMaintenanceFeedEventType.PublicNote,
    "📄 **Public note**: Checkout may be read-only for up to 5 minutes while connections move to the new primary. No action is needed from customers.",
    "#0ea5e9",
    new Date(smCreatedAt.getTime() + 5 * MINUTE),
    people.jordan,
  ],
  [
    ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
    "📧 **Subscribers notified**: 1,284 status page subscribers were told about this event.",
    "#64748b",
    new Date(smCreatedAt.getTime() + 6 * MINUTE),
    undefined,
  ],
];
if (smHasStarted) {
  smFeed.push([
    ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
    `🟡 Changed **Scheduled Maintenance #${SM_NUMBER} State** to **Ongoing**`,
    "#f59e0b",
    smWindow.startsAt,
    people.jordan,
  ]);
  smFeed.push([
    ScheduledMaintenanceFeedEventType.PublicNote,
    "📄 **Public note**: Failover started. Writes are paused while orders-db-standby is promoted.",
    "#0ea5e9",
    new Date(smWindow.startsAt.getTime() + 2 * MINUTE),
    people.jordan,
  ]);
}
if (smMode === "ended") {
  smFeed.push([
    ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
    `⚪ Changed **Scheduled Maintenance #${SM_NUMBER} State** to **Ended**`,
    "#4b5563",
    new Date(smWindow.endsAt.getTime() + 2 * MINUTE),
    people.jordan,
  ]);
}
for (const [eventType, markdown, color, when, byUser] of smFeed) {
  insert(ScheduledMaintenanceFeed, {
    scheduledMaintenanceId: smId,
    scheduledMaintenanceFeedEventType: eventType,
    feedInfoInMarkdown: markdown,
    displayColor: new Color(color),
    postedAt: when,
    createdAt: when,
    user: byUser,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Incident episode #12
 * ---------------------------------------------------------------------------
 */
const incidentEpisodeId = new ObjectID(
  ID.incidentEpisode(INCIDENT_EPISODE_NUMBER),
);
const incidentGroupingRule = insert(IncidentGroupingRule, {
  _id: ID.groupingRule(1),
  name: "Checkout incidents within 30 minutes",
});
const incidentEpisodeState = isResolved
  ? incidentStates.resolved
  : isAcknowledged
    ? incidentStates.acknowledged
    : incidentStates.created;
table(IncidentEpisode).push({
  _id: incidentEpisodeId.toString(),
  projectId: projectObjectId,
  title: "Checkout degradation — Sep 14",
  description:
    "Grouped automatically: four checkout incidents opened within 30 minutes of each other.",
  episodeNumber: INCIDENT_EPISODE_NUMBER,
  episodeNumberWithPrefix: `#${INCIDENT_EPISODE_NUMBER}`,
  currentIncidentState: incidentEpisodeState,
  currentIncidentStateId: incidentEpisodeState.id,
  incidentSeverity: incidentSeverities.sev2,
  incidentSeverityId: incidentSeverities.sev2.id,
  incidentCount: 4,
  lastIncidentAddedAt: at("18:01"),
  declaredAt: at("17:56"),
  createdAt: at("17:56"),
  resolvedAt: isResolved ? at("18:14") : undefined,
  allIncidentsResolvedAt: isResolved ? at("18:13") : undefined,
  incidentGroupingRule,
  incidentGroupingRuleId: incidentGroupingRule.id,
  isManuallyCreated: false,
  onCallDutyPolicies: [policies.checkout],
  labels: [labels.checkout, labels.production],
  assignedToUser: people.maya,
  assignedToUserId: people.maya.id,
  isVisibleOnStatusPage: true,
  isPrivate: false,
});
for (const [number, addedAt] of [
  [1038, "17:56"],
  [1040, "17:58"],
  [1041, "18:00"],
  [1042, "18:01"],
]) {
  insert(IncidentEpisodeMember, {
    incidentEpisodeId,
    incidentId: new ObjectID(ID.incident(number)),
    incident: make(
      Incident,
      table(Incident).find((record) => {
        return record.incidentNumber === number;
      }),
    ),
    addedAt: at(addedAt),
    addedBy: "rule",
    matchedRule: incidentGroupingRule,
  });
}
insert(IncidentEpisodeMember, {
  incidentEpisodeId: new ObjectID(
    ID.incidentEpisode(LATER_INCIDENT_EPISODE_NUMBER),
  ),
  incidentId: new ObjectID(ID.incident(1038)),
  incident: make(
    Incident,
    table(Incident).find((record) => {
      return record.incidentNumber === 1038;
    }),
  ),
  addedAt: at("18:09"),
  addedBy: "manual",
});
const incidentEpisodeTimeline = [
  [incidentStates.created, at("17:56"), undefined],
];
if (isAcknowledged) {
  incidentEpisodeTimeline.push([
    incidentStates.acknowledged,
    at("18:04"),
    people.sam,
  ]);
}
if (isResolved) {
  incidentEpisodeTimeline.push([
    incidentStates.resolved,
    at("18:14"),
    people.maya,
  ]);
}
incidentEpisodeTimeline.forEach(([state, when, byUser], index) => {
  const next = incidentEpisodeTimeline[index + 1];
  insert(IncidentEpisodeStateTimeline, {
    incidentEpisodeId,
    incidentStateId: state.id,
    incidentState: state,
    startsAt: when,
    endsAt: next ? next[1] : undefined,
    createdAt: when,
    createdByUser: byUser,
    createdByUserId: byUser?.id,
  });
});
const incidentEpisodeFeed = [
  [
    IncidentEpisodeFeedEventType.EpisodeCreated,
    `#### Episode #${INCIDENT_EPISODE_NUMBER} Created\n\n**Checkout degradation — Sep 14**\n\nGrouped by rule **${incidentGroupingRule.name}**.`,
    "#ef4444",
    at("17:56"),
  ],
  [
    IncidentEpisodeFeedEventType.OnCallPolicy,
    `#### On-Call Policy Executed\n\n**${policies.checkout.name}** started executing for this episode.`,
    "#6366f1",
    at("17:56", 20),
  ],
  [
    IncidentEpisodeFeedEventType.IncidentAdded,
    `➕ [Incident #1038](${incidentLink(1038)}) **Cart service 5xx rate above 2%** was added to this episode.`,
    "#64748b",
    at("17:56", 5),
  ],
  [
    IncidentEpisodeFeedEventType.IncidentAdded,
    `➕ [Incident #1040](${incidentLink(1040)}) **Orders DB connection pool saturated** was added to this episode.`,
    "#64748b",
    at("17:58", 5),
  ],
  [
    IncidentEpisodeFeedEventType.IncidentAdded,
    `➕ [Incident #1041](${incidentLink(1041)}) **Checkout synthetic check failing in eu-west-1** was added to this episode.`,
    "#64748b",
    at("18:00", 5),
  ],
  [
    IncidentEpisodeFeedEventType.IncidentAdded,
    `➕ [Incident #1042](${incidentLink(1042)}) **Checkout API p95 latency above 2s** was added to this episode.`,
    "#64748b",
    at("18:01", 5),
  ],
];
if (isAcknowledged) {
  incidentEpisodeFeed.push([
    IncidentEpisodeFeedEventType.EpisodeStateChanged,
    "🟡 Changed **Episode #12 State** to **Acknowledged**",
    "#f59e0b",
    at("18:04"),
  ]);
}
if (isResolved) {
  incidentEpisodeFeed.push([
    IncidentEpisodeFeedEventType.EpisodeStateChanged,
    "✅ Changed **Episode #12 State** to **Resolved**",
    "#10b981",
    at("18:14"),
  ]);
}
for (const [eventType, markdown, color, when] of incidentEpisodeFeed) {
  insert(IncidentEpisodeFeed, {
    incidentEpisodeId,
    incidentEpisodeFeedEventType: eventType,
    feedInfoInMarkdown: markdown,
    displayColor: new Color(color),
    postedAt: when,
    createdAt: when,
  });
}
insert(IncidentEpisodeRoleMember, {
  incidentEpisodeId,
  userId: people.maya.id,
  user: people.maya,
  incidentRoleId: roles.commander.id,
  incidentRole: roles.commander,
  createdAt: at("18:05"),
});

/*
 * ---------------------------------------------------------------------------
 * Alert episode #7
 * ---------------------------------------------------------------------------
 */
const alertEpisodeId = new ObjectID(ID.alertEpisode(ALERT_EPISODE_NUMBER));
const alertGroupingRule = insert(AlertGroupingRule, {
  _id: ID.groupingRule(2),
  name: "Payments webhook alerts",
});
const alertEpisodeState = isResolved
  ? alertStates.resolved
  : isAcknowledged
    ? alertStates.acknowledged
    : alertStates.created;
table(AlertEpisode).push({
  _id: alertEpisodeId.toString(),
  projectId: projectObjectId,
  title: "Payment webhook failures — Sep 14",
  description:
    "Grouped automatically: payment webhook alerts from the same monitor group.",
  episodeNumber: ALERT_EPISODE_NUMBER,
  episodeNumberWithPrefix: `#${ALERT_EPISODE_NUMBER}`,
  currentAlertState: alertEpisodeState,
  currentAlertStateId: alertEpisodeState.id,
  alertSeverity: alertSeverities.high,
  alertSeverityId: alertSeverities.high.id,
  alertCount: 5,
  lastAlertAddedAt: at("18:06"),
  createdAt: at("17:40"),
  resolvedAt: isResolved ? at("18:16") : undefined,
  allAlertsResolvedAt: isResolved ? at("18:15") : undefined,
  alertGroupingRule,
  alertGroupingRuleId: alertGroupingRule.id,
  isManuallyCreated: false,
  onCallDutyPolicies: [policies.payments],
  labels: [labels.payments, labels.production],
  assignedToUser: people.alex,
  assignedToUserId: people.alex.id,
  isPrivate: false,
});
for (const [number, addedAt] of [
  [305, "17:40"],
  [307, "17:52"],
  [309, "18:01"],
  [310, "18:03"],
  [311, "18:06"],
]) {
  insert(AlertEpisodeMember, {
    alertEpisodeId,
    alertId: new ObjectID(ID.alert(number)),
    alert: make(
      Alert,
      table(Alert).find((record) => {
        return record.alertNumber === number;
      }),
    ),
    addedAt: at(addedAt),
    addedBy: "rule",
    matchedRule: alertGroupingRule,
  });
}
insert(AlertEpisodeMember, {
  alertEpisodeId: new ObjectID(ID.alertEpisode(LATER_ALERT_EPISODE_NUMBER)),
  alertId: new ObjectID(ID.alert(305)),
  alert: make(
    Alert,
    table(Alert).find((record) => {
      return record.alertNumber === 305;
    }),
  ),
  addedAt: at("18:07"),
  addedBy: "manual",
});
const alertEpisodeTimeline = [[alertStates.created, at("17:40"), undefined]];
if (isAcknowledged) {
  alertEpisodeTimeline.push([
    alertStates.acknowledged,
    at("17:55"),
    people.alex,
  ]);
}
if (isResolved) {
  alertEpisodeTimeline.push([alertStates.resolved, at("18:16"), people.alex]);
}
alertEpisodeTimeline.forEach(([state, when, byUser], index) => {
  const next = alertEpisodeTimeline[index + 1];
  insert(AlertEpisodeStateTimeline, {
    alertEpisodeId,
    alertStateId: state.id,
    alertState: state,
    startsAt: when,
    endsAt: next ? next[1] : undefined,
    createdAt: when,
    createdByUser: byUser,
    createdByUserId: byUser?.id,
  });
});
const alertEpisodeFeed = [
  [
    AlertEpisodeFeedEventType.EpisodeCreated,
    `#### Episode #${ALERT_EPISODE_NUMBER} Created\n\n**Payment webhook failures — Sep 14**\n\nGrouped by rule **${alertGroupingRule.name}**.`,
    "#ef4444",
    at("17:40"),
  ],
  ...[
    [305, "Payment webhook latency above 3s", "17:40"],
    [307, "Payment webhook 5xx rate above 2%", "17:52"],
    [309, "Refund callback queue backlog above 500", "18:01"],
    [310, "Payment provider callback retries above 50/min", "18:03"],
    [ALERT_NUMBER, ALERT_TITLE, "18:06"],
  ].map(([number, title, when]) => {
    return [
      AlertEpisodeFeedEventType.AlertAdded,
      `➕ [Alert #${number}](${alertLink(number)}) **${title}** was added to this episode.`,
      "#64748b",
      at(`${when}:05`),
    ];
  }),
];
if (isAcknowledged) {
  alertEpisodeFeed.push([
    AlertEpisodeFeedEventType.EpisodeStateChanged,
    `🟡 Changed **Episode #${ALERT_EPISODE_NUMBER} State** to **Acknowledged**`,
    "#f59e0b",
    at("17:55"),
  ]);
}
if (isResolved) {
  alertEpisodeFeed.push([
    AlertEpisodeFeedEventType.EpisodeStateChanged,
    `✅ Changed **Episode #${ALERT_EPISODE_NUMBER} State** to **Resolved**`,
    "#10b981",
    at("18:16"),
  ]);
}
for (const [eventType, markdown, color, when] of alertEpisodeFeed) {
  insert(AlertEpisodeFeed, {
    alertEpisodeId,
    alertEpisodeFeedEventType: eventType,
    feedInfoInMarkdown: markdown,
    displayColor: new Color(color),
    postedAt: when,
    createdAt: when,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Measurements
 * ---------------------------------------------------------------------------
 * The project's incident, alert and maintenance measurements, and each
 * event's value of each one, worked out the way the workers do: the real
 * MeasurementEvaluator over the event's own fixture timeline. A state
 * changed from a hero works them out again (applyStateChange), as the
 * server's timeline hook does, so the page's refresh reads the new values.
 *
 * ?measurements= picks the definitions:
 *   - default: what the cards show on a typical day, plus one measurement
 *     kept off event pages and one switched off, which the cards must not
 *     ask for;
 *   - none: no measurements at all (the cards draw nothing);
 *   - states: the default ones plus one whose end is before its start
 *     (Invalid) and one created a moment ago, which the background job has
 *     not worked out for any event yet (not worked out yet).
 */
const MEASUREMENT_MODES = ["none", "states"];
const measurementsMode = MEASUREMENT_MODES.includes(params.get("measurements"))
  ? params.get("measurements")
  : "default";

/*
 * A state the project added between Acknowledged and Resolved. Only a
 * measurement points at it: it is not one of the incident states, so the
 * hero's step rail and every state list stay as they are, and no fixture
 * incident ever enters it.
 */
const mitigatedState = make(IncidentState, {
  _id: ID.incidentState(9),
  name: "Mitigated",
  color: new Color("#0ea5e9"),
  order: 2.5,
});

function measurementDefinition(modelType, number, fields) {
  return {
    _id: ID.measurement(number),
    projectId: projectObjectId,
    key: fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    metricName: `oneuptime.measurement.${number}`,
    unit: "seconds",
    aggregationType: "Avg",
    startStateOccurrence: "First",
    endStateOccurrence: "First",
    isEnabled: true,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    ...fields,
  };
}

const incidentMeasurementDefinitions = [
  measurementDefinition(IncidentMeasurement, 1, {
    name: "Time to acknowledge",
    order: 1,
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Acknowledged",
    showOnIncidentView: true,
  }),
  measurementDefinition(IncidentMeasurement, 2, {
    name: "Time to mitigate",
    order: 2,
    startAnchorType: "Declared At",
    endAnchorType: "State Entered",
    endIncidentState: mitigatedState,
    endIncidentStateId: mitigatedState.id,
    showOnIncidentView: true,
  }),
  measurementDefinition(IncidentMeasurement, 3, {
    name: "Time to resolve",
    order: 3,
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Resolved",
    showOnIncidentView: true,
  }),
  measurementDefinition(IncidentMeasurement, 4, {
    name: "Time to postmortem",
    order: 4,
    startAnchorType: "State Role Entered",
    startIncidentStateRole: "Resolved",
    endAnchorType: "Postmortem Posted At",
    showOnIncidentView: true,
  }),
  // Charted, but kept off the incident page.
  measurementDefinition(IncidentMeasurement, 5, {
    name: "Time to page",
    order: 5,
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Acknowledged",
    showOnIncidentView: false,
  }),
  // Switched off.
  measurementDefinition(IncidentMeasurement, 6, {
    name: "Time to detect",
    order: 6,
    startAnchorType: "Impact Started At",
    endAnchorType: "Declared At",
    isEnabled: false,
    showOnIncidentView: true,
  }),
];

if (measurementsMode === "states") {
  incidentMeasurementDefinitions.push(
    // Impact recorded at 17:58, before the 18:01 declaration: Invalid.
    measurementDefinition(IncidentMeasurement, 7, {
      name: "Time to impact",
      order: 7,
      startAnchorType: "Declared At",
      endAnchorType: "Impact Started At",
      showOnIncidentView: true,
    }),
    // Created a moment ago: no event has a value for it yet.
    measurementDefinition(IncidentMeasurement, 8, {
      name: "Time to close",
      order: 8,
      startAnchorType: "Declared At",
      endAnchorType: "State Role Entered",
      endIncidentStateRole: "Resolved",
      endStateOccurrence: "Last",
      createdAt: NOW,
      showOnIncidentView: true,
    }),
  );
}

const alertMeasurementDefinitions = [
  measurementDefinition(AlertMeasurement, 11, {
    name: "Time to acknowledge",
    order: 1,
    startAnchorType: "Created At",
    endAnchorType: "State Role Entered",
    endAlertStateRole: "Acknowledged",
    showOnAlertView: true,
  }),
  measurementDefinition(AlertMeasurement, 12, {
    name: "Time to resolve",
    order: 2,
    startAnchorType: "Created At",
    endAnchorType: "State Role Entered",
    endAlertStateRole: "Resolved",
    unit: "minutes",
    showOnAlertView: true,
  }),
];

const scheduledMaintenanceMeasurementDefinitions = [
  measurementDefinition(ScheduledMaintenanceMeasurement, 21, {
    name: "Start delay",
    order: 1,
    startAnchorType: "Scheduled Starts At",
    endAnchorType: "State Role Entered",
    endScheduledMaintenanceStateRole: "Ongoing",
    showOnScheduledMaintenanceView: true,
  }),
  measurementDefinition(ScheduledMaintenanceMeasurement, 22, {
    name: "Overrun",
    order: 2,
    startAnchorType: "Scheduled Ends At",
    endAnchorType: "State Role Entered",
    endScheduledMaintenanceStateRole: "Ended",
    showOnScheduledMaintenanceView: true,
  }),
  measurementDefinition(ScheduledMaintenanceMeasurement, 23, {
    name: "Maintenance duration",
    order: 3,
    startAnchorType: "State Role Entered",
    startScheduledMaintenanceStateRole: "Ongoing",
    endAnchorType: "State Role Entered",
    endScheduledMaintenanceStateRole: "Ended",
    showOnScheduledMaintenanceView: true,
  }),
];

/*
 * Where each kind of event keeps its measurements, and what its anchors
 * read from: the record's own times, and the roles its states play.
 */
const MEASUREMENT_DOMAINS = [
  {
    parent: Incident,
    parentKey: "incidentId",
    timeline: IncidentStateTimeline,
    stateKey: "incidentStateId",
    stateRelation: "incidentState",
    definition: IncidentMeasurement,
    value: IncidentMeasurementValue,
    measurementKey: "incidentMeasurementId",
    stateColumnPrefix: "Incident",
    definitions: incidentMeasurementDefinitions,
    timestamps: (record) => {
      return {
        "Declared At": record.declaredAt,
        "Created At": record.createdAt,
        "Timeline Start": record.declaredAt || record.createdAt,
        "Impact Started At": record.impactStartedAt,
        "Postmortem Posted At": record.postmortemPostedAt,
      };
    },
    // Recorded after the fact: still to come once the incident is resolved.
    laterTimestamps: ["Impact Started At", "Postmortem Posted At"],
    roles: (state) => {
      return [
        state?.isCreatedState ? "Created" : null,
        state?.isAcknowledgedState ? "Acknowledged" : null,
        state?.isResolvedState ? "Resolved" : null,
      ].filter(Boolean);
    },
  },
  {
    parent: Alert,
    parentKey: "alertId",
    timeline: AlertStateTimeline,
    stateKey: "alertStateId",
    stateRelation: "alertState",
    definition: AlertMeasurement,
    value: AlertMeasurementValue,
    measurementKey: "alertMeasurementId",
    stateColumnPrefix: "Alert",
    definitions: alertMeasurementDefinitions,
    timestamps: (record) => {
      return {
        "Created At": record.createdAt,
        "Timeline Start": record.createdAt,
        "Impact Started At": record.impactStartedAt,
      };
    },
    laterTimestamps: ["Impact Started At"],
    roles: (state) => {
      return [
        state?.isCreatedState ? "Created" : null,
        state?.isAcknowledgedState ? "Acknowledged" : null,
        state?.isResolvedState ? "Resolved" : null,
      ].filter(Boolean);
    },
  },
  {
    parent: ScheduledMaintenance,
    parentKey: "scheduledMaintenanceId",
    timeline: ScheduledMaintenanceStateTimeline,
    stateKey: "scheduledMaintenanceStateId",
    stateRelation: "scheduledMaintenanceState",
    definition: ScheduledMaintenanceMeasurement,
    value: ScheduledMaintenanceMeasurementValue,
    measurementKey: "scheduledMaintenanceMeasurementId",
    stateColumnPrefix: "ScheduledMaintenance",
    definitions: scheduledMaintenanceMeasurementDefinitions,
    timestamps: (record) => {
      return {
        "Scheduled Starts At": record.startsAt,
        "Scheduled Ends At": record.endsAt,
        "Created At": record.createdAt,
        "Timeline Start": record.createdAt,
      };
    },
    laterTimestamps: [],
    roles: (state) => {
      return [
        state?.isScheduledState ? "Scheduled" : null,
        state?.isOngoingState ? "Ongoing" : null,
        state?.isEndedState ? "Ended" : null,
        state?.isResolvedState ? "Resolved" : null,
      ].filter(Boolean);
    },
  },
];

// The anchor one end of a definition is, as the server's toAnchor builds it.
function measurementAnchor(domain, record, definition, end) {
  const anchorType = definition[`${end}AnchorType`];
  const role = definition[`${end}${domain.stateColumnPrefix}StateRole`];
  const state = definition[`${end}${domain.stateColumnPrefix}State`];
  const occurrence = definition[`${end}StateOccurrence`] || "First";

  if (anchorType === MeasurementAnchorKind.StateEntered) {
    return {
      kind: MeasurementAnchorKind.StateEntered,
      label: state?.name || "The chosen state",
      stateId: state?._id?.toString(),
      stateOrder: state?.order,
      occurrence,
      isDanglingStateReference: !state,
    };
  }

  if (anchorType === MeasurementAnchorKind.StateRoleEntered) {
    return {
      kind: MeasurementAnchorKind.StateRoleEntered,
      label: `The ${String(role || "").toLowerCase()} state`,
      stateRole: role,
      occurrence,
    };
  }

  return {
    kind: MeasurementAnchorKind.Timestamp,
    label: anchorType,
    timestamp: domain.timestamps(record)[anchorType],
    canResolveAfterTerminalState: domain.laterTimestamps.includes(anchorType),
  };
}

let measurementValueCounter = 0;

/*
 * When a work-out happened, on the server's clock: a moment later each
 * time, as the server's own clock moves on while the page's is pinned, so a
 * page can tell the values worked out after a state change from the ones it
 * had (haveEventMeasurementsCaughtUp).
 */
let measurementComputeCounter = 0;

function measurementComputedAt() {
  measurementComputeCounter += 1;
  return new Date(NOW.getTime() + measurementComputeCounter);
}

// The ones no event has a value for yet: just created.
function isWorkedOutYet(definition) {
  return definition.name !== "Time to close";
}

/*
 * Works every measurement of one event out again from its timeline, and
 * replaces its stored values, as IncidentMeasurementValueService and its
 * twins do.
 */
function recomputeMeasurements(domain, parentId) {
  const record = table(domain.parent).find((item) => {
    return String(item._id) === String(parentId);
  });
  const definitions = table(domain.definition).filter(isWorkedOutYet);

  if (!record || definitions.length === 0) {
    return;
  }

  const computedAt = measurementComputedAt();

  const timeline = table(domain.timeline)
    .filter((entry) => {
      return String(entry[domain.parentKey]) === String(parentId);
    })
    .map((entry) => {
      const state = entry[domain.stateRelation];
      return {
        id: String(entry._id),
        stateId: String(entry[domain.stateKey]),
        stateName: state?.name,
        stateOrder: state?.order,
        stateRoles: domain.roles(state),
        startsAt: entry.startsAt,
      };
    });

  const evaluations = MeasurementEvaluator.evaluate({
    definitions: definitions.map((definition) => {
      return {
        id: String(definition._id),
        name: definition.name,
        start: measurementAnchor(domain, record, definition, "start"),
        end: measurementAnchor(domain, record, definition, "end"),
      };
    }),
    timeline,
  });

  const values = table(domain.value);

  for (const evaluation of evaluations) {
    const existing = values.findIndex((value) => {
      return (
        String(value[domain.parentKey]) === String(parentId) &&
        String(value[domain.measurementKey]) === evaluation.measurementId
      );
    });

    measurementValueCounter += 1;

    const value = {
      _id: uuid("91000000", measurementValueCounter),
      projectId: projectObjectId,
      [domain.parentKey]: new ObjectID(String(parentId)),
      [domain.measurementKey]: new ObjectID(evaluation.measurementId),
      status: evaluation.status,
      statusMessage: evaluation.statusMessage,
      startedAt: evaluation.startedAt
        ? new Date(evaluation.startedAt)
        : undefined,
      endedAt: evaluation.endedAt ? new Date(evaluation.endedAt) : undefined,
      valueInSeconds: evaluation.valueInSeconds,
      computedAt,
    };

    if (existing >= 0) {
      values.splice(existing, 1, value);
    } else {
      values.push(value);
    }
  }
}

// The state timeline model a state change was written to: which domain.
function recomputeMeasurementsAfterStateChange(timelineModelName, parentId) {
  const domain = MEASUREMENT_DOMAINS.find((item) => {
    return tableName(item.timeline) === timelineModelName;
  });

  if (domain) {
    recomputeMeasurements(domain, parentId);
  }
}

for (const domain of MEASUREMENT_DOMAINS) {
  // Registered even when empty: the pages read them, and that is modelled.
  table(domain.definition);
  table(domain.value);

  if (measurementsMode === "none") {
    continue;
  }

  for (const definition of domain.definitions) {
    table(domain.definition).push(definition);
  }

  for (const record of table(domain.parent)) {
    recomputeMeasurements(domain, record._id);
  }
}

/*
 * ---------------------------------------------------------------------------
 * AI investigations
 * ---------------------------------------------------------------------------
 */
const MODEL_NAME = "claude-sonnet-4-5";

function iso(date) {
  return date.toISOString();
}

// One point per minute from `start` to `end`, shaped by `valueAt(date)`.
function series(name, start, end, valueAt) {
  const points = [];
  for (let time = start.getTime(); time < end.getTime(); time += MINUTE) {
    const date = new Date(time);
    points.push({ x: iso(date), y: valueAt(date) });
  }
  return { name, points };
}

function wobble(date, amplitude) {
  const minute = Math.floor(date.getTime() / MINUTE);
  return Math.round(Math.sin(minute / 2.3) * amplitude);
}

const incidentWindow = { start: at("17:00"), end: at("18:20") };

const INCIDENT_CITATIONS = [
  {
    toolName: "search_incidents",
    queryArguments: {
      searchText: "checkout latency",
      createdWithinHours: 2160,
      limit: 10,
    },
    label: 'Incident search "checkout latency" (3 found)',
    rowCount: 3,
    durationInMs: 412,
    target: { type: AIChatCitationTargetType.Incidents },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.IncidentList,
      title: 'Incident search "checkout latency"',
      data: {
        items: [1036, 1029, 1017].map((number) => {
          const record = table(Incident).find((item) => {
            return item.incidentNumber === number;
          });
          return {
            id: record._id,
            incidentNumber: number,
            title: record.title,
            state: record.currentIncidentState.name,
            severity: record.incidentSeverity.name,
            createdAt: iso(record.createdAt),
            rootCause: record.rootCause,
          };
        }),
      },
    },
  },
  {
    toolName: "query_metrics",
    queryArguments: {
      metricName: "http.server.request.duration",
      aggregationType: "P95",
      startTime: iso(incidentWindow.start),
      endTime: iso(incidentWindow.end),
      entityId: ID.service(1),
    },
    label: `P95(http.server.request.duration), ${iso(incidentWindow.start)} – ${iso(incidentWindow.end)}`,
    rowCount: 80,
    durationInMs: 1180,
    target: { type: AIChatCitationTargetType.Metrics },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.TimeSeriesChart,
      title: "p95 request duration — checkout-api",
      description: "P95(http.server.request.duration), 1 minute buckets",
      data: {
        xIsTime: true,
        unit: "ms",
        valueLabel: "p95",
        series: [
          series(
            "checkout-api",
            incidentWindow.start,
            incidentWindow.end,
            (date) => {
              if (date >= at("17:59") && date < at("18:11")) {
                return 2350 + wobble(date, 90);
              }
              if (date >= at("17:55") && date < at("17:59")) {
                return 900 + wobble(date, 120);
              }
              return 310 + wobble(date, 25);
            },
          ),
        ],
      },
    },
  },
  {
    toolName: "search_logs",
    queryArguments: {
      startTime: "2026-09-14T17:45:00.000Z",
      endTime: "2026-09-14T18:15:00.000Z",
      bodySearchText: "pool",
      serviceId: ID.service(1),
      limit: 50,
    },
    label:
      "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:15:00.000Z (50 shown)",
    rowCount: 50,
    durationInMs: 864,
    target: { type: AIChatCitationTargetType.Logs },
    isPinnedToInvestigationTime: true,
    isTruncated: true,
    widget: {
      type: AIChatWidgetType.Table,
      title: 'Logs matching "pool" — checkout-api',
      data: {
        columns: [
          { key: "time", title: "Time", type: "date" },
          { key: "severity", title: "Severity" },
          { key: "body", title: "Message" },
          { key: "traceId", title: "Trace" },
        ],
        rows: [
          [
            "17:52:04",
            "INFO",
            "checkout-api 2026.09.14-2 starting: db pool configured max=10 idle=2 (was max=40)",
            "",
          ],
          [
            "17:58:12",
            "WARN",
            "db pool at capacity: 10/10 connections in use, 14 waiting",
            "",
          ],
          [
            "17:59:40",
            "ERROR",
            "timeout acquiring connection from pool after 2000ms (POST /api/checkout)",
            "5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c",
          ],
          [
            "18:03:18",
            "ERROR",
            "timeout acquiring connection from pool after 2000ms (POST /api/checkout)",
            "7d2f1c3b5a6e4f8091a2b3c4d5e6f708",
          ],
          [
            "18:10:02",
            "INFO",
            "checkout-api 2026.09.14-1 starting: db pool configured max=40 idle=5",
            "",
          ],
        ].map(([time, severity, body, traceId]) => {
          return { time: iso(at(time)), severity, body, traceId };
        }),
      },
    },
  },
  {
    toolName: "lookup_context",
    queryArguments: { type: "service", nameSearch: "checkout" },
    label: "Telemetry services (1 found)",
    rowCount: 1,
    durationInMs: 96,
    canLoadRows: false,
  },
  {
    toolName: "recent_changes",
    queryArguments: {
      startTime: "2026-09-13T18:02:00.000Z",
      endTime: "2026-09-14T18:02:00.000Z",
      limitPerSource: 20,
    },
    label:
      "Changes 2026-09-13T18:02:00.000Z → 2026-09-14T18:02:00.000Z (3 events)",
    rowCount: 3,
    durationInMs: 522,
    isPinnedToInvestigationTime: true,
    text: [
      "at                        change                     detail",
      "2026-09-14T17:58:30.000Z  monitor status change      Orders DB connection pool: Operational → Degraded",
      "2026-09-14T18:01:00.000Z  monitor status change      Checkout API p95 latency: Operational → Degraded",
      "2026-09-10T09:00:00.000Z  scheduled_maintenance      #58 Primary database failover drill (scheduled)",
    ].join("\n"),
  },
  {
    toolName: "query_metrics",
    queryArguments: {
      metricName: "db.client.connections.usage",
      aggregationType: "Max",
      startTime: iso(incidentWindow.start),
      endTime: iso(incidentWindow.end),
      entityId: ID.service(1),
    },
    label: `Max(db.client.connections.usage), ${iso(incidentWindow.start)} – ${iso(incidentWindow.end)}`,
    rowCount: 80,
    durationInMs: 1034,
    target: { type: AIChatCitationTargetType.Metrics },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.TimeSeriesChart,
      title: "Connections in use — checkout-api → orders-db",
      description: "Max(db.client.connections.usage), 1 minute buckets",
      data: {
        xIsTime: true,
        unit: "connections",
        valueLabel: "max",
        series: [
          series(
            "checkout-api",
            incidentWindow.start,
            incidentWindow.end,
            (date) => {
              if (date >= at("17:58") && date < at("18:11")) {
                return 10;
              }
              if (date >= at("17:52") && date < at("17:58")) {
                return 8 + Math.abs(wobble(date, 1));
              }
              return 14 + wobble(date, 3);
            },
          ),
        ],
      },
    },
  },
  {
    toolName: "get_trace",
    queryArguments: { traceId: "5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c" },
    label: "Trace 5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c (38 spans)",
    rowCount: 38,
    durationInMs: 640,
    target: {
      type: AIChatCitationTargetType.TraceView,
      params: { traceId: "5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c" },
    },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.TraceWaterfall,
      title: "Trace 5c1e0b7a…2a4c — POST /api/checkout",
      data: {
        totalDurationMs: 2310,
        spans: [
          [
            "a1",
            undefined,
            "POST /api/checkout",
            0,
            2310,
            true,
            "checkout-api",
          ],
          ["a2", "a1", "load cart", 12, 48, false, "checkout-api"],
          ["a3", "a1", "pg.pool.connect", 64, 1940, true, "checkout-api"],
          ["a4", "a1", "INSERT orders", 2008, 96, false, "orders-db"],
          ["a5", "a1", "reserve inventory", 2110, 120, false, "checkout-api"],
          [
            "a6",
            "a1",
            "publish order.created",
            2236,
            58,
            false,
            "checkout-api",
          ],
        ].map(
          ([
            spanId,
            parentSpanId,
            name,
            startOffsetMs,
            durationMs,
            isError,
            serviceName,
          ]) => {
            return {
              spanId,
              parentSpanId,
              name,
              startOffsetMs,
              durationMs,
              isError,
              serviceName,
            };
          },
        ),
      },
    },
  },
  {
    toolName: "top_exceptions",
    queryArguments: {
      lastSeenWithinHours: 1,
      includeResolved: false,
      limit: 10,
    },
    label: "Top exceptions, last 1h (0 found)",
    rowCount: 0,
    durationInMs: 288,
    target: { type: AIChatCitationTargetType.Exceptions },
    isPinnedToInvestigationTime: false,
    /*
     * An empty re-run has no widget; the server's own explanation comes back
     * as text and is shown next to "No rows returned.".
     */
    text: "No unresolved exception groups were seen in the last 1 hour for checkout-api or orders-db.",
  },
  {
    toolName: "query_monitors",
    queryArguments: { problemsOnly: true, limit: 20 },
    label: "Monitors with problems (2 found)",
    rowCount: 2,
    durationInMs: 350,
    target: { type: AIChatCitationTargetType.Monitors },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.Table,
      title: "Monitors with problems",
      data: {
        columns: [
          { key: "name", title: "Monitor" },
          { key: "type", title: "Type" },
          { key: "currentStatus", title: "Status" },
        ],
        rows: [
          {
            name: "Checkout API p95 latency",
            type: "API",
            currentStatus: "Degraded",
          },
          {
            name: "Orders DB connection pool",
            type: "Metrics",
            currentStatus: "Degraded",
          },
        ],
      },
    },
  },
  {
    toolName: "get_incident_timeline",
    queryArguments: { incidentId: ID.incident(INCIDENT_NUMBER), limit: 50 },
    label: `Incident #${INCIDENT_NUMBER} timeline (1 entry)`,
    rowCount: 1,
    durationInMs: 204,
    target: {
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: ID.incident(INCIDENT_NUMBER) },
    },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.Table,
      title: `Incident #${INCIDENT_NUMBER} timeline`,
      data: {
        columns: [
          { key: "at", title: "At", type: "date" },
          { key: "state", title: "State" },
          { key: "by", title: "By" },
        ],
        rows: [
          { at: iso(at("18:01")), state: "Created", by: "eu-west-1 probe" },
        ],
      },
    },
  },
];

const INCIDENT_ANALYSIS = [
  `**Summary** — Checkout API p95 latency passed 2s at 18:01 UTC because checkout-api restarted at 17:52 with its orders-db connection pool capped at 10 connections instead of 40, so requests queued for a connection [C2][C3][C6]. This is the same pool exhaustion recorded on prior incidents #1017, #1029 and #1036 [C1].`,
  `**Most likely root cause** — Release 2026.09.14-2 of checkout-api started at 17:52:04 with \`db pool configured max=10\` (previously max=40) [C3]. Under normal evening load the pool sat at its 10-connection ceiling from 17:58 [C6], checkout requests waited up to 2s for a connection and p95 latency rose from about 310 ms to 2.35 s [C2]. The slowest sampled trace spent 1.94 s of 2.31 s in \`pg.pool.connect\` [C7]. No new exception groups appeared in the last hour, so this is capacity, not a code fault [C8]. Incidents #1017, #1029 and #1036 were resolved with the same root cause [C1].`,
  [
    "**Evidence**",
    "- p95 of `http.server.request.duration` for checkout-api rose from ~310 ms to 2.35 s between 17:55 and 17:59 UTC [C2]",
    "- `db.client.connections.usage` stayed pinned at 10 from 17:58 to 18:11 UTC [C6]",
    '- checkout-api logged "timeout acquiring connection from pool after 2000ms" repeatedly after the 17:52 restart [C3]',
    "- Trace 5c1e0b7a… spent 1.94 s waiting in `pg.pool.connect` [C7]",
    "- Two monitors were degraded at investigation time: Checkout API p95 latency and Orders DB connection pool [C9]",
  ].join("\n"),
  [
    "**Suggested next steps**",
    "1. Roll checkout-api back to 2026.09.14-1, or redeploy with `DB_POOL_MAX=40`, and confirm p95 returns below 500 ms.",
    "2. Add a release check that fails when `DB_POOL_MAX` is lower than the production baseline.",
    "3. Link this incident to #1017, #1029 and #1036 and alert on `db.client.connections.usage` above 90% of the pool size.",
  ].join("\n"),
].join("\n\n");

const INCIDENT_TLDR =
  "checkout-api restarted at 17:52 with its database pool cut from 40 to 10 connections, so checkout requests queued and p95 latency passed 2s — the same pool exhaustion as #1017, #1029 and #1036.";

// ?tldr=long: exactly the server's 320-character cap.
const INCIDENT_LONG_TLDR =
  "checkout-api release 2026.09.14-2 restarted at 17:52:04 with DB_POOL_MAX=10 instead of 40, so requests waited up to 2s in pg.pool.connect for an orders-db connection and p95 latency rose from ~310 ms to 2.35 s (db.client.connections.usage pinned at 10/10). Rolling back to 2026.09.14-1 cleared it, as in #1017 and #1029.";

const alertWindow = { start: at("17:30"), end: at("18:10") };

const ALERT_CITATIONS = [
  {
    toolName: "query_alerts",
    queryArguments: { state: "resolved", createdWithinHours: 720, limit: 20 },
    label: "Resolved alerts, last 720h (1 found)",
    rowCount: 1,
    durationInMs: 318,
    target: { type: AIChatCitationTargetType.Alerts },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.AlertList,
      title: "Resolved alerts, last 720h",
      data: {
        items: [
          {
            id: ID.alert(298),
            alertNumber: 298,
            title: "Payment webhook 5xx rate above 5%",
            state: "Resolved",
            severity: "High",
            monitor: "Payment webhook error rate",
            createdAt: "2026-08-29T11:14:00.000Z",
          },
        ],
      },
    },
  },
  {
    toolName: "query_metrics",
    queryArguments: {
      metricName: "payments.webhook.error_ratio",
      aggregationType: "Avg",
      startTime: iso(alertWindow.start),
      endTime: iso(alertWindow.end),
      entityId: ID.service(3),
    },
    label: `Avg(payments.webhook.error_ratio), ${iso(alertWindow.start)} – ${iso(alertWindow.end)}`,
    rowCount: 40,
    durationInMs: 910,
    target: { type: AIChatCitationTargetType.Metrics },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.TimeSeriesChart,
      title: "Webhook 5xx ratio — payments-webhooks",
      data: {
        xIsTime: true,
        unit: "%",
        valueLabel: "avg",
        series: [
          series(
            "payments-webhooks",
            alertWindow.start,
            alertWindow.end,
            (date) => {
              if (date >= at("17:36")) {
                return (
                  Math.min(
                    8,
                    1 + (date.getTime() - at("17:36").getTime()) / (4 * MINUTE),
                  ) + wobble(date, 0.4)
                );
              }
              return 0.3;
            },
          ),
        ],
      },
    },
  },
  {
    toolName: "search_logs",
    queryArguments: {
      startTime: "2026-09-14T17:30:00.000Z",
      endTime: "2026-09-14T18:06:00.000Z",
      bodySearchText: "ledger",
      serviceId: ID.service(3),
      limit: 50,
    },
    label:
      "Logs 2026-09-14T17:30:00.000Z – 2026-09-14T18:06:00.000Z (50 shown)",
    rowCount: 50,
    durationInMs: 702,
    target: { type: AIChatCitationTargetType.Logs },
    isPinnedToInvestigationTime: true,
    isTruncated: true,
    widget: {
      type: AIChatWidgetType.Table,
      title: 'Logs matching "ledger" — payments-webhooks',
      data: {
        columns: [
          { key: "time", title: "Time", type: "date" },
          { key: "severity", title: "Severity" },
          { key: "body", title: "Message" },
        ],
        rows: [
          [
            "17:35:10",
            "INFO",
            "ledger client reloaded config: connectTimeout=1000ms (was 5000ms)",
          ],
          [
            "17:37:44",
            "ERROR",
            "ledger write timed out after 1000ms; responding 502 to provider callback",
          ],
          [
            "17:52:03",
            "ERROR",
            "ledger write timed out after 1000ms; responding 502 to provider callback",
          ],
        ].map(([time, severity, body]) => {
          return { time: iso(at(time)), severity, body };
        }),
      },
    },
  },
  {
    toolName: "lookup_context",
    queryArguments: { type: "service", nameSearch: "payments" },
    label: "Telemetry services (1 found)",
    rowCount: 1,
    durationInMs: 88,
    canLoadRows: false,
  },
  {
    toolName: "recent_changes",
    queryArguments: {
      startTime: "2026-09-13T18:07:00.000Z",
      endTime: "2026-09-14T18:07:00.000Z",
      limitPerSource: 20,
    },
    label:
      "Changes 2026-09-13T18:07:00.000Z → 2026-09-14T18:07:00.000Z (2 events)",
    rowCount: 2,
    durationInMs: 470,
    isPinnedToInvestigationTime: true,
    text: [
      "at                        change                     detail",
      "2026-09-14T17:40:12.000Z  monitor status change      Payment webhook error rate: Operational → Degraded",
      "2026-09-10T09:00:00.000Z  scheduled_maintenance      #58 Primary database failover drill (scheduled)",
    ].join("\n"),
  },
  {
    toolName: "query_traces",
    queryArguments: {
      groupBy: "name",
      metric: "errorRate",
      serviceId: ID.service(3),
      startTime: iso(alertWindow.start),
      endTime: iso(alertWindow.end),
    },
    label: `Trace analytics by name (errorRate), ${iso(alertWindow.start)} – ${iso(alertWindow.end)}`,
    rowCount: 6,
    durationInMs: 1210,
    target: { type: AIChatCitationTargetType.Traces },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.Table,
      title: "Error rate by span name — payments-webhooks",
      data: {
        columns: [
          { key: "name", title: "Span" },
          { key: "errorRate", title: "Error rate", type: "number" },
          { key: "count", title: "Spans", type: "number" },
        ],
        rows: [
          { name: "ledger.write", errorRate: 7.9, count: 4120 },
          { name: "POST /webhooks/payments", errorRate: 7.8, count: 4133 },
          { name: "verify signature", errorRate: 0, count: 4133 },
        ],
      },
    },
  },
  {
    toolName: "get_trace",
    queryArguments: { traceId: "9e4d2c1b0a8f7e6d5c4b3a2918273645" },
    label: "Trace 9e4d2c1b0a8f7e6d5c4b3a2918273645 (14 spans)",
    rowCount: 14,
    durationInMs: 402,
    target: {
      type: AIChatCitationTargetType.TraceView,
      params: { traceId: "9e4d2c1b0a8f7e6d5c4b3a2918273645" },
    },
    isPinnedToInvestigationTime: true,
    widget: {
      type: AIChatWidgetType.TraceWaterfall,
      title: "Trace 9e4d2c1b…3645 — POST /webhooks/payments",
      data: {
        totalDurationMs: 1042,
        spans: [
          {
            spanId: "b1",
            name: "POST /webhooks/payments",
            startOffsetMs: 0,
            durationMs: 1042,
            isError: true,
            serviceName: "payments-webhooks",
          },
          {
            spanId: "b2",
            parentSpanId: "b1",
            name: "verify signature",
            startOffsetMs: 4,
            durationMs: 11,
            isError: false,
            serviceName: "payments-webhooks",
          },
          {
            spanId: "b3",
            parentSpanId: "b1",
            name: "ledger.write",
            startOffsetMs: 20,
            durationMs: 1001,
            isError: true,
            serviceName: "payments-webhooks",
          },
        ],
      },
    },
  },
  {
    toolName: "top_exceptions",
    queryArguments: {
      lastSeenWithinHours: 1,
      includeResolved: false,
      limit: 10,
    },
    label: "Top exceptions, last 1h (2 found)",
    rowCount: 2,
    durationInMs: 250,
    target: { type: AIChatCitationTargetType.Exceptions },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.ExceptionList,
      title: "Top exceptions, last 1h",
      data: {
        items: [
          {
            type: "LedgerTimeoutError",
            message: "ledger write timed out after 1000ms",
            occurrences: 318,
            lastSeenAt: iso(at("18:05:40")),
            isResolved: false,
          },
          {
            type: "UpstreamResponseError",
            message: "responding 502 to payment provider callback",
            occurrences: 311,
            lastSeenAt: iso(at("18:05:41")),
            isResolved: false,
          },
        ],
      },
    },
  },
  {
    toolName: "query_monitors",
    queryArguments: { monitorId: ID.monitor(3) },
    label: "Monitor Payment webhook error rate + status timeline",
    rowCount: 4,
    durationInMs: 330,
    target: {
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: ID.monitor(3) },
    },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.Table,
      title: "Payment webhook error rate — status timeline",
      data: {
        columns: [
          { key: "at", title: "At", type: "date" },
          { key: "status", title: "Status" },
        ],
        rows: [
          { at: iso(at("17:40:12")), status: "Degraded" },
          { at: "2026-08-29T11:41:00.000Z", status: "Operational" },
        ],
      },
    },
  },
  {
    toolName: "get_alert_timeline",
    queryArguments: { alertId: ID.alert(ALERT_NUMBER), limit: 50 },
    label: `Alert #${ALERT_NUMBER} timeline (1 entry)`,
    rowCount: 1,
    durationInMs: 190,
    target: {
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ID.alert(ALERT_NUMBER) },
    },
    isPinnedToInvestigationTime: false,
    widget: {
      type: AIChatWidgetType.Table,
      title: `Alert #${ALERT_NUMBER} timeline`,
      data: {
        columns: [
          { key: "at", title: "At", type: "date" },
          { key: "state", title: "State" },
        ],
        rows: [{ at: iso(at("18:06")), state: "Created" }],
      },
    },
  },
];

const ALERT_ANALYSIS = [
  "**Summary** — payments-webhooks started answering payment provider callbacks with 502 at 17:37 UTC because its ledger client reloaded with a 1s connect timeout (was 5s) and ledger writes slower than that now fail [C2][C3]. Alert #298 on Aug 29 had the same cause [C1].",
  "**Most likely root cause** — At 17:35:10 the ledger client in payments-webhooks reloaded `connectTimeout=1000ms` [C3]. `ledger.write` spans now fail at a 7.9% rate [C6] and a sampled failing callback spent 1,001 ms in `ledger.write` before returning 502 [C7]. The webhook 5xx ratio climbed from 0.3% to 7.8% [C2]. `LedgerTimeoutError` is the top exception group of the last hour, with 318 occurrences [C8].",
  [
    "**Evidence**",
    "- `payments.webhook.error_ratio` rose from 0.3% to 7.8% after 17:36 UTC [C2]",
    '- "ledger client reloaded config: connectTimeout=1000ms (was 5000ms)" at 17:35:10 [C3]',
    "- `ledger.write` error rate 7.9% across 4,120 spans [C6]",
    "- Monitor Payment webhook error rate went Degraded at 17:40 [C9]",
  ].join("\n"),
  [
    "**Suggested next steps**",
    "1. Restore the ledger client `connectTimeout` to 5000 ms and confirm the 5xx ratio drops below 1%.",
    "2. Ask the payment provider to replay callbacks that received 502 since 17:37 UTC.",
    "3. Compare with the remediation notes on #298 and add a config check for the ledger timeout.",
  ].join("\n"),
].join("\n\n");

const ALERT_TLDR =
  "A 17:35 config reload cut the ledger client timeout from 5s to 1s, so slow ledger writes fail and payment webhooks return 502 — the same cause as alert #298.";

function brandedMarkdown(analysis, citations, toolCallCount) {
  let markdown = `## \u{1F9E0} AI — Automated Root Cause Analysis\n\n${analysis}`;
  if (citations.length > 0) {
    markdown += "\n\n**Evidence checked**";
    for (const citation of citations.slice(0, 15)) {
      markdown += `\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;
    }
  }
  markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${toolCallCount} quer${
    toolCallCount === 1 ? "y" : "ies"
  } run across your own telemetry${MODEL_NAME ? ` using ${MODEL_NAME}` : ""}. This is an AI-generated first pass; verify before acting.*`;
  return markdown;
}

function defineInvestigation(spec) {
  const citations = spec.citations.map((citation, index) => {
    return { ...citation, id: `C${index + 1}` };
  });
  return {
    ...spec,
    citations,
    markdown: brandedMarkdown(spec.analysis, citations, citations.length),
    verdict: presetVerdict,
    verdictAt: presetVerdict ? at("18:10") : null,
  };
}

const investigations = {
  incident: defineInvestigation({
    subjectType: "incident",
    subjectId: ID.incident(INCIDENT_NUMBER),
    runId: ID.aiRun(1),
    createdAt: at("18:01", 20),
    startedAt: at("18:01", 22),
    completedAt: at("18:03", 5),
    totalTokens: 48212,
    citations: INCIDENT_CITATIONS,
    analysis: INCIDENT_ANALYSIS,
    tldr: tldrMode === "long" ? INCIDENT_LONG_TLDR : INCIDENT_TLDR,
    references: [1017, 1029, 1036].map((number) => {
      const record = table(Incident).find((item) => {
        return item.incidentNumber === number;
      });
      return {
        kind: "incident",
        number,
        id: record._id,
        displayNumber: `#${number}`,
        title: record.title,
        stateName: record.currentIncidentState.name,
        stateColor: record.currentIncidentState.color.toString(),
      };
    }),
  }),
  alert: defineInvestigation({
    subjectType: "alert",
    subjectId: ID.alert(ALERT_NUMBER),
    runId: ID.aiRun(2),
    createdAt: at("18:06", 15),
    startedAt: at("18:06", 17),
    completedAt: at("18:07", 48),
    totalTokens: 41876,
    citations: ALERT_CITATIONS,
    analysis: ALERT_ANALYSIS,
    tldr: ALERT_TLDR,
    references: [
      {
        kind: "alert",
        number: 298,
        id: ID.alert(298),
        displayNumber: "#298",
        title: "Payment webhook 5xx rate above 5%",
        stateName: "Resolved",
        stateColor: "#10b981",
      },
    ],
  }),
};

// The AI root-cause feed item only exists once a report was posted.
if (hasReport) {
  insert(IncidentFeed, {
    incidentId: mainIncident.id,
    incidentFeedEventType: IncidentFeedEventType.RootCause,
    aiRunId: new ObjectID(investigations.incident.runId),
    feedInfoInMarkdown: investigations.incident.markdown,
    displayColor: new Color("#3b82f6"),
    postedAt: investigations.incident.completedAt,
    createdAt: investigations.incident.completedAt,
  });
  insert(AlertFeed, {
    alertId: mainAlert.id,
    alertFeedEventType: AlertFeedEventType.RootCause,
    aiRunId: new ObjectID(investigations.alert.runId),
    feedInfoInMarkdown: investigations.alert.markdown,
    displayColor: new Color("#3b82f6"),
    postedAt: investigations.alert.completedAt,
    createdAt: investigations.alert.completedAt,
  });
}

/*
 * The run's AIRunEvents, in the order the engine writes them. `toolCount`
 * limits how many tool calls have happened; `openTool` leaves the next one
 * running; `ending` is "completed", "failed" or undefined (still going).
 */
function buildEvents(investigation, options) {
  const events = [];
  let time = investigation.startedAt.getTime();
  const push = (eventType, extra, advanceMs) => {
    events.push(
      make(AIRunEvent, {
        _id: uuid("84000000", events.length + 1),
        projectId: projectObjectId,
        aiRunId: new ObjectID(investigation.runId),
        sequence: events.length + 1,
        eventType,
        createdAt: new Date(time),
        ...extra,
      }),
    );
    time += advanceMs;
  };
  const thinking = (durationInMs) => {
    push(AIRunEventType.LlmCallStarted, {}, durationInMs);
    push(AIRunEventType.LlmCallCompleted, {}, 150);
  };

  push(AIRunEventType.RunStarted, {}, 300);
  thinking(3400);
  const tools = investigation.citations.slice(0, options.toolCount);
  tools.forEach((citation, index) => {
    if (index === 5) {
      thinking(2900);
    }
    const shared = {
      toolName: citation.toolName,
      toolArguments: citation.queryArguments,
      citationId: citation.id,
    };
    push(AIRunEventType.ToolCallStarted, shared, citation.durationInMs);
    push(
      AIRunEventType.ToolCallCompleted,
      {
        ...shared,
        resultSummary: {
          rowCount: citation.rowCount,
          durationInMs: citation.durationInMs,
          isTruncated: Boolean(citation.isTruncated),
          citationLabel: citation.label,
          citationTarget: citation.target,
        },
      },
      250,
    );
  });
  if (options.openTool) {
    const next = investigation.citations[options.toolCount];
    push(
      AIRunEventType.ToolCallStarted,
      {
        toolName: next.toolName,
        toolArguments: next.queryArguments,
        citationId: next.id,
      },
      0,
    );
  }
  if (options.failedTool) {
    const next = investigation.citations[options.toolCount];
    push(
      AIRunEventType.ToolCallStarted,
      { toolName: next.toolName, toolArguments: next.queryArguments },
      2000,
    );
    push(
      AIRunEventType.ToolCallFailed,
      {
        toolName: next.toolName,
        resultSummary: {
          durationInMs: 2000,
          errorMessage: "LLM provider returned 529 Overloaded",
        },
      },
      200,
    );
  }
  if (options.ending === "completed") {
    thinking(5200);
    if (!options.skipRunCompleted) {
      push(AIRunEventType.RunCompleted, {}, 0);
    }
  }
  if (options.ending === "failed") {
    push(
      AIRunEventType.RunFailed,
      {
        resultSummary: {
          errorMessage: "LLM provider returned 529 Overloaded three times.",
        },
      },
      0,
    );
  }
  return events;
}

/*
 * The payload's clusterAccess rows, shaped like the server's
 * KubernetesClusterAiAccessStatus as every reader of the signal receives
 * it. The unreachable cluster's gaps use the server's own wording, with the
 * AI agent's install command shortened to one line.
 */
function clusterAccessRows() {
  const evaluatedAt = iso(NOW);
  const reachable = {
    clusterId: ID.cluster(1),
    clusterName: "prod-eu-west-1",
    isInvestigationReady: true,
    isRemediationReady: true,
    remediationMode: "RequireApproval",
    gaps: [],
    evaluatedAt,
  };
  const unreachable = {
    clusterId: ID.cluster(2),
    clusterName: "staging-us-east-1",
    isInvestigationReady: false,
    isRemediationReady: false,
    remediationMode: "Disabled",
    gaps: [
      {
        code: "ai_agent_not_connected",
        title: "The Kubernetes AI agent is not connected",
        description:
          "OneUptime AI runs kubectl on this cluster through the Kubernetes AI agent, and no agent has connected for this cluster yet.",
        nextStep:
          "Install the Kubernetes AI agent: helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent --set aiAgent.enabled=true.",
        blocks: "both",
      },
      {
        code: "remediation_disabled",
        title: "AI fixes are turned off for this cluster",
        description:
          "OneUptime AI will diagnose but never propose or apply a fix on this cluster.",
        nextStep:
          'Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on the cluster\'s AI agent page.',
        blocks: "remediation",
      },
    ],
    evaluatedAt,
  };

  if (clustersMode === "reachable") {
    return [reachable];
  }

  if (clustersMode === "unreachable") {
    return [unreachable];
  }

  return clustersMode === "mixed" ? [reachable, unreachable] : [];
}

function investigationPayload(investigation) {
  if (aiMode === "none") {
    return {
      run: null,
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
    };
  }

  const run = make(AIRun, {
    _id: investigation.runId,
    createdAt: investigation.createdAt,
    llmCallCount: 0,
    toolCallCount: 0,
    totalTokens: 0,
    codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
  });
  let events = [];
  let analysisMarkdown = null;
  let analysisTldr = null;
  let isAnalysisPending = false;
  const toolCount = investigation.citations.length;

  if (aiMode === "queued") {
    run.status = AIRunStatus.Queued;
  } else if (aiMode === "running") {
    run.status = AIRunStatus.Running;
    run.startedAt = investigation.startedAt;
    run.llmCallCount = 1;
    run.toolCallCount = 3;
    run.totalTokens = 9120;
    events = buildEvents(investigation, { toolCount: 3, openTool: true });
  } else if (aiMode === "failed") {
    run.status = AIRunStatus.Error;
    run.startedAt = investigation.startedAt;
    run.completedAt = new Date(investigation.startedAt.getTime() + 38000);
    run.errorMessage =
      "The LLM provider returned 529 Overloaded three times; the investigation stopped after 4 of 12 planned tool calls.";
    run.llmCallCount = 2;
    run.toolCallCount = 4;
    run.totalTokens = 12840;
    events = buildEvents(investigation, {
      toolCount: 4,
      failedTool: true,
      ending: "failed",
    });
  } else {
    const isPending = aiMode === "pending";
    run.status = AIRunStatus.Completed;
    run.startedAt = investigation.startedAt;
    run.completedAt = isPending
      ? new Date(NOW.getTime() - 20000)
      : investigation.completedAt;
    run.llmCallCount = 3;
    run.toolCallCount = toolCount;
    run.totalTokens = investigation.totalTokens;
    run.codeFixRecommendation = isPending
      ? AIRunCodeFixRecommendation.Pending
      : AIRunCodeFixRecommendation.Recommended;
    run.humanVerdict = investigation.verdict || undefined;
    run.humanVerdictAt = investigation.verdictAt || undefined;
    events = buildEvents(investigation, {
      toolCount,
      ending: "completed",
      skipRunCompleted: isPending,
    });
    if (isPending) {
      isAnalysisPending = true;
    } else {
      analysisMarkdown = investigation.markdown;
      analysisTldr = investigation.tldr;
      run.analysisTldr = investigation.tldr;
    }
  }

  const runJson = BaseModel.toJSONArray([run], AIRun)[0];
  runJson.analysisTldr = analysisTldr;

  const payload = {
    run: runJson,
    events: BaseModel.toJSONArray(events, AIRunEvent),
    analysisMarkdown,
    analysisTldr,
    isAnalysisPending,
  };

  if (clustersMode !== "none") {
    payload.clusterAccess = clusterAccessRows();
  }

  // An API replica that predates structured evidence omits both keys.
  if (analysisMarkdown && aiMode !== "legacy") {
    payload.evidence = investigation.citations.map((citation) => {
      return {
        citationId: citation.id,
        toolName: citation.toolName,
        label: citation.label,
        rowCount: citation.rowCount,
        durationInMs: citation.durationInMs,
        queryArguments: citation.queryArguments,
        target: citation.target,
        executedAt: iso(
          events.find((event) => {
            return (
              event.eventType === AIRunEventType.ToolCallCompleted &&
              event.citationId === citation.id
            );
          })?.createdAt || investigation.startedAt,
        ),
        canLoadRows: citation.canLoadRows !== false,
      };
    });
    payload.references = investigation.references;
  }

  return payload;
}

function investigationFor(body) {
  if (
    body.subjectType === "alert" ||
    body.alertId === ID.alert(ALERT_NUMBER) ||
    (body.subjectId === ID.alert(ALERT_NUMBER) && !body.incidentId)
  ) {
    return investigations.alert;
  }
  return investigations.incident;
}

function evidenceRows(body) {
  const investigation = investigationFor(body);
  const citation = investigation.citations.find((item) => {
    return item.id === body.citationId;
  });
  if (!citation) {
    throw fail(
      404,
      `Citation ${body.citationId || "(none)"} was not found on this investigation.`,
    );
  }
  if (citation.canLoadRows === false) {
    throw fail(
      400,
      `${citation.toolName} is not part of the read-only toolbox, so its rows cannot be loaded again.`,
    );
  }
  const response = {
    citationId: citation.id,
    toolName: citation.toolName,
    label: citation.label,
    rowCount: citation.rowCount,
    isTruncated: Boolean(citation.isTruncated),
    executedAt: NOW.toISOString(),
    isPinnedToInvestigationTime: Boolean(citation.isPinnedToInvestigationTime),
    investigatedAt: investigation.startedAt.toISOString(),
  };
  if (citation.widget) {
    response.widget = {
      id: `W${citation.id.slice(1)}`,
      citationId: citation.id,
      ...citation.widget,
    };
  }
  if (citation.text) {
    response.text = citation.text;
  }
  return response;
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => roleMode === "owner";
UserUtil.getUserId = () => people.maya.id;
UserUtil.getName = () => people.maya.name;
UserUtil.getEmail = () => people.maya.email;
PermissionUtil.getAllPermissions = () => {
  if (roleMode === "alert-member") {
    return [Permission.AlertMember];
  }
  if (roleMode === "loading") {
    return [];
  }
  return [Permission.ProjectOwner];
};
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

function tableName(modelType) {
  return new modelType().tableName;
}

function knownTable(modelType, kind, extra) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    fixture.unhandled.push({ kind, modelName: name, ...extra });
    return null;
  }
  return tables.get(name);
}

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.getItemRequests.push({
    modelName,
    id,
    select: serialize(options.select),
  });
  const known = knownTable(options.modelType, "getItem", { id });
  const record = known?.records.find((item) => {
    return String(item._id) === id;
  });
  if (known && !record) {
    fixture.unhandled.push({ kind: "getItem", modelName, id, missing: true });
  }
  return record ? make(options.modelType, record) : null;
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  const known = knownTable(options.modelType, "getList", {
    query: serialize(options.query),
  });
  const records = sortRecords(
    (known?.records || []).filter((record) => {
      return matches(record, options.query);
    }),
    options.sort,
  );
  return {
    data: records.slice(skip, skip + limit).map((record) => {
      return make(options.modelType, record);
    }),
    count: records.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });
  const known = knownTable(options.modelType, "count", {
    query: serialize(options.query),
  });
  return (known?.records || []).filter((record) => {
    return matches(record, options.query);
  }).length;
};

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.updates.push({ modelName, id, data: serialize(options.data) });
  const isNotificationResend = [
    "subscriberNotificationStatusOnIncidentCreated",
    "subscriberNotificationStatusOnEventScheduled",
  ].some((key) => {
    return Object.prototype.hasOwnProperty.call(options.data || {}, key);
  });
  if (failures.has("resend") && isNotificationResend) {
    throw fail(400, RESEND_FAILURE_MESSAGE);
  }
  const record = (tables.get(modelName)?.records || []).find((item) => {
    return String(item._id) === id;
  });
  if (record) {
    Object.assign(record, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

/*
 * A state change submitted from a hero action. Stamp it the way the server
 * does (it starts now and closes the entry that was open) and move the event
 * itself to the new state, so the page's background refresh reads the result.
 */
const STATE_TIMELINE_MODELS = [
  {
    timeline: IncidentStateTimeline,
    parent: Incident,
    parentKey: "incidentId",
    stateKey: "incidentStateId",
    stateRelation: "incidentState",
    currentState: "currentIncidentState",
    states: incidentStates,
  },
  {
    timeline: AlertStateTimeline,
    parent: Alert,
    parentKey: "alertId",
    stateKey: "alertStateId",
    stateRelation: "alertState",
    currentState: "currentAlertState",
    states: alertStates,
  },
  {
    timeline: IncidentEpisodeStateTimeline,
    parent: IncidentEpisode,
    parentKey: "incidentEpisodeId",
    stateKey: "incidentStateId",
    stateRelation: "incidentState",
    currentState: "currentIncidentState",
    states: incidentStates,
  },
  {
    timeline: AlertEpisodeStateTimeline,
    parent: AlertEpisode,
    parentKey: "alertEpisodeId",
    stateKey: "alertStateId",
    stateRelation: "alertState",
    currentState: "currentAlertState",
    states: alertStates,
  },
  {
    timeline: ScheduledMaintenanceStateTimeline,
    parent: ScheduledMaintenance,
    parentKey: "scheduledMaintenanceId",
    stateKey: "scheduledMaintenanceStateId",
    stateRelation: "scheduledMaintenanceState",
    currentState: "currentScheduledMaintenanceState",
    states: smStates,
  },
];

function applyStateChange(modelName, record) {
  const model = STATE_TIMELINE_MODELS.find((item) => {
    return tableName(item.timeline) === modelName;
  });
  if (!model || !record[model.parentKey] || !record[model.stateKey]) {
    return;
  }
  const parentId = String(record[model.parentKey]);
  const state = Object.values(model.states).find((item) => {
    return String(item._id) === String(record[model.stateKey]);
  });
  if (!state) {
    return;
  }
  for (const entry of table(model.timeline)) {
    if (String(entry[model.parentKey]) === parentId && !entry.endsAt) {
      entry.endsAt = NOW;
    }
  }
  record.startsAt = record.startsAt || NOW;
  record[model.stateRelation] = state;
  record.createdByUser = people.maya;
  record.createdByUserId = people.maya.id;
  const parent = table(model.parent).find((item) => {
    return String(item._id) === parentId;
  });
  if (parent) {
    parent[model.currentState] = state;
    parent[`${model.currentState}Id`] = state.id;
  }
}

/*
 * The server works an event's measurements out again once its new timeline
 * entry is saved; so does the fixture, once the record is in its table.
 */
function recomputeAfterStateChange(modelName, record) {
  const model = STATE_TIMELINE_MODELS.find((item) => {
    return tableName(item.timeline) === modelName;
  });
  if (!model || !record[model.parentKey]) {
    return;
  }
  recomputeMeasurementsAfterStateChange(
    modelName,
    String(record[model.parentKey]),
  );
}

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const data = BaseModel.toJSON(options.model, options.modelType);
  fixture.creates.push({
    modelName,
    formType: options.formType,
    data: serialize(data),
    miscDataProps: serialize(options.miscDataProps),
  });
  const record = { ...options.model, projectId: projectObjectId };
  if (!record._id) {
    record._id = rowId();
  }
  record.createdAt = record.createdAt || NOW;
  applyStateChange(modelName, record);
  if (tables.has(modelName)) {
    tables.get(modelName).records.push(record);
  }
  recomputeAfterStateChange(modelName, record);
  const created = make(options.modelType, record);
  return new HTTPResponse(
    200,
    BaseModel.toJSON(created, options.modelType),
    {},
  );
};

ModelAPI.create = async (options) => {
  return ModelAPI.createOrUpdate({ ...options, formType: "Create" });
};

ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.deletes.push({ modelName, id });
  const known = tables.get(modelName);
  if (known) {
    known.records = known.records.filter((record) => {
      return String(record._id) !== id;
    });
  }
};

/*
 * No telemetry is attached to these events, so analytics reads are not
 * modelled: they answer empty and are recorded as unhandled.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const record = {
    modelName,
    analytics: true,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip: Number(options.skip || 0),
    limit: Number(options.limit || 10),
  };
  fixture.listRequests.push(record);
  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: record.skip, limit: record.limit };
};

AnalyticsModelAPI.count = async (modelType, query) => {
  const modelName = tableName(modelType);
  fixture.countRequests.push({
    modelName,
    analytics: true,
    query: serialize(query),
  });
  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.unhandled.push({ kind: "analytics.aggregate", modelName });
  return { data: [] };
};

/*
 * Who incident #1042's status page notifications reach
 * (POST /incident/subscriber-audience), for the Retry and Resend
 * confirmations of its 'created' notification. Its monitors reach two
 * status pages. Asked for a Retry's audience
 * (excludeStatusPagesNotifiedOnCreation), the page the failed send reached in
 * full is left out, as the server leaves it out.
 */
const SUBSCRIBER_COUNTS = {
  email: 1284,
  sms: 0,
  slack: 0,
  microsoftTeams: 0,
  webhook: 3,
};
const AUDIENCE_PAGES = [
  { statusPageId: "90000000-0000-4000-8000-000000000001", name: "Acme EU" },
  { statusPageId: "90000000-0000-4000-8000-000000000002", name: "Acme US" },
];

function subscriberAudience(body) {
  const alreadyNotified =
    body.excludeStatusPagesNotifiedOnCreation === true
      ? [AUDIENCE_PAGES[1].statusPageId]
      : [];
  return {
    hasMonitors: true,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: AUDIENCE_PAGES.filter((page) => {
      return !alreadyNotified.includes(page.statusPageId);
    }).map((page) => {
      return { ...page, subscriberCounts: SUBSCRIBER_COUNTS };
    }),
    hiddenStatusPageCount: 0,
    excludedStatusPages: AUDIENCE_PAGES.filter((page) => {
      return alreadyNotified.includes(page.statusPageId);
    }).map((page) => {
      return { ...page, reason: "AlreadyNotified" };
    }),
    selectedStatusPagesNotListingMonitors: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * The investigation card's conversation
 * ---------------------------------------------------------------------------
 * The shared thread of incident #1042 and alert #311, as
 * InvestigationThreadService.getView answers it: messages oldest first with
 * who asked, and, while an answer is in flight, its run and live steps.
 * `?thread=` picks what it starts with. Maya Chen is the viewer.
 *
 * It is a small state machine, so a spec can drive the card for real:
 *  - a question that is sent appears with an answer in progress, which
 *    narrates a step on the next read and is complete on the one after;
 *  - an approval that is answered runs or skips its action and completes;
 *  - Stop turns the answer in flight into a stopped one.
 */
function threadAuthor(user) {
  return { userId: user.id.toString(), name: user.name.toString() };
}

let threadMessageCounter = 0;
function threadMessage(role, author, createdAt, extra) {
  threadMessageCounter += 1;
  return {
    _id: uuid("88000000", threadMessageCounter),
    role,
    contentInMarkdown: "",
    status: AIChatMessageStatus.Completed,
    citations: [],
    widgets: [],
    toolActions: [],
    errorMessage: null,
    aiRunId: null,
    createdAt: iso(createdAt),
    author,
    ...extra,
  };
}

function threadQuestion(user, createdAt, content) {
  return threadMessage(
    AIChatMessageRole.User,
    typeof user.userId === "string" ? user : threadAuthor(user),
    createdAt,
    { contentInMarkdown: content },
  );
}

function threadAnswer(user, createdAt, extra) {
  return threadMessage(
    AIChatMessageRole.Assistant,
    typeof user.userId === "string" ? user : threadAuthor(user),
    createdAt,
    extra,
  );
}

let threadRunCounter = 0;
function threadRunId() {
  threadRunCounter += 1;
  return uuid("89000000", threadRunCounter);
}

/*
 * The steps of an answer in flight, without tool arguments: getView never
 * selects them. `openTool` leaves the last tool call running.
 */
function threadRunEvents(runId, startedAt, options) {
  const events = [];
  let time = startedAt.getTime();
  const push = (eventType, extra, advanceMs) => {
    events.push(
      make(AIRunEvent, {
        _id: uuid("8a000000", events.length + 1),
        projectId: projectObjectId,
        aiRunId: new ObjectID(runId),
        sequence: events.length + 1,
        eventType,
        createdAt: new Date(time),
        ...extra,
      }),
    );
    time += advanceMs;
  };
  push(AIRunEventType.RunStarted, {}, 200);
  push(AIRunEventType.LlmCallStarted, {}, 2100);
  push(AIRunEventType.LlmCallCompleted, {}, 100);
  if (options.toolCount > 0) {
    push(AIRunEventType.ToolCallStarted, { toolName: "recent_changes" }, 470);
    push(
      AIRunEventType.ToolCallCompleted,
      {
        toolName: "recent_changes",
        resultSummary: { rowCount: 3, durationInMs: 470 },
      },
      120,
    );
  }
  if (options.openTool) {
    push(AIRunEventType.ToolCallStarted, { toolName: "search_logs" }, 0);
  }
  return BaseModel.toJSONArray(events, AIRunEvent);
}

const THREAD_ANSWER_TO_SENT_QUESTION =
  "checkout-api is still the only service above its latency threshold: its p95 is back under 500 ms since 18:12 and no other monitor has changed state [C1].";

function seedThread(kind, number) {
  const subject = `${kind} #${number}`;
  const messages = [];
  let activeRun = null;

  const affectedCitations = [
    {
      id: "C1",
      toolName: "query_metrics",
      label: "db.client.connections.usage for orders-db, 17:30 – 18:15 UTC",
      queryArguments: { metricName: "db.client.connections.usage" },
      rowCount: 45,
      target: { type: AIChatCitationTargetType.Metrics },
    },
    {
      id: "C2",
      toolName: "search_logs",
      label: 'Logs matching "timeout acquiring connection" in cart-api',
      queryArguments: { search: "timeout acquiring connection" },
      rowCount: 0,
      target: { type: AIChatCitationTargetType.Logs },
    },
    {
      id: "C3",
      toolName: "query_monitors",
      label: "Monitors attached to checkout-api, cart-api and orders-db",
      queryArguments: { nameSearch: "checkout" },
      rowCount: 4,
    },
  ];
  const affectedExchange = () => {
    messages.push(
      threadQuestion(
        people.sam,
        ago(9 * MINUTE),
        `Is anything else affected by this ${kind}?`,
      ),
      threadAnswer(people.sam, ago(8 * MINUTE), {
        contentInMarkdown: [
          "Nothing outside checkout is degraded, but one dependency shares the cause:",
          "",
          "- **Orders DB connection pool** has sat at its 10-connection ceiling since 17:58 [C1].",
          "- **cart-api** is healthy: p95 is 180 ms and it logged no pool timeouts [C2].",
          "",
          "Both monitors on checkout-api are the only ones not Operational [C3].",
        ].join("\n"),
        citations: affectedCitations,
        aiRunId: threadRunId(),
      }),
    );
  };

  if (threadMode === "answered" || threadMode === "crowded") {
    affectedExchange();
    messages.push(
      threadQuestion(
        people.maya,
        ago(4 * MINUTE),
        `Acknowledge this ${kind} and tell me who is on call for checkout.`,
      ),
      threadAnswer(people.maya, ago(3 * MINUTE), {
        contentInMarkdown: `Done — ${subject} is acknowledged. **Jordan Patel** is on call for Checkout on-call until 20:00 UTC [C1].`,
        citations: [
          {
            id: "C1",
            toolName: "get_on_call",
            label: "Who is on call for Checkout on-call right now",
            queryArguments: { policyName: "Checkout on-call" },
            rowCount: 1,
            target: { type: AIChatCitationTargetType.OnCallPolicies },
          },
        ],
        toolActions: [
          {
            id: "call_acknowledge",
            toolName: `acknowledge_${kind}`,
            title: `Acknowledge ${subject}`,
            arguments: { [`${kind}Number`]: number },
            isMutation: true,
            requiresApproval: false,
            status: AIChatToolActionStatus.Executed,
          },
        ],
        // Rows fetched under the asker's permissions: the viewer asked.
        widgets: [
          {
            id: "W1",
            citationId: "C1",
            type: AIChatWidgetType.Table,
            title: "Checkout on-call — current shift",
            data: {
              columns: [
                { key: "who", title: "On call" },
                { key: "layer", title: "Layer" },
                { key: "until", title: "Until", type: "date" },
              ],
              rows: [
                {
                  who: "Jordan Patel",
                  layer: "Primary",
                  until: iso(at("20:00")),
                },
                {
                  who: "Alex Kim",
                  layer: "Secondary",
                  until: iso(at("20:00")),
                },
              ],
            },
          },
        ],
        aiRunId: threadRunId(),
      }),
    );
  }

  if (threadMode === "crowded") {
    // Six people have asked: the header shows four of them and "+2".
    const askers = [
      threadAuthor(people.jordan),
      threadAuthor(people.alex),
      { userId: ID.user(5), name: "Priya Nair" },
      { userId: ID.user(6), name: "Diego Santos" },
    ];
    askers.forEach((author, index) => {
      messages.push(
        threadQuestion(
          author,
          ago((150 - 30 * index) * 1000),
          [
            "Did the 17:52 release change anything besides the pool size?",
            "How many checkout requests failed while this was open?",
            `Draft a short, customer-facing status update for this ${kind}. Don't post it yet.`,
            "Is it safe to roll back to 2026.09.14-1 right now?",
          ][index],
        ),
        threadAnswer(author, ago((140 - 30 * index) * 1000), {
          contentInMarkdown: [
            "No. The release diff only touches the pool configuration: `DB_POOL_MAX` went from 40 to 10 [C1].",
            "About 2,140 checkout requests waited longer than 2 s between 17:58 and 18:11; 312 of them timed out [C1].",
            "**Investigating — Checkout delays.** Some customers saw slow or failed checkouts between 17:58 and 18:11 UTC. A configuration change has been identified and reverted, and checkout is back to normal. We are monitoring.",
            "Yes. 2026.09.14-1 ran for six days without pool exhaustion, and no migration shipped in between [C1].",
          ][index],
          citations:
            index === 2
              ? []
              : [
                  {
                    id: "C1",
                    toolName: "recent_changes",
                    label: "Changes in the 24 hours before 18:07 UTC",
                    queryArguments: { limitPerSource: 20 },
                    rowCount: 2,
                  },
                ],
          aiRunId: threadRunId(),
        }),
      );
    });
  }

  if (threadMode === "working") {
    affectedExchange();
    const runId = threadRunId();
    const answer = threadAnswer(people.sam, ago(20 * 1000), {
      status: AIChatMessageStatus.InProgress,
      aiRunId: runId,
    });
    messages.push(
      threadQuestion(
        people.sam,
        ago(22 * 1000),
        `What changed right before this ${kind} started — deploys, config, traffic, errors?`,
      ),
      answer,
    );
    activeRun = {
      aiRunId: runId,
      assistantMessageId: answer._id,
      status: AIRunStatus.Running,
      startedAt: iso(ago(20 * 1000)),
      events: threadRunEvents(runId, ago(20 * 1000), {
        toolCount: 1,
        openTool: true,
      }),
    };
  }

  if (threadMode === "approval") {
    const runId = threadRunId();
    const answer = threadAnswer(people.maya, ago(40 * 1000), {
      status: AIChatMessageStatus.WaitingForApproval,
      aiRunId: runId,
      toolActions: [
        {
          id: "call_acknowledge",
          toolName: `acknowledge_${kind}`,
          title: `Acknowledge ${subject}`,
          arguments: { [`${kind}Number`]: number },
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
        },
      ],
    });
    messages.push(
      threadQuestion(people.maya, ago(45 * 1000), `Acknowledge this ${kind}.`),
      answer,
    );
    activeRun = {
      aiRunId: runId,
      assistantMessageId: answer._id,
      status: AIRunStatus.WaitingForApproval,
      startedAt: iso(ago(40 * 1000)),
      events: threadRunEvents(runId, ago(40 * 1000), { toolCount: 0 }),
    };
  }

  if (threadMode === "error") {
    messages.push(
      threadQuestion(
        people.maya,
        ago(6 * MINUTE),
        `Draft a short, customer-facing status update for this ${kind}. Don't post it yet.`,
      ),
      threadAnswer(people.maya, ago(6 * MINUTE - 5000), {
        status: AIChatMessageStatus.Error,
        errorMessage:
          "The LLM provider returned 529 Overloaded three times. Nothing was changed.",
        aiRunId: threadRunId(),
      }),
      threadQuestion(
        people.sam,
        ago(2 * MINUTE),
        `What should I do right now to mitigate this ${kind}? Give me the next steps in order.`,
      ),
      threadAnswer(people.sam, ago(2 * MINUTE - 4000), {
        status: AIChatMessageStatus.Cancelled,
        contentInMarkdown: "Stopped before the answer was finished.",
        aiRunId: threadRunId(),
      }),
    );
  }

  return { kind, number, messages, activeRun, turn: null };
}

const threads = {
  [ID.incident(INCIDENT_NUMBER)]: seedThread("incident", INCIDENT_NUMBER),
  [ID.alert(ALERT_NUMBER)]: seedThread("alert", ALERT_NUMBER),
};

function isThreadAnswerInFlight(message) {
  return (
    message.role === AIChatMessageRole.Assistant &&
    [
      AIChatMessageStatus.InProgress,
      AIChatMessageStatus.Pending,
      AIChatMessageStatus.WaitingForApproval,
    ].includes(message.status)
  );
}

function threadView(subjectId) {
  const thread = threads[subjectId];
  const viewerUserId = people.maya.id.toString();

  // Every other incident and alert: nobody has asked anything.
  if (!thread) {
    return {
      conversationId: null,
      messages: [],
      activeRun: null,
      isBusy: false,
      viewerUserId,
    };
  }

  // The question a spec sent moves one step with every read.
  if (thread.turn) {
    thread.turn.reads += 1;
    const answer = thread.messages.find((message) => {
      return message._id === thread.turn.answerId;
    });

    if (thread.turn.reads >= 3) {
      answer.status = AIChatMessageStatus.Completed;
      answer.contentInMarkdown = THREAD_ANSWER_TO_SENT_QUESTION;
      answer.citations = [
        {
          id: "C1",
          toolName: "query_monitors",
          label: "Monitors attached to checkout-api, right now",
          queryArguments: { nameSearch: "checkout" },
          rowCount: 2,
          target: { type: AIChatCitationTargetType.Monitors },
        },
      ];
      thread.activeRun = null;
      thread.turn = null;
    } else {
      thread.activeRun = {
        aiRunId: answer.aiRunId,
        assistantMessageId: answer._id,
        status: AIRunStatus.Running,
        startedAt: iso(NOW),
        events: threadRunEvents(answer.aiRunId, NOW, {
          toolCount: 0,
          openTool: thread.turn.reads >= 2,
        }),
      };
    }
  }

  return {
    conversationId: thread.messages.length > 0 ? uuid("87000000", 1) : null,
    /*
     * Charts and tables are built from rows fetched under the asker's
     * permissions, so getView sends them only to the person who asked.
     */
    messages: thread.messages.map((message) => {
      return message.author.userId === viewerUserId
        ? message
        : { ...message, widgets: [] };
    }),
    activeRun: thread.activeRun,
    isBusy: thread.messages.some(isThreadAnswerInFlight),
    viewerUserId,
  };
}

function sendThreadMessage(body) {
  const thread = threads[body.subjectId];

  if (failures.has("conversation-send") || !thread) {
    throw fail(
      400,
      "AI is turned off for this project. Turn it on in Project Settings → AI Features, then ask again.",
    );
  }

  if (thread.messages.some(isThreadAnswerInFlight)) {
    throw fail(
      400,
      "OneUptime AI is still answering the previous question. Ask again as soon as it finishes.",
    );
  }

  const runId = threadRunId();
  const question = threadQuestion(people.maya, NOW, body.content);
  const answer = threadAnswer(people.maya, NOW, {
    status: AIChatMessageStatus.InProgress,
    aiRunId: runId,
  });
  thread.messages.push(question, answer);
  thread.turn = { answerId: answer._id, reads: 0 };

  return {
    conversationId: uuid("87000000", 1),
    userMessageId: question._id,
    assistantMessageId: answer._id,
    aiRunId: runId,
  };
}

function respondToThreadApproval(body) {
  const thread = threads[body.subjectId];
  const answer = thread?.messages.find((message) => {
    return message._id === body.assistantMessageId;
  });

  if (!answer || answer.status !== AIChatMessageStatus.WaitingForApproval) {
    throw fail(400, "This answer is no longer waiting for approval.");
  }

  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  let approvedCount = 0;
  answer.toolActions = answer.toolActions.map((action) => {
    const decision = decisions.find((candidate) => {
      return candidate.toolCallId === action.id;
    });
    const approved = decision ? decision.approved === true : false;
    approvedCount += approved ? 1 : 0;
    return {
      ...action,
      status: approved
        ? AIChatToolActionStatus.Executed
        : AIChatToolActionStatus.Denied,
    };
  });
  answer.status = AIChatMessageStatus.Completed;
  answer.contentInMarkdown =
    approvedCount > 0
      ? `Done — ${thread.kind} #${thread.number} is acknowledged.`
      : `Okay — I left ${thread.kind} #${thread.number} as it is.`;
  thread.activeRun = null;

  return { assistantMessageId: answer._id, aiRunId: answer.aiRunId };
}

function cancelThreadRun(body) {
  const thread = threads[body.subjectId];
  const answer = thread?.messages.find(isThreadAnswerInFlight);

  if (!answer) {
    throw fail(400, "There is no answer in progress to stop.");
  }

  answer.status = AIChatMessageStatus.Cancelled;
  answer.contentInMarkdown = "Stopped before the answer was finished.";
  thread.activeRun = null;
  thread.turn = null;

  return { aiRunId: answer.aiRunId, cancelled: true };
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/incident/subscriber-audience")) {
    return ok(subscriberAudience(body));
  }

  if (
    url.includes("/ai-investigation/incident") ||
    url.includes("/ai-investigation/alert")
  ) {
    if (failures.has("investigation")) {
      throw fail(500, "The investigation service is unavailable.");
    }
    const isAlert = url.includes("/ai-investigation/alert");
    const subjectId = isAlert ? body.alertId : body.incidentId;
    const investigation = isAlert
      ? investigations.alert
      : investigations.incident;
    if (subjectId !== investigation.subjectId) {
      return ok({
        run: null,
        events: [],
        analysisMarkdown: null,
        analysisTldr: null,
        isAnalysisPending: false,
      });
    }
    return ok(investigationPayload(investigation));
  }

  if (url.includes("/ai-investigation/evidence")) {
    if (failures.has("evidence")) {
      throw fail(
        400,
        "The evidence query could not be re-run: the telemetry store rejected the time range.",
      );
    }
    return ok(evidenceRows(body));
  }

  if (url.includes("/ai-investigation/verdict")) {
    if (failures.has("verdict")) {
      throw fail(403, "You do not have permission to rate this investigation.");
    }
    const investigation = investigationFor(body);
    investigation.verdict = body.verdict || null;
    investigation.verdictAt = NOW;
    return ok({
      runId: body.aiRunId || body.investigationRunId || investigation.runId,
      verdict: body.verdict,
    });
  }

  if (url.includes("/ai-investigation/create-fix-task")) {
    if (failures.has("create-fix-task")) {
      throw fail(400, "No AI agent is online for this project.");
    }
    return ok({ aiRunId: ID.task(1) });
  }

  /*
   * The investigation card's shared conversation, which it reads on load and
   * then polls, and the three things a responder can do in it (see "The
   * investigation card's conversation" above).
   */
  if (url.endsWith("/ai-investigation/conversation")) {
    if (failures.has("conversation")) {
      throw fail(500, "The conversation service is unavailable.");
    }
    return ok(threadView(body.subjectId));
  }

  if (url.endsWith("/ai-investigation/conversation/send-message")) {
    return ok(sendThreadMessage(body));
  }

  if (url.endsWith("/ai-investigation/conversation/respond-to-approval")) {
    return ok(respondToThreadApproval(body));
  }

  if (url.endsWith("/ai-investigation/conversation/cancel-run")) {
    return ok(cancelThreadRun(body));
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return ok({ data: [], count: 0 });
}

/*
 * Lets a spec exercise the API stubs directly (for example the evidence
 * endpoint before any UI calls it):
 *   await window.__eventOverviewFixture.callApi("POST", "/ai-investigation/evidence", { ... })
 * resolves to { status, data } or { status, message } for a thrown error.
 */
fixture.callApi = async (method, route, body) => {
  try {
    const response = await handleApi(method, {
      url: `${APP_API_URL.toString()}${route}`,
      data: body || {},
    });
    return { status: response.statusCode, data: serialize(response.data) };
  } catch (error) {
    if (error instanceof HTTPErrorResponse) {
      return { status: error.statusCode, message: error.message };
    }
    throw error;
  }
};

API.get = async (options) => handleApi("GET", options);
API.post = async (options) => handleApi("POST", options);
API.put = async (options) => handleApi("PUT", options);
API.delete = async (options) => handleApi("DELETE", options);
API.fetch = async (options) => handleApi(options.method || "GET", options);

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function withNavigation(Layout) {
  return function FixtureLayout() {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());
    return <Layout {...pageProps(undefined)} />;
  };
}

function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

const IncidentLayout = withNavigation(IncidentViewLayout);
const AlertLayout = withNavigation(AlertViewLayout);
const ScheduledMaintenanceLayout = withNavigation(
  ScheduledMaintenanceViewLayout,
);
const IncidentEpisodeLayout = withNavigation(IncidentEpisodeViewLayout);
const AlertEpisodeLayout = withNavigation(AlertEpisodeViewLayout);

function StubPage(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p
        data-testid="stub-page"
        data-page={props.pageKey}
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </main>
  );
}

const STUB_PAGES = [
  [PageMap.AI_AGENT_TASK_VIEW, "AI Agent Task"],
  [PageMap.AI_AGENT_TASKS, "AI Agent Tasks"],
  [PageMap.MONITOR_VIEW, "Monitor"],
  // What the Affected Resources card links to with ?resources=many.
  [PageMap.HOST_VIEW, "Host"],
  [PageMap.KUBERNETES_CLUSTER_VIEW, "Kubernetes Cluster"],
  [PageMap.SLO_VIEW, "SLO"],
  [PageMap.ON_CALL_DUTY_POLICY_VIEW, "On-Call Policy"],
  [PageMap.STATUS_PAGE_VIEW, "Status Page"],
  [PageMap.SERVICE_VIEW, "Service"],
  [PageMap.USER_VIEW, "User"],
  [PageMap.TEAM_VIEW, "Team"],
  [PageMap.INCIDENT_VIEW_ROLES, "Incident Roles"],
  [PageMap.INCIDENT_VIEW_STATE_TIMELINE, "Incident State Timeline"],
  [PageMap.ALERT_VIEW_STATE_TIMELINE, "Alert State Timeline"],
  [PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS, "Episode Member Incidents"],
  [PageMap.INCIDENT_EPISODE_VIEW_MEMBERS, "Episode Roles"],
  [PageMap.ALERT_EPISODE_VIEW_ALERTS, "Episode Member Alerts"],
  [PageMap.INCIDENTS, "Incidents"],
  // Where "Declare Incident" in an alert's header leads (?alertIds=<alert>).
  [PageMap.INCIDENT_CREATE, "Create Incident"],
  [PageMap.INCIDENT_EPISODES, "Incident Episodes"],
  [PageMap.ALERTS, "Alerts"],
  [PageMap.ALERT_EPISODES, "Alert Episodes"],
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS, "Scheduled Maintenance"],
  [PageMap.HOME, "Home"],
  // Where the AI Investigation card's cluster access notice links.
  [PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT, "Kubernetes AI Agent"],
  // Where the sources of an answer in the card's conversation lead.
  [PageMap.METRICS, "Metrics"],
  [PageMap.LOGS, "Logs"],
  [PageMap.MONITORS, "Monitors"],
  [PageMap.ON_CALL_DUTY_POLICIES, "On-Call Policies"],
].filter(([pageKey]) => {
  return Boolean(pageKey && RouteMap[pageKey]);
});

/*
 * Like the dashboard's App, this reads the location on every navigation, so
 * the route elements are created again and a page that stays mounted (the
 * incident view moving from #1042 to #1029 through a report link) re-renders
 * with the new id instead of keeping the element React already rendered.
 */
function FixtureApp() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Commerce</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Routes>
          <Route
            path={RouteMap[PageMap.INCIDENT_VIEW].toString()}
            element={<IncidentLayout />}
          >
            <Route
              index
              element={<IncidentView {...pageProps(PageMap.INCIDENT_VIEW)} />}
            />
          </Route>
          <Route
            path={RouteMap[PageMap.ALERT_VIEW].toString()}
            element={<AlertLayout />}
          >
            <Route
              index
              element={<AlertView {...pageProps(PageMap.ALERT_VIEW)} />}
            />
          </Route>
          <Route
            path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW].toString()}
            element={<ScheduledMaintenanceLayout />}
          >
            <Route
              index
              element={
                <ScheduledMaintenanceView
                  {...pageProps(PageMap.SCHEDULED_MAINTENANCE_VIEW)}
                />
              }
            />
          </Route>
          <Route
            path={RouteMap[PageMap.INCIDENT_EPISODE_VIEW].toString()}
            element={<IncidentEpisodeLayout />}
          >
            <Route
              index
              element={
                <IncidentEpisodeView
                  {...pageProps(PageMap.INCIDENT_EPISODE_VIEW)}
                />
              }
            />
          </Route>
          <Route
            path={RouteMap[PageMap.ALERT_EPISODE_VIEW].toString()}
            element={<AlertEpisodeLayout />}
          >
            <Route
              index
              element={
                <AlertEpisodeView {...pageProps(PageMap.ALERT_EPISODE_VIEW)} />
              }
            />
          </Route>
          {STUB_PAGES.map(([pageKey, title]) => {
            return (
              <Route
                key={pageKey}
                path={RouteMap[pageKey].toString()}
                element={<StubPage pageKey={pageKey} title={title} />}
              />
            );
          })}
          <Route
            path="*"
            element={<StubPage pageKey="unknown" title="Not modelled" />}
          />
        </Routes>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
