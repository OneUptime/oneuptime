/*
 * Offline fixture for How to Reach Me's ladder (#6820, #7453), its inline
 * add (#7451) and the project's default ladder (#7449): the real User
 * Settings > How to Reach Me page, and the real Default Ladder for New
 * Members and Phone for People on Call cards of Project Settings >
 * Notification Channels.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The page, its ladder, the grid of cards behind it,
 * the confirmation that names the cards a ladder replaces, the inline add
 * (the phone form and its code, this browser, the app's codes) and the
 * default ladder's editor are the production ones from this branch.
 *
 * Steered by the query string:
 *   - person=one-ladder  (default) Maya: push, email, SMS and a phone call,
 *                       one ladder in every card - push and email at once,
 *                       SMS after 5 minutes, a call after 15
 *   - person=differing  Maya again, with two Incidents cards that differ: a
 *                       call at once more for Critical, and no call at all
 *                       for Minor
 *   - person=email-only Maya with only her email, in a project that asks
 *                       everyone on call for a phone method: the ladder's
 *                       inline add
 *   - page=default-ladder  Project Settings > Notification Channels' Default
 *                       Ladder for New Members and Phone for People on Call
 *                       (no default saved yet)
 *   - default=on        the project has a default ladder (#9445) - push and
 *                       SMS at once, then a call after 5 minutes - which
 *                       Maya's ladder is not: How to Reach Me offers Start
 *                       From the Project's Default
 *   - default=left-out  push after 5 minutes, then Telegram, which Maya has
 *                       not linked: started from, it names Telegram as left
 *                       out and keeps her own steps meanwhile
 *   - send=none         this server can send no email, SMS or calls right
 *                       now (GET /project-can-send, #9446); left out, it
 *                       can send everything, as OneUptime Cloud always can
 *   - theme=dark        the Dashboard's dark mode
 *   - lang=de           the Dashboard's German words (fa: Persian, right to
 *                       left, as the Dashboard draws it)
 *
 * Every ladder saved is recorded on `window.__fixture.ladderSaves` (the body
 * POST /paging-ladder/apply was sent), every update on
 * `window.__fixture.updates`, every create on `window.__fixture.creates` and
 * every code checked on `window.__fixture.verifications`, so the spec checks
 * what the page sent as well as what it drew. A ladder saved is applied as
 * the server applies it (PagingLadderService): every card but the ones kept
 * gets its steps; a number verified by its code gets a rule at once in
 * every card, as the server's verify path gives one when the project has no
 * default ladder.
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import OnCallRulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallRules";
import DefaultPagingLadderCard from "../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/DefaultPagingLadderCard";
import PhoneForOnCallCard from "../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PhoneForOnCallCard";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import { ProjectCanSendLoader } from "Common/UI/Utils/ServerSending";
import { toPagingLadderDefaultJSON } from "Common/Types/NotificationRule/PagingLadderDefault";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";

const PROJECT_ID = "10000000-0000-4000-8000-000000007453";
const USER_ID = "80000000-0000-4000-8000-000000007453";
// The code the fixture's SMS "sends", as the journeys' fixture has it.
const VERIFICATION_CODE = "123456";
const NOW = new Date("2026-11-18T10:00:00.000Z");

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "on-call-rules";
const person = ["one-ladder", "differing", "email-only"].includes(
  params.get("person"),
)
  ? params.get("person")
  : "one-ladder";
// The project's default ladder (#9445), by `default=`.
const DEFAULT_LADDERS = {
  on: [
    { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
    { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
    { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
  ],
  "left-out": [
    { channel: OnCallPageChannel.Push, notifyAfterMinutes: 5 },
    { channel: OnCallPageChannel.Telegram, notifyAfterMinutes: 10 },
  ],
};
const defaultLadder = DEFAULT_LADDERS[params.get("default")] || null;
// What this server can send right now (#9446), by `send=`.
const canSend =
  params.get("send") === "none"
    ? { email: false, sms: false, call: false }
    : { email: true, sms: true, call: true };
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  ladderSaves: [],
  updates: [],
  creates: [],
  verifications: [],
};

let counter = 0;

// A new row's id, counted, so two runs make the same ones.
function nextId(prefix) {
  counter += 1;
  return `${prefix}-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function owned(record) {
  record.projectId = new ObjectID(PROJECT_ID);
  record.userId = new ObjectID(USER_ID);
  return record;
}

function incidentSeverity(id, name, color, order) {
  const record = new IncidentSeverity();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.color = new Color(color);
  record.order = order;
  record.isArchived = false;
  return record;
}

function alertSeverity(id, name, color, order) {
  const record = new AlertSeverity();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.color = new Color(color);
  record.order = order;
  record.isArchived = false;
  return record;
}

const SEVERITY_IDS = {
  critical: "20000000-0000-4000-8000-000000007453",
  major: "20000000-0000-4000-8000-000000007454",
  minor: "20000000-0000-4000-8000-000000007455",
  high: "21000000-0000-4000-8000-000000007453",
  low: "21000000-0000-4000-8000-000000007454",
};

const incidentSeverities = [
  incidentSeverity(SEVERITY_IDS.critical, "Critical", "#b70400", 1),
  incidentSeverity(SEVERITY_IDS.major, "Major", "#fd625e", 2),
  incidentSeverity(SEVERITY_IDS.minor, "Minor", "#ffbf53", 3),
];

const alertSeverities = [
  alertSeverity(SEVERITY_IDS.high, "High", "#dc2626", 1),
  alertSeverity(SEVERITY_IDS.low, "Low", "#f59e0b", 2),
];

// Maya's ways to be reached: her email, her number for SMS and calls, her iPhone.
const METHOD_IDS = {
  email: "23000000-0000-4000-8000-000000007453",
  sms: "23000000-0000-4000-8000-000000007454",
  call: "23000000-0000-4000-8000-000000007455",
  push: "23000000-0000-4000-8000-000000007456",
};

const PHONE = "+15550104821";

function email() {
  const record = owned(new UserEmail());
  record._id = METHOD_IDS.email;
  record.email = "maya.chen@acme-commerce.example";
  record.isVerified = true;
  return record;
}

function sms(id, phone, isVerified) {
  const record = owned(new UserSMS());
  record._id = id;
  record.phone = new Phone(phone);
  record.isVerified = isVerified;
  return record;
}

function call(id, phone, isVerified) {
  const record = owned(new UserCall());
  record._id = id;
  record.phone = new Phone(phone);
  record.isVerified = isVerified;
  return record;
}

function iPhone() {
  const record = owned(new UserPush());
  record._id = METHOD_IDS.push;
  record.deviceName = "Maya's iPhone";
  record.deviceType = PushDeviceType.iOS;
  record.isVerified = true;
  return record;
}

const RECORDS = {
  IncidentSeverity: incidentSeverities,
  AlertSeverity: alertSeverities,
  UserEmail: [email()],
  UserSMS: person === "email-only" ? [] : [sms(METHOD_IDS.sms, PHONE, true)],
  UserCall: person === "email-only" ? [] : [call(METHOD_IDS.call, PHONE, true)],
  UserPush: person === "email-only" ? [] : [iPhone()],
  UserNotificationRule: [],
  Project: [],
};

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme Commerce";
project.enableSmsNotifications = true;
project.enableCallNotifications = true;
project.requirePhoneMethodForOnCall = person === "email-only";
project.defaultPagingLadder = defaultLadder
  ? toPagingLadderDefaultJSON(defaultLadder)
  : null;
RECORDS.Project.push(project);

// The method each column of a rule names, by its id.
const METHOD_COLUMNS = {
  userEmailId: { table: "UserEmail", relation: "userEmail" },
  userSmsId: { table: "UserSMS", relation: "userSms" },
  userCallId: { table: "UserCall", relation: "userCall" },
  userPushId: { table: "UserPush", relation: "userPush" },
};

// The four kinds of on-call page, each with a card per severity.
const KINDS = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityColumn: "incidentSeverityId",
    severities: incidentSeverities,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityColumn: "incidentSeverityId",
    severities: incidentSeverities,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityColumn: "alertSeverityId",
    severities: alertSeverities,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityColumn: "alertSeverityId",
    severities: alertSeverities,
  },
];

function findRecord(table, id) {
  return (RECORDS[table] || []).find((record) => {
    return idOf(record._id) === idOf(id);
  });
}

function rule(values) {
  const record = owned(new UserNotificationRule());
  record._id = nextId("24000000");
  record.ruleType = values.ruleType;
  record[values.severityColumn] = new ObjectID(values.severityId);
  record.notifyAfterMinutes = values.notifyAfterMinutes;
  record.isOptOut = false;
  const method = METHOD_COLUMNS[values.methodColumn];
  record[values.methodColumn] = new ObjectID(values.methodId);
  record[method.relation] = findRecord(method.table, values.methodId);
  if (values.methodColumn === "userPushId") {
    record.pushNotificationLevel =
      values.pushNotificationLevel || PushNotificationLevel.Critical;
    record.repeatEveryMinutes = values.repeatEveryMinutes || 0;
  }
  return record;
}

// Push and email at once, SMS after 5 minutes, a call after 15.
const MAYAS_LADDER = [
  {
    methodColumn: "userPushId",
    methodId: METHOD_IDS.push,
    notifyAfterMinutes: 0,
  },
  {
    methodColumn: "userEmailId",
    methodId: METHOD_IDS.email,
    notifyAfterMinutes: 0,
  },
  {
    methodColumn: "userSmsId",
    methodId: METHOD_IDS.sms,
    notifyAfterMinutes: 5,
  },
  {
    methodColumn: "userCallId",
    methodId: METHOD_IDS.call,
    notifyAfterMinutes: 15,
  },
];

const EMAIL_ONLY = [
  {
    methodColumn: "userEmailId",
    methodId: METHOD_IDS.email,
    notifyAfterMinutes: 0,
  },
];

function stepsOfCard(kind, severityId) {
  if (person === "email-only") {
    return EMAIL_ONLY;
  }

  if (
    person === "differing" &&
    kind.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT
  ) {
    // Critical calls at once too; Minor never calls.
    if (severityId === SEVERITY_IDS.critical) {
      return [
        ...MAYAS_LADDER,
        {
          methodColumn: "userCallId",
          methodId: METHOD_IDS.call,
          notifyAfterMinutes: 0,
        },
      ];
    }

    if (severityId === SEVERITY_IDS.minor) {
      return MAYAS_LADDER.filter((step) => {
        return step.methodColumn !== "userCallId";
      });
    }
  }

  return MAYAS_LADDER;
}

function cardKey(ruleType, severityId) {
  return `${ruleType}|${idOf(severityId)}`;
}

function ruleCardKey(record) {
  return cardKey(
    record.ruleType,
    record.incidentSeverityId || record.alertSeverityId,
  );
}

// Every card's rules, made from its steps.
function rulesOfCard(kind, severityId, steps) {
  return steps.map((step) => {
    return rule({
      ...step,
      ruleType: kind.ruleType,
      severityColumn: kind.severityColumn,
      severityId: severityId,
    });
  });
}

for (const kind of KINDS) {
  for (const severity of kind.severities) {
    RECORDS.UserNotificationRule.push(
      ...rulesOfCard(kind, severity._id, stepsOfCard(kind, severity._id)),
    );
  }
}

// The columns a query names by id.
const ID_COLUMNS = [
  "userId",
  "incidentSeverityId",
  "alertSeverityId",
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userPushId",
];

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return String(value._id).toLowerCase();
  }
  return String(value).toLowerCase();
}

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null) {
      continue;
    }
    if (key === "projectId") {
      if (idOf(record.projectId) !== idOf(condition)) {
        return false;
      }
      continue;
    }
    if (key === "_id") {
      const wanted =
        condition instanceof Includes
          ? condition.values.map(idOf)
          : [idOf(condition)];
      if (!wanted.includes(idOf(record._id))) {
        return false;
      }
      continue;
    }
    if (typeof condition === "boolean") {
      if (Boolean(record[key]) !== condition) {
        return false;
      }
      continue;
    }
    if (ID_COLUMNS.includes(key)) {
      if (idOf(record[key]) !== idOf(condition)) {
        return false;
      }
      continue;
    }
    if (key === "ruleType") {
      if (record.ruleType !== condition) {
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
    return first[field] > second[field]
      ? direction
      : first[field] < second[field]
        ? -direction
        : 0;
  });
}

function ok(data) {
  return new HTTPResponse(200, JSON.parse(JSON.stringify(data || {})), {});
}

function fail(statusCode, message) {
  return new HTTPErrorResponse(statusCode, { message }, {});
}

User.isMasterAdmin = () => false;
// GET /project-can-send's three yes-or-noes, as a member reads them (#9446).
ProjectCanSendLoader.load = async () => {
  return { ...canSend };
};
User.getUserId = () => new ObjectID(USER_ID);
/*
 * The project's permissions and the global ones, as the Dashboard joins
 * them: a Project Owner, who may change the project's default ladder, and
 * reads their own notification methods by CurrentUser.
 */
PermissionUtil.getAllPermissions = () => [
  Permission.ProjectOwner,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: [
    {
      _type: "UserPermission",
      permission: Permission.ProjectOwner,
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

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  return findRecord(tableName, options.id) || null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  const items = sortRows(
    (RECORDS[tableName] || []).filter((record) => {
      return matchesQuery(record, options.query);
    }),
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
  return (RECORDS[tableName] || []).filter((record) => {
    return matchesQuery(record, options.query);
  }).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.updateById = async (options) => {
  const tableName = new options.modelType().tableName;
  window.__fixture.updates.push({
    tableName,
    id: idOf(options.id),
    data: JSON.parse(JSON.stringify(options.data || {})),
  });
  const record = findRecord(tableName, options.id);
  if (!record) {
    throw new Error(`${tableName} not found.`);
  }
  for (const [key, value] of Object.entries(options.data || {})) {
    record[key] = value;
  }
  return { data: {} };
};

/*
 * A number added: for SMS it waits for its code; for calls, once verified
 * for SMS, it is verified at once (UserCallService.isNumberVerifiedForSms),
 * and gets its rule at once in every card, as verifying does.
 */
ModelAPI.create = async (options) => {
  const tableName = new options.modelType().tableName;
  const phone = options.model.phone ? options.model.phone.toString() : "";
  window.__fixture.creates.push({ tableName, phone });

  if (tableName === "UserSMS") {
    const record = sms(nextId("25000000"), phone, false);
    RECORDS.UserSMS.push(record);
    return { data: { id: new ObjectID(record._id), isVerified: false } };
  }

  if (tableName === "UserCall") {
    const isVerified = RECORDS.UserSMS.some((candidate) => {
      return candidate.isVerified && candidate.phone.toString() === phone;
    });
    const record = call(nextId("25000000"), phone, isVerified);
    RECORDS.UserCall.push(record);
    if (isVerified) {
      addRulesAtOnce("userCallId", record._id);
    }
    return { data: { id: new ObjectID(record._id), isVerified } };
  }

  throw new Error(`${tableName} cannot be added here.`);
};

ModelAPI.deleteItem = async () => {
  throw new Error("Nothing is deleted here.");
};

// A method just verified: a rule at once in every card, as the server's verify path adds.
function addRulesAtOnce(methodColumn, methodId) {
  for (const kind of KINDS) {
    for (const severity of kind.severities) {
      RECORDS.UserNotificationRule.push(
        ...rulesOfCard(kind, severity._id, [
          { methodColumn, methodId, notifyAfterMinutes: 0 },
        ]),
      );
    }
  }
}

/*
 * A ladder saved, applied as PagingLadderService applies it: every card but
 * the ones kept gets exactly the ladder's steps.
 */
function applyLadder(body) {
  const kept = new Set(
    (body.keepCards || []).map((card) => {
      return cardKey(card.ruleType, card.severityId);
    }),
  );
  const before = RECORDS.UserNotificationRule.length;
  RECORDS.UserNotificationRule = RECORDS.UserNotificationRule.filter(
    (record) => {
      return kept.has(ruleCardKey(record));
    },
  );
  const deletedCount = before - RECORDS.UserNotificationRule.length;
  let createdCount = 0;

  for (const kind of KINDS) {
    for (const severity of kind.severities) {
      if (kept.has(cardKey(kind.ruleType, severity._id))) {
        continue;
      }
      const made = rulesOfCard(kind, severity._id, body.steps || []);
      createdCount += made.length;
      RECORDS.UserNotificationRule.push(...made);
    }
  }

  return { createdCount, updatedCount: 0, deletedCount, unchangedCount: 0 };
}

const CODE_ROUTE =
  /\/(user-sms|user-call)\/(verification-status|resend-verification-code|verify)$/;

API.post = async (options) => {
  const url = options.url.toString();
  const body = options.data || {};

  if (url.endsWith("/paging-ladder/apply")) {
    const sent = JSON.parse(JSON.stringify(body));
    window.__fixture.ladderSaves.push(sent);
    return ok(applyLadder(sent));
  }

  const code = CODE_ROUTE.exec(url);

  if (code) {
    const table = code[1] === "user-sms" ? "UserSMS" : "UserCall";
    const record = findRecord(table, body.itemId);

    if (code[2] === "verification-status") {
      return ok({
        isVerified: Boolean(record && record.isVerified),
        codeState: "active",
        codeSentAt: NOW.toISOString(),
        codeExpiresAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
        resendAvailableInSeconds: 0,
        cannotSendReason: null,
      });
    }

    if (code[2] === "resend-verification-code") {
      return ok({});
    }

    window.__fixture.verifications.push({ table, code: String(body.code) });

    if (String(body.code) !== VERIFICATION_CODE) {
      return fail(400, "Invalid verification code.");
    }

    if (record && !record.isVerified) {
      record.isVerified = true;
      addRulesAtOnce(
        table === "UserSMS" ? "userSmsId" : "userCallId",
        record._id,
      );
    }

    return ok({});
  }

  return ok({ data: [], count: 0 });
};
API.get = async () => {
  return ok({ data: [], count: 0 });
};

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// Notification Channels' More settings, opened at the two cards of #7449.
function ProjectPagingDefaults() {
  const projectId = new ObjectID(PROJECT_ID);
  return (
    <div className="flex flex-col gap-6">
      <div id="default-ladder-for-new-members">
        <DefaultPagingLadderCard projectId={projectId} />
      </div>
      <div id="phone-for-people-on-call">
        <PhoneForOnCallCard projectId={projectId} />
      </div>
    </div>
  );
}

const PAGES = {
  "on-call-rules": {
    component: OnCallRulesPage,
    trail: ["User Settings", "How to Reach Me"],
  },
  "default-ladder": {
    component: ProjectPagingDefaults,
    trail: ["Project Settings", "Notification Channels", "More settings"],
  },
};

function Fixture() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page] || PAGES["on-call-rules"];
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
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
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

// Without transitions, as the Dashboard routes (Dashboard/src/Index.tsx).
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Fixture />
  </BrowserRouter>,
);
