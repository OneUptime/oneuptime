/*
 * Offline fixture for the real monitor overview page.
 *
 * The monitor view Layout (ModelPage + SideMenu) and the overview Index are
 * the production components from this branch, mounted under their real
 * RouteMap pattern. Only the data boundary (ModelAPI / AnalyticsModelAPI /
 * API) and the signed-in user are replaced.
 *
 * Every record is fabricated for a generic "Acme Commerce" workspace. The
 * clock is pinned: every date is relative to NOW = 2026-09-21T12:00:00Z and
 * the spec fixes the browser clock to the same instant.
 *
 * One monitor exists per supported type, each on its own id (see
 * MONITORS below). Scenarios are picked with query parameters, parsed once
 * at load, so a scenario change needs a fresh page.goto. They shape the
 * monitor chosen with ?type= (the "subject"); every other monitor keeps the
 * defaults, so following a link to another monitor lands on a plain,
 * healthy one.
 *
 *   ?type=     api (default) | website | ssl | incoming-request
 *              | incoming-email | server | kubernetes | network-device
 *              | manual
 *   ?state=    comma separated. The status: operational (default) |
 *              offline | degraded. Plus any of: disabled, maintenance,
 *              no-probes, probes-off, disconnected, one-disconnected,
 *              stale, awaiting. "disabled,probes-off" is a disabled
 *              monitor whose probes are all switched off.
 *   ?history=  full (default, created in March) | new (created 12 days
 *              ago, so most bars have no data) | flapping (an outage every
 *              few hours for three months)
 *   ?role=     owner (default) | viewer | monitor-viewer
 *              | read-project-monitor. The signed-in user's permissions.
 *              Reads of a model the role cannot read are refused the way
 *              the API refuses them, and so is a select that names a
 *              column the role cannot read.
 *   ?fail=     comma separated:
 *              uptime-summary  the FIRST uptime-summary request fails
 *              incidents       every Incident list fails
 *              probes          every MonitorProbe list fails
 *              monitor         the FIRST overview read of the Monitor row
 *                              fails (the Layout's and header's reads do
 *                              not)
 *              refresh-status  every refresh-status request fails
 *   ?nav=1     shows links to every fixture monitor in the header, to move
 *              between monitors on the same, still-mounted route.
 *   ?theme=    dark adds html.dark (handled by server.js).
 *
 * Every read is recorded on window.__monitorOverviewFixture: getItemRequests,
 * listRequests (analytics lists carry analytics: true), aggregateRequests,
 * apiRequests (with headers), updates, and unhandled: anything the fixture
 * does not model (a model table, an analytics query or an API URL). The
 * spec asserts `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import MonitorViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Layout";
import MonitorView from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Index";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import MonitorFeed, {
  MonitorFeedEventType,
} from "Common/Models/DatabaseModels/MonitorFeed";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CommonURL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MONITOR_UPTIME_ROLLING_WINDOWS,
  MonitorUptimeWindowKey,
} from "Common/Types/Monitor/MonitorUptimeSummary";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { APP_API_URL } from "Common/UI/Config";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import MonitorUptimeSummaryUtil from "Common/Utils/Monitor/MonitorUptimeSummaryUtil";

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

const TYPE_KEYS = [
  "api",
  "website",
  "ssl",
  "incoming-request",
  "incoming-email",
  "server",
  "kubernetes",
  "network-device",
  "manual",
];
const subjectType = TYPE_KEYS.includes(params.get("type"))
  ? params.get("type")
  : "api";
const stateFlags = listParam("state");
const statusMode = stateFlags.has("offline")
  ? "offline"
  : stateFlags.has("degraded")
    ? "degraded"
    : "operational";
const historyMode = ["new", "flapping"].includes(params.get("history"))
  ? params.get("history")
  : "full";
const ROLE_KEYS = ["owner", "viewer", "monitor-viewer", "read-project-monitor"];
const roleMode = ROLE_KEYS.includes(params.get("role"))
  ? params.get("role")
  : "owner";
const failures = listParam("fail");
const showNav = params.get("nav") === "1";

/*
 * What every signed-in user holds (AccessTokenService's global permissions),
 * plus the one project permission of the role.
 */
const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const ROLE_PERMISSIONS = {
  owner: [...GLOBAL_PERMISSIONS, Permission.ProjectOwner],
  viewer: [...GLOBAL_PERMISSIONS, Permission.Viewer],
  "monitor-viewer": [...GLOBAL_PERMISSIONS, Permission.MonitorViewer],
  "read-project-monitor": [
    ...GLOBAL_PERMISSIONS,
    Permission.ReadProjectMonitor,
  ],
};
const rolePermissions = ROLE_PERMISSIONS[roleMode];

/*
 * ---------------------------------------------------------------------------
 * Clock and ids
 * ---------------------------------------------------------------------------
 */
const NOW = new Date("2026-09-21T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
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
  monitor: (number) => uuid("70000000", number),
  label: (number) => uuid("72000000", number),
  probe: (number) => uuid("73000000", number),
  user: (number) => uuid("80000000", number),
  team: (number) => uuid("81000000", number),
  status: (number) => uuid("83000000", number),
  step: (number) => uuid("84000000", number),
  networkDevice: (number) => uuid("85000000", number),
  secret: (number) => uuid("86000000", number),
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
    type: subjectType,
    state: Array.from(stateFlags),
    history: historyMode,
    role: roleMode,
    fail: Array.from(failures),
  },
  getItemRequests: [],
  listRequests: [],
  countRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  updates: [],
  unhandled: [],
};
window.__monitorOverviewFixture = fixture;

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
  const full = { _id: rowId(), projectId: projectObjectId, ...record };
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
    // A relation list (Incident.monitors) matches when any member does.
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
    // Other query operators are not modelled: match.
    return true;
  }
  // A nested relation filter: { monitors: { _id: "..." } }.
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

/*
 * A relation value cut down to its selected columns. The id always comes
 * back, as it does from the API.
 */
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
 * Shared catalogue: people, labels, statuses, probes, states, severities
 * ---------------------------------------------------------------------------
 */
const project = make(Project, { _id: PROJECT_ID, name: "Acme Commerce" });

function person(number, name, email) {
  return insert(User, {
    _id: ID.user(number),
    name: new Name(name),
    email: new Email(email),
    // Avatars come from /api/user/profile-picture/:userId (server.js).
    profilePictureId: new ObjectID(ID.user(number)),
  });
}

const people = {
  maya: person(1, "Maya Chen", "maya.chen@acme-commerce.example"),
  sam: person(2, "Sam Rivera", "sam.rivera@acme-commerce.example"),
  jordan: person(3, "Jordan Patel", "jordan.patel@acme-commerce.example"),
};

const team = insert(Team, { _id: ID.team(1), name: "Checkout SRE" });

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
  platform: label(3, "team:platform", "#7c3aed"),
  finance: label(4, "team:finance", "#0891b2"),
};

const STATUS_DEFINITIONS = {
  operational: {
    number: 1,
    name: "Operational",
    color: "#10b981",
    priority: 1,
    isOperationalState: true,
    isOfflineState: false,
  },
  degraded: {
    number: 2,
    name: "Degraded",
    color: "#f59e0b",
    priority: 2,
    isOperationalState: false,
    isOfflineState: false,
  },
  offline: {
    number: 3,
    name: "Offline",
    color: "#ef4444",
    priority: 3,
    isOperationalState: false,
    isOfflineState: true,
  },
};

const statuses = {};
for (const [key, definition] of Object.entries(STATUS_DEFINITIONS)) {
  statuses[key] = insert(MonitorStatus, {
    _id: ID.status(definition.number),
    name: definition.name,
    color: new Color(definition.color),
    priority: definition.priority,
    isOperationalState: definition.isOperationalState,
    isOfflineState: definition.isOfflineState,
  });
}

const PROBE_DEFINITIONS = [
  {
    number: 1,
    name: "Frankfurt (eu-central-1)",
    responseTimeInMs: 182,
    slowResponseTimeInMs: 2410,
  },
  {
    number: 2,
    name: "N. Virginia (us-east-1)",
    responseTimeInMs: 243,
    slowResponseTimeInMs: 2688,
  },
  {
    number: 3,
    name: "Singapore (ap-southeast-1)",
    responseTimeInMs: 311,
    slowResponseTimeInMs: 3120,
  },
];

for (const definition of PROBE_DEFINITIONS) {
  insert(Probe, {
    _id: ID.probe(definition.number),
    name: definition.name,
    connectionStatus: ProbeConnectionStatus.Connected,
  });
}

function eventStates(modelType, prefixId) {
  return {
    created: insert(modelType, {
      _id: prefixId(1),
      name: "Created",
      color: new Color("#ef4444"),
      isCreatedState: true,
      isResolvedState: false,
      order: 1,
    }),
    acknowledged: insert(modelType, {
      _id: prefixId(2),
      name: "Acknowledged",
      color: new Color("#f59e0b"),
      isAcknowledgedState: true,
      isResolvedState: false,
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
};

insert(MetricType, {
  name: MonitorMetricType.ResponseTime,
  unit: "ms",
});
insert(MetricType, {
  name: MonitorMetricType.ExecutionTime,
  unit: "ms",
});

/*
 * Tables the page reads that are intentionally empty in this workspace (no
 * custom fields defined). Registering them marks them as modelled, so they
 * never show up in `unhandled`.
 */
for (const modelType of [MonitorCustomField]) {
  table(modelType);
}

/*
 * ---------------------------------------------------------------------------
 * Monitors
 * ---------------------------------------------------------------------------
 */
const MONITOR_DEFINITIONS = {
  api: {
    number: 1,
    name: "Checkout API",
    description: "Health check of the public checkout API.",
    monitorType: MonitorType.API,
    interval: "*/5 * * * *",
    labels: [labels.checkout, labels.production],
    destination: "https://api.acme-commerce.example/v1/checkout/health",
    minimumProbeAgreement: 2,
    failureCauses: [
      "HTTP 503 Service Unavailable: upstream connect error before headers.",
      "Request timed out after 30 seconds.",
      "HTTP 503 Service Unavailable: upstream connect error before headers.",
    ],
  },
  website: {
    number: 2,
    name: "Storefront",
    description: "The shop's home page, loaded from three regions.",
    monitorType: MonitorType.Website,
    interval: "*/5 * * * *",
    labels: [labels.checkout, labels.production],
    destination: "https://shop.acme-commerce.example/",
    minimumProbeAgreement: 1,
    failureCauses: [
      "HTTP 502 Bad Gateway.",
      "HTTP 502 Bad Gateway.",
      "HTTP 502 Bad Gateway.",
    ],
  },
  ssl: {
    number: 3,
    name: "Storefront TLS certificate",
    description: "Certificate served by shop.acme-commerce.example.",
    monitorType: MonitorType.SSLCertificate,
    interval: "0 * * * *",
    labels: [labels.platform],
    destination: "https://shop.acme-commerce.example",
    minimumProbeAgreement: 1,
    failureCauses: [
      "The certificate has expired.",
      "The certificate has expired.",
      "The certificate has expired.",
    ],
  },
  "incoming-request": {
    number: 4,
    name: "Nightly billing export",
    description: "The billing export posts here when it finishes.",
    monitorType: MonitorType.IncomingRequest,
    interval: "* * * * *",
    labels: [labels.finance],
  },
  "incoming-email": {
    number: 5,
    name: "Payroll run confirmation",
    description: "The payroll provider emails a confirmation every day.",
    monitorType: MonitorType.IncomingEmail,
    interval: "* * * * *",
    labels: [labels.finance],
  },
  server: {
    number: 6,
    name: "orders-db primary host",
    description: "The host running the primary orders database.",
    monitorType: MonitorType.Server,
    interval: "* * * * *",
    labels: [labels.platform, labels.production],
  },
  kubernetes: {
    number: 7,
    name: "Production cluster (eu-west-1)",
    description: "Pod restarts and node pressure on the production cluster.",
    monitorType: MonitorType.Kubernetes,
    interval: "* * * * *",
    labels: [labels.platform, labels.production],
  },
  "network-device": {
    number: 8,
    name: "Core switch sw-core-01",
    description: "Uplinks of the data-centre core switch.",
    monitorType: MonitorType.NetworkDevice,
    interval: "* * * * *",
    labels: [labels.platform],
  },
  manual: {
    number: 9,
    name: "Payment provider",
    description: "Set by the on-call engineer from the provider's own status.",
    monitorType: MonitorType.Manual,
    interval: "* * * * *",
    labels: [labels.checkout],
  },
};

const PROBE_CHECK_TYPES = ["api", "website", "ssl"];

function scenarioFor(typeKey) {
  if (typeKey !== subjectType) {
    return { status: "operational", flags: new Set(), history: "full" };
  }
  return { status: statusMode, flags: stateFlags, history: historyMode };
}

function createdAtFor(scenario) {
  if (scenario.flags.has("awaiting")) {
    return ago(2 * MINUTE);
  }
  if (scenario.history === "new") {
    return new Date("2026-09-09T08:30:00.000Z");
  }
  return new Date("2026-03-02T09:30:00.000Z");
}

function criteriaInstance(data) {
  const instance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data,
    id: data.id,
    name: data.name,
    description: data.description || "",
    monitorStatusId: statuses[data.status].id,
    filterCondition: data.filterCondition || FilterCondition.Any,
    filters: data.filters,
    changeMonitorStatus: true,
    createIncidents: data.status === "offline",
    createAlerts: data.status !== "operational",
    isEnabled: true,
  };
  return instance;
}

function criteriaFor(typeKey) {
  const criteria = new MonitorCriteria();
  let instances = [];
  if (typeKey === "incoming-request" || typeKey === "incoming-email") {
    const checkOn =
      typeKey === "incoming-email"
        ? CheckOn.EmailReceivedAt
        : CheckOn.IncomingRequest;
    instances = [
      criteriaInstance({
        id: "criteria-missing",
        name: "Nothing received",
        status: "offline",
        filters: [
          {
            checkOn,
            filterType: FilterType.NotRecievedInMinutes,
            value: typeKey === "incoming-email" ? 1500 : 30,
          },
        ],
      }),
      criteriaInstance({
        id: "criteria-received",
        name: "Received on time",
        status: "operational",
        filters: [
          {
            checkOn,
            filterType: FilterType.RecievedInMinutes,
            value: typeKey === "incoming-email" ? 1500 : 30,
          },
        ],
      }),
    ];
  } else {
    instances = [
      criteriaInstance({
        id: "criteria-offline",
        name: "Offline",
        status: "offline",
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
      }),
      criteriaInstance({
        id: "criteria-online",
        name: "Online",
        status: "operational",
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
      }),
    ];
  }
  criteria.data = { monitorCriteriaInstanceArray: instances };
  return criteria;
}

function stepFor(typeKey, definition, stepNumber) {
  const step = new MonitorStep();
  step.data = {
    ...step.data,
    id: ID.step(definition.number * 10 + stepNumber),
    monitorCriteria: criteriaFor(typeKey),
    requestType: HTTPMethod.GET,
  };
  if (definition.destination) {
    step.data.monitorDestination = CommonURL.fromString(definition.destination);
  }
  if (typeKey === "kubernetes") {
    step.data.kubernetesMonitor = {
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod-eu-west-1",
    };
  }
  if (typeKey === "network-device") {
    step.data.networkDeviceMonitor = {
      networkDeviceId: ID.networkDevice(1),
    };
  }
  return step;
}

function stepsFor(typeKey, definition) {
  if (typeKey === "manual") {
    return undefined;
  }
  const steps = new MonitorSteps();
  const count = typeKey === "kubernetes" ? 2 : 1;
  const instances = [];
  for (let index = 1; index <= count; index++) {
    instances.push(stepFor(typeKey, definition, index));
  }
  steps.data = {
    monitorStepsInstanceArray: instances,
    defaultMonitorStatusId: statuses.operational.id,
  };
  return steps;
}

/*
 * Past status changes, as [start, duration, status]. Every monitor with a
 * full or flapping history has these; a new one keeps those after it was
 * created.
 */
const PAST_OUTAGES = [
  {
    start: new Date("2026-07-12T14:05:00.000Z"),
    minutes: 42,
    status: "offline",
  },
  {
    start: new Date("2026-08-04T03:10:00.000Z"),
    minutes: 180,
    status: "degraded",
  },
  {
    start: new Date("2026-08-29T09:40:00.000Z"),
    minutes: 75,
    status: "offline",
  },
  {
    start: new Date("2026-09-12T17:20:00.000Z"),
    minutes: 18,
    status: "degraded",
  },
];

// The change that started today's "Operational for 3 days, 4 hours".
const LAST_RECOVERY = ago(3 * DAY + 4 * HOUR + 12 * MINUTE);
const LAST_DEGRADATION_MINUTES = 35;

/*
 * The status changes of one monitor, oldest first: [{ status, start, end }],
 * the last one still open (end undefined).
 */
function buildSegments(scenario, createdAt) {
  const outages = [];

  if (!scenario.flags.has("awaiting")) {
    for (const outage of PAST_OUTAGES) {
      if (outage.start.getTime() > createdAt.getTime()) {
        outages.push(outage);
      }
    }

    if (scenario.history === "flapping") {
      /*
       * An outage every 6h40m from a day after creation to four days ago,
       * 8 to 27 minutes long, alternating Offline and Degraded.
       */
      let start = new Date(createdAt.getTime() + DAY);
      let index = 0;
      while (start.getTime() < ago(4 * DAY).getTime()) {
        const overlapsFixed = PAST_OUTAGES.some((outage) => {
          return Math.abs(outage.start.getTime() - start.getTime()) < 6 * HOUR;
        });
        if (!overlapsFixed) {
          outages.push({
            start,
            minutes: 8 + ((index * 7) % 20),
            status: index % 3 === 0 ? "degraded" : "offline",
          });
        }
        start = new Date(start.getTime() + 6 * HOUR + 40 * MINUTE);
        index += 1;
      }
    }

    outages.push({
      start: new Date(
        LAST_RECOVERY.getTime() - LAST_DEGRADATION_MINUTES * MINUTE,
      ),
      minutes: LAST_DEGRADATION_MINUTES,
      status: "degraded",
    });
  }

  outages.sort((left, right) => {
    return left.start.getTime() - right.start.getTime();
  });

  const changes = [{ status: "operational", at: createdAt }];
  for (const outage of outages) {
    changes.push({ status: outage.status, at: outage.start });
    changes.push({
      status: "operational",
      at: new Date(outage.start.getTime() + outage.minutes * MINUTE),
    });
  }

  if (!scenario.flags.has("awaiting")) {
    if (scenario.status === "offline") {
      changes.push({ status: "offline", at: ago(12 * MINUTE) });
    }
    if (scenario.status === "degraded") {
      changes.push({ status: "degraded", at: ago(25 * MINUTE) });
    }
  }

  return changes.map((change, index) => {
    const next = changes[index + 1];
    return {
      status: change.status,
      start: change.at,
      end: next ? next.at : undefined,
    };
  });
}

/*
 * One probe's latest result for one step, as MonitorResource writes it into
 * MonitorProbe.lastMonitoringLog (a JSON column, so dates are strings).
 */
function probeResult(data) {
  const result = {
    projectId: PROJECT_ID,
    monitorId: data.monitorId,
    probeId: data.probeId,
    monitorStepId: data.stepId,
    monitorDestination: data.destination,
    monitoredAt: data.monitoredAt.toISOString(),
    isOnline: data.isOnline,
    failureCause: data.isOnline ? "" : data.failureCause,
  };
  if (data.responseTimeInMs !== undefined) {
    result.responseTimeInMs = data.responseTimeInMs;
  }
  if (data.responseCode !== undefined) {
    result.responseCode = data.responseCode;
    result.responseHeaders = {
      "content-type": "application/json",
      server: "envoy",
    };
    result.responseBody = data.isOnline
      ? { status: "ok", version: "2026.09.21-1" }
      : "upstream connect error or disconnect/reset before headers";
  }
  if (data.sslResponse) {
    result.sslResponse = data.sslResponse;
  }
  return result;
}

/*
 * When the probes of a monitor last ran, for each scenario. Offsets are per
 * probe, so the newest result is always Frankfurt's.
 */
function lastRunAgo(scenario) {
  if (scenario.flags.has("probes-off")) {
    return 2 * DAY;
  }
  if (scenario.flags.has("disabled")) {
    return 6 * HOUR;
  }
  if (scenario.flags.has("disconnected")) {
    return 52 * MINUTE;
  }
  if (scenario.flags.has("stale")) {
    return 38 * MINUTE;
  }
  if (scenario.flags.has("maintenance")) {
    return 25 * MINUTE;
  }
  return 41 * SECOND;
}

/*
 * While a probe-check monitor is Offline, N. Virginia's checks time out and
 * the others get a fast error response. A timeout records no response time;
 * an error response records how long it took (MonitorMetricUtil writes the
 * metric whenever a check has a response time, whatever its verdict).
 */
const TIMEOUT_PROBE_INDEX = 1;

function errorResponseTimeInMs(index) {
  return 94 + index * 11;
}

/*
 * "one-disconnected" loses Singapore: a probe that went offline three days
 * ago while Frankfurt and N. Virginia kept reporting. Only a probe's own
 * claim moves its nextPingAt forward, so that stays three days in the past
 * too, next to the others' future ones.
 */
const LOST_PROBE_INDEX = 2;
const LOST_PROBE_RUN_AGO = 3 * DAY + 2 * HOUR;

/*
 * A "stale" Kubernetes monitor: the worker still queues an evaluation every
 * minute, but the newest one in MonitorLog is this old.
 */
const STALE_EVALUATION_AGO = 14 * MINUTE;

function isLostProbe(scenario, index) {
  return scenario.flags.has("one-disconnected") && index === LOST_PROBE_INDEX;
}

// When one probe last ran; the newest result is always Frankfurt's.
function probeRunAgo(scenario, index) {
  if (isLostProbe(scenario, index)) {
    return LOST_PROBE_RUN_AGO;
  }
  return lastRunAgo(scenario) + index * 3 * SECOND;
}

function evaluationSummary(data) {
  const isDown = data.status === "offline";
  const filters = [
    {
      checkOn: CheckOn.IsOnline,
      filterType: isDown ? FilterType.False : FilterType.True,
      message: isDown ? "The check failed." : "The check succeeded.",
      met: true,
    },
  ];
  const events = [];
  if (isDown && data.withEvents) {
    events.push({
      type: "monitor-status-changed",
      title: "Status changed to Offline",
      at: data.at.toISOString(),
    });
  }
  return {
    evaluatedAt: data.at.toISOString(),
    criteriaResults: [
      {
        criteriaId: isDown ? "criteria-offline" : "criteria-online",
        criteriaName: isDown ? "Offline" : "Online",
        filterCondition: FilterCondition.Any,
        met: true,
        message: isDown
          ? "Offline matched: the check failed."
          : "Online matched: the check succeeded.",
        filters,
      },
    ],
    events,
  };
}

const monitors = {};
const segmentsByMonitorId = {};
const secretKeys = {};

function defineMonitor(typeKey) {
  const definition = MONITOR_DEFINITIONS[typeKey];
  const scenario = scenarioFor(typeKey);
  const monitorId = ID.monitor(definition.number);
  const createdAt = createdAtFor(scenario);
  const segments = buildSegments(scenario, createdAt);
  const current = segments[segments.length - 1];
  const isAwaiting = scenario.flags.has("awaiting");
  const steps = stepsFor(typeKey, definition);
  const secretKey = new ObjectID(ID.secret(definition.number));

  segmentsByMonitorId[monitorId] = segments;
  secretKeys[typeKey] = secretKey.toString();

  const record = {
    _id: monitorId,
    name: definition.name,
    description: definition.description,
    monitorType: definition.monitorType,
    labels: definition.labels,
    createdAt,
    currentMonitorStatusId: statuses[current.status].id,
    currentMonitorStatus: statuses[current.status],
    monitoringInterval: definition.interval,
    monitorSteps: steps,
    minimumProbeAgreement: definition.minimumProbeAgreement,
    disableActiveMonitoring: scenario.flags.has("disabled"),
    disableActiveMonitoringBecauseOfManualIncident: false,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:
      scenario.flags.has("maintenance"),
    isNoProbeEnabledOnThisMonitor:
      PROBE_CHECK_TYPES.includes(typeKey) &&
      (scenario.flags.has("probes-off") || scenario.flags.has("no-probes")),
    isAllProbesDisconnectedFromThisMonitor:
      PROBE_CHECK_TYPES.includes(typeKey) && scenario.flags.has("disconnected"),
    incomingRequestSecretKey:
      typeKey === "incoming-request" ? secretKey : undefined,
    incomingEmailSecretKey:
      typeKey === "incoming-email" ? secretKey : undefined,
    serverMonitorSecretKey: typeKey === "server" ? secretKey : undefined,
    customFields: {},
  };

  if (typeKey === "incoming-request" && !isAwaiting) {
    record.incomingMonitorRequest = {
      projectId: PROJECT_ID,
      monitorId,
      requestMethod: HTTPMethod.POST,
      requestHeaders: {
        "content-type": "application/json",
        "user-agent": "billing-export/2.3",
      },
      requestBody: { job: "nightly-billing-export", rows: 18234 },
      incomingRequestReceivedAt: ago(7 * MINUTE).toISOString(),
      checkedAt: ago(40 * SECOND).toISOString(),
    };
    record.incomingRequestMonitorHeartbeatCheckedAt = ago(40 * SECOND);
  }

  if (typeKey === "incoming-email" && !isAwaiting) {
    const receivedAt = ago(2 * HOUR + 14 * MINUTE);
    record.incomingEmailMonitorLastEmailReceivedAt = receivedAt;
    record.incomingEmailMonitorHeartbeatCheckedAt = ago(40 * SECOND);
    record.incomingEmailMonitorRequest = {
      projectId: PROJECT_ID,
      monitorId,
      emailFrom: "notifications@payroll-provider.example",
      emailTo: `monitor-${secretKey.toString()}@inbound.acme-commerce.example`,
      emailSubject: "Payroll run 2026-09-21 completed",
      emailBody: "The payroll run for Acme Commerce completed at 09:44 UTC.",
      emailReceivedAt: receivedAt.toISOString(),
      checkedAt: ago(40 * SECOND).toISOString(),
    };
  }

  if (typeKey === "server" && !isAwaiting) {
    const receivedAt = ago(38 * SECOND);
    record.serverMonitorRequestReceivedAt = receivedAt;
    record.serverMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId,
      hostname: "orders-db-01.eu-west-1.acme.internal",
      requestReceivedAt: receivedAt.toISOString(),
      onlyCheckRequestReceivedAt: false,
      basicInfrastructureMetrics: {
        cpuMetrics: { percentUsed: 37.4, cores: 8 },
        memoryMetrics: {
          total: 34359738368,
          used: 21234298880,
          free: 13125439488,
          percentUsed: 61.8,
          percentFree: 38.2,
        },
        diskMetrics: [
          {
            diskPath: "/",
            total: 214748364800,
            used: 116178779136,
            free: 98569585664,
            percentUsed: 54.1,
            percentFree: 45.9,
          },
        ],
      },
      processes: [
        {
          pid: 1182,
          name: "postgres",
          command: "/usr/lib/postgresql/16/bin/postgres",
          cpuPercent: 21.3,
          memoryPercent: 38.5,
        },
        {
          pid: 944,
          name: "pgbouncer",
          command: "/usr/sbin/pgbouncer /etc/pgbouncer/pgbouncer.ini",
          cpuPercent: 2.1,
          memoryPercent: 0.4,
        },
      ],
    };
  }

  if (typeKey === "kubernetes" && !isAwaiting) {
    /*
     * The worker writes this stamp when it queues an evaluation, so it
     * keeps moving even when "stale" evaluations stop landing in MonitorLog
     * (see STALE_EVALUATION_AGO below).
     */
    record.telemetryMonitorLastMonitorAt = ago(40 * SECOND);
    record.telemetryMonitorNextMonitorAt = fromNow(20 * SECOND);
  }

  monitors[typeKey] = insert(Monitor, record);

  // The status timeline: every change of this monitor, oldest first.
  for (const segment of segments) {
    insert(MonitorStatusTimeline, {
      monitorId: new ObjectID(monitorId),
      monitorStatusId: statuses[segment.status].id,
      monitorStatus: statuses[segment.status],
      startsAt: segment.start,
      endsAt: segment.end,
      createdAt: segment.start,
    });
  }

  if (PROBE_CHECK_TYPES.includes(typeKey)) {
    defineProbes({ typeKey, definition, scenario, monitorId, steps, current });
  } else if (!isAwaiting && typeKey !== "manual") {
    // One evaluation per run for everything that is not a probe check.
    const at =
      typeKey === "kubernetes" && scenario.flags.has("stale")
        ? ago(STALE_EVALUATION_AGO)
        : record.telemetryMonitorLastMonitorAt ||
          record.serverMonitorRequestReceivedAt ||
          record.incomingMonitorRequest?.checkedAt ||
          record.incomingEmailMonitorHeartbeatCheckedAt ||
          ago(35 * SECOND);
    insert(MonitorLog, {
      monitorId: new ObjectID(monitorId),
      time: new Date(at),
      logBody: {
        monitorId,
        evaluationSummary: evaluationSummary({
          status: current.status,
          at: new Date(at),
          withEvents: false,
        }),
      },
    });
  }

  defineOwners(typeKey, monitorId);
  defineFeed(typeKey, monitorId, createdAt, segments);
  defineIncidents(typeKey, monitorId, segments);
}

function defineProbes(data) {
  const { typeKey, definition, scenario, monitorId, steps, current } = data;
  if (scenario.flags.has("no-probes")) {
    return;
  }
  const stepId = steps.data.monitorStepsInstanceArray[0].data.id;
  const isAwaiting = scenario.flags.has("awaiting");
  const isDown = current.status === "offline";
  const isSlow = current.status === "degraded";

  PROBE_DEFINITIONS.forEach((probeDefinition, index) => {
    const probeId = ID.probe(probeDefinition.number);
    const monitoredAt = ago(probeRunAgo(scenario, index));
    const isEnabled = !scenario.flags.has("probes-off");
    const probe = make(Probe, {
      _id: probeId,
      name: probeDefinition.name,
      connectionStatus:
        scenario.flags.has("disconnected") || isLostProbe(scenario, index)
          ? ProbeConnectionStatus.Disconnected
          : ProbeConnectionStatus.Connected,
    });

    let lastMonitoringLog = undefined;
    if (!isAwaiting) {
      const isTimeout = isDown && index === TIMEOUT_PROBE_INDEX;
      lastMonitoringLog = {
        [stepId]: probeResult({
          monitorId,
          probeId,
          stepId,
          destination: definition.destination,
          monitoredAt,
          isOnline: !isDown,
          failureCause: definition.failureCauses[index],
          responseTimeInMs: isTimeout
            ? undefined
            : isDown
              ? errorResponseTimeInMs(index)
              : isSlow
                ? probeDefinition.slowResponseTimeInMs
                : probeDefinition.responseTimeInMs,
          responseCode:
            typeKey === "ssl" || isTimeout ? undefined : isDown ? 503 : 200,
          sslResponse:
            typeKey === "ssl"
              ? {
                  isValidCertificate: true,
                  isSelfSigned: false,
                  commonName: "shop.acme-commerce.example",
                  issuer: "R11 (Let's Encrypt)",
                  organization: "Acme Commerce",
                  createdAt: ago(67 * DAY).toISOString(),
                  expiresAt: fromNow(23 * DAY).toISOString(),
                }
              : undefined,
        }),
      };
    }

    insert(MonitorProbe, {
      monitorId: new ObjectID(monitorId),
      probeId: new ObjectID(probeId),
      probe,
      isEnabled,
      // A probe claims the job just before it reports the result.
      lastPingAt: isAwaiting
        ? ago(90 * SECOND)
        : new Date(monitoredAt.getTime() - 2 * SECOND),
      nextPingAt: isAwaiting
        ? fromNow(3 * MINUTE)
        : new Date(monitoredAt.getTime() + 5 * MINUTE),
      lastMonitoringLog,
      createdAt: new Date("2026-03-02T09:30:00.000Z"),
    });

    if (!isAwaiting) {
      // Two evaluations per probe, newest first.
      for (const offset of [0, 5 * MINUTE]) {
        const at = new Date(monitoredAt.getTime() - offset);
        insert(MonitorLog, {
          monitorId: new ObjectID(monitorId),
          time: at,
          logBody: {
            monitorId,
            probeId,
            evaluationSummary: evaluationSummary({
              status: offset === 0 ? current.status : "operational",
              at,
              withEvents: offset === 0 && index === 0,
            }),
          },
        });
      }
    }
  });
}

function defineOwners(typeKey, monitorId) {
  // The network device has nobody assigned, so its hero offers "Add owners".
  if (typeKey === "network-device") {
    return;
  }
  insert(MonitorOwnerUser, {
    monitorId: new ObjectID(monitorId),
    userId: people.maya.id,
    user: people.maya,
    createdAt: new Date("2026-03-02T09:31:00.000Z"),
  });
  insert(MonitorOwnerUser, {
    monitorId: new ObjectID(monitorId),
    userId: people.sam.id,
    user: people.sam,
    createdAt: new Date("2026-03-02T09:32:00.000Z"),
  });
  insert(MonitorOwnerTeam, {
    monitorId: new ObjectID(monitorId),
    teamId: team.id,
    team,
    createdAt: new Date("2026-03-02T09:33:00.000Z"),
  });
}

function defineFeed(typeKey, monitorId, createdAt, segments) {
  const name = MONITOR_DEFINITIONS[typeKey].name;
  insert(MonitorFeed, {
    monitorId: new ObjectID(monitorId),
    monitorFeedEventType: MonitorFeedEventType.MonitorCreated,
    feedInfoInMarkdown: `**${name}** was created by **Maya Chen**.`,
    displayColor: new Color("#6366f1"),
    user: people.maya,
    postedAt: createdAt,
    createdAt,
  });
  insert(MonitorFeed, {
    monitorId: new ObjectID(monitorId),
    monitorFeedEventType: MonitorFeedEventType.OwnerTeamAdded,
    feedInfoInMarkdown: "**Checkout SRE** was added as an owner.",
    displayColor: new Color("#6366f1"),
    user: people.maya,
    postedAt: new Date(createdAt.getTime() + 30 * SECOND),
    createdAt: new Date(createdAt.getTime() + 30 * SECOND),
  });
  // The last few status changes, as the server posts them.
  for (const segment of segments.slice(1).slice(-4)) {
    const status = STATUS_DEFINITIONS[segment.status];
    insert(MonitorFeed, {
      monitorId: new ObjectID(monitorId),
      monitorFeedEventType: MonitorFeedEventType.MonitorStatusChanged,
      feedInfoInMarkdown: `Status changed to **${status.name}**.`,
      displayColor: new Color(status.color),
      postedAt: segment.start,
      createdAt: segment.start,
    });
  }
}

let incidentCounter = 0;

function defineIncidents(typeKey, monitorId, segments) {
  const monitorRef = make(Monitor, {
    _id: monitorId,
    name: MONITOR_DEFINITIONS[typeKey].name,
  });
  const name = MONITOR_DEFINITIONS[typeKey].name;

  // Every past Offline spell raised an incident that has since resolved.
  for (const segment of segments) {
    if (segment.status !== "offline" || !segment.end) {
      continue;
    }
    if (segment.end.getTime() - segment.start.getTime() < 30 * MINUTE) {
      continue;
    }
    incidentCounter += 1;
    insert(Incident, {
      _id: ID.incident(incidentCounter),
      title: `${name} is down`,
      declaredAt: segment.start,
      createdAt: segment.start,
      incidentSeverity: incidentSeverities.sev2,
      currentIncidentState: incidentStates.resolved,
      currentIncidentStateId: incidentStates.resolved.id,
      monitors: [monitorRef],
    });
  }

  const current = segments[segments.length - 1];
  if (current.status !== "offline") {
    return;
  }

  // Offline right now: one incident and one alert are still open.
  insert(Incident, {
    _id: ID.incident(1042),
    title: `${name} is returning 503s`,
    declaredAt: ago(11 * MINUTE),
    createdAt: ago(11 * MINUTE),
    incidentSeverity: incidentSeverities.sev1,
    currentIncidentState: incidentStates.created,
    currentIncidentStateId: incidentStates.created.id,
    monitors: [monitorRef],
  });
  insert(Alert, {
    _id: ID.alert(311),
    title: `${name} health check failing`,
    createdAt: ago(12 * MINUTE),
    alertSeverity: alertSeverities.critical,
    currentAlertState: alertStates.acknowledged,
    currentAlertStateId: alertStates.acknowledged.id,
    monitorId: new ObjectID(monitorId),
    monitor: monitorRef,
  });
}

// Alerts is read by the open-work card even when nothing is open.
table(Alert);
table(Incident);

for (const typeKey of TYPE_KEYS) {
  defineMonitor(typeKey);
}

fixture.monitors = Object.fromEntries(
  TYPE_KEYS.map((typeKey) => {
    return [
      typeKey,
      {
        id: String(monitors[typeKey]._id),
        name: MONITOR_DEFINITIONS[typeKey].name,
        secretKey: secretKeys[typeKey],
      },
    ];
  }),
);

/*
 * ---------------------------------------------------------------------------
 * The uptime summary route (GET /monitor/uptime-summary/:monitorId), built
 * from the same status changes the timeline rows come from, the way
 * MonitorStatusTimelineService.getMonitorUptimeSummary builds it.
 * ---------------------------------------------------------------------------
 */
function durationsIn(segments, start, end) {
  const secondsByStatus = new Map();
  let covered = 0;
  for (const segment of segments) {
    const from = Math.max(segment.start.getTime(), start.getTime());
    const to = Math.min((segment.end || NOW).getTime(), end.getTime());
    if (to > from) {
      const seconds = Math.round((to - from) / 1000);
      covered += seconds;
      secondsByStatus.set(
        segment.status,
        (secondsByStatus.get(segment.status) || 0) + seconds,
      );
    }
  }
  return {
    coveredSeconds: covered,
    statusDurations: Array.from(secondsByStatus.entries())
      .map(([status, seconds]) => {
        return { monitorStatusId: statuses[status].id, seconds };
      })
      .sort((left, right) => {
        return right.seconds - left.seconds;
      }),
  };
}

function buildUptimeSummary(monitorId, timezone) {
  const segments = segmentsByMonitorId[monitorId] || [];
  const barsStart = OneUptimeDate.getStartOfDay(
    OneUptimeDate.addRemoveDays(NOW, -89, timezone),
    timezone,
  );
  const buckets = [];
  let dayStart = barsStart;
  while (dayStart.getTime() < NOW.getTime()) {
    const nextStart = OneUptimeDate.getStartOfDay(
      OneUptimeDate.addRemoveDays(dayStart, 1, timezone),
      timezone,
    );
    const dayEnd = nextStart.getTime() < NOW.getTime() ? nextStart : NOW;
    buckets.push({
      bucketStart: dayStart,
      bucketEnd: dayEnd,
      daySeconds: Math.round((dayEnd.getTime() - dayStart.getTime()) / 1000),
      ...durationsIn(segments, dayStart, dayEnd),
    });
    dayStart = nextStart;
  }

  const windows = MONITOR_UPTIME_ROLLING_WINDOWS.map((window) => {
    const start = new Date(NOW.getTime() - window.seconds * 1000);
    return {
      key: window.key,
      startDate: start,
      endDate: NOW,
      windowSeconds: window.seconds,
      ...durationsIn(segments, start, NOW),
    };
  });
  windows.push(
    MonitorUptimeSummaryUtil.sumBuckets({
      key: MonitorUptimeWindowKey.Last90Days,
      buckets,
      startDate: barsStart,
      endDate: NOW,
    }),
  );

  return {
    monitorId: new ObjectID(monitorId),
    timezone,
    generatedAt: NOW,
    startDate: barsStart,
    endDate: NOW,
    buckets,
    windows,
    isComplete: true,
    completeFrom: null,
    statuses: Object.values(STATUS_DEFINITIONS).map((definition) => {
      return {
        id: new ObjectID(ID.status(definition.number)),
        name: definition.name,
        color: definition.color,
        isOperationalState: definition.isOperationalState,
        isOfflineState: definition.isOfflineState,
        priority: definition.priority,
      };
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Response-time metric: one series per enabled probe, every five minutes,
 * for the probe-check monitors. While a monitor is Offline, only the checks
 * that got an error response record a time (see TIMEOUT_PROBE_INDEX).
 * ---------------------------------------------------------------------------
 */
function metricRows(aggregateBy) {
  const name = String(aggregateBy?.query?.name || "");
  const attributes = aggregateBy?.query?.attributes || {};
  const monitorId = String(attributes.monitorId || "");
  if (name !== MonitorMetricType.ResponseTime) {
    return [];
  }
  const typeKey = TYPE_KEYS.find((key) => {
    return String(monitors[key]._id) === monitorId;
  });
  if (!typeKey || !PROBE_CHECK_TYPES.includes(typeKey)) {
    return [];
  }
  const scenario = scenarioFor(typeKey);
  const segments = segmentsByMonitorId[monitorId];
  const start = Math.max(
    toTime(aggregateBy.startTimestamp),
    toTime(monitors[typeKey].createdAt),
  );
  const lastRun = ago(lastRunAgo(scenario)).getTime();
  const end = Math.min(
    toTime(aggregateBy.endTimestamp),
    lastRun,
    NOW.getTime(),
  );
  if (scenario.flags.has("awaiting") || scenario.flags.has("no-probes")) {
    return [];
  }
  const rows = [];
  const step = 5 * MINUTE;
  for (let time = Math.ceil(start / step) * step; time <= end; time += step) {
    const segment = segments.find((item) => {
      return (
        item.start.getTime() <= time && (!item.end || item.end.getTime() > time)
      );
    });
    if (!segment) {
      continue;
    }
    const isOffline = segment.status === "offline";
    PROBE_DEFINITIONS.forEach((probeDefinition, index) => {
      // A probe that went offline stopped recording then.
      if (
        isLostProbe(scenario, index) &&
        time > ago(probeRunAgo(scenario, index)).getTime()
      ) {
        return;
      }
      if (isOffline && index === TIMEOUT_PROBE_INDEX) {
        return;
      }
      const base = isOffline
        ? errorResponseTimeInMs(index)
        : segment.status === "degraded"
          ? probeDefinition.slowResponseTimeInMs
          : probeDefinition.responseTimeInMs;
      const wobble =
        Math.sin(time / (47 * MINUTE) + index) * 0.08 +
        Math.cos(time / (13 * MINUTE) + index * 2) * 0.05;
      rows.push({
        timestamp: new Date(time).toISOString(),
        value: Math.round(base * (1 + wobble)),
        attributes: {
          monitorId,
          probeId: ID.probe(probeDefinition.number),
          projectId: PROJECT_ID,
        },
      });
    });
  }
  return rows;
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
  return people.maya.id;
};
UserUtil.getName = () => {
  return people.maya.name;
};
UserUtil.getEmail = () => {
  return people.maya.email;
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
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
AnalyticsModelAPI.getCommonHeaders = () => {
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

/*
 * Refuses a read the role may not make, the way the API does: the table's
 * read permissions first, then every selected column that declares a read
 * permission (ColumnPermission fails the whole request on one of them).
 */
function assertCanRead(modelType, select) {
  const model = new modelType();
  const gate = PermissionGate.check(model, ModelAction.Read, {
    permissions: rolePermissions,
  });
  if (!gate.isAllowed) {
    throw fail(
      422,
      `You do not have permission to read ${model.singularName || "this item"}.`,
    );
  }
  if (!select || !model.getColumnAccessControlForAllColumns) {
    return;
  }
  for (const column of Object.keys(select)) {
    if (
      !PermissionGate.canReadColumn(model, column, {
        permissions: rolePermissions,
      })
    ) {
      throw fail(
        422,
        `User is not allowed to read on ${column} column of ${model.singularName}`,
      );
    }
  }
}

const OVERVIEW_MONITOR_SELECT_KEY = "currentMonitorStatusId";
let hasFailedMonitorRead = false;

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.getItemRequests.push({
    modelName,
    id,
    select: serialize(options.select),
  });
  assertCanRead(options.modelType, options.select);
  if (
    failures.has("monitor") &&
    modelName === "Monitor" &&
    !hasFailedMonitorRead &&
    options.select?.[OVERVIEW_MONITOR_SELECT_KEY]
  ) {
    hasFailedMonitorRead = true;
    throw fail(503, "The monitor could not be read. The API is restarting.");
  }
  const known = knownTable(options.modelType, "getItem", { id });
  const record = known?.records.find((item) => {
    return String(item._id) === id;
  });
  if (known && !record) {
    fixture.unhandled.push({ kind: "getItem", modelName, id, missing: true });
  }
  return record
    ? projectRecord(options.modelType, record, options.select)
    : null;
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
  assertCanRead(options.modelType, options.select);
  if (failures.has("probes") && modelName === "MonitorProbe") {
    throw fail(500, "Probe results could not be read.");
  }
  if (failures.has("incidents") && modelName === "Incident") {
    throw fail(500, "Incidents could not be read.");
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
  assertCanRead(options.modelType, undefined);
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
  const record = (tables.get(modelName)?.records || []).find((item) => {
    return String(item._id) === id;
  });
  if (record) {
    Object.assign(record, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

/*
 * Analytics reads: the evaluation log (MonitorLog), the response-time
 * aggregate (Metric) and the chart's change-event markers (none here).
 */
const ANALYTICS_TABLES = [
  tableName(MonitorLog),
  tableName(ChangeEvent),
  tableName(Metric),
];
table(MonitorLog);
table(ChangeEvent);

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    analytics: true,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  assertCanRead(options.modelType, undefined);
  if (!ANALYTICS_TABLES.includes(modelName)) {
    fixture.unhandled.push({ kind: "analytics.getList", modelName });
    return { data: [], count: 0, skip, limit };
  }
  const records = sortRecords(
    table(options.modelType).filter((record) => {
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
  fixture.aggregateRequests.push({
    modelName,
    name: String(options.aggregateBy?.query?.name || ""),
    attributes: serialize(options.aggregateBy?.query?.attributes),
  });
  assertCanRead(options.modelType, undefined);
  if (modelName !== tableName(Metric)) {
    fixture.unhandled.push({ kind: "analytics.aggregate", modelName });
    return { data: [] };
  }
  return { data: metricRows(options.aggregateBy) };
};

let hasFailedUptimeSummary = false;

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({
    method,
    url,
    body,
    headers: serialize(options.headers) || {},
  });
  const parsed = new window.URL(url);

  if (
    method === "GET" &&
    parsed.pathname.includes("/monitor/refresh-status/")
  ) {
    if (failures.has("refresh-status")) {
      throw fail(500, "The monitor status could not be refreshed.");
    }
    return ok({});
  }

  if (
    method === "GET" &&
    parsed.pathname.includes("/monitor/uptime-summary/")
  ) {
    const monitorId = parsed.pathname.split("/").pop();
    if (failures.has("uptime-summary") && !hasFailedUptimeSummary) {
      hasFailedUptimeSummary = true;
      throw fail(500, "The uptime history could not be computed.");
    }
    if (
      !PermissionGate.check(new MonitorStatusTimeline(), ModelAction.Read, {
        permissions: rolePermissions,
      }).isAllowed
    ) {
      throw fail(
        422,
        "You do not have permission to read this monitor's status history.",
      );
    }
    let timezone;
    try {
      timezone = MonitorUptimeSummaryUtil.parseTimezone(
        parsed.searchParams.get("timezone") || undefined,
      );
    } catch (error) {
      throw fail(400, error.message);
    }
    if (!segmentsByMonitorId[monitorId]) {
      throw fail(422, "You are not authorized to access this project's data.");
    }
    return ok(
      MonitorUptimeSummaryUtil.toJSON(buildUptimeSummary(monitorId, timezone)),
    );
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
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function FixtureLayout() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <MonitorViewLayout {...pageProps(undefined)} />;
}

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

// Every monitor sub-page and every page the overview links to.
const STUB_PAGES = [
  ...Object.values(PageMap)
    .filter((pageKey) => {
      return String(pageKey).startsWith("MONITOR_VIEW_");
    })
    .map((pageKey) => {
      return [pageKey, String(pageKey)];
    }),
  [PageMap.INCIDENT_VIEW, "Incident"],
  [PageMap.ALERT_VIEW, "Alert"],
  [PageMap.NETWORK_DEVICE_VIEW, "Network Device"],
  [PageMap.MONITORS, "Monitors"],
  [PageMap.INCIDENTS, "Incidents"],
  [PageMap.ALERTS, "Alerts"],
  [PageMap.HOME, "Home"],
].filter(([pageKey]) => {
  return Boolean(pageKey && RouteMap[pageKey]);
});

function monitorPath(typeKey) {
  return `/dashboard/${PROJECT_ID}/monitors/${monitors[typeKey]._id}`;
}

/*
 * Like the dashboard's App, this reads the location on every navigation, so
 * the route elements are created again and the monitor view, which stays
 * mounted when the reader moves from one monitor to another, re-renders
 * with the new id.
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
        {showNav ? (
          <nav
            aria-label="Fixture monitors"
            className="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs"
          >
            {TYPE_KEYS.map((typeKey) => {
              return (
                <Link
                  key={typeKey}
                  data-testid={`fixture-link-${typeKey}`}
                  to={`${monitorPath(typeKey)}${location.search}`}
                  className="text-indigo-600 hover:underline"
                >
                  {MONITOR_DEFINITIONS[typeKey].name}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Routes>
          <Route
            path={RouteMap[PageMap.MONITOR_VIEW].toString()}
            element={<FixtureLayout />}
          >
            <Route
              index
              element={<MonitorView {...pageProps(PageMap.MONITOR_VIEW)} />}
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
