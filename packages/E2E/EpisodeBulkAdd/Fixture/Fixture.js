/*
 * Offline fixture for adding alerts and incidents to episodes: the real
 * Alerts and Incidents lists (their Bulk Actions "Add to Existing Episode"
 * and "Add to New Episode") and an episode's own Alerts / Incidents page
 * ("Add Alerts" / "Add Incidents", and Remove).
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, their ModelTable, the bulk bar and its
 * result, the dialogs and the picker list are the production ones from this
 * branch. The add request is answered as the server answers it
 * (EpisodeMembersAdd): what was added, what was in the episode already, and
 * what was not added and why.
 *
 * Steered by the query string:
 *   - page=alerts                  the Alerts list (the default)
 *   - page=incidents               the Incidents list
 *   - page=alert-episode           an alert episode's Alerts page; the
 *                                  episode is the one the path names
 *                                  (.../alerts/episodes/<id>/alerts)
 *   - page=incident-episode        an incident episode's Incidents page
 *                                  (.../incidents/episodes/<id>/incidents)
 *   - role=viewer                  may read alerts, incidents and episodes,
 *                                  may add to none (Viewer)
 *   - role=adder                   may add to an episode but may not create
 *                                  one (Read Alert, Read Incident, Read and
 *                                  Create Alert / Incident Episode Member,
 *                                  Read Alert / Incident Episode)
 *   - refuse=<ids>                 alerts or incidents (comma-separated
 *                                  ids) the server does not add, as it
 *                                  answers one the person cannot see
 *   - failNew=1                    creating an episode is refused
 *   - noEpisodes=1                 the project has no episodes yet
 *   - delay=<ms>                   how long the add takes, to see it run
 *   - slow=<tables>&slowMs=<ms>    list reads of these tables (comma-
 *                                  separated, e.g. AlertEpisode,Alert) take
 *                                  this long, to see the dialogs load
 *   - fail=<tables>                list reads of these tables fail, to see
 *                                  the dialogs' error and Retry
 *   - many=<n>                     n more alerts and incidents (ALT-100 on),
 *                                  past what a dialog lists before a search
 *   - long=1                       long titles, the way some are written
 *   - onlyMembers=1                every alert and incident is in episode
 *                                  12 already: nothing left to add
 *   - lang=de|ja                   the Dashboard's German or Japanese words
 *   - theme=dark                   the dark theme
 *
 * Every add request is recorded on `window.__fixture.adds`, every episode
 * created on `window.__fixture.creates`, every delete on
 * `window.__fixture.deletes` and every list request on
 * `window.__fixture.listRequests`, so the spec checks what the page sent,
 * not only what it drew.
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
import AlertsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Alerts";
import IncidentsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Incidents";
import AlertEpisodeAlertsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Alerts";
import IncidentEpisodeIncidentsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Incidents";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import UserModel from "Common/Models/DatabaseModels/User";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import {
  ALERT_NOT_FOUND_REASON,
  INCIDENT_NOT_FOUND_REASON,
} from "Common/Types/Episode/EpisodeMembersAdd";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "alerts";
const role = params.get("role") || "owner";
const refused = (params.get("refuse") || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter(Boolean);
const failNew = params.get("failNew") === "1";
const noEpisodes = params.get("noEpisodes") === "1";
const delay = Math.max(0, Number(params.get("delay") || 0));
const listTables = (name) =>
  (params.get(name) || "")
    .split(",")
    .map((table) => table.trim())
    .filter(Boolean);
const slowTables = listTables("slow");
const slowMs = Math.max(0, Number(params.get("slowMs") || 2000));
const failTables = listTables("fail");
const many = Math.min(400, Math.max(0, Number(params.get("many") || 0)));
const long = params.get("long") === "1";
const onlyMembers = params.get("onlyMembers") === "1";
const LONG_TITLE =
  "Checkout API returns 502 for card payments in eu-west-1 while the payment provider's webhook queue is backed up";
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

// A fixed "now", so the relative times read the same on every run.
const NOW = new Date("2026-10-14T12:00:00.000Z").getTime();
const minutesAgo = (minutes) => new Date(NOW - minutes * 60 * 1000);

function model(Type, values) {
  const record = new Type();
  Object.assign(record, values);
  return record;
}

const PERSON = model(UserModel, {
  _id: USER_ID,
  name: "Jane Doe",
  email: "jane@example.com",
});

/*
 * The kinds: what an alert and an incident differ in, as the fixture holds
 * them. The ids are uuids: the server refuses anything else.
 */
function makeKind(kind) {
  const isAlert = kind === "alert";
  const prefix = isAlert ? "ALT-" : "INC-";
  const episodePrefix = isAlert ? "AE-" : "IE-";
  const idBase = isAlert ? "2" : "3";
  const StateType = isAlert ? AlertState : IncidentState;
  const SeverityType = isAlert ? AlertSeverity : IncidentSeverity;

  const states = [
    model(StateType, {
      _id: `${idBase}1000000-0000-4000-8000-000000000001`,
      name: "Created",
      color: new Color("#ef4444"),
      order: 1,
      isCreatedState: true,
    }),
    model(StateType, {
      _id: `${idBase}1000000-0000-4000-8000-000000000002`,
      name: "Acknowledged",
      color: new Color("#f59e0b"),
      order: 2,
      isAcknowledgedState: true,
    }),
    model(StateType, {
      _id: `${idBase}1000000-0000-4000-8000-000000000003`,
      name: "Resolved",
      color: new Color("#10b981"),
      order: 3,
      isResolvedState: true,
    }),
  ];

  const severities = [
    model(SeverityType, {
      _id: `${idBase}2000000-0000-4000-8000-000000000001`,
      name: "Critical",
      color: new Color("#dc2626"),
      order: 1,
    }),
    model(SeverityType, {
      _id: `${idBase}2000000-0000-4000-8000-000000000002`,
      name: "Major",
      color: new Color("#f97316"),
      order: 2,
    }),
    model(SeverityType, {
      _id: `${idBase}2000000-0000-4000-8000-000000000003`,
      name: "Minor",
      color: new Color("#64748b"),
      order: 3,
    }),
  ];

  const [created, acknowledged, resolved] = states;
  const [critical, major, minor] = severities;

  const recordId = (number) =>
    `${idBase}3000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const episodeId = (number) =>
    `${idBase}4000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

  const RecordType = isAlert ? Alert : Incident;
  const EpisodeType = isAlert ? AlertEpisode : IncidentEpisode;
  const MemberType = isAlert ? AlertEpisodeMember : IncidentEpisodeMember;

  const numberField = isAlert ? "alertNumber" : "incidentNumber";
  const numberWithPrefixField = isAlert
    ? "alertNumberWithPrefix"
    : "incidentNumberWithPrefix";
  const stateField = isAlert ? "currentAlertState" : "currentIncidentState";
  const severityField = isAlert ? "alertSeverity" : "incidentSeverity";
  const severityIdField = isAlert ? "alertSeverityId" : "incidentSeverityId";
  const episodeIdField = isAlert ? "alertEpisodeId" : "incidentEpisodeId";
  const countField = isAlert ? "alertCount" : "incidentCount";
  const memberRecordField = isAlert ? "alert" : "incident";
  const memberRecordIdField = isAlert ? "alertId" : "incidentId";

  function record(number, title, state, severity, minutes, extra) {
    return model(RecordType, {
      _id: recordId(number),
      projectId: new ObjectID(PROJECT_ID),
      title: title,
      description: "",
      [numberField]: number,
      [numberWithPrefixField]: `${prefix}${number}`,
      [stateField]: state,
      [`${stateField}Id`]: new ObjectID(state._id),
      [severityField]: severity,
      [severityIdField]: new ObjectID(severity._id),
      createdAt: minutesAgo(minutes),
      declaredAt: minutesAgo(minutes),
      isPrivate: false,
      labels: [],
      ...(extra || {}),
    });
  }

  const records = [
    record(63, "Checkout API is offline", created, critical, 3),
    record(62, "Checkout API p95 latency above 2 s", created, major, 9),
    record(61, "Payment provider webhook failures", acknowledged, major, 14),
    record(60, "Disk usage above 90% on db-2", created, minor, 25),
    record(59, "Payroll export job failing", created, critical, 40, {
      isPrivate: true,
    }),
    record(58, "Cart service restarts", acknowledged, minor, 55),
    record(57, "Search index lagging behind", resolved, minor, 70),
    record(56, "CDN error rate above 1%", resolved, major, 95),
  ];

  if (long) {
    records[1].title = LONG_TITLE;
  }

  // More than a dialog lists before a search: older, numbered from 100.
  for (let index = 0; index < many; index++) {
    const severity = [critical, major, minor][index % 3];
    records.push(
      record(
        100 + index,
        `Synthetic check ${100 + index} failing in us-east-1`,
        index % 4 === 3 ? acknowledged : created,
        severity,
        120 + index * 5,
      ),
    );
  }

  function episode(number, title, state, severity, minutes, isResolved) {
    return model(EpisodeType, {
      _id: episodeId(number),
      projectId: new ObjectID(PROJECT_ID),
      title: title,
      episodeNumber: number,
      episodeNumberWithPrefix: `${episodePrefix}${number}`,
      [stateField]: state,
      [severityField]: severity,
      [countField]: 0,
      createdAt: minutesAgo(minutes),
      resolvedAt: isResolved ? minutesAgo(minutes - 30) : undefined,
      isPrivate: false,
    });
  }

  const episodes = noEpisodes
    ? []
    : [
        episode(12, "Checkout degradation", created, critical, 20, false),
        episode(11, "Database latency", acknowledged, major, 120, false),
        episode(9, "Network blip in eu-west", resolved, minor, 600, true),
      ];

  if (long && episodes.length > 0) {
    episodes[1].title =
      "Database latency across every read replica in eu-west-1 after the storage migration";
  }

  const members = [];

  function addMember(episodeRecord, memberRecord, minutes) {
    members.push(
      model(MemberType, {
        _id: ObjectID.generate().toString(),
        projectId: new ObjectID(PROJECT_ID),
        [isAlert ? "alertEpisodeId" : "incidentEpisodeId"]: new ObjectID(
          episodeRecord._id,
        ),
        [memberRecordIdField]: new ObjectID(memberRecord._id),
        [memberRecordField]: memberRecord,
        addedBy: "rule",
        addedAt: minutesAgo(minutes),
        createdAt: minutesAgo(minutes),
      }),
    );
    memberRecord[episodeIdField] = new ObjectID(episodeRecord._id);
    episodeRecord[countField] = (episodeRecord[countField] || 0) + 1;
  }

  if (!noEpisodes) {
    // AE-12 holds ALT-61 already; ALT-58 is in AE-11.
    addMember(episodes[0], records[2], 14);
    addMember(episodes[1], records[5], 55);
    addMember(episodes[2], records[6], 70);
    addMember(episodes[2], records[7], 95);
  }

  // Nothing left to add to episode 12: every other one is gone.
  if (onlyMembers) {
    const kept = records.filter(
      (candidate) => idOf(candidate[episodeIdField]) === episodeId(12),
    );
    records.splice(0, records.length, ...kept);
  }

  return {
    kind,
    isAlert,
    states,
    severities,
    records,
    episodes,
    members,
    RecordType,
    EpisodeType,
    MemberType,
    episodePrefix,
    numberField,
    stateField,
    severityField,
    severityIdField,
    episodeIdField,
    countField,
    memberRecordField,
    memberRecordIdField,
    episodeIdKey: isAlert ? "alertEpisodeId" : "incidentEpisodeId",
    idsKey: isAlert ? "alertIds" : "incidentIds",
    idsToAddKey: isAlert ? "alertIdsToAdd" : "incidentIdsToAdd",
    notFoundReason: isAlert
      ? ALERT_NOT_FOUND_REASON
      : INCIDENT_NOT_FOUND_REASON,
    nextEpisodeNumber: 13,
  };
}

const KINDS = {
  alert: makeKind("alert"),
  incident: makeKind("incident"),
};

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

window.__fixture = {
  listRequests: [],
  adds: [],
  creates: [],
  deletes: [],
};

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }
  return value.toString().toLowerCase();
}

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (condition instanceof MultiSearch) {
      const needle = condition.value.toLowerCase();
      const hit = condition.fields.some((field) =>
        String(record[field] ?? "")
          .toLowerCase()
          .includes(needle),
      );
      if (!hit) {
        return false;
      }
      continue;
    }
    if (condition instanceof IsNull) {
      if (record[key]) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotNull) {
      if (!record[key]) {
        return false;
      }
      continue;
    }
    if (condition instanceof Includes) {
      const ids = condition.values.map(idOf);
      if (!ids.includes(idOf(record[key]))) {
        return false;
      }
      continue;
    }
    if (condition instanceof IncludesNone) {
      const ids = condition.values.map(idOf);
      if (ids.includes(idOf(record[key]))) {
        return false;
      }
      continue;
    }
    if (
      (key === "_id" || key.endsWith("Id")) &&
      (condition instanceof ObjectID || typeof condition === "string")
    ) {
      if (idOf(record[key]) !== idOf(condition)) {
        return false;
      }
      continue;
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
      first[field] instanceof Date ? first[field].getTime() : first[field];
    const b =
      second[field] instanceof Date ? second[field].getTime() : second[field];
    if (a === b) {
      return 0;
    }
    if (a === undefined || a === null) {
      return 1;
    }
    if (b === undefined || b === null) {
      return -1;
    }
    return a > b ? direction : -direction;
  });
}

function recordsOf(tableName) {
  for (const kind of Object.values(KINDS)) {
    const recordTable = kind.isAlert ? "Alert" : "Incident";
    if (tableName === recordTable) {
      return kind.records;
    }
    if (tableName === `${recordTable}State`) {
      return kind.states;
    }
    if (tableName === `${recordTable}Severity`) {
      return kind.severities;
    }
    if (tableName === `${recordTable}Episode`) {
      return kind.episodes;
    }
    if (tableName === `${recordTable}EpisodeMember`) {
      return kind.members;
    }
  }
  return [];
}

function kindOfEpisodeTable(tableName) {
  return tableName === "AlertEpisode" ? KINDS.alert : KINDS.incident;
}

/*
 * The person: a project owner by default; a Viewer, who may add to no
 * episode; or someone who may add to an episode but not create one.
 */
const ADDER_PERMISSIONS = [
  Permission.ReadAlert,
  Permission.ReadIncident,
  Permission.ReadAlertEpisode,
  Permission.ReadIncidentEpisode,
  Permission.ReadAlertEpisodeMember,
  Permission.ReadIncidentEpisodeMember,
  Permission.CreateAlertEpisodeMember,
  Permission.CreateIncidentEpisodeMember,
];

const heldPermissions =
  role === "viewer"
    ? [Permission.Viewer]
    : role === "adder"
      ? ADDER_PERMISSIONS
      : [Permission.ProjectOwner];

User.isMasterAdmin = () => false;
User.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => heldPermissions;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: heldPermissions.map((permission) => ({
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  })),
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

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  return recordsOf(tableName).find((record) => idOf(record._id) === id) || null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  window.__fixture.listRequests.push({
    tableName,
    query: serialize(options.query),
    skip,
    limit,
  });

  if (slowTables.includes(tableName)) {
    await new Promise((resolve) => {
      setTimeout(resolve, slowMs);
    });
  }

  if (failTables.includes(tableName)) {
    throw new HTTPErrorResponse(
      500,
      { message: "The server could not be reached. Try again." },
      {},
    );
  }

  const items = sortRows(
    recordsOf(tableName).filter((record) =>
      matchesQuery(record, options.query),
    ),
    options.sort,
  );

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const tableName = new options.modelType().tableName;
  return recordsOf(tableName).filter((record) =>
    matchesQuery(record, options.query),
  ).length;
};

function wait() {
  if (!delay) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/*
 * Adds the records to the episode as the member services do: one member
 * each, added by the person, the record pointed at the episode, the
 * episode's count kept.
 */
function addMembers(kind, episodeRecord, ids) {
  for (const id of ids) {
    const memberRecord = kind.records.find(
      (candidate) => idOf(candidate._id) === id,
    );
    kind.members.push(
      model(kind.MemberType, {
        _id: ObjectID.generate().toString(),
        projectId: new ObjectID(PROJECT_ID),
        [kind.isAlert ? "alertEpisodeId" : "incidentEpisodeId"]: new ObjectID(
          episodeRecord._id,
        ),
        [kind.memberRecordIdField]: new ObjectID(memberRecord._id),
        [kind.memberRecordField]: memberRecord,
        addedBy: "manual",
        addedByUserId: new ObjectID(USER_ID),
        addedByUser: PERSON,
        addedAt: new Date(NOW),
        createdAt: new Date(NOW),
      }),
    );
    memberRecord[kind.episodeIdField] = new ObjectID(episodeRecord._id);
    episodeRecord[kind.countField] = (episodeRecord[kind.countField] || 0) + 1;
  }
}

/*
 * A new episode, with the records it is for: refused as a whole when one of
 * them is refused, as the server refuses it before the episode exists.
 */
ModelAPI.create = async (options) => {
  const tableName = new options.modelType().tableName;

  if (tableName !== "AlertEpisode" && tableName !== "IncidentEpisode") {
    throw new Error(`The fixture does not model creating ${tableName}.`);
  }

  const kind = kindOfEpisodeTable(tableName);
  const ids = (options.miscDataProps?.[kind.idsToAddKey] || []).map(idOf);
  const values = options.model;

  window.__fixture.creates.push({
    tableName,
    title: values.title,
    severityId: idOf(values[kind.severityIdField]),
    isManuallyCreated: values.isManuallyCreated === true,
    ids,
  });

  await wait();

  if (failNew || ids.some((id) => refused.includes(id))) {
    throw new HTTPErrorResponse(
      400,
      {
        message: `Some of the ${kind.isAlert ? "alerts" : "incidents"} to add to the episode do not exist in this project, or you do not have access to them.`,
      },
      {},
    );
  }

  const number = kind.nextEpisodeNumber++;
  const severity = kind.severities.find(
    (candidate) => idOf(candidate._id) === idOf(values[kind.severityIdField]),
  );
  const episodeRecord = model(kind.EpisodeType, {
    _id: ObjectID.generate().toString(),
    projectId: new ObjectID(PROJECT_ID),
    title: values.title,
    episodeNumber: number,
    episodeNumberWithPrefix: `${kind.episodePrefix}${number}`,
    [kind.stateField]: kind.states[0],
    [kind.severityField]: severity,
    [kind.countField]: 0,
    createdAt: new Date(NOW),
    isPrivate: false,
  });
  kind.episodes.unshift(episodeRecord);
  addMembers(kind, episodeRecord, ids);

  return {
    data: {
      _id: episodeRecord._id,
      episodeNumber: number,
      episodeNumberWithPrefix: episodeRecord.episodeNumberWithPrefix,
    },
  };
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.deletes.push({ tableName, id });
  const rows = recordsOf(tableName);
  const index = rows.findIndex((record) => idOf(record._id) === id);
  if (index === -1) {
    throw new Error("Not found.");
  }
  rows.splice(index, 1);
};

const ADD_ROUTES = {
  "/alert-episode-member/add-alerts": KINDS.alert,
  "/incident-episode-member/add-incidents": KINDS.incident,
};

API.get = async () => ({ data: { data: [], count: 0 } });

/*
 * POST <add route>: what the member services answer. A refused id is
 * answered like one that does not exist; one in the episode already is left
 * as it is.
 */
API.post = async (options) => {
  const url = options.url.toString();
  const route = Object.keys(ADD_ROUTES).find((candidate) =>
    url.endsWith(candidate),
  );

  if (!route) {
    return { data: { data: [], count: 0 } };
  }

  const kind = ADD_ROUTES[route];
  const episodeId = idOf(options.data[kind.episodeIdKey]);
  const ids = (options.data[kind.idsKey] || []).map(idOf);

  window.__fixture.adds.push({
    route,
    episodeId,
    ids,
    headers: options.headers || {},
  });

  await wait();

  const episodeRecord = kind.episodes.find(
    (candidate) => idOf(candidate._id) === episodeId,
  );

  if (!episodeRecord) {
    return new HTTPErrorResponse(
      400,
      {
        message: `The episode to add the ${kind.isAlert ? "alerts" : "incidents"} to does not exist in this project, or you do not have access to it.`,
      },
      {},
    );
  }

  const result = { added: [], alreadyInEpisode: [], notAdded: [] };

  for (const id of ids) {
    if (refused.includes(id)) {
      result.notAdded.push({ id, reason: kind.notFoundReason });
      continue;
    }

    const isMember = kind.members.some(
      (member) =>
        idOf(member[kind.memberRecordIdField]) === id &&
        idOf(member[kind.isAlert ? "alertEpisodeId" : "incidentEpisodeId"]) ===
          episodeId,
    );

    if (isMember) {
      result.alreadyInEpisode.push(id);
      continue;
    }

    addMembers(kind, episodeRecord, [id]);
    result.added.push(id);
  }

  return { data: result };
};

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
  alerts: { component: AlertsPage, trail: ["Alerts"] },
  incidents: { component: IncidentsPage, trail: ["Incidents"] },
  "alert-episode": {
    component: AlertEpisodeAlertsPage,
    trail: ["Alerts", "Episodes", "AE-12", "Alerts"],
  },
  "incident-episode": {
    component: IncidentEpisodeIncidentsPage,
    trail: ["Incidents", "Episodes", "IE-12", "Incidents"],
  },
};

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page] || PAGES.alerts;
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        {trail.map((title, index) => (
          <React.Fragment key={`${title}-${index}`}>
            {index > 0 ? <span className="mx-2">/</span> : null}
            {title}
          </React.Fragment>
        ))}
      </div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
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
