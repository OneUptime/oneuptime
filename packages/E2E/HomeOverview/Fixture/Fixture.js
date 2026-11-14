/*
 * Offline fixture for the real dashboard Home page.
 *
 * The Home Layout (Page, with no side menu: Home is one page, #6857), the
 * Home page and the forwards from Home's old list addresses
 * (Routes/MovedHomeRoutes) are the production components from this branch,
 * mounted under their real RouteMap patterns as App.tsx mounts them. Only
 * the data boundary (ModelAPI / API) and the signed-in user are replaced.
 * The products' lists Home opens are stubs that say which list they are.
 *
 * Every record is fabricated for a generic "Acme Commerce" workspace. The
 * clock is pinned: every date is relative to NOW = 2026-10-13T12:00:00Z and
 * the spec fixes the browser clock to the same instant.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?scenario=  busy (default): two open incidents, three open alerts, two
 *                 monitors not operational, two SLOs burning, one
 *                 maintenance window in progress and three coming up
 *               healthy: monitors up, nothing open, one window coming up
 *               quiet: healthy, and nothing scheduled either - no
 *                 Upcoming maintenance card, so Your project alone sits
 *                 beside the all-clear
 *               attention: no incident, but alerts, a degraded monitor and
 *                 an SLO at risk
 *               maintenance: nothing wrong, one window in progress
 *               new: a project made a minute ago - nothing at all
 *               many: busy, with 9 open incidents (more than a group shows)
 *   ?role=      owner (default) | viewer (may read, may create nothing)
 *   ?fail=      comma separated:
 *                 overview   every Incident list fails, so Home's batch does
 *                 overview-once  only the FIRST Incident list fails
 *                 resources  every Status Page count fails
 *                 upcoming   the upcoming maintenance list fails
 *   ?lang=      de reads the German locale file, fa the Persian one (the
 *               page then reads right to left, as the Dashboard's does)
 *   ?theme=     dark adds html.dark (handled by server.js)
 *   ?welcome=   the Welcome checklist's answer (GET /welcome-checklist),
 *               built with the real rules (Common/Types/WelcomeChecklist):
 *                 ask     a new project nobody has answered for yet: the
 *                         question first
 *                 half    the four steps, the monitor's first check in
 *                 hidden  the four steps, hidden by this person
 *               without it, a new project skipped the question (the four
 *               steps, none done) and every other scenario finished it
 *   ?plan=      free: OneUptime Cloud's Free plan (the team step needs Growth)
 *   ?setup=     Setup health (#6812: GET /setup-health and /setup-health/
 *               summary), whose page (Pages/Home/SetupHealth) is mounted
 *               under Home as App.tsx mounts it:
 *                 busy    findings of every level, one check broken for
 *                         five monitors, and one finding dismissed
 *               without it, nothing to fix: Home says nothing of the setup
 *
 * A viewer was invited (#6807): Home draws their own first steps, from
 * their personal checklist's reads (readiness, the project's channel
 * switches, notification settings, incoming-call numbers, chat workspaces,
 * profile fields, the calendar link) and their shifts (/my-shifts). The
 * fixture answers as for Grace, a member invited a minute ago: only her
 * sign-in email, on a team that an on-call policy pages, her first shift
 * tomorrow at 09:00 on "Primary on-call".
 *
 * The header carries the Dashboard's Help menu, and the page the dialog
 * How OneUptime works opens in (App.tsx mounts it once), so Help and
 * Home's Explore OneUptime open it as they do in the product (#6819).
 *
 * Every read is recorded on window.__homeOverviewFixture: listRequests,
 * countRequests, apiRequests, paletteToggles (Search) and unhandled:
 * anything the fixture does not model. The spec asserts `unhandled` is
 * empty.
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { initReactI18next } from "react-i18next";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import Help from "../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import HowOneUptimeWorksDialog from "../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import HomeLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import Home from "../../../App/FeatureSet/Dashboard/src/Pages/Home/Home";
import SetupHealthPage from "../../../App/FeatureSet/Dashboard/src/Pages/Home/SetupHealth";
import MovedHomeRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/MovedHomeRoutes";
import DashboardRecording from "../../../App/FeatureSet/Dashboard/src/Components/DashboardRecording/DashboardRecording";
import EventName from "../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import ProjectUserProfile from "Common/Models/DatabaseModels/ProjectUserProfile";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import { parseProjectGoals } from "Common/Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  buildWelcomeChecklist,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  getSetupHealthCounts,
  getSetupHealthDismissalId,
  makeSetupHealthFinding,
} from "Common/Types/SetupHealth/SetupHealth";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

function listParam(name) {
  return new Set(
    (params.get(name) || "")
      .split(",")
      .map((value) => {
        return value.trim();
      })
      .filter((value) => {
        return value.length > 0;
      }),
  );
}

const SCENARIOS = [
  "busy",
  "healthy",
  "quiet",
  "attention",
  "maintenance",
  "new",
  "many",
];
const scenario = SCENARIOS.includes(params.get("scenario"))
  ? params.get("scenario")
  : "busy";
const roleMode = params.get("role") === "viewer" ? "viewer" : "owner";
const failures = listParam("fail");
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [
  ...GLOBAL_PERMISSIONS,
  roleMode === "viewer" ? Permission.Viewer : Permission.ProjectOwner,
];

/*
 * ---------------------------------------------------------------------------
 * Clock and ids
 * ---------------------------------------------------------------------------
 */
const NOW = new Date("2026-10-13T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function fromNow(milliseconds) {
  return new Date(NOW.getTime() + milliseconds);
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
  maintenance: (number) => uuid("40000000", number),
  maintenanceState: (number) => uuid("41000000", number),
  slo: (number) => uuid("50000000", number),
  monitor: (number) => uuid("70000000", number),
  status: (number) => uuid("83000000", number),
  user: (number) => uuid("80000000", number),
};
let rowCounter = 0;
function rowId() {
  rowCounter += 1;
  return uuid("90000000", rowCounter);
}

const projectObjectId = new ObjectID(PROJECT_ID);

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  now: NOW.toISOString(),
  scenario: {
    scenario,
    role: roleMode,
    fail: Array.from(failures),
    language,
  },
  listRequests: [],
  countRequests: [],
  apiRequests: [],
  paletteToggles: 0,
  unhandled: [],
  // The recording switches read (#6834): only ever with ?recording=cloud.
  recordingSwitchReads: [],
};
window.__homeOverviewFixture = fixture;

GlobalEvents.addEventListener(EventName.COMMAND_PALETTE_TOGGLE, () => {
  fixture.paletteToggles += 1;
});

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
 * fresh model instance holding only the selected columns, as the API does.
 * ---------------------------------------------------------------------------
 */
const tables = new Map();

function tableName(modelType) {
  return new modelType().tableName;
}

function table(modelType) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    tables.set(name, { modelType, records: [] });
  }
  return tables.get(name).records;
}

function insert(modelType, record) {
  const full = {
    _id: rowId(),
    projectId: projectObjectId,
    createdAt: ago(30 * DAY),
    ...record,
  };
  table(modelType).push(full);
  return make(modelType, full);
}

function idOf(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && "_id" in value && value._id) {
    return String(value._id);
  }
  return String(value);
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

function toTime(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  return new Date(value).getTime();
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.constructor === Object || value.constructor === undefined)
  );
}

function matchesCondition(actual, condition) {
  if (condition instanceof Includes) {
    const values = condition.values.map((value) => {
      return idOf(value);
    });
    if (Array.isArray(actual)) {
      return actual.some((item) => {
        return values.includes(idOf(item));
      });
    }
    return values.includes(idOf(actual));
  }
  if (condition instanceof InBetween) {
    if (actual === null || actual === undefined) {
      return false;
    }
    const time = toTime(actual);
    return (
      time >= toTime(condition.startValue) && time <= toTime(condition.endValue)
    );
  }
  if (condition instanceof Search) {
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(condition.value).toLowerCase());
  }
  if (condition instanceof NotEqual) {
    return String(comparable(actual)) !== String(comparable(condition.value));
  }
  if (
    condition !== null &&
    typeof condition === "object" &&
    !isPlainObject(condition) &&
    !(condition instanceof ObjectID) &&
    !(condition instanceof Date)
  ) {
    // Other query operators are not modelled: record it, and match.
    fixture.unhandled.push({
      kind: "query-operator",
      operator: condition.constructor ? condition.constructor.name : "unknown",
    });
    return true;
  }
  // A nested relation filter: { currentMonitorStatus: { isOperationalState: false } }.
  if (isPlainObject(condition)) {
    if (Array.isArray(actual)) {
      return actual.some((item) => {
        return matches(item, condition);
      });
    }
    if (actual && typeof actual === "object") {
      return matches(actual, condition);
    }
    return false;
  }
  return String(comparable(actual)) === String(comparable(condition));
}

function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || key === "projectId") {
      continue;
    }
    if (!matchesCondition(record[key], condition)) {
      return false;
    }
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

function projectValue(value, subSelect) {
  if (
    subSelect === true ||
    subSelect === undefined ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      return projectValue(item, subSelect);
    });
  }
  if (
    typeof value === "object" &&
    typeof subSelect === "object" &&
    !isPlainObject(value) &&
    "_id" in value
  ) {
    const copy = new value.constructor();
    copy._id = value._id;
    for (const [key, nested] of Object.entries(subSelect)) {
      if (value[key] !== undefined) {
        copy[key] = projectValue(value[key], nested);
      }
    }
    return copy;
  }
  return value;
}

function projectRecord(modelType, record, select) {
  if (!select) {
    return make(modelType, record);
  }
  const out = { _id: record._id };
  for (const [key, subSelect] of Object.entries(select)) {
    if (record[key] !== undefined) {
      out[key] = projectValue(record[key], subSelect);
    }
  }
  return make(modelType, out);
}

/*
 * ---------------------------------------------------------------------------
 * The workspace: states, severities and statuses every scenario shares
 * ---------------------------------------------------------------------------
 */
const project = make(Project, { _id: PROJECT_ID, name: "Acme Commerce" });

function state(modelType, id, data) {
  const record = {
    _id: id,
    projectId: projectObjectId,
    ...data,
    color: new Color(data.color),
  };
  table(modelType).push(record);
  return make(modelType, record);
}

const incidentStates = {
  created: state(IncidentState, ID.incidentState(1), {
    name: "Investigating",
    color: "#ef4444",
    order: 1,
    isCreatedState: true,
    isResolvedState: false,
  }),
  acknowledged: state(IncidentState, ID.incidentState(2), {
    name: "Identified",
    color: "#f59e0b",
    order: 2,
    isAcknowledgedState: true,
    isResolvedState: false,
  }),
  resolved: state(IncidentState, ID.incidentState(3), {
    name: "Resolved",
    color: "#10b981",
    order: 3,
    isResolvedState: true,
  }),
};

const incidentSeverities = {
  sev1: state(IncidentSeverity, ID.incidentSeverity(1), {
    name: "SEV-1",
    color: "#dc2626",
    order: 1,
  }),
  sev2: state(IncidentSeverity, ID.incidentSeverity(2), {
    name: "SEV-2",
    color: "#f97316",
    order: 2,
  }),
  sev3: state(IncidentSeverity, ID.incidentSeverity(3), {
    name: "SEV-3",
    color: "#eab308",
    order: 3,
  }),
};

const alertStates = {
  created: state(AlertState, ID.alertState(1), {
    name: "Identified",
    color: "#ef4444",
    order: 1,
    isCreatedState: true,
    isResolvedState: false,
  }),
  acknowledged: state(AlertState, ID.alertState(2), {
    name: "Acknowledged",
    color: "#f59e0b",
    order: 2,
    isAcknowledgedState: true,
    isResolvedState: false,
  }),
  resolved: state(AlertState, ID.alertState(3), {
    name: "Resolved",
    color: "#10b981",
    order: 3,
    isResolvedState: true,
  }),
};

const alertSeverities = {
  critical: state(AlertSeverity, ID.alertSeverity(1), {
    name: "Critical",
    color: "#dc2626",
    order: 1,
  }),
  high: state(AlertSeverity, ID.alertSeverity(2), {
    name: "High",
    color: "#f97316",
    order: 2,
  }),
  low: state(AlertSeverity, ID.alertSeverity(3), {
    name: "Low",
    color: "#3b82f6",
    order: 3,
  }),
};

const monitorStatuses = {
  operational: state(MonitorStatus, ID.status(1), {
    name: "Operational",
    color: "#10b981",
    isOperationalState: true,
    priority: 1,
  }),
  degraded: state(MonitorStatus, ID.status(2), {
    name: "Degraded",
    color: "#f59e0b",
    isOperationalState: false,
    priority: 2,
  }),
  offline: state(MonitorStatus, ID.status(3), {
    name: "Offline",
    color: "#ef4444",
    isOperationalState: false,
    isOfflineState: true,
    priority: 3,
  }),
};

const maintenanceStates = {
  scheduled: state(ScheduledMaintenanceState, ID.maintenanceState(1), {
    name: "Scheduled",
    color: "#6366f1",
    order: 1,
    isScheduledState: true,
    isOngoingState: false,
    isEndedState: false,
    isResolvedState: false,
  }),
  ongoing: state(ScheduledMaintenanceState, ID.maintenanceState(2), {
    name: "Ongoing",
    color: "#f59e0b",
    order: 2,
    isScheduledState: false,
    isOngoingState: true,
    isEndedState: false,
    isResolvedState: false,
  }),
  ended: state(ScheduledMaintenanceState, ID.maintenanceState(3), {
    name: "Ended",
    color: "#10b981",
    order: 3,
    isScheduledState: false,
    isOngoingState: false,
    isEndedState: true,
    isResolvedState: false,
  }),
  completed: state(ScheduledMaintenanceState, ID.maintenanceState(4), {
    name: "Completed",
    color: "#10b981",
    order: 4,
    isScheduledState: false,
    isOngoingState: false,
    isEndedState: false,
    isResolvedState: true,
  }),
};

/*
 * Every table Home reads, registered up front: a scenario that leaves one
 * empty (a new project has no incidents) still answers its reads with
 * nothing, rather than recording them as unmodelled.
 */
for (const modelType of [
  Incident,
  IncidentEpisode,
  Alert,
  AlertEpisode,
  Monitor,
  ScheduledMaintenance,
  ServiceLevelObjective,
  StatusPage,
  OnCallDutyPolicy,
  Service,
  Dashboard,
  Workflow,
  TeamMember,
]) {
  table(modelType);
}

/*
 * ---------------------------------------------------------------------------
 * Scenario data
 * ---------------------------------------------------------------------------
 */
const isNew = scenario === "new";
const hasIncidents = scenario === "busy" || scenario === "many";
const hasAlerts = hasIncidents || scenario === "attention";
const hasMaintenanceNow = hasIncidents || scenario === "maintenance";

const MONITORS = [
  ["Checkout API", MonitorType.API, hasIncidents ? "offline" : "operational"],
  ["Storefront", MonitorType.Website, "operational"],
  [
    "Search service",
    MonitorType.API,
    hasIncidents || scenario === "attention" ? "degraded" : "operational",
  ],
  ["Payments gateway", MonitorType.API, "operational"],
  ["orders-db primary host", MonitorType.Server, "operational"],
  ["Production cluster (eu-west-1)", MonitorType.Kubernetes, "operational"],
  ["Storefront TLS certificate", MonitorType.SSLCertificate, "operational"],
  ["Nightly billing export", MonitorType.IncomingRequest, "operational"],
  ["Mobile API", MonitorType.API, "operational"],
  ["Status page CDN", MonitorType.Website, "operational"],
  ["Email delivery", MonitorType.Port, "operational"],
];

/*
 * Every monitor is checked: monitoring is on (disableActiveMonitoring, a
 * column that is never empty, false by default). Not Operational leaves out
 * a monitor whose monitoring is off (NotOperationalMonitorQuery), so the
 * column is set here as the database holds it.
 */
if (!isNew) {
  MONITORS.forEach(([name, monitorType, status], index) => {
    insert(Monitor, {
      _id: ID.monitor(index + 1),
      name,
      monitorType,
      isArchived: false,
      disableActiveMonitoring: false,
      ...withIds({ currentMonitorStatus: monitorStatuses[status] }, [
        "currentMonitorStatus",
      ]),
    });
  });
  // Archived and frozen Offline: never counted, never listed.
  insert(Monitor, {
    _id: ID.monitor(99),
    name: "Legacy image resizer",
    monitorType: MonitorType.API,
    isArchived: true,
    disableActiveMonitoring: false,
    ...withIds({ currentMonitorStatus: monitorStatuses.offline }, [
      "currentMonitorStatus",
    ]),
  });
}

/*
 * A relation and its id column, as the API stores them: queries filter on
 * the id (currentIncidentStateId), selects read the relation.
 */
function withIds(data, relations) {
  const out = { ...data };
  for (const relation of relations) {
    if (data[relation]) {
      out[`${relation}Id`] = new ObjectID(String(data[relation]._id));
    }
  }
  return out;
}

function incident(number, data) {
  insert(Incident, {
    _id: ID.incident(number),
    incidentNumber: number,
    incidentNumberWithPrefix: `INC-${number}`,
    isPrivate: false,
    ...withIds(data, ["currentIncidentState", "incidentSeverity"]),
  });
}

if (hasIncidents) {
  incident(1042, {
    title: "Checkout API returning 503 errors",
    incidentSeverity: incidentSeverities.sev1,
    currentIncidentState: incidentStates.created,
    declaredAt: ago(12 * MINUTE),
    createdAt: ago(12 * MINUTE),
  });
  incident(1041, {
    title: "Elevated latency on payment authorizations",
    incidentSeverity: incidentSeverities.sev2,
    currentIncidentState: incidentStates.acknowledged,
    declaredAt: ago(47 * MINUTE),
    createdAt: ago(47 * MINUTE),
  });
}

if (scenario === "many") {
  for (let index = 0; index < 7; index++) {
    incident(1030 + index, {
      title: `Regional edge node ${index + 1} unreachable`,
      incidentSeverity: incidentSeverities.sev3,
      currentIncidentState: incidentStates.created,
      declaredAt: ago((2 + index) * HOUR),
      createdAt: ago((2 + index) * HOUR),
    });
  }
}

if (!isNew) {
  // Resolved: in the table, never on Home.
  incident(1037, {
    title: "Search results missing product images",
    incidentSeverity: incidentSeverities.sev3,
    currentIncidentState: incidentStates.resolved,
    declaredAt: ago(2 * DAY),
    createdAt: ago(2 * DAY),
  });
}

function alert(number, data) {
  insert(Alert, {
    _id: ID.alert(number),
    alertNumber: number,
    alertNumberWithPrefix: `ALT-${number}`,
    ...withIds(data, ["currentAlertState", "alertSeverity"]),
  });
}

if (hasAlerts) {
  alert(311, {
    title: "CPU above 90% on orders-db-1",
    alertSeverity: alertSeverities.high,
    currentAlertState: alertStates.acknowledged,
    createdAt: ago(25 * MINUTE),
  });
  alert(310, {
    title: "Disk 85% full on logs-2",
    alertSeverity: alertSeverities.low,
    currentAlertState: alertStates.created,
    createdAt: ago(2 * HOUR),
  });
}

if (hasIncidents) {
  alert(309, {
    title: "Error rate above 2% on Search service",
    alertSeverity: alertSeverities.critical,
    currentAlertState: alertStates.created,
    createdAt: ago(3 * HOUR),
  });
}

if (!isNew) {
  alert(300, {
    title: "Queue depth above 10,000 on order-events",
    alertSeverity: alertSeverities.high,
    currentAlertState: alertStates.resolved,
    createdAt: ago(3 * DAY),
  });
}

function slo(number, data) {
  insert(ServiceLevelObjective, {
    _id: ID.slo(number),
    isEnabled: true,
    isArchived: false,
    targetPercentage: 99.9,
    ...data,
  });
}

if (!isNew) {
  const burning = hasIncidents || scenario === "attention";
  slo(1, {
    name: "Checkout availability",
    sloStatus: burning ? SloStatus.AtRisk : SloStatus.Healthy,
    currentSliPercentage: burning ? 99.91 : 99.98,
    errorBudgetRemainingPercentage: burning ? 18.4 : 82.5,
  });
  slo(2, {
    name: "Search latency p95 under 300 ms",
    sloStatus: hasIncidents ? SloStatus.BudgetExhausted : SloStatus.Healthy,
    targetPercentage: 99,
    currentSliPercentage: hasIncidents ? 98.7 : 99.6,
    errorBudgetRemainingPercentage: hasIncidents ? -30 : 60,
  });
  slo(3, {
    name: "API availability",
    sloStatus: SloStatus.Healthy,
    errorBudgetRemainingPercentage: 91.2,
  });
  // Disabled and archived: frozen, never counted as burning.
  slo(4, {
    name: "Legacy storefront availability",
    sloStatus: SloStatus.AtRisk,
    isEnabled: false,
    errorBudgetRemainingPercentage: 5,
  });
  slo(5, {
    name: "Old checkout target",
    sloStatus: SloStatus.BudgetExhausted,
    isArchived: true,
    errorBudgetRemainingPercentage: -10,
  });
}

function maintenance(number, data) {
  insert(ScheduledMaintenance, {
    _id: ID.maintenance(number),
    ...withIds(data, ["currentScheduledMaintenanceState"]),
  });
}

if (hasMaintenanceNow) {
  maintenance(1, {
    title: "Database failover drill",
    currentScheduledMaintenanceState: maintenanceStates.ongoing,
    startsAt: ago(20 * MINUTE),
    endsAt: fromNow(40 * MINUTE),
  });
}

// Quiet: nothing coming up, so Home leaves the Upcoming maintenance card out.
if (!isNew && scenario !== "quiet") {
  maintenance(2, {
    title: "Kubernetes 1.31 upgrade",
    currentScheduledMaintenanceState: maintenanceStates.scheduled,
    startsAt: fromNow(2 * DAY),
    endsAt: fromNow(2 * DAY + 2 * HOUR),
  });
}

if (!isNew) {
  maintenance(5, {
    title: "Quarterly storage cleanup",
    currentScheduledMaintenanceState: maintenanceStates.completed,
    startsAt: ago(10 * DAY),
    endsAt: ago(10 * DAY - HOUR),
  });
}

if (hasIncidents) {
  maintenance(3, {
    title: "CDN provider migration",
    currentScheduledMaintenanceState: maintenanceStates.scheduled,
    startsAt: fromNow(6 * DAY),
    endsAt: fromNow(6 * DAY + 4 * HOUR),
  });
  maintenance(4, {
    title: "Payments provider maintenance window",
    currentScheduledMaintenanceState: maintenanceStates.scheduled,
    startsAt: fromNow(9 * DAY),
    endsAt: fromNow(9 * DAY + HOUR),
  });
}

function many(modelType, count, data) {
  for (let index = 0; index < count; index++) {
    insert(modelType, { name: `${data.name} ${index + 1}`, isArchived: false });
  }
  // One archived row each: left out of every count.
  insert(modelType, { name: `${data.name} (archived)`, isArchived: true });
}

if (!isNew) {
  many(StatusPage, 2, { name: "Status page" });
  many(OnCallDutyPolicy, 3, { name: "On-call policy" });
  many(Service, 8, { name: "Service" });
  many(Dashboard, 4, { name: "Dashboard" });
  table(Workflow);
  for (let index = 0; index < 6; index++) {
    insert(TeamMember, { userId: new ObjectID(ID.user(index + 1)) });
  }
} else {
  table(StatusPage);
  table(OnCallDutyPolicy);
  table(Service);
  table(Dashboard);
  table(Workflow);
  // The project's creator: the first member every project starts with.
  insert(TeamMember, { userId: new ObjectID(ID.user(1)) });
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
/*
 * Signed in, as far as recording the setup pages is concerned (#6834): it
 * reads the person's switch only for somebody signed in. Only with
 * ?recording=cloud, so every other scenario runs as it always has.
 */
if (params.get("recording") === "cloud") {
  UserUtil.isLoggedIn = () => {
    return true;
  };
}
UserUtil.getUserId = () => {
  return new ObjectID(ID.user(1));
};
UserUtil.getName = () => {
  return "Maya Chen";
};
UserUtil.getEmail = () => {
  return "maya@acme-commerce.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

function knownTable(modelType, kind, extra) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    fixture.unhandled.push({ kind, modelName: name, ...extra });
    return null;
  }
  return tables.get(name);
}

let hasFailedIncidentList = false;

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
  if (modelName === "Incident") {
    if (failures.has("overview")) {
      throw fail(500, "Incidents could not be read. The API is restarting.");
    }
    if (failures.has("overview-once") && !hasFailedIncidentList) {
      hasFailedIncidentList = true;
      throw fail(500, "Incidents could not be read. The API is restarting.");
    }
  }
  if (
    failures.has("upcoming") &&
    modelName === "ScheduledMaintenance" &&
    serialize(options.sort)?.startsAt === SortOrder.Ascending &&
    !serialize(options.select)?.currentScheduledMaintenanceState
  ) {
    throw fail(500, "Scheduled maintenance could not be read.");
  }
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
      return projectRecord(options.modelType, record, options.select);
    }),
    count: records.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });
  if (failures.has("resources") && modelName === "StatusPage") {
    throw fail(403, "You do not have permission to read status pages.");
  }
  const known = knownTable(options.modelType, "count", {
    query: serialize(options.query),
  });
  return (known?.records || []).filter((record) => {
    return matches(record, options.query);
  }).length;
};

/*
 * What an invited member's personal checklist reads besides readiness: a
 * new member has none of these yet (#6807).
 */
[
  UserNotificationSetting,
  IncomingCallPolicy,
  UserIncomingCallNumber,
  WorkspaceProjectAuthToken,
  WorkspaceUserAuthToken,
  TeamMemberCustomField,
  ProjectUserProfile,
].forEach((modelType) => {
  table(modelType);
});

ModelAPI.getItem = async (options) => {
  /*
   * The project's channel switches and fallback, for the personal checklist;
   * and, with ?recording=cloud, its switch for recording the setup pages
   * (#6834), on.
   */
  if (tableName(options.modelType) === "Project") {
    return make(Project, {
      _id: PROJECT_ID,
      disableOnCallNotificationFallback: false,
      disableDashboardRecording: false,
    });
  }

  // The person's own switch for recording the setup pages (#6834), on.
  if (tableName(options.modelType) === "User") {
    fixture.recordingSwitchReads.push("User");
    return make(User, { disableDashboardRecording: false });
  }

  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

/*
 * The Welcome checklist (issue #6803): one answer for the project and the
 * person, built with the real rules, and the routes that change it.
 */
const welcomeMode = params.get("welcome") || "";
const welcome = {
  goals: welcomeMode === "ask" ? null : [],
  isHiddenForMe: welcomeMode === "hidden",
  isFinished: !isNew,
  reached:
    welcomeMode === "half"
      ? [
          ActivationMilestone.FirstMonitorCreated,
          ActivationMilestone.FirstCheckResultReceived,
        ]
      : [],
  isFreePlan: params.get("plan") === "free",
};
fixture.welcomeRequests = [];

function welcomeAnswer() {
  const base = {
    goals: welcome.goals,
    shouldAskForGoals: false,
    canChooseGoals: roleMode !== "viewer",
    isHiddenForMe: welcome.isHiddenForMe,
    isFinished: welcome.isFinished,
    canSendEmail: true,
    steps: [],
    doneCount: 0,
    totalCount: 0,
  };

  // A viewer was invited: the owner's checklist is not theirs (#6807).
  if (roleMode === "viewer") {
    return { ...base, audience: WelcomeAudience.InvitedMember };
  }

  if (welcome.isFinished) {
    return { ...base, audience: WelcomeAudience.SetUp };
  }

  const checklist = buildWelcomeChecklist({
    goals: welcome.goals,
    facts: {
      reached: welcome.reached,
      hasRuleThatPagesSomeone: false,
      hasFinishedImport: false,
      serverCanSendEmail: true,
    },
    plan: { isFreePlan: welcome.isFreePlan },
    readerIsServerAdmin: false,
  });

  return {
    ...base,
    audience: WelcomeAudience.SetUp,
    shouldAskForGoals: welcome.goals === null,
    steps: checklist.steps,
    doneCount: checklist.doneCount,
    totalCount: checklist.totalCount,
  };
}

function handleWelcome(method, url, options) {
  const path = new URL(url).pathname;

  if (!path.includes("/welcome-checklist")) {
    return null;
  }

  fixture.welcomeRequests.push({
    method,
    path,
    data: serialize(options.data),
  });

  if (method === "GET" && path.endsWith("/welcome-checklist")) {
    return ok(welcomeAnswer());
  }

  if (method === "POST" && path.endsWith("/welcome-checklist/goals")) {
    welcome.goals = parseProjectGoals(options.data?.goals) || [];
    return ok(welcomeAnswer());
  }

  if (method === "POST" && path.endsWith("/welcome-checklist/hide")) {
    welcome.isHiddenForMe = true;
    return ok(welcomeAnswer());
  }

  if (method === "POST" && path.endsWith("/welcome-checklist/show")) {
    welcome.isHiddenForMe = false;
    return ok(welcomeAnswer());
  }

  return null;
}

/*
 * An invited member's own reads (#6807): Grace, invited a minute ago - her
 * sign-in email only, paged through a team, her first shift tomorrow.
 */
const MEMBER_SEVERITY_ID = "70000000-0000-4000-8000-000000000001";

function memberReadiness() {
  return {
    userId: ID.user(1),
    userName: "Maya Chen",
    userEmail: "maya@acme-commerce.example",
    status: "Ready",
    methods: [
      {
        methodId: "70000000-0000-4000-8000-000000000002",
        methodType: "Email",
        maskedIdentifier: "m***@acme-commerce.example",
        isVerified: true,
      },
    ],
    coverage: [
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ].map((ruleType) => {
      return {
        ruleType,
        severityId: MEMBER_SEVERITY_ID,
        severityName: "Critical",
        hasRule: true,
        isOptOut: false,
      };
    }),
    reasons: [],
    reachedVia: ["Team"],
    teams: [],
  };
}

function memberShifts() {
  // Tomorrow, 09:00 to 17:00 UTC.
  const start = new Date(
    Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 1, 9),
  );
  const end = new Date(start.getTime() + 8 * HOUR);

  return {
    shifts: [
      {
        shiftKey: `70000000-0000-4000-8000-000000000003:${start.getTime() / 1000}`,
        contentHash: "fixture",
        projectId: PROJECT_ID,
        projectName: "Acme Commerce",
        scheduleId: "70000000-0000-4000-8000-000000000003",
        scheduleName: "Primary on-call",
        scheduleTimezone: "UTC",
        userId: ID.user(1),
        userName: "Maya Chen",
        start: start.toISOString(),
        end: end.toISOString(),
        coverageSeconds: 8 * 3600,
        layerId: "70000000-0000-4000-8000-000000000004",
        layerName: "Layer 1",
        policies: [],
        isPast: false,
        lastModifiedAt: ago(DAY).toISOString(),
        shiftConfigVersion: 1,
      },
    ],
    truncated: false,
    generatedAt: NOW.toISOString(),
  };
}

/*
 * Setup health (#6812): the project's findings, built with the real
 * makeSetupHealthFinding, for the page (GET /setup-health) and the count
 * Home's Needs attention says (GET /setup-health/summary).
 */
const setupMode = params.get("setup") || "";
fixture.setupHealthRequests = [];

const SETUP_POLICY_ID = uuid("60000000", 9);
const SETUP_STATUS_PAGE_ID = uuid("61000000", 9);

function setupFinding(data) {
  return makeSetupHealthFinding(data);
}

function setupMonitorPagesNobody(index, name) {
  return setupFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: ID.monitor(20 + index),
      name: name,
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: name },
  });
}

function setupHealthFindings() {
  if (setupMode !== "busy") {
    return [];
  }

  const project = { kind: SetupHealthRecordKind.Project, id: PROJECT_ID, name: "" };

  return [
    setupFinding({
      check: SetupHealthCheck.MonitorAlertsPageNobody,
      level: SetupHealthLevel.PagesWillNotArrive,
      record: {
        kind: SetupHealthRecordKind.Monitor,
        id: ID.monitor(19),
        name: "Payments API",
      },
      fix: SetupHealthFix.AlertOnCallRules,
      words: SETUP_HEALTH_WORDS.monitorAlertsPageNobody,
      values: { monitor: "Payments API" },
    }),
    setupFinding({
      check: SetupHealthCheck.PolicyReachesNobody,
      level: SetupHealthLevel.PagesWillNotArrive,
      record: {
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: SETUP_POLICY_ID,
        name: "Weekend escalation",
      },
      fix: SetupHealthFix.OnCallPolicy,
      fixRecordId: SETUP_POLICY_ID,
      words: SETUP_HEALTH_WORDS.policyReachesNobody,
      values: { policy: "Weekend escalation" },
    }),
    setupFinding({
      check: SetupHealthCheck.ChannelOff,
      level: SetupHealthLevel.PagesWillNotArrive,
      subject: "SMS",
      record: project,
      fix: SetupHealthFix.ProjectNotificationSettings,
      words: SETUP_HEALTH_WORDS.channelOff,
      values: { channel: "SMS" },
    }),
    ...[
      "Checkout API",
      "Search API",
      "Marketing site",
      "Image CDN",
      "Status webhook",
    ].map((name, index) => {
      return setupMonitorPagesNobody(index, name);
    }),
    setupFinding({
      check: SetupHealthCheck.StatusPageShowsNoMonitor,
      level: SetupHealthLevel.WorthFixing,
      record: {
        kind: SetupHealthRecordKind.StatusPage,
        id: SETUP_STATUS_PAGE_ID,
        name: "Partner status",
      },
      fix: SetupHealthFix.StatusPageResources,
      fixRecordId: SETUP_STATUS_PAGE_ID,
      words: SETUP_HEALTH_WORDS.statusPageShowsNoMonitor,
      values: { statusPage: "Partner status" },
    }),
    setupFinding({
      check: SetupHealthCheck.OneOwner,
      level: SetupHealthLevel.Suggestion,
      record: project,
      fix: SetupHealthFix.ProjectOwners,
      words: SETUP_HEALTH_WORDS.oneOwner,
    }),
  ];
}

function setupHealthDismissed() {
  if (setupMode !== "busy") {
    return [];
  }

  const finding = setupMonitorPagesNobody(9, "Staging API");

  return [
    {
      finding,
      dismissal: {
        id: "70000000-0000-4000-8000-000000000068",
        recommendationId: getSetupHealthDismissalId(finding),
        resourceType: finding.record.kind,
        resourceId: finding.record.id,
        reason: "Staging never pages anybody.",
        dismissedByName: "Maya Chen",
        dismissedAt: NOW.toISOString(),
      },
    },
  ];
}

function handleSetupHealth(method, url) {
  const path = new URL(url).pathname;

  if (!path.includes("/setup-health")) {
    return null;
  }

  fixture.setupHealthRequests.push({ method, url });

  const findings = setupHealthFindings();
  const counts = getSetupHealthCounts(findings);

  if (method === "GET" && path.endsWith("/setup-health/summary")) {
    return ok({ counts, checkedAt: NOW.toISOString() });
  }

  if (method === "GET" && path.endsWith("/setup-health")) {
    return ok({
      findings,
      dismissed: setupHealthDismissed(),
      counts,
      monitorCount: 14,
      checkedAt: NOW.toISOString(),
    });
  }

  return null;
}

function handleMember(method, url) {
  const path = new URL(url).pathname;

  if (method !== "GET") {
    return null;
  }

  if (path.includes("/on-call-readiness/user/")) {
    return ok(memberReadiness());
  }

  if (path.endsWith("/on-call-calendar/my-shifts")) {
    return ok(memberShifts());
  }

  // No calendar link yet, as an older API answers: the row is left out.
  if (path.endsWith("/on-call-calendar/feed/current")) {
    return fail(404, "Not found");
  }

  return null;
}

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url });

  const welcomeResponse = handleWelcome(method, url, options);

  if (welcomeResponse) {
    return welcomeResponse;
  }

  const memberResponse = handleMember(method, url);

  if (memberResponse) {
    return memberResponse;
  }

  const setupHealthResponse = handleSetupHealth(method, url);

  if (setupHealthResponse) {
    return setupHealthResponse;
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return ok({ data: [], count: 0 });
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

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fa: { translation: fa },
  },
  interpolation: { escapeValue: false },
});
// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
// <html lang dir> follow the reader's language: Persian reads right to left.
followLanguageForPage(i18next);

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function FixtureHomeLayout() {
  useNavigationHooks();
  return <HomeLayout {...pageProps(PageMap.HOME)} />;
}

function HomePage() {
  useNavigationHooks();
  return (
    <Home
      {...pageProps(PageMap.HOME)}
      projects={[project]}
      isLoadingProjects={false}
    />
  );
}

// Setup health (#6812): the real page, as App.tsx mounts it under Home.
function SetupHealthRoute() {
  useNavigationHooks();
  return <SetupHealthPage {...pageProps(PageMap.HOME_SETUP_HEALTH)} />;
}

// A page Home links to that is not modelled here: says where it is.
function StubPage(props) {
  useNavigationHooks();
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

/*
 * The products' own lists Home opens: its numbers, View all and the old
 * addresses of Home's copies of them (#6857). Each is a stub that names
 * the list, so the spec can tell where a click or a forward ended up.
 */
const PRODUCT_LISTS = [
  [PageMap.UNRESOLVED_INCIDENTS, "Active Incidents"],
  [PageMap.UNRESOLVED_INCIDENT_EPISODES, "Active Incident Episodes"],
  [PageMap.UNRESOLVED_ALERTS, "Active Alerts"],
  [PageMap.UNRESOLVED_ALERT_EPISODES, "Active Alert Episodes"],
  [PageMap.MONITORS_INOPERATIONAL, "Not Operational Monitors"],
  [PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS, "Ongoing Maintenance Events"],
  [PageMap.SLOS, "SLOs"],
];

function FixtureApp() {
  useNavigationHooks();

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
        <div className="flex items-center gap-3">
          <span
            data-testid="synthetic-banner"
            className="text-xs text-gray-500"
          >
            Preview workspace · Synthetic data
          </span>
          <Help />
        </div>
      </header>
      <HowOneUptimeWorksDialog />
      {/*
       * As App.tsx mounts it (#6834). Without OneUptime Cloud's configuration
       * - every scenario but ?recording=cloud - it does nothing at all.
       */}
      <DashboardRecording projectId={PROJECT_ID} />
      <Routes>
        <Route element={<FixtureHomeLayout />}>
          <Route
            path={RouteMap[PageMap.HOME].toString()}
            element={<HomePage />}
          />
        </Route>
        {/* Setup health (#6812), under Home, as App.tsx mounts it. */}
        <Route
          path={RouteMap[PageMap.HOME_SETUP_HEALTH].toString()}
          element={<SetupHealthRoute />}
        />
        {/* Home's old lists, forwarded to the products' own lists. */}
        <Route
          path={RouteMap[PageMap.MOVED_HOME_LISTS_ROOT].toString()}
          element={<MovedHomeRoutes />}
        />
        {PRODUCT_LISTS.map(([pageKey, title]) => {
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
          element={<StubPage pageKey="other" title="Not modelled" />}
        />
      </Routes>
    </>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
