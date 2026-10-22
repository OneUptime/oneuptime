/*
 * Offline fixture for On-Call > Schedules (Pages/OnCallDuty/
 * OnCallDutySchedules) and its Owner chip - "I can't filter by Owner/team on
 * /on-call-duty/schedules" - in the On-Call side menu as the Dashboard frames
 * it. The page, the chips, the table and the Owners column are the
 * production ones from this branch; only the ModelAPI / API data boundary
 * and the signed-in user's permissions are replaced.
 *
 * The project: six on-call schedules, owned by
 *
 *   Payments Primary     the Payments team
 *   SRE Weekdays         the SRE team
 *   SRE Weekends         the SRE team and Ada Lovelace
 *   Database On-Call     Ada Lovelace
 *   Bo's Escalation      Bo Chen, a member of the SRE team
 *   Nights               nobody
 *
 * Ada and Bo are both members of the SRE team. A list read answers the Owner
 * chip's filter (`owners`, an OwnedBy) as the server does: a team's
 * schedules are the ones the team owns - not its members' - a person's the
 * ones they own, "is not" the rest (unowned ones too), "is empty" the
 * unowned, "is not empty" the owned.
 *
 * Steered by the query string:
 *   - lang=de     the Dashboard's German words
 *   - theme=dark  dark mode (set before the bundle by server.js)
 *   - delay=<ms>  the Owner chip's people and teams take this long to read
 *
 * Recorded on window.__fixture: every list read (`listRequests`, its query
 * as the API would carry it) and every read of a table this fixture does not
 * model (`unhandled`; the spec fails on any).
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
import OnCallDutySchedulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";
import OnCallDutySideMenu from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import TableView from "Common/Models/DatabaseModels/TableView";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import JSONFunctions from "Common/Types/JSONFunctions";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import OwnedBy, { OwnedByMatch } from "Common/Types/BaseDatabase/OwnedBy";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import Page from "Common/UI/Components/Page/Page";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000f1";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") === "de" ? "de" : "en";
// ?delay=<ms>: the Owner chip's people and teams take this long to read.
const pickerDelay = Number(params.get("delay") || 0);

window.__fixture = {
  listRequests: [],
  unhandled: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID("20000000-0000-4000-8000-0000000000f1");
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission,
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
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

function uuid(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function record(ModelType, fields) {
  const item = new ModelType();
  item._id = fields._id;
  item.id = new ObjectID(fields._id);
  item.createdAt = new Date("2026-10-10T09:00:00Z");
  item.updatedAt = new Date("2026-10-12T09:00:00Z");
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  return item;
}

function person(index, name, email) {
  return record(User, {
    _id: uuid("30000000", index),
    name: new Name(name),
    email: new Email(email),
  });
}

const ADA = person(1, "Ada Lovelace", "ada@example.com");
const GRACE = person(2, "Grace Hopper", "grace@example.com");
const BO = person(3, "Bo Chen", "bo@example.com");

const SRE = record(Team, {
  _id: uuid("40000000", 1),
  projectId: new ObjectID(PROJECT_ID),
  name: "SRE",
});
const PAYMENTS = record(Team, {
  _id: uuid("40000000", 2),
  projectId: new ObjectID(PROJECT_ID),
  name: "Payments",
});

const NIGHT_SHIFT = record(Label, {
  _id: uuid("50000000", 1),
  projectId: new ObjectID(PROJECT_ID),
  name: "night-shift",
  color: "#4f46e5",
});

function schedule(index, name, description, onCall, labels) {
  return record(OnCallDutyPolicySchedule, {
    _id: uuid("60000000", index),
    projectId: new ObjectID(PROJECT_ID),
    name: name,
    description: description,
    currentUserOnRoster: onCall,
    labels: labels || [],
    createdAt: new Date(Date.UTC(2026, 9, 10, 9, 0, index)),
  });
}

const SCHEDULES = [
  schedule(1, "Payments Primary", "Card and wallet payments.", GRACE),
  schedule(2, "SRE Weekdays", "Monday to Friday, office hours.", ADA),
  schedule(3, "SRE Weekends", "Saturday and Sunday.", BO, [NIGHT_SHIFT]),
  schedule(4, "Database On-Call", "Postgres and ClickHouse.", ADA),
  schedule(5, "Bo's Escalation", "When the primary does not answer.", BO),
  schedule(6, "Nights", "Overnight cover, not yet owned.", undefined, [
    NIGHT_SHIFT,
  ]),
];

function scheduleNamed(name) {
  return SCHEDULES.find((item) => item.name === name);
}

let ownerIndex = 0;

function ownerUser(scheduleName, user) {
  ownerIndex++;
  return record(OnCallDutyPolicyScheduleOwnerUser, {
    _id: uuid("70000000", ownerIndex),
    projectId: new ObjectID(PROJECT_ID),
    onCallDutyPolicyScheduleId: new ObjectID(scheduleNamed(scheduleName)._id),
    userId: new ObjectID(user._id),
    user: user,
  });
}

function ownerTeam(scheduleName, team) {
  ownerIndex++;
  return record(OnCallDutyPolicyScheduleOwnerTeam, {
    _id: uuid("80000000", ownerIndex),
    projectId: new ObjectID(PROJECT_ID),
    onCallDutyPolicyScheduleId: new ObjectID(scheduleNamed(scheduleName)._id),
    teamId: new ObjectID(team._id),
    team: team,
  });
}

function member(index, team, user) {
  return record(TeamMember, {
    _id: uuid("90000000", index),
    projectId: new ObjectID(PROJECT_ID),
    teamId: new ObjectID(team._id),
    team: team,
    userId: new ObjectID(user._id),
    user: user,
    hasAcceptedInvitation: true,
  });
}

const TABLES = {
  OnCallDutyPolicySchedule: SCHEDULES,
  OnCallDutyPolicyScheduleOwnerUser: [
    ownerUser("SRE Weekends", ADA),
    ownerUser("Database On-Call", ADA),
    ownerUser("Bo's Escalation", BO),
  ],
  OnCallDutyPolicyScheduleOwnerTeam: [
    ownerTeam("Payments Primary", PAYMENTS),
    ownerTeam("SRE Weekdays", SRE),
    ownerTeam("SRE Weekends", SRE),
  ],
  TeamMember: [
    member(1, SRE, ADA),
    member(2, SRE, BO),
    member(3, PAYMENTS, GRACE),
  ],
  Team: [SRE, PAYMENTS],
  Label: [NIGHT_SHIFT],
  // Saved views and the chat workspaces the side menu names: none here.
  TableView: [],
  WorkspaceProjectAuthToken: [],
};

// The tables read by name: a read of any other is unhandled.
const MODELLED = [
  OnCallDutyPolicySchedule,
  OnCallDutyPolicyScheduleOwnerUser,
  OnCallDutyPolicyScheduleOwnerTeam,
  TeamMember,
  Team,
  Label,
  TableView,
  WorkspaceProjectAuthToken,
].map((modelType) => tableName(modelType));

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return String(value._id).toLowerCase();
  }
  return value.toString().toLowerCase();
}

function idsOf(value) {
  if (value && Array.isArray(value.values)) {
    return value.values.map(idOf);
  }
  if (Array.isArray(value)) {
    return value.map(idOf);
  }
  return value ? [idOf(value)] : [];
}

function textOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value.value ?? value.toString());
}

function contains(haystack, needle) {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

// The owners of a schedule, as its owner rows name them.
function ownersOf(scheduleId) {
  const id = idOf(scheduleId);
  return {
    userIds: TABLES.OnCallDutyPolicyScheduleOwnerUser.filter(
      (row) => idOf(row.onCallDutyPolicyScheduleId) === id,
    ).map((row) => idOf(row.userId)),
    teamIds: TABLES.OnCallDutyPolicyScheduleOwnerTeam.filter(
      (row) => idOf(row.onCallDutyPolicyScheduleId) === id,
    ).map((row) => idOf(row.teamId)),
  };
}

// The Owner chip's filter, answered as the server answers it (OwnedBy).
function matchesOwners(item, owners) {
  if (!owners) {
    return true;
  }

  const filter = owners instanceof OwnedBy ? owners : OwnedBy.fromJSON(owners);
  const held = ownersOf(item._id);
  const ownedByOneNamed =
    held.userIds.some((id) => filter.userIds.includes(id)) ||
    held.teamIds.some((id) => filter.teamIds.includes(id));
  const hasOwners = held.userIds.length + held.teamIds.length > 0;

  switch (filter.match) {
    case OwnedByMatch.AnyOf:
      return ownedByOneNamed;
    case OwnedByMatch.NoneOf:
      return !ownedByOneNamed;
    case OwnedByMatch.AnyOwner:
      return hasOwners;
    case OwnedByMatch.NoOwner:
      return !hasOwners;
    default:
      return false;
  }
}

function matchesSchedule(item, query) {
  if (!matchesOwners(item, query.owners)) {
    return false;
  }

  if (query.labels) {
    const wanted = idsOf(query.labels);
    const has = (item.labels || []).map((label) => idOf(label._id));
    if (!wanted.some((id) => has.includes(id))) {
      return false;
    }
  }

  const search = query._multiFieldSearch;
  if (search) {
    const text = textOf(search);
    if (!contains(item.name, text) && !contains(item.description, text)) {
      return false;
    }
  }

  if (query.name) {
    if (!contains(item.name, textOf(query.name))) {
      return false;
    }
  }

  return true;
}

function rowsFor(name, query) {
  const rows = TABLES[name] || [];

  switch (name) {
    case "OnCallDutyPolicySchedule":
      return rows.filter((item) => matchesSchedule(item, query));
    case "OnCallDutyPolicyScheduleOwnerUser":
    case "OnCallDutyPolicyScheduleOwnerTeam": {
      const ids = idsOf(query.onCallDutyPolicyScheduleId);
      return rows.filter(
        (row) =>
          ids.length === 0 ||
          ids.includes(idOf(row.onCallDutyPolicyScheduleId)),
      );
    }
    case "TeamMember":
      return rows.filter((row) => {
        if (query.userId && !idsOf(query.userId).includes(idOf(row.userId))) {
          return false;
        }
        const user = query.user || {};
        if (user.name && !contains(row.user.name, textOf(user.name))) {
          return false;
        }
        if (user.email && !contains(row.user.email, textOf(user.email))) {
          return false;
        }
        return true;
      });
    case "Team":
    case "Label":
      return rows.filter((row) => {
        if (query._id && !idsOf(query._id).includes(idOf(row._id))) {
          return false;
        }
        if (query.name && !contains(row.name, textOf(query.name))) {
          return false;
        }
        return true;
      });
    default:
      return rows;
  }
}

// A record as a fresh read gives it: never the instance the page drew before.
function copyOf(item, modelType) {
  return BaseModel.fromJSONObject(BaseModel.toJSON(item, modelType), modelType);
}

ModelAPI.getList = async (options) => {
  const modelType = options.modelType;
  const name = tableName(modelType);
  const query = options.query || {};

  window.__fixture.listRequests.push({
    model: name,
    query: JSON.parse(JSON.stringify(JSONFunctions.serialize(query))),
  });

  if (!MODELLED.includes(name)) {
    window.__fixture.unhandled.push({ kind: "getList", model: name });
    return { data: [], count: 0, skip: 0, limit: 10 };
  }

  if (pickerDelay > 0 && (name === "TeamMember" || name === "Team")) {
    await new Promise((resolve) => setTimeout(resolve, pickerDelay));
  }

  const items = rowsFor(name, query).map((item) => copyOf(item, modelType));
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const name = tableName(options.modelType);

  if (!MODELLED.includes(name)) {
    window.__fixture.unhandled.push({ kind: "count", model: name });
    return 0;
  }

  return rowsFor(name, options.query || {}).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  window.__fixture.unhandled.push({
    kind: "getItem",
    model: tableName(options.modelType),
  });
  return null;
};

API.get = async (options) => {
  window.__fixture.unhandled.push({
    kind: "api",
    url: String(options && options.url),
  });
  return new HTTPResponse(200, {}, {});
};
API.post = API.get;

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
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  // The schedules as the On-Call layout frames them: beside its side menu.
  return (
    <Page
      title="On-Call Duty Schedules"
      breadcrumbLinks={[]}
      sideMenu={<OnCallDutySideMenu />}
    >
      <OnCallDutySchedulesPage
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </Page>
  );
}

const target = `/dashboard/${PROJECT_ID}/on-call-duty/schedules`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/on-call-duty/schedules"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);
