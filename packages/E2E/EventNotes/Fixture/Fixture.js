/*
 * Offline fixture for the real public and private note pages of incidents,
 * alerts, scheduled maintenance events, incident episodes and alert
 * episodes.
 *
 * Each page's Layout (ModelPage + SideMenu) and note page are the production
 * components from this branch, mounted under their real RouteMap patterns.
 * Only the data boundary (ModelAPI / API) and the signed-in user are
 * replaced.
 *
 * Every record is fabricated for a generic "Acme Commerce" workspace. Dates
 * are relative to the moment the page loads, so a spec that pins the browser
 * clock gets the same page every run.
 *
 * Scenarios are picked with query parameters (read once at load):
 *
 *   ?notes=     full (default) | empty | many
 *               "empty" gives every event no notes; "many" gives Incident
 *               #1042 enough public notes to need a second page.
 *   ?role=      owner (default) | viewer | member
 *               "viewer" can read notes but not write them; "member" is a
 *               plain Project Member rather than a master admin, so every
 *               gate goes through the real permission checks.
 *   ?templates= some (default) | none | many
 *   ?quiet=     1 marks Incident #1042 as declared without notifying
 *               subscribers, so its public note composer starts unticked.
 *   ?fail=      comma separated: list, create, update, delete, resend,
 *               templates, ai. The matching call throws HTTPErrorResponse.
 *   ?theme=     dark adds html.dark (handled by server.js).
 *
 * Every read and write is recorded on window.__eventNotesFixture:
 *   getItemRequests, listRequests, countRequests, apiRequests, creates,
 *   updates, deletes, unhandled.
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
import IncidentPublicNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/PublicNote";
import IncidentInternalNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/InternalNote";
import AlertViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Layout";
import AlertInternalNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/InternalNote";
import ScheduledMaintenanceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Layout";
import ScheduledMaintenancePublicNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/PublicNote";
import ScheduledMaintenanceInternalNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/InternalNote";
import IncidentEpisodeViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Layout";
import IncidentEpisodePublicNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";
import IncidentEpisodeInternalNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/InternalNote";
import AlertEpisodeViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Layout";
import AlertEpisodeInternalNotePage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/InternalNote";
import RouteMap, {
  RouteUtil,
} from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import FileModel from "Common/Models/DatabaseModels/File";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Email from "Common/Types/Email";
import MimeType from "Common/Types/File/MimeType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const notesMode = ["empty", "many"].includes(params.get("notes"))
  ? params.get("notes")
  : "full";
const roleMode = ["viewer", "member"].includes(params.get("role"))
  ? params.get("role")
  : "owner";
const templatesMode = ["none", "many"].includes(params.get("templates"))
  ? params.get("templates")
  : "some";
const isQuietIncident = params.get("quiet") === "1";
const failures = new Set((params.get("fail") || "").split(",").filter(Boolean));

const NOW = new Date();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const ID = {
  user: (n) => uuid("80000000", n),
  incident: (n) => uuid("20000000", n),
  alert: (n) => uuid("30000000", n),
  scheduledMaintenance: (n) => uuid("40000000", n),
  incidentEpisode: (n) => uuid("50000000", n),
  alertEpisode: (n) => uuid("60000000", n),
  note: (n) => uuid("70000000", n),
  template: (n) => uuid("71000000", n),
  file: (n) => uuid("72000000", n),
};

let rowCounter = 9000;

function rowId() {
  rowCounter++;
  return uuid("99000000", rowCounter);
}

const projectObjectId = new ObjectID(PROJECT_ID);

const fixture = {
  now: NOW.toISOString(),
  scenario: {
    notes: notesMode,
    role: roleMode,
    templates: templatesMode,
    quiet: isQuietIncident,
    fail: Array.from(failures),
  },
  ids: {
    project: PROJECT_ID,
    incident: ID.incident(1042),
    alert: ID.alert(311),
    scheduledMaintenance: ID.scheduledMaintenance(58),
    incidentEpisode: ID.incidentEpisode(12),
    alertEpisode: ID.alertEpisode(7),
  },
  getItemRequests: [],
  listRequests: [],
  countRequests: [],
  apiRequests: [],
  creates: [],
  updates: [],
  deletes: [],
  unhandled: [],
};
window.__eventNotesFixture = fixture;

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
 * In-memory tables
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
  return full;
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
    if (
      condition === null ||
      typeof condition !== "object" ||
      condition instanceof ObjectID
    ) {
      if (String(comparable(actual)) !== String(comparable(condition))) {
        return false;
      }
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
 * ---------------------------------------------------------------------------
 * People, events, notes, templates
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

const project = make(Project, { _id: PROJECT_ID, name: "Acme Commerce" });

function file(number, name, fileType) {
  return make(FileModel, { _id: ID.file(number), name, fileType });
}

insert(Incident, {
  _id: ID.incident(1042),
  incidentNumber: 1042,
  incidentNumberWithPrefix: "INC-1042",
  title: "Checkout API returning 502s for EU customers",
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: !isQuietIncident,
});
insert(Alert, {
  _id: ID.alert(311),
  alertNumber: 311,
  alertNumberWithPrefix: "ALT-311",
  title: "p99 latency above 2s on payments-worker",
});
insert(ScheduledMaintenance, {
  _id: ID.scheduledMaintenance(58),
  scheduledMaintenanceNumber: 58,
  title: "Primary database failover drill",
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
});
insert(IncidentEpisode, {
  _id: ID.incidentEpisode(12),
  episodeNumber: 12,
  title: "EU edge network degradation",
  shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
});
insert(AlertEpisode, {
  _id: ID.alertEpisode(7),
  episodeNumber: 7,
  title: "Payments worker saturation",
});

let noteNumber = 0;

function note(modelType, parentKey, parentId, spec) {
  noteNumber++;
  const createdAt = spec.createdAt;
  return insert(modelType, {
    _id: ID.note(noteNumber),
    [parentKey]: new ObjectID(parentId),
    note: spec.note,
    createdAt,
    updatedAt: createdAt,
    postedAt: spec.postedAt || (spec.isPublic ? createdAt : undefined),
    createdByUser: spec.by || undefined,
    createdByUserId: spec.by ? spec.by.id : undefined,
    attachments: spec.attachments || [],
    postedFromSlackMessageId: spec.slack
      ? "C0123456789:1726330000.000100"
      : undefined,
    subscriberNotificationStatusOnNoteCreated: spec.status,
    subscriberNotificationStatusMessage: spec.statusMessage,
    subscriberNotificationStatusOnNoteUpdated: spec.updateStatus,
    subscriberNotificationStatusMessageOnNoteUpdated: spec.updateStatusMessage,
  });
}

if (notesMode !== "empty") {
  const incidentId = ID.incident(1042);

  note(IncidentPublicNote, "incidentId", incidentId, {
    isPublic: true,
    createdAt: ago(12 * MINUTE),
    by: people.maya,
    status: StatusPageSubscriberNotificationStatus.Success,
    note: "**Monitoring.** A fix has been rolled out to every EU region and error rates are back to normal. We are keeping a close eye on checkout and will post a final update within the hour.",
  });
  note(IncidentPublicNote, "incidentId", incidentId, {
    isPublic: true,
    createdAt: ago(48 * MINUTE),
    by: people.sam,
    status: StatusPageSubscriberNotificationStatus.Failed,
    statusMessage:
      "The SMTP relay refused the connection (421 Too many connections). 1,284 subscribers were not notified.",
    note: "**Identified.** The 502s are caused by an expired certificate on one of our EU load balancers. We are rotating it now.\n\n- Card payments in the EU may fail\n- Orders placed in other regions are not affected",
    attachments: [
      file(1, "lb-eu-west-1-errors.png", MimeType.png),
      file(2, "certificate-chain.txt", MimeType.txt),
    ],
  });
  note(IncidentPublicNote, "incidentId", incidentId, {
    isPublic: true,
    createdAt: ago(DAY + 2 * HOUR),
    by: undefined,
    status: StatusPageSubscriberNotificationStatus.Skipped,
    statusMessage:
      "Notifications were not sent because the note was posted without notifying subscribers.",
    note: "We are investigating reports of failed payments at checkout for customers in Europe.",
  });
  note(IncidentPublicNote, "incidentId", incidentId, {
    isPublic: true,
    createdAt: ago(DAY + 3 * HOUR),
    by: people.jordan,
    slack: true,
    status: StatusPageSubscriberNotificationStatus.Success,
    updateStatus: StatusPageSubscriberNotificationStatus.Success,
    updateStatusMessage: SubscriberUpdateNotification.sentMessage,
    note: "Some customers in Europe may see errors when paying. Our engineers have been paged.",
  });

  if (notesMode === "many") {
    for (let i = 0; i < 30; i++) {
      note(IncidentPublicNote, "incidentId", incidentId, {
        isPublic: true,
        createdAt: ago(3 * DAY + i * HOUR),
        by: i % 2 === 0 ? people.alex : people.sam,
        status: StatusPageSubscriberNotificationStatus.Success,
        note: `Archived status update number ${30 - i}.`,
      });
    }
  }

  note(IncidentInternalNote, "incidentId", incidentId, {
    createdAt: ago(9 * MINUTE),
    by: people.jordan,
    note: "Rotated the cert on `lb-eu-west-1b`. Watching the 5xx panel before closing out. Follow-up: add expiry alerting for **all** edge certs.",
  });
  note(IncidentInternalNote, "incidentId", incidentId, {
    createdAt: ago(55 * MINUTE),
    by: people.sam,
    note: "Root cause looks like the ACME renewal job silently failing since the Sept 2 deploy. Logs attached.",
    attachments: [file(3, "renewal-job.log", MimeType.txt)],
  });
  note(IncidentInternalNote, "incidentId", incidentId, {
    createdAt: ago(DAY + HOUR),
    by: people.maya,
    note: "Paged the edge on-call. Customer support has a macro ready for affected merchants.",
  });

  note(AlertInternalNote, "alertId", ID.alert(311), {
    createdAt: ago(20 * MINUTE),
    by: people.alex,
    note: "Queue depth on `payments-worker` is at 40k. Scaling the consumer group from 6 to 12 pods.",
  });
  note(AlertInternalNote, "alertId", ID.alert(311), {
    createdAt: ago(2 * HOUR),
    by: people.maya,
    note: "Acknowledged. Correlates with the marketing email send at 14:00.",
  });

  note(
    ScheduledMaintenancePublicNote,
    "scheduledMaintenanceId",
    ID.scheduledMaintenance(58),
    {
      isPublic: true,
      createdAt: ago(3 * HOUR),
      by: people.jordan,
      status: StatusPageSubscriberNotificationStatus.Success,
      note: "The failover drill starts at 22:00 UTC. You may see up to 30 seconds of read-only mode.",
    },
  );
  note(
    ScheduledMaintenancePublicNote,
    "scheduledMaintenanceId",
    ID.scheduledMaintenance(58),
    {
      isPublic: true,
      createdAt: ago(2 * DAY),
      by: people.jordan,
      status: StatusPageSubscriberNotificationStatus.Pending,
      note: "We will be performing a scheduled failover of our primary database.",
    },
  );
  note(
    ScheduledMaintenanceInternalNote,
    "scheduledMaintenanceId",
    ID.scheduledMaintenance(58),
    {
      createdAt: ago(4 * HOUR),
      by: people.sam,
      note: "Runbook reviewed. Replica lag is under 50ms, good to go.",
    },
  );

  note(IncidentEpisodePublicNote, "incidentEpisodeId", ID.incidentEpisode(12), {
    isPublic: true,
    createdAt: ago(30 * MINUTE),
    by: people.maya,
    status: StatusPageSubscriberNotificationStatus.InProgress,
    note: "Several services in Europe are degraded. We are working on it.",
  });
  note(
    IncidentEpisodeInternalNote,
    "incidentEpisodeId",
    ID.incidentEpisode(12),
    {
      createdAt: ago(35 * MINUTE),
      by: people.alex,
      note: "Grouped INC-1042, INC-1043 and INC-1045 into this episode: same edge POP.",
    },
  );
  note(AlertEpisodeInternalNote, "alertEpisodeId", ID.alertEpisode(7), {
    createdAt: ago(25 * MINUTE),
    by: people.sam,
    note: "All 5 alerts in this episode are downstream of the payments queue backlog.",
  });
}

const TEMPLATE_SETS = {
  none: [],
  some: [
    [
      "Investigating",
      "**Investigating.** We are aware of an issue affecting {{service}} and are looking into it. Next update in 30 minutes.",
    ],
    [
      "Identified",
      "**Identified.** We have found the cause and are working on a fix.",
    ],
    [
      "Resolved",
      "**Resolved.** The issue has been fixed and all systems are operating normally. Thank you for your patience.",
    ],
  ],
};
TEMPLATE_SETS.many = Array.from({ length: 12 }, (_, index) => {
  return [
    `Template ${String(index + 1).padStart(2, "0")}`,
    `Body ${index + 1}.`,
  ];
});

for (const modelType of [
  IncidentNoteTemplate,
  AlertNoteTemplate,
  ScheduledMaintenanceNoteTemplate,
]) {
  TEMPLATE_SETS[templatesMode].forEach(([templateName, body], index) => {
    insert(modelType, {
      _id: ID.template(index + 1),
      templateName,
      note: body,
    });
  });
}

/*
 * Every note and template table exists even when a scenario leaves it
 * empty, so an empty feed reads as empty rather than as unmodelled.
 */
for (const modelType of [
  IncidentPublicNote,
  IncidentInternalNote,
  AlertInternalNote,
  ScheduledMaintenancePublicNote,
  ScheduledMaintenanceInternalNote,
  IncidentEpisodePublicNote,
  IncidentEpisodeInternalNote,
  AlertEpisodeInternalNote,
  IncidentNoteTemplate,
  AlertNoteTemplate,
  ScheduledMaintenanceNoteTemplate,
]) {
  table(modelType);
}

const PUBLIC_NOTE_MODELS = [
  IncidentPublicNote,
  ScheduledMaintenancePublicNote,
  IncidentEpisodePublicNote,
].map(tableName);

const NOTE_MODELS = [
  ...PUBLIC_NOTE_MODELS,
  ...[
    IncidentInternalNote,
    AlertInternalNote,
    ScheduledMaintenanceInternalNote,
    IncidentEpisodeInternalNote,
    AlertEpisodeInternalNote,
  ].map(tableName),
];

/*
 * A notification the worker would send a moment after the note is posted:
 * every read of the feed moves it one step, Pending -> InProgress -> Success.
 */
function advanceNotifications(records) {
  for (const record of records) {
    for (const key of [
      "subscriberNotificationStatusOnNoteCreated",
      "subscriberNotificationStatusOnNoteUpdated",
    ]) {
      if (record.__settleAfterReads === undefined) {
        continue;
      }
      if (record[key] === StatusPageSubscriberNotificationStatus.Pending) {
        record[key] = StatusPageSubscriberNotificationStatus.InProgress;
      } else if (
        record[key] === StatusPageSubscriberNotificationStatus.InProgress
      ) {
        record[key] = StatusPageSubscriberNotificationStatus.Success;
      }
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
const ROLE_PERMISSIONS = {
  owner: [Permission.ProjectOwner],
  // Reads every note, writes none.
  viewer: [Permission.Viewer],
  member: [Permission.ProjectMember],
};

UserUtil.isMasterAdmin = () => roleMode === "owner";
UserUtil.getUserId = () => people.maya.id;
UserUtil.getName = () => people.maya.name;
UserUtil.getEmail = () => people.maya.email;
PermissionUtil.getAllPermissions = () => ROLE_PERMISSIONS[roleMode];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

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
  if (failures.has("list") && NOTE_MODELS.includes(modelName)) {
    throw fail(500, "The notes service is unavailable. Try again shortly.");
  }
  if (
    failures.has("templates") &&
    modelName.toLowerCase().includes("template")
  ) {
    throw fail(403, "You do not have permission to read note templates.");
  }
  const known = knownTable(options.modelType, "getList", {
    query: serialize(options.query),
  });
  const matching = (known?.records || []).filter((record) => {
    return matches(record, options.query);
  });
  if (PUBLIC_NOTE_MODELS.includes(modelName)) {
    advanceNotifications(matching);
  }
  const records = sortRecords(matching, options.sort);
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
  if (failures.has("resend")) {
    throw fail(
      400,
      "Notifications cannot be resent while the SMTP relay is down.",
    );
  }
  const record = (tables.get(modelName)?.records || []).find((item) => {
    return String(item._id) === id;
  });
  if (record) {
    Object.assign(record, options.data, { __settleAfterReads: 2 });
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const data = BaseModel.toJSON(options.model, options.modelType);
  const isUpdate = options.formType === FormType.Update;
  fixture[isUpdate ? "updates" : "creates"].push({
    modelName,
    formType: options.formType,
    data: serialize(data),
    miscDataProps: serialize(options.miscDataProps),
  });
  if (failures.has(isUpdate ? "update" : "create")) {
    throw fail(
      400,
      isUpdate
        ? "This note was changed by someone else. Reload and try again."
        : "Notes cannot be posted while the incident is being merged.",
    );
  }
  const known = tables.get(modelName);
  const isPublicNote = PUBLIC_NOTE_MODELS.includes(modelName);

  if (isUpdate) {
    const record = (known?.records || []).find((item) => {
      return String(item._id) === String(options.model._id);
    });
    if (record) {
      for (const key of Object.keys(options.model)) {
        if (options.model[key] !== undefined && key !== "_id") {
          record[key] = options.model[key];
        }
      }
      if (
        isPublicNote &&
        SubscriberUpdateNotification.isRequested(options.miscDataProps)
      ) {
        record.subscriberNotificationStatusOnNoteUpdated =
          StatusPageSubscriberNotificationStatus.Pending;
        record.subscriberNotificationStatusMessageOnNoteUpdated =
          SubscriberUpdateNotification.queuedMessage;
        record.__settleAfterReads = 2;
      }
    }
    return new HTTPResponse(200, {}, {});
  }

  const record = { ...options.model, projectId: projectObjectId };
  record._id = record._id || rowId();
  record.createdAt = NOW;
  record.createdByUser = people.maya;
  record.createdByUserId = people.maya.id;
  if (isPublicNote) {
    record.postedAt = record.postedAt || NOW;
    const shouldNotify =
      record.shouldStatusPageSubscribersBeNotifiedOnNoteCreated !== false;
    record.subscriberNotificationStatusOnNoteCreated = shouldNotify
      ? StatusPageSubscriberNotificationStatus.Pending
      : StatusPageSubscriberNotificationStatus.Skipped;
    record.__settleAfterReads = 2;
  }
  if (known) {
    known.records.push(record);
  }
  const created = make(options.modelType, record);
  return new HTTPResponse(
    200,
    BaseModel.toJSON(created, options.modelType),
    {},
  );
};

ModelAPI.create = async (options) => {
  return ModelAPI.createOrUpdate({ ...options, formType: FormType.Create });
};

ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.deletes.push({ modelName, id });
  if (failures.has("delete")) {
    throw fail(403, "You can only delete notes you wrote.");
  }
  const known = tables.get(modelName);
  if (known) {
    known.records = known.records.filter((record) => {
      return String(record._id) !== id;
    });
  }
};

const AI_DRAFT =
  "**Update.** We have identified the cause of the elevated error rates and a fix is being deployed. We will post another update within 30 minutes.";

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/generate-note-from-ai/")) {
    if (failures.has("ai")) {
      throw fail(500, "The AI provider did not respond.");
    }
    return ok({ note: AI_DRAFT });
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return ok({ data: [], count: 0 });
}

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
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function withNavigation(Layout) {
  return function FixtureLayout() {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());
    return <Layout {...pageProps(undefined)} />;
  };
}

const LAYOUTS = [
  {
    view: PageMap.INCIDENT_VIEW,
    Layout: withNavigation(IncidentViewLayout),
    pages: [
      [PageMap.INCIDENT_VIEW_PUBLIC_NOTE, IncidentPublicNotePage],
      [PageMap.INCIDENT_VIEW_INTERNAL_NOTE, IncidentInternalNotePage],
    ],
  },
  {
    view: PageMap.ALERT_VIEW,
    Layout: withNavigation(AlertViewLayout),
    pages: [[PageMap.ALERT_VIEW_INTERNAL_NOTE, AlertInternalNotePage]],
  },
  {
    view: PageMap.SCHEDULED_MAINTENANCE_VIEW,
    Layout: withNavigation(ScheduledMaintenanceViewLayout),
    pages: [
      [
        PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE,
        ScheduledMaintenancePublicNotePage,
      ],
      [
        PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE,
        ScheduledMaintenanceInternalNotePage,
      ],
    ],
  },
  {
    view: PageMap.INCIDENT_EPISODE_VIEW,
    Layout: withNavigation(IncidentEpisodeViewLayout),
    pages: [
      [
        PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE,
        IncidentEpisodePublicNotePage,
      ],
      [
        PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE,
        IncidentEpisodeInternalNotePage,
      ],
    ],
  },
  {
    view: PageMap.ALERT_EPISODE_VIEW,
    Layout: withNavigation(AlertEpisodeViewLayout),
    pages: [
      [PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE, AlertEpisodeInternalNotePage],
    ],
  },
];

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
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </main>
  );
}

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
          {LAYOUTS.map(({ view, Layout, pages }) => {
            return (
              <Route
                key={view}
                path={RouteMap[view].toString()}
                element={<Layout />}
              >
                {pages.map(([pageKey, Page]) => {
                  return (
                    <Route
                      key={pageKey}
                      path={RouteUtil.getLastPathForKey(pageKey)}
                      element={<Page {...pageProps(pageKey)} />}
                    />
                  );
                })}
              </Route>
            );
          })}
          <Route path="*" element={<StubPage title="Not modelled" />} />
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
