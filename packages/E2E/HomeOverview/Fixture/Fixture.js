/*
 * Offline fixture for the real dashboard Home page.
 *
 * The Home Layout (Page + the Home side menu) and the Home page are the
 * production components from this branch, mounted under their real RouteMap
 * patterns. Only the data boundary (ModelAPI / API) and the signed-in user
 * are replaced.
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
 *   ?lang=      de reads the German locale file
 *   ?theme=     dark adds html.dark (handled by server.js)
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
import { initReactI18next } from "react-i18next";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import HomeLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import Home from "../../../App/FeatureSet/Dashboard/src/Pages/Home/Home";
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

const SCENARIOS = ["busy", "healthy", "attention", "maintenance", "new", "many"];
const scenario = SCENARIOS.includes(params.get("scenario"))
  ? params.get("scenario")
  : "busy";
const roleMode = params.get("role") === "viewer" ? "viewer" : "owner";
const failures = listParam("fail");
const language = params.get("lang") === "de" ? "de" : "en";

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
const hasMaintenanceNow =
  hasIncidents || scenario === "maintenance";

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

if (!isNew) {
  MONITORS.forEach(([name, monitorType, status], index) => {
    insert(Monitor, {
      _id: ID.monitor(index + 1),
      name,
      monitorType,
      isArchived: false,
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

if (!isNew) {
  maintenance(2, {
    title: "Kubernetes 1.31 upgrade",
    currentScheduledMaintenanceState: maintenanceStates.scheduled,
    startsAt: fromNow(2 * DAY),
    endsAt: fromNow(2 * DAY + 2 * HOUR),
  });
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

ModelAPI.getItem = async (options) => {
  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url });
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
  },
  interpolation: { escapeValue: false },
});

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
 * One of Home's own lists, drawn inside the Home layout, whose Page already
 * has the list's title as its heading: says where it is, with no heading of
 * its own.
 */
function InLayoutStubPage(props) {
  useNavigationHooks();
  const location = useLocation();
  return (
    <p
      data-testid="stub-page"
      data-page={props.pageKey}
      className="rounded-xl border border-gray-200 bg-white p-6 font-mono text-sm text-gray-600"
    >
      {location.pathname}
    </p>
  );
}

// Home's own lists, drawn in the Home layout beside its side menu.
const HOME_TABS = [
  [PageMap.HOME_ACTIVE_INCIDENTS, "Active Incidents"],
  [PageMap.HOME_ACTIVE_ALERTS, "Active Alerts"],
  [PageMap.HOME_ACTIVE_EPISODES, "Active Alert Episodes"],
  [PageMap.HOME_ACTIVE_INCIDENT_EPISODES, "Active Incident Episodes"],
  [PageMap.HOME_NOT_OPERATIONAL_MONITORS, "Not Operational Monitors"],
  [
    PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    "Ongoing Scheduled Maintenance",
  ],
].filter(([pageKey]) => {
  return Boolean(pageKey && RouteMap[pageKey]);
});

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
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureHomeLayout />}>
          <Route path={RouteMap[PageMap.HOME].toString()} element={<HomePage />} />
          {HOME_TABS.map(([pageKey]) => {
            return (
              <Route
                key={pageKey}
                path={RouteMap[pageKey].toString()}
                element={<InLayoutStubPage pageKey={pageKey} />}
              />
            );
          })}
        </Route>
        <Route
          path="*"
          element={<StubPage pageKey="other" title="Not modelled" />}
        />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
