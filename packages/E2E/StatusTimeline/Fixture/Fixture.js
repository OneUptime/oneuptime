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
 *                            monitor's; page=alert, maintenance,
 *                            incident-episode, alert-episode or site for
 *                            the other five status timeline pages
 *   - scenario=...           for a monitor: screenshot (the default; the
 *                            maintainer's 63 status events, mostly Operational
 *                            with short Offline blips), flapping (700 changes
 *                            in the last day, more than one read), new (one
 *                            status, an hour old), quiet (one outage in a
 *                            year) or empty;
 *                            for an incident: resolved (the default; Created,
 *                            Acknowledged, Resolved three weeks ago), ongoing
 *                            (still Acknowledged), declared (its only state)
 *                            or closed (moved on to "Closed", a state of the
 *                            project's own placed after Resolved, with no
 *                            flag of its own);
 *                            for an alert: ongoing (the default) or resolved;
 *                            for a maintenance event: completed (the
 *                            default) or ongoing
 *   - role=viewer            a member who may read the timeline but not
 *                            create or delete a status event (Viewer); the
 *                            default is a project owner
 *   - lang=de|ja             the Dashboard's German or Japanese words
 *   - fail=timeline          every read of the timeline's rows fails, as a
 *                            server that cannot be reached does
 *   - delay=<ms>             each read takes this long (60 ms otherwise), to
 *                            see the timeline while it loads
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
import AlertStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline";
import ScheduledMaintenanceStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import IncidentEpisodeStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/StateTimeline";
import AlertEpisodeStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/StateTimeline";
import NetworkSiteStatusTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import NetworkSiteStatusTimeline from "Common/Models/DatabaseModels/NetworkSiteStatusTimeline";
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
// The suites' one seeded generator, so every run draws the same history.
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const MONITOR_ID = "60000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "40000000-0000-4000-8000-000000000001";
const ALERT_ID = "43000000-0000-4000-8000-000000000001";
const MAINTENANCE_ID = "44000000-0000-4000-8000-000000000001";
const INCIDENT_EPISODE_ID = "45000000-0000-4000-8000-000000000001";
const ALERT_EPISODE_ID = "46000000-0000-4000-8000-000000000001";
const SITE_ID = "47000000-0000-4000-8000-000000000001";

const PAGE_NAMES = [
  "monitor",
  "incident",
  "alert",
  "maintenance",
  "incident-episode",
  "alert-episode",
  "site",
];

const params = new URLSearchParams(window.location.search);
const page = PAGE_NAMES.includes(params.get("page"))
  ? params.get("page")
  : "monitor";
const scenario = params.get("scenario") || "";
const role = params.get("role") || "owner";
const failure = params.get("fail") || "";
const readDelay = Number(params.get("delay") || 60);
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

// A state of an incident's or an alert's list, with its built-in flag.
function listState(Model, id, name, color, order, flag) {
  const state = new Model();
  state._id = id;
  state.projectId = new ObjectID(PROJECT_ID);
  state.name = name;
  state.color = new Color(color);
  state.order = order;
  if (flag) {
    state[flag] = true;
  }
  return state;
}

const CREATED = listState(
  IncidentState,
  "41000000-0000-4000-8000-000000000001",
  "Created",
  "#ef4444",
  1,
  "isCreatedState",
);
const ACKNOWLEDGED = listState(
  IncidentState,
  "41000000-0000-4000-8000-000000000002",
  "Acknowledged",
  "#f59e0b",
  2,
  "isAcknowledgedState",
);
const RESOLVED = listState(
  IncidentState,
  "41000000-0000-4000-8000-000000000003",
  "Resolved",
  "#10b981",
  3,
  "isResolvedState",
);
/*
 * A state of the project's own, placed after Resolved and carrying no flag:
 * an incident in it is resolved all the same (Common/Utils/ResolvedState).
 */
const CLOSED = listState(
  IncidentState,
  "41000000-0000-4000-8000-000000000004",
  "Closed",
  "#64748b",
  4,
  null,
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
  if (scenario === "closed") {
    return [
      incidentEvent(CREATED, declared, declared - 12 * MINUTE),
      incidentEvent(ACKNOWLEDGED, declared - 12 * MINUTE, 21 * DAY),
      incidentEvent(RESOLVED, 21 * DAY, 21 * DAY - 30 * MINUTE),
      incidentEvent(CLOSED, 21 * DAY - 30 * MINUTE, null),
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

// ------------------------------------------------- the other timelines

const ALERT_CREATED = listState(
  AlertState,
  "48000000-0000-4000-8000-000000000001",
  "Created",
  "#ef4444",
  1,
  "isCreatedState",
);
const ALERT_ACKNOWLEDGED = listState(
  AlertState,
  "48000000-0000-4000-8000-000000000002",
  "Acknowledged",
  "#f59e0b",
  2,
  "isAcknowledgedState",
);
const ALERT_RESOLVED = listState(
  AlertState,
  "48000000-0000-4000-8000-000000000003",
  "Resolved",
  "#10b981",
  3,
  "isResolvedState",
);

const SCHEDULED = listState(
  ScheduledMaintenanceState,
  "49000000-0000-4000-8000-000000000001",
  "Scheduled",
  "#6366f1",
  1,
  "isScheduledState",
);
const ONGOING = listState(
  ScheduledMaintenanceState,
  "49000000-0000-4000-8000-000000000002",
  "Ongoing",
  "#f59e0b",
  2,
  "isOngoingState",
);
const ENDED = listState(
  ScheduledMaintenanceState,
  "49000000-0000-4000-8000-000000000003",
  "Ended",
  "#10b981",
  3,
  "isEndedState",
);
const COMPLETED = listState(
  ScheduledMaintenanceState,
  "49000000-0000-4000-8000-000000000004",
  "Completed",
  "#059669",
  4,
  "isResolvedState",
);

// The other five pages' timelines: their model, state column and record.
const TIMELINES = {
  AlertStateTimeline: {
    Model: AlertStateTimeline,
    stateColumn: "alertState",
    recordColumn: "alertId",
    recordId: ALERT_ID,
    prefix: "4a000000",
    record: StateTimelineRecord.Alert,
  },
  ScheduledMaintenanceStateTimeline: {
    Model: ScheduledMaintenanceStateTimeline,
    stateColumn: "scheduledMaintenanceState",
    recordColumn: "scheduledMaintenanceId",
    recordId: MAINTENANCE_ID,
    prefix: "4b000000",
    record: StateTimelineRecord.ScheduledMaintenance,
  },
  IncidentEpisodeStateTimeline: {
    Model: IncidentEpisodeStateTimeline,
    stateColumn: "incidentState",
    recordColumn: "incidentEpisodeId",
    recordId: INCIDENT_EPISODE_ID,
    prefix: "4c000000",
    record: StateTimelineRecord.IncidentEpisode,
  },
  AlertEpisodeStateTimeline: {
    Model: AlertEpisodeStateTimeline,
    stateColumn: "alertState",
    recordColumn: "alertEpisodeId",
    recordId: ALERT_EPISODE_ID,
    prefix: "4d000000",
    record: StateTimelineRecord.AlertEpisode,
  },
  NetworkSiteStatusTimeline: {
    Model: NetworkSiteStatusTimeline,
    stateColumn: "monitorStatus",
    recordColumn: "siteId",
    recordId: SITE_ID,
    prefix: "4e000000",
    record: null,
  },
};

const timelineRowCounts = {};

/*
 * A row of one of those timelines: `from` and `to` are how long before now
 * it began and ended (`to` null: the record's state now).
 */
function timelineEvent(tableName, state, from, to, extra) {
  const timeline = TIMELINES[tableName];
  timelineRowCounts[tableName] = (timelineRowCounts[tableName] || 0) + 1;
  const row = new timeline.Model();
  row._id = rowId(timeline.prefix, timelineRowCounts[tableName]);
  row.projectId = new ObjectID(PROJECT_ID);
  row[timeline.recordColumn] = new ObjectID(timeline.recordId);
  row[`${timeline.stateColumn}Id`] = new ObjectID(state._id);
  row[timeline.stateColumn] = state;
  row.startsAt = new Date(NOW - from);
  if (to !== null) {
    row.endsAt = new Date(NOW - to);
  }
  Object.assign(row, extra || {});
  return row;
}

function alertHistory() {
  if (scenario === "resolved") {
    return [
      timelineEvent(
        "AlertStateTimeline",
        ALERT_CREATED,
        2 * DAY,
        2 * DAY - 9 * MINUTE,
      ),
      timelineEvent(
        "AlertStateTimeline",
        ALERT_ACKNOWLEDGED,
        2 * DAY - 9 * MINUTE,
        2 * DAY - 47 * MINUTE,
      ),
      timelineEvent(
        "AlertStateTimeline",
        ALERT_RESOLVED,
        2 * DAY - 47 * MINUTE,
        null,
      ),
    ];
  }
  return [
    timelineEvent(
      "AlertStateTimeline",
      ALERT_CREATED,
      40 * MINUTE,
      31 * MINUTE,
    ),
    timelineEvent("AlertStateTimeline", ALERT_ACKNOWLEDGED, 31 * MINUTE, null, {
      createdByUser: ADA,
    }),
  ];
}

// What a maintenance event's status page subscribers were told of a change.
function told(status, message) {
  return {
    subscriberNotificationStatus: status,
    subscriberNotificationStatusMessage: message,
  };
}

function maintenanceHistory() {
  const sent = told(
    StatusPageSubscriberNotificationStatus.Success,
    "Status page subscribers were notified.",
  );
  if (scenario === "ongoing") {
    return [
      timelineEvent(
        "ScheduledMaintenanceStateTimeline",
        SCHEDULED,
        2 * DAY,
        45 * MINUTE,
        sent,
      ),
      timelineEvent(
        "ScheduledMaintenanceStateTimeline",
        ONGOING,
        45 * MINUTE,
        null,
        sent,
      ),
    ];
  }
  return [
    timelineEvent(
      "ScheduledMaintenanceStateTimeline",
      SCHEDULED,
      3 * DAY,
      10 * HOUR,
      sent,
    ),
    timelineEvent(
      "ScheduledMaintenanceStateTimeline",
      ONGOING,
      10 * HOUR,
      8 * HOUR,
      sent,
    ),
    timelineEvent(
      "ScheduledMaintenanceStateTimeline",
      ENDED,
      8 * HOUR,
      8 * HOUR - 5 * MINUTE,
      sent,
    ),
    timelineEvent(
      "ScheduledMaintenanceStateTimeline",
      COMPLETED,
      8 * HOUR - 5 * MINUTE,
      null,
      told(
        StatusPageSubscriberNotificationStatus.Skipped,
        "Notify Status Page Subscribers was off for this change.",
      ),
    ),
  ];
}

function incidentEpisodeHistory() {
  return [
    timelineEvent(
      "IncidentEpisodeStateTimeline",
      CREATED,
      DAY + 4 * HOUR,
      DAY + 3 * HOUR + 40 * MINUTE,
    ),
    timelineEvent(
      "IncidentEpisodeStateTimeline",
      ACKNOWLEDGED,
      DAY + 3 * HOUR + 40 * MINUTE,
      DAY + HOUR,
    ),
    timelineEvent("IncidentEpisodeStateTimeline", RESOLVED, DAY + HOUR, null),
  ];
}

function alertEpisodeHistory() {
  return [
    timelineEvent(
      "AlertEpisodeStateTimeline",
      ALERT_CREATED,
      5 * HOUR,
      4 * HOUR + 30 * MINUTE,
    ),
    timelineEvent(
      "AlertEpisodeStateTimeline",
      ALERT_ACKNOWLEDGED,
      4 * HOUR + 30 * MINUTE,
      null,
    ),
  ];
}

// A month of a site's health, Operational with a few bad stretches.
function siteHistory() {
  const lengths = [
    [OPERATIONAL, 3 * DAY + 4 * HOUR],
    [DEGRADED, 2 * HOUR + 10 * MINUTE],
    [OPERATIONAL, 9 * DAY + 7 * HOUR],
    [OFFLINE, 41 * MINUTE],
    [DEGRADED, 3 * HOUR],
    [OPERATIONAL, 12 * DAY + 2 * HOUR],
    [OFFLINE, 3 * MINUTE + 12 * SECOND],
    [OPERATIONAL, 30 * DAY],
  ];
  const rows = [];
  let end = 0;
  lengths.forEach(([status, length], index) => {
    rows.push(
      timelineEvent(
        "NetworkSiteStatusTimeline",
        status,
        end + length,
        index === 0 ? null : end,
      ),
    );
    end += length;
  });
  return rows;
}

// ---------------------------------------------------------------- the API

const RECORDS = {
  MonitorStatus: MONITOR_STATUSES,
  MonitorStatusTimeline: page === "monitor" ? monitorHistory() : [],
  IncidentState: [CREATED, ACKNOWLEDGED, RESOLVED, CLOSED],
  IncidentStateTimeline: page === "incident" ? incidentHistory() : [],
  AlertState: [ALERT_CREATED, ALERT_ACKNOWLEDGED, ALERT_RESOLVED],
  AlertStateTimeline: page === "alert" ? alertHistory() : [],
  ScheduledMaintenanceState: [SCHEDULED, ONGOING, ENDED, COMPLETED],
  ScheduledMaintenanceStateTimeline:
    page === "maintenance" ? maintenanceHistory() : [],
  IncidentEpisodeStateTimeline:
    page === "incident-episode" ? incidentEpisodeHistory() : [],
  AlertEpisodeStateTimeline:
    page === "alert-episode" ? alertEpisodeHistory() : [],
  NetworkSiteStatusTimeline: page === "site" ? siteHistory() : [],
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
// The record the page is about.
const RECORD_IDS = {
  monitor: MONITOR_ID,
  incident: INCIDENT_ID,
  alert: ALERT_ID,
  maintenance: MAINTENANCE_ID,
  "incident-episode": INCIDENT_EPISODE_ID,
  "alert-episode": ALERT_EPISODE_ID,
  site: SITE_ID,
};
Navigation.getLastParamAsObjectID = () => new ObjectID(RECORD_IDS[page]);

// A read takes as long as a quick one does, so loading states are real.
function respond(value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), readDelay);
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

  if (failure === "timeline" && tableName.endsWith("Timeline")) {
    await respond(undefined);
    throw new Error(
      "Error connecting to server. Please try again in a few minutes.",
    );
  }

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

/*
 * The other timelines' rows: the record's only row is refused in the
 * server's words; the row before runs on otherwise.
 */
function deleteTimelineEvent(tableName, id) {
  const rows = sortRows(RECORDS[tableName], { startsAt: SortOrder.Ascending });
  const index = rows.findIndex((row) => idOf(row._id) === id);
  if (index < 0) {
    throw new Error(`${tableName} not found.`);
  }
  if (rows.length === 1) {
    throw new Error(ONLY_STATE_DELETE_MESSAGES[TIMELINES[tableName].record]);
  }
  const target = rows[index];
  const before = rows[index - 1];
  const after = rows[index + 1];
  if (before) {
    before.endsAt = after ? after.startsAt : target.endsAt;
  }
  RECORDS[tableName] = RECORDS[tableName].filter((row) => row !== target);
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
  if (TIMELINES[tableName] && TIMELINES[tableName].record) {
    deleteTimelineEvent(tableName, id);
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
    tableName === "MonitorStatusTimeline"
      ? "monitorStatus"
      : tableName === "IncidentStateTimeline"
        ? "incidentState"
        : TIMELINES[tableName].stateColumn;
  const states = {
    monitorStatus: MONITOR_STATUSES,
    incidentState: RECORDS.IncidentState,
    alertState: RECORDS.AlertState,
    scheduledMaintenanceState: RECORDS.ScheduledMaintenanceState,
  }[stateColumn];
  const stateId = idOfRelation(model[`${stateColumn}Id`] || model[stateColumn]);
  const state = states.find((candidate) => idOf(candidate._id) === stateId);
  const startsAt = model.startsAt ? new Date(model.startsAt) : new Date(NOW);

  const recordColumn =
    tableName === "MonitorStatusTimeline"
      ? "monitorId"
      : tableName === "IncidentStateTimeline"
        ? "incidentId"
        : TIMELINES[tableName].recordColumn;

  window.__fixture.creates.push({
    tableName,
    state: state ? state.name : null,
    startsAt: startsAt.toISOString(),
    recordId: idOf(model[recordColumn]),
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
  row[recordColumn] = new ObjectID(RECORD_IDS[page]);
  if (
    tableName === "IncidentStateTimeline" ||
    tableName === "ScheduledMaintenanceStateTimeline"
  ) {
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

/*
 * Each page's trail, as the Dashboard's breadcrumbs end it: a monitor's and
 * a site's Status Timeline, and the State Timeline of an incident, an
 * alert, a maintenance event and an episode - the name of their menu entry
 * and their card.
 */
const PAGES = {
  monitor: {
    component: MonitorStatusTimelinePage,
    trail: ["Monitors", "Checkout API", "Status Timeline"],
  },
  incident: {
    component: IncidentStateTimelinePage,
    trail: ["Incidents", "#42 Checkout API is offline", "State Timeline"],
  },
  alert: {
    component: AlertStateTimelinePage,
    trail: [
      "Alerts",
      "#318 Checkout API p95 latency over 2s",
      "State Timeline",
    ],
  },
  maintenance: {
    component: ScheduledMaintenanceStateTimelinePage,
    trail: [
      "Scheduled Maintenance",
      "Database upgrade to Postgres 18",
      "State Timeline",
    ],
  },
  "incident-episode": {
    component: IncidentEpisodeStateTimelinePage,
    trail: ["Incident Episodes", "Checkout outages", "State Timeline"],
  },
  "alert-episode": {
    component: AlertEpisodeStateTimelinePage,
    trail: ["Alert Episodes", "Checkout latency alerts", "State Timeline"],
  },
  site: {
    component: NetworkSiteStatusTimelinePage,
    trail: ["Network Sites", "London office", "Status Timeline"],
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
