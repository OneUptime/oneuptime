/*
 * Offline fixture for the real status timeline pages: a monitor's Status
 * Timeline and an incident's.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, the shared timeline they open on
 * (ModelStatusTimeline: its band, legend, list and period controls), the
 * table one click away, the Create form and the Delete dialogs are the
 * production ones from this branch.
 *
 * Steered by the query string:
 *   - page=incident          an incident's State Timeline instead of a
 *                            monitor's
 *   - scenario=...           for a monitor: screenshot (the default; the
 *                            maintainer's 63 status events, mostly Operational
 *                            with short Offline blips), flapping (700 changes
 *                            in the last day, more than one read), new (one
 *                            status, an hour old), quiet (one outage in a
 *                            year) or empty;
 *                            for an incident: resolved (the default; Created,
 *                            Acknowledged, Resolved three weeks ago), ongoing
 *                            (still Acknowledged) or declared (its only state)
 *   - role=viewer            a member who may read the timeline but not
 *                            create or delete a status event (Viewer); the
 *                            default is a project owner
 *   - lang=de|ja             the Dashboard's German or Japanese words
 *   - theme=dark             (read by server.js) the dark theme
 *
 * Every list request is recorded on `window.__fixture.listRequests` (with
 * the startsAt bound it asked for), every single read on `itemRequests`,
 * every delete on `deletes` and every new row on `creates`, so the spec
 * checks what the page asked for, not only what it drew. Deletes are
 * answered as the services answer them: a monitor's only event, and its
 * oldest while it covers part of the last 90 days, are refused in the
 * server's words (MonitorStatusEventDelete); so is an incident's only state.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import MonitorStatusTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline";
import IncidentStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "Common/Types/BaseDatabase/GreaterThanOrNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import MonitorStatusEventDelete from "Common/Utils/Monitor/MonitorStatusEventDelete";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const MONITOR_ID = "60000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "40000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") === "incident" ? "incident" : "monitor";
const scenario = params.get("scenario") || "";
const role = params.get("role") || "owner";
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

// The clock the page reads; the spec fixes it (page.clock) before loading.
const NOW = Date.now();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

window.__fixture = {
  listRequests: [],
  itemRequests: [],
  deletes: [],
  creates: [],
  updates: [],
};

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

// A relation as a form sends it: an id, or the record it names.
function idOfRelation(value) {
  if (!value) {
    return "";
  }
  if (value._id) {
    return idOf(value._id);
  }
  if (value.id) {
    return idOf(value.id);
  }
  return idOf(value);
}

function rowId(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// ---------------------------------------------------------------- monitors

function monitorStatus(id, name, color, priority, isOperationalState) {
  const status = new MonitorStatus();
  status._id = id;
  status.projectId = new ObjectID(PROJECT_ID);
  status.name = name;
  status.color = new Color(color);
  status.priority = priority;
  status.isOperationalState = Boolean(isOperationalState);
  return status;
}

const OPERATIONAL = monitorStatus(
  "61000000-0000-4000-8000-000000000001",
  "Operational",
  "#10b981",
  1,
  true,
);
const DEGRADED = monitorStatus(
  "61000000-0000-4000-8000-000000000002",
  "Degraded",
  "#f59e0b",
  2,
);
const OFFLINE = monitorStatus(
  "61000000-0000-4000-8000-000000000003",
  "Offline",
  "#ef4444",
  3,
);

const MONITOR_STATUSES = [OPERATIONAL, DEGRADED, OFFLINE];

const OFFLINE_CAUSE = `**Created because the following criteria was met**:

**Criteria Name**: Is Offline

**Filter Conditions Met**: Response status code is 503, which is not 200.`;

const ONLINE_CAUSE = `**Created because the following criteria was met**:

**Criteria Name**: Is Online

**Filter Conditions Met**: Response status code is 200.`;

const ADA = (() => {
  const user = new User();
  user._id = USER_ID;
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
})();

/*
 * A status event of the monitor: `from` and `to` are how long before now it
 * began and ended (`to` null: it is the monitor's status now).
 */
let monitorRowCount = 0;

function monitorEvent(status, from, to, extra) {
  monitorRowCount++;
  const row = new MonitorStatusTimeline();
  row._id = rowId("62000000", monitorRowCount);
  row.projectId = new ObjectID(PROJECT_ID);
  row.monitorId = new ObjectID(MONITOR_ID);
  row.monitorStatusId = new ObjectID(status._id);
  row.monitorStatus = status;
  row.startsAt = new Date(NOW - from);
  if (to !== null) {
    row.endsAt = new Date(NOW - to);
  }
  row.rootCause = status === OPERATIONAL ? ONLINE_CAUSE : OFFLINE_CAUSE;
  row.statusChangeLog = {
    responseCode: status === OPERATIONAL ? 200 : 503,
    probe: "Europe (London)",
  };
  if (extra && extra.byAda) {
    row.createdByUser = ADA;
    row.createdByUserId = new ObjectID(USER_ID);
  }
  return row;
}

// A seeded generator, so every run draws the same history.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

/*
 * The maintainer's screenshot: the ten newest rows as they were (the newest
 * open), then 53 older ones - days of Operational with short blips.
 */
function screenshotHistory() {
  const lengths = [
    [OPERATIONAL, 5 * DAY + HOUR + 9 * MINUTE + 21 * SECOND],
    [OFFLINE, 38 * SECOND],
    [OPERATIONAL, 5 * DAY + 54 * MINUTE + 12 * SECOND],
    [OFFLINE, 49 * SECOND],
    [OPERATIONAL, 3 * MINUTE + 51 * SECOND],
    [OFFLINE, MINUTE + 43 * SECOND],
    [OPERATIONAL, 55 * MINUTE + 29 * SECOND],
    [OFFLINE, 12 * MINUTE + 2 * SECOND],
    [OPERATIONAL, 18 * DAY + 12 * HOUR + 7 * MINUTE + 8 * SECOND],
    [OFFLINE, 20 * SECOND],
  ];
  const random = seededRandom(7);

  for (let index = 0; index < 53; index++) {
    if (index % 2 === 0) {
      lengths.push([OPERATIONAL, (0.2 + random() * 3.5) * DAY]);
    } else {
      const roll = random();
      lengths.push([
        roll < 0.25 ? DEGRADED : OFFLINE,
        roll < 0.5
          ? (20 + random() * 90) * SECOND
          : (2 + random() * 40) * MINUTE,
      ]);
    }
  }

  const rows = [];
  let end = 0;
  lengths.forEach(([status, length], index) => {
    const from = end + length;
    rows.push(
      monitorEvent(status, Math.round(from), index === 0 ? null : end, {
        byAda: index === 4,
      }),
    );
    end = Math.round(from);
  });
  return rows;
}

// Flapping every few minutes for a day: more changes than one read holds.
function flappingHistory() {
  const rows = [];
  let end = 0;
  for (let index = 0; index < 700; index++) {
    const status = index % 2 === 0 ? OPERATIONAL : OFFLINE;
    const length =
      index % 2 === 0
        ? (2 + (index % 7)) * MINUTE
        : (30 + (index % 5) * 10) * SECOND;
    rows.push(monitorEvent(status, end + length, index === 0 ? null : end));
    end += length;
  }
  rows.push(monitorEvent(OPERATIONAL, end + 200 * DAY, end));
  return rows;
}

function monitorHistory() {
  if (scenario === "flapping") {
    return flappingHistory();
  }
  if (scenario === "new") {
    return [monitorEvent(OPERATIONAL, HOUR, null, { byAda: true })];
  }
  if (scenario === "quiet") {
    return [
      monitorEvent(OPERATIONAL, 40 * DAY - 2 * HOUR, null),
      monitorEvent(OFFLINE, 40 * DAY, 40 * DAY - 2 * HOUR),
      monitorEvent(OPERATIONAL, 400 * DAY, 40 * DAY),
    ];
  }
  if (scenario === "empty") {
    return [];
  }
  return screenshotHistory();
}

const monitor = (() => {
  const record = new Monitor();
  record._id = MONITOR_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = "Checkout API";
  record.disableActiveMonitoring = false;
  record.currentMonitorStatus = OPERATIONAL;
  return record;
})();

// ---------------------------------------------------------------- incidents

function incidentState(id, name, color, order, isResolvedState) {
  const state = new IncidentState();
  state._id = id;
  state.projectId = new ObjectID(PROJECT_ID);
  state.name = name;
  state.color = new Color(color);
  state.order = order;
  state.isResolvedState = Boolean(isResolvedState);
  return state;
}

const CREATED = incidentState(
  "41000000-0000-4000-8000-000000000001",
  "Created",
  "#ef4444",
  1,
);
const ACKNOWLEDGED = incidentState(
  "41000000-0000-4000-8000-000000000002",
  "Acknowledged",
  "#f59e0b",
  2,
);
const RESOLVED = incidentState(
  "41000000-0000-4000-8000-000000000003",
  "Resolved",
  "#10b981",
  3,
  true,
);

let incidentRowCount = 0;

function incidentEvent(state, from, to, notification) {
  incidentRowCount++;
  const row = new IncidentStateTimeline();
  row._id = rowId("42000000", incidentRowCount);
  row.projectId = new ObjectID(PROJECT_ID);
  row.incidentId = new ObjectID(INCIDENT_ID);
  row.incidentStateId = new ObjectID(state._id);
  row.incidentState = state;
  row.startsAt = new Date(NOW - from);
  if (to !== null) {
    row.endsAt = new Date(NOW - to);
  }
  row.rootCause =
    state === CREATED ? "Declared from the Checkout API's Offline alert." : "";
  row.subscriberNotificationStatus =
    notification || StatusPageSubscriberNotificationStatus.Success;
  row.subscriberNotificationStatusMessage =
    notification === StatusPageSubscriberNotificationStatus.Failed
      ? "The status page's SMTP server refused the message."
      : "Status page subscribers were notified.";
  return row;
}

function incidentHistory() {
  const declared = 21 * DAY + 2 * HOUR;
  if (scenario === "declared") {
    return [incidentEvent(CREATED, 25 * MINUTE, null)];
  }
  if (scenario === "ongoing") {
    return [
      incidentEvent(CREATED, 3 * HOUR, 2 * HOUR + 48 * MINUTE),
      incidentEvent(ACKNOWLEDGED, 2 * HOUR + 48 * MINUTE, null),
    ];
  }
  return [
    incidentEvent(CREATED, declared, declared - 12 * MINUTE),
    incidentEvent(
      ACKNOWLEDGED,
      declared - 12 * MINUTE,
      21 * DAY,
      StatusPageSubscriberNotificationStatus.Failed,
    ),
    incidentEvent(RESOLVED, 21 * DAY, null),
  ];
}

// ---------------------------------------------------------------- the API

const RECORDS = {
  MonitorStatus: MONITOR_STATUSES,
  MonitorStatusTimeline: page === "monitor" ? monitorHistory() : [],
  IncidentState: [CREATED, ACKNOWLEDGED, RESOLVED],
  IncidentStateTimeline: page === "incident" ? incidentHistory() : [],
  Monitor: [monitor],
};

function timeOf(value) {
  return new Date(value).getTime();
}

// A query's bound on a time column, as the spec reads it back.
function describeBound(bound) {
  if (bound instanceof InBetween) {
    return {
      type: "InBetween",
      from: new Date(bound.startValue).toISOString(),
      to: new Date(bound.endValue).toISOString(),
    };
  }
  for (const [type, Kind] of [
    ["LessThan", LessThan],
    ["LessThanOrEqual", LessThanOrEqual],
    ["GreaterThan", GreaterThan],
    ["GreaterThanOrEqual", GreaterThanOrEqual],
    ["GreaterThanOrNull", GreaterThanOrNull],
  ]) {
    if (bound instanceof Kind) {
      return { type, value: new Date(bound.value).toISOString() };
    }
  }
  return null;
}

function matchesTime(value, bound) {
  if (bound === undefined || bound === null) {
    return true;
  }
  if (bound instanceof GreaterThanOrNull) {
    return value === null || value > timeOf(bound.value);
  }
  if (value === null) {
    return false;
  }
  if (bound instanceof InBetween) {
    return value >= timeOf(bound.startValue) && value <= timeOf(bound.endValue);
  }
  if (bound instanceof LessThan) {
    return value < timeOf(bound.value);
  }
  if (bound instanceof LessThanOrEqual) {
    return value <= timeOf(bound.value);
  }
  if (bound instanceof GreaterThan) {
    return value > timeOf(bound.value);
  }
  if (bound instanceof GreaterThanOrEqual) {
    return value >= timeOf(bound.value);
  }
  return true;
}

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (key === "startsAt" || key === "endsAt") {
      const value = record[key] ? timeOf(record[key]) : null;
      if (!matchesTime(value, condition)) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotEqual) {
      if (idOf(record[key]) === idOf(condition.value)) {
        return false;
      }
      continue;
    }
    if (condition instanceof ObjectID || typeof condition === "string") {
      if (idOf(record[key]) !== idOf(condition)) {
        return false;
      }
    }
  }
  return true;
}

function sortRows(rows, sort) {
  const [field, order] = Object.entries(sort || {})[0] || [];
  if (!field) {
    return rows;
  }
  const direction = order === SortOrder.Descending ? -1 : 1;
  return [...rows].sort((first, second) => {
    const a =
      first[field] instanceof Date ? timeOf(first[field]) : first[field];
    const b =
      second[field] instanceof Date ? timeOf(second[field]) : second[field];
    return a > b ? direction : a < b ? -direction : 0;
  });
}

const heldPermission =
  role === "viewer" ? Permission.Viewer : Permission.ProjectOwner;

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
UserUtil.getName = () => new Name("Ada Lovelace");
UserUtil.getEmail = () => new Email("ada@example.com");
PermissionUtil.getAllPermissions = () => [heldPermission];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: [
    {
      _type: "UserPermission",
      permission: heldPermission,
      labelIds: [],
      isBlockPermission: false,
    },
  ],
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
// The record the page is about: the monitor's, or the incident's, id.
Navigation.getLastParamAsObjectID = () =>
  new ObjectID(page === "incident" ? INCIDENT_ID : MONITOR_ID);

// A read takes as long as a quick one does, so loading states are real.
function respond(value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 60);
  });
}

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  const query = options.query || {};

  window.__fixture.listRequests.push({
    tableName,
    startsAt: describeBound(query.startsAt),
    queryKeys: Object.keys(query).sort(),
    selectKeys: Object.keys(options.select || {}).sort(),
    sort: JSON.parse(JSON.stringify(options.sort || {})),
    skip,
    limit,
  });

  const items = sortRows(
    (RECORDS[tableName] || []).filter((record) => matchesQuery(record, query)),
    options.sort,
  );

  return respond({
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  });
};

ModelAPI.count = async (options) => {
  const tableName = new options.modelType().tableName;
  return (RECORDS[tableName] || []).filter((record) =>
    matchesQuery(record, options.query),
  ).length;
};

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.itemRequests.push({
    tableName,
    id,
    selectKeys: Object.keys(options.select || {}).sort(),
  });
  return respond(
    (RECORDS[tableName] || []).find((record) => idOf(record._id) === id) ||
      null,
  );
};

ModelAPI.updateById = async (options) => {
  window.__fixture.updates.push({
    tableName: new options.modelType().tableName,
    id: idOf(options.id),
    data: JSON.parse(JSON.stringify(options.data || {})),
  });
  return respond(undefined);
};

/*
 * What MonitorStatusTimelineService does when one event is deleted by its
 * id (MonitorStatusEventDelete.decide): the only event, and the oldest
 * while it covers part of the kept history, are refused; otherwise the
 * event before runs on over its time.
 */
function deleteMonitorEvent(id) {
  const rows = sortRows(RECORDS.MonitorStatusTimeline, {
    startsAt: SortOrder.Ascending,
  });
  const index = rows.findIndex((row) => idOf(row._id) === id);
  if (index < 0) {
    throw new Error("Monitor Status Timeline not found.");
  }
  const target = rows[index];
  const before = rows[index - 1];
  const after = rows[index + 1];
  const decision = MonitorStatusEventDelete.decide({
    event: { startsAt: target.startsAt, endsAt: target.endsAt },
    before: before
      ? {
          id: new ObjectID(before._id),
          startsAt: before.startsAt,
          endsAt: before.endsAt,
        }
      : null,
    after: after ? { startsAt: after.startsAt } : null,
    eventCount: rows.length,
    now: new Date(NOW),
  });
  if (decision.kind === "refuse") {
    throw new Error(decision.message);
  }
  if (before) {
    before.endsAt = after ? after.startsAt : target.endsAt;
  }
  RECORDS.MonitorStatusTimeline = RECORDS.MonitorStatusTimeline.filter(
    (row) => row !== target,
  );
}

// An incident's only state is refused; the state before runs on otherwise.
function deleteIncidentEvent(id) {
  const rows = sortRows(RECORDS.IncidentStateTimeline, {
    startsAt: SortOrder.Ascending,
  });
  const index = rows.findIndex((row) => idOf(row._id) === id);
  if (index < 0) {
    throw new Error("Incident State Timeline not found.");
  }
  if (rows.length === 1) {
    throw new Error(ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.Incident]);
  }
  const target = rows[index];
  const before = rows[index - 1];
  const after = rows[index + 1];
  if (before) {
    before.endsAt = after ? after.startsAt : target.endsAt;
  }
  RECORDS.IncidentStateTimeline = RECORDS.IncidentStateTimeline.filter(
    (row) => row !== target,
  );
}

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.deletes.push({ tableName, id });
  await respond(undefined);

  if (tableName === "MonitorStatusTimeline") {
    deleteMonitorEvent(id);
    return;
  }
  if (tableName === "IncidentStateTimeline") {
    deleteIncidentEvent(id);
    return;
  }
  throw new Error(`The fixture does not model deleting ${tableName}.`);
};

/*
 * A new status event: it begins when the form says, and the event that
 * was the monitor's (or the incident's) status then ends there.
 */
ModelAPI.createOrUpdate = async (options) => {
  const tableName = new options.modelType().tableName;
  const model = options.model;
  const stateColumn =
    tableName === "MonitorStatusTimeline" ? "monitorStatus" : "incidentState";
  const states =
    tableName === "MonitorStatusTimeline"
      ? MONITOR_STATUSES
      : RECORDS.IncidentState;
  const stateId = idOfRelation(model[`${stateColumn}Id`] || model[stateColumn]);
  const state = states.find((candidate) => idOf(candidate._id) === stateId);
  const startsAt = model.startsAt ? new Date(model.startsAt) : new Date(NOW);

  window.__fixture.creates.push({
    tableName,
    state: state ? state.name : null,
    startsAt: startsAt.toISOString(),
    recordId: idOf(model.monitorId || model.incidentId),
  });

  const rows = RECORDS[tableName];
  const open = rows.find(
    (row) => !row.endsAt && timeOf(row.startsAt) <= startsAt.getTime(),
  );
  if (open) {
    open.endsAt = startsAt;
  }

  const row = new options.modelType();
  row._id = rowId("63000000", rows.length + 1);
  row.projectId = new ObjectID(PROJECT_ID);
  row[stateColumn] = state;
  row[`${stateColumn}Id`] = state ? new ObjectID(state._id) : undefined;
  row.startsAt = startsAt;
  row.createdByUser = ADA;
  if (tableName === "MonitorStatusTimeline") {
    row.monitorId = new ObjectID(MONITOR_ID);
  } else {
    row.incidentId = new ObjectID(INCIDENT_ID);
    row.subscriberNotificationStatus =
      StatusPageSubscriberNotificationStatus.Pending;
  }
  rows.push(row);

  return respond({ data: row, miscData: undefined });
};

API.get = async () => ({ data: { data: [], count: 0 } });
API.post = async () => ({ data: { data: [], count: 0 } });

/*
 * The Dashboard looks every string up by its English text, so the separators
 * i18next reads in a key (the "." and ":" of a sentence) are turned off, as
 * the Dashboard's own setup does.
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

const PAGES = {
  monitor: {
    component: MonitorStatusTimelinePage,
    trail: ["Monitors", "Checkout API", "Status Timeline"],
  },
  incident: {
    component: IncidentStateTimelinePage,
    trail: ["Incidents", "#42 Checkout API is offline", "Status Timeline"],
  },
};

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page];
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        {trail.map((title, index) => (
          <React.Fragment key={title}>
            {index > 0 ? <span className="mx-2">/</span> : null}
            {title}
          </React.Fragment>
        ))}
      </div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
