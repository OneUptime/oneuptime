/*
 * Offline fixture for custom roles: the real Teams pages - Teams > Settings >
 * Roles, a role's own page, a team's Permissions page and the Teams list with
 * Create Team - mounted at their real addresses through the real
 * TeamsRoutes, with the real Teams layout (side menu, breadcrumbs); and the
 * real Settings > API Keys pages - the list with Create API Key, and a key's
 * own page - through the real SettingsRoutes.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced; the pages, their tables, forms and dialogs are the
 * production ones from this branch.
 *
 * Steered by the query string:
 *   - roles=none        the project has no custom role yet
 *   - roles=many        thirty custom roles, for a long list and long pickers
 *   - keys=none         the project has no API key yet
 *   - long=1            two roles with long names: a sentence of a name, and
 *                       a single word with nowhere to break - both given to
 *                       the Deploy bot key too
 *   - user=editor       a member who may change what teams can do and holds
 *                       Incident Member and Alert Member - not Project Admin,
 *                       and not who may read the project's API keys; the
 *                       default is a project owner
 *   - refuse=<perm>     the server refuses putting this permission into a
 *                       role, as it refuses one its giver does not hold
 *   - members=hidden    the reader may not read the teams' members, so a
 *                       role's reach names its teams only
 *   - lang=de|ja        the Dashboard's German or Japanese words
 *   - theme=dark        (server) the Dashboard's dark mode
 *
 * Every write the page sends is recorded on `window.__fixture.creates`,
 * `.updates` and `.deletes`, and every list read on `.listRequests`, so the
 * spec checks what the page sent as well as what it drew. Writes act on the
 * in-memory project as the services do: a permission put into a role counts
 * on the role and reaches every team and API key with it (but what it limits
 * to resources someone owns, which gives a key nothing); deleting a role
 * takes its permissions and the teams' and keys' hold of it.
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
import TeamsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/TeamsRoutes";
import SettingsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/SettingsRoutes";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Label from "Common/Models/DatabaseModels/Label";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { getPermissionTitleForSentence } from "Common/Types/Team/CustomRole";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
const rolesScenario = params.get("roles") || "some";
const hasNoApiKey = params.get("keys") === "none";
const hasLongNames = params.get("long") === "1";
const userKind = params.get("user") || "owner";
const refusedPermission = params.get("refuse") || "";
const membersHidden = params.get("members") === "hidden";
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

let nextId = 1;
function newId(prefix) {
  nextId += 1;
  return `${prefix}000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }
  return value.toString().toLowerCase();
}

// Labels.
function label(id, name, color) {
  const record = new Label();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.color = new Color(color);
  return record;
}

const PRODUCTION = label(
  "20000000-0000-4000-8000-000000000001",
  "Production",
  "#ef4444",
);
const STAGING = label(
  "20000000-0000-4000-8000-000000000002",
  "Staging",
  "#f59e0b",
);
const labels = [PRODUCTION, STAGING];

// Teams: the three every project starts with, and two of its own.
function team(id, name, description, editable) {
  const record = new Team();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.isPermissionsEditable = editable;
  record.isTeamDeleteable = editable;
  record.isTeamEditable = editable;
  return record;
}

const TEAMS = {
  owners: "50000000-0000-4000-8000-000000000001",
  admin: "50000000-0000-4000-8000-000000000002",
  members: "50000000-0000-4000-8000-000000000003",
  platform: "50000000-0000-4000-8000-000000000004",
  support: "50000000-0000-4000-8000-000000000005",
};

const teams = [
  team(TEAMS.owners, "Owners", "Owners of this project.", false),
  team(TEAMS.admin, "Admin", "Admins of this project.", false),
  team(TEAMS.members, "Members", "Members of this project.", true),
  team(
    TEAMS.platform,
    "Platform On-Call",
    "Who is paged for the platform.",
    true,
  ),
  team(TEAMS.support, "Support", "First line for customers.", true),
];

// Who is on which team; one person on both Platform On-Call and Support.
function member(teamId, userId, accepted) {
  const record = new TeamMember();
  record._id = newId("51");
  record.projectId = new ObjectID(PROJECT_ID);
  record.teamId = new ObjectID(teamId);
  record.userId = new ObjectID(userId);
  record.hasAcceptedInvitation = accepted;
  return record;
}

const teamMembers = [
  member(TEAMS.platform, "81000000-0000-4000-8000-000000000001", true),
  member(TEAMS.platform, "81000000-0000-4000-8000-000000000002", true),
  member(TEAMS.platform, "81000000-0000-4000-8000-000000000003", true),
  member(TEAMS.support, "81000000-0000-4000-8000-000000000003", true),
  member(TEAMS.support, "81000000-0000-4000-8000-000000000004", true),
  // Invited, not accepted: holds nothing yet, so a role reaches nobody here.
  member(TEAMS.support, "81000000-0000-4000-8000-000000000005", false),
  member(TEAMS.members, "81000000-0000-4000-8000-000000000006", true),
];

// Custom roles and their permissions.
const ROLES = {
  responder: "30000000-0000-4000-8000-000000000001",
  lead: "30000000-0000-4000-8000-000000000002",
  auditor: "30000000-0000-4000-8000-000000000003",
  // Made only of what the editor (user=editor) holds: theirs to give.
  helper: "30000000-0000-4000-8000-000000000004",
};

function customRole(id, name, description) {
  const record = new CustomRole();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description || undefined;
  record.permissionCount = 0;
  return record;
}

function rolePermission(roleId, permission, scope, rowLabels) {
  const record = new CustomRolePermission();
  record._id = newId("31");
  record.projectId = new ObjectID(PROJECT_ID);
  record.customRoleId = new ObjectID(roleId);
  record.permission = permission;
  record.scope = scope || PermissionScope.All;
  record.labels = rowLabels || [];
  return record;
}

const customRoles = [];
const customRolePermissions = [];

if (rolesScenario !== "none") {
  customRoles.push(
    customRole(
      ROLES.responder,
      "Incident Responder",
      "Declares, works and resolves incidents and alerts.",
    ),
    customRole(
      ROLES.lead,
      "Team Lead",
      "Runs a team: its incidents, its on-call and who is on it.",
    ),
    customRole(ROLES.auditor, "Auditor", ""),
    customRole(ROLES.helper, "Incident Helper", "Works incidents and alerts."),
  );

  customRolePermissions.push(
    rolePermission(ROLES.responder, Permission.IncidentMember),
    rolePermission(ROLES.responder, Permission.AlertMember),
    rolePermission(ROLES.responder, Permission.OnCallViewer),
    rolePermission(ROLES.responder, Permission.StatusPageMember),
    rolePermission(ROLES.responder, Permission.ReadTelemetryServiceLog),
    rolePermission(
      ROLES.responder,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [PRODUCTION],
    ),
    rolePermission(ROLES.lead, Permission.IncidentAdmin),
    rolePermission(ROLES.lead, Permission.OnCallAdmin),
    rolePermission(ROLES.lead, Permission.AlertMember, PermissionScope.Owned),
    rolePermission(ROLES.helper, Permission.IncidentMember),
    rolePermission(ROLES.helper, Permission.AlertMember),
  );
}

if (rolesScenario === "many") {
  for (let index = 1; index <= 27; index++) {
    const id = `32000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    customRoles.push(
      customRole(
        id,
        `Region ${String(index).padStart(2, "0")} Responders`,
        "Responders for one region.",
      ),
    );
    customRolePermissions.push(rolePermission(id, Permission.IncidentMember));
  }
}

/*
 * Names as long as people give them: a sentence of a name, and a single word
 * with nowhere to break.
 */
const LONG_NAMES = [
  "Incident Commander for the EU-West Enterprise Platform, Payments and Identity Services (Primary Rotation)",
  "incident-responders.eu-west-1.enterprise-platform.payments-and-identity-services",
];

if (hasLongNames) {
  LONG_NAMES.forEach((name, index) => {
    const id = `33000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    customRoles.push(
      customRole(
        id,
        name,
        "A role with a long name, and a long description that says a lot about what the people who have it do, day and night.",
      ),
    );
    customRolePermissions.push(rolePermission(id, Permission.IncidentMember));
  });
}

// The teams given each role.
function teamCustomRole(teamId, roleId) {
  const record = new TeamCustomRole();
  record._id = newId("34");
  record.projectId = new ObjectID(PROJECT_ID);
  record.teamId = new ObjectID(teamId);
  record.customRoleId = new ObjectID(roleId);
  return record;
}

const teamCustomRoles = [];

if (rolesScenario !== "none") {
  teamCustomRoles.push(
    teamCustomRole(TEAMS.platform, ROLES.responder),
    teamCustomRole(TEAMS.support, ROLES.responder),
    teamCustomRole(TEAMS.platform, ROLES.lead),
  );
}

// A team's own permissions, and the copies of its roles' permissions.
function teamPermission(teamId, permission, extra) {
  const record = new TeamPermission();
  record._id = newId("35");
  record.projectId = new ObjectID(PROJECT_ID);
  record.teamId = new ObjectID(teamId);
  record.permission = permission;
  record.scope = PermissionScope.All;
  record.isBlockPermission = false;
  record.labels = [];
  Object.assign(record, extra || {});
  return record;
}

const teamPermissions = [
  teamPermission(TEAMS.owners, Permission.ProjectOwner),
  teamPermission(TEAMS.admin, Permission.ProjectAdmin),
  teamPermission(TEAMS.members, Permission.ProjectMember),
  teamPermission(TEAMS.platform, Permission.WorkflowViewer),
];

// The copies CustomRoleSync keeps: the team's Permissions table never lists them.
function syncCopies() {
  for (let index = teamPermissions.length - 1; index >= 0; index--) {
    if (teamPermissions[index].customRoleId) {
      teamPermissions.splice(index, 1);
    }
  }

  for (const given of teamCustomRoles) {
    for (const row of customRolePermissions) {
      if (idOf(row.customRoleId) !== idOf(given.customRoleId)) {
        continue;
      }
      teamPermissions.push(
        teamPermission(idOf(given.teamId), row.permission, {
          scope: row.scope,
          labels: row.labels,
          customRoleId: new ObjectID(idOf(given.customRoleId)),
          teamCustomRoleId: new ObjectID(idOf(given._id)),
          customRolePermissionId: new ObjectID(idOf(row._id)),
        }),
      );
    }
  }

  syncKeyCopies();
}

/*
 * API keys: Deploy bot, given Team Lead and Incident Helper (and, with
 * long=1, the two roles with long names), and Terraform, given none. Each
 * has one permission of its own.
 */
const KEYS = {
  deploy: "60000000-0000-4000-8000-000000000001",
  terraform: "60000000-0000-4000-8000-000000000002",
};

function apiKey(id, name, description) {
  const record = new ApiKey();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.expiresAt = new Date("2027-10-23T00:00:00.000Z");
  record.apiKey = new ObjectID(`61${id.slice(2)}`);
  return record;
}

const apiKeys = hasNoApiKey
  ? []
  : [
      apiKey(KEYS.deploy, "Deploy bot", "Ships releases from CI."),
      apiKey(KEYS.terraform, "Terraform", "Manages monitors and status pages."),
    ];

function apiKeyCustomRole(keyId, roleId) {
  const record = new ApiKeyCustomRole();
  record._id = newId("64");
  record.projectId = new ObjectID(PROJECT_ID);
  record.apiKeyId = new ObjectID(keyId);
  record.customRoleId = new ObjectID(roleId);
  return record;
}

const apiKeyCustomRoles = [];

if (rolesScenario !== "none" && !hasNoApiKey) {
  apiKeyCustomRoles.push(
    apiKeyCustomRole(KEYS.deploy, ROLES.lead),
    apiKeyCustomRole(KEYS.deploy, ROLES.helper),
  );
}

if (hasLongNames && !hasNoApiKey) {
  LONG_NAMES.forEach((name, index) => {
    apiKeyCustomRoles.push(
      apiKeyCustomRole(
        KEYS.deploy,
        `33000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
    );
  });
}

function apiKeyPermission(keyId, permission, extra) {
  const record = new ApiKeyPermission();
  record._id = newId("62");
  record.projectId = new ObjectID(PROJECT_ID);
  record.apiKeyId = new ObjectID(keyId);
  record.permission = permission;
  record.isBlockPermission = false;
  record.labels = [];
  Object.assign(record, extra || {});
  return record;
}

const apiKeyPermissions = hasNoApiKey
  ? []
  : [
      apiKeyPermission(KEYS.deploy, Permission.WorkflowViewer),
      apiKeyPermission(KEYS.terraform, Permission.MonitorAdmin),
    ];

/*
 * The copies CustomRoleSync keeps for a key: every permission of its roles
 * but those limited to what someone owns. The key's Permissions table never
 * lists them.
 */
function syncKeyCopies() {
  for (let index = apiKeyPermissions.length - 1; index >= 0; index--) {
    if (apiKeyPermissions[index].apiKeyCustomRoleId) {
      apiKeyPermissions.splice(index, 1);
    }
  }

  for (const given of apiKeyCustomRoles) {
    for (const row of customRolePermissions) {
      if (
        idOf(row.customRoleId) !== idOf(given.customRoleId) ||
        row.scope === PermissionScope.Owned
      ) {
        continue;
      }
      apiKeyPermissions.push(
        apiKeyPermission(idOf(given.apiKeyId), row.permission, {
          labels: row.scope === PermissionScope.Labels ? row.labels : [],
          customRoleId: new ObjectID(idOf(given.customRoleId)),
          apiKeyCustomRoleId: new ObjectID(idOf(given._id)),
          customRolePermissionId: new ObjectID(idOf(row._id)),
        }),
      );
    }
  }
}

function recount() {
  for (const role of customRoles) {
    role.permissionCount = customRolePermissions.filter(
      (row) => idOf(row.customRoleId) === idOf(role._id),
    ).length;
  }
}

function resolveRelations() {
  for (const given of teamCustomRoles) {
    given.team = teams.find(
      (candidate) => idOf(candidate._id) === idOf(given.teamId),
    );
    given.customRole = customRoles.find(
      (candidate) => idOf(candidate._id) === idOf(given.customRoleId),
    );
  }
  for (const given of apiKeyCustomRoles) {
    given.apiKey = apiKeys.find(
      (candidate) => idOf(candidate._id) === idOf(given.apiKeyId),
    );
    given.customRole = customRoles.find(
      (candidate) => idOf(candidate._id) === idOf(given.customRoleId),
    );
  }
}

recount();
syncCopies();
resolveRelations();

window.__fixture = {
  listRequests: [],
  creates: [],
  updates: [],
  deletes: [],
};

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function matchesCondition(value, condition) {
  if (condition instanceof IsNull) {
    return value === undefined || value === null || value === "";
  }
  if (condition instanceof Includes) {
    const wanted = (condition.values || []).map((item) => idOf(item));
    return wanted.includes(idOf(value));
  }
  if (condition instanceof IncludesNone) {
    const unwanted = (condition.values || []).map((item) => idOf(item));
    return !unwanted.includes(idOf(value));
  }
  if (typeof condition === "boolean") {
    return Boolean(value) === condition;
  }
  if (condition instanceof ObjectID || typeof condition === "string") {
    return idOf(value) === idOf(condition);
  }
  return true;
}

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (condition instanceof MultiSearch) {
      const needle = condition.value.toLowerCase();
      const hit = condition.fields.some((field) =>
        String(record[field] || "")
          .toLowerCase()
          .includes(needle),
      );
      if (!hit) {
        return false;
      }
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(record[key] || "")
          .toLowerCase()
          .includes(String(condition.value || "").toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (!matchesCondition(record[key], condition)) {
      return false;
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
    const a = String(first[field] || "").toLowerCase();
    const b = String(second[field] || "").toLowerCase();
    return a > b ? direction : a < b ? -direction : 0;
  });
}

const RECORDS = {
  Label: labels,
  Team: teams,
  TeamMember: teamMembers,
  CustomRole: customRoles,
  CustomRolePermission: customRolePermissions,
  TeamCustomRole: teamCustomRoles,
  TeamPermission: teamPermissions,
  ApiKey: apiKeys,
  ApiKeyCustomRole: apiKeyCustomRoles,
  ApiKeyPermission: apiKeyPermissions,
};

// Read only by who may read the project's API keys, as the server answers.
const API_KEY_TABLES = ["ApiKey", "ApiKeyCustomRole", "ApiKeyPermission"];

/*
 * A project owner, or a member who may change what teams can do but holds
 * only Incident Member and Alert Member: the second is offered only the
 * custom roles made of what they hold.
 */
const heldPermissions =
  userKind === "editor"
    ? [
        Permission.EditProjectTeamPermissions,
        Permission.ReadProjectTeam,
        Permission.CreateProjectTeam,
        Permission.InviteProjectTeamMembers,
        Permission.IncidentMember,
        Permission.AlertMember,
      ]
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
    scope: PermissionScope.All,
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
ProjectUtil.getCurrentProject = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  resolveRelations();
  return (
    (RECORDS[tableName] || []).find((record) => idOf(record._id) === id) || null
  );
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

  if (tableName === "TeamMember" && membersHidden) {
    throw new Error(
      "You do not have permissions to read Team Member. You need one of these permissions: Project Owner, Project Admin.",
    );
  }

  if (API_KEY_TABLES.includes(tableName) && userKind === "editor") {
    throw new Error(
      `You do not have permissions to read ${new options.modelType().singularName}. You need one of these permissions: Project Owner, Project Admin, Read API Key.`,
    );
  }

  resolveRelations();

  const items = sortRows(
    (RECORDS[tableName] || []).filter((record) =>
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
  return (RECORDS[tableName] || []).filter((record) =>
    matchesQuery(record, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

/*
 * As DatabaseService.create does before any hook runs
 * (fillIdColumnsFromRelations): a record the form names by its relation -
 * Give to a Team sends `team: { _id }`, Give to an API Key `apiKey: { _id }`
 * - gets the id in its ID column too.
 */
function fillIdColumnsFromRelations(record) {
  for (const relation of ["team", "customRole", "apiKey"]) {
    const idColumn = `${relation}Id`;
    if (!record[idColumn] && record[relation] && idOf(record[relation])) {
      record[idColumn] = new ObjectID(idOf(record[relation]));
    }
  }
}

// What the services answer for a write, in their words.
function createRecord(tableName, record) {
  fillIdColumnsFromRelations(record);

  if (tableName === "CustomRolePermission") {
    if (refusedPermission && record.permission === refusedPermission) {
      throw new Error(
        `You cannot grant ${getPermissionTitleForSentence(record.permission)} because your own access does not include that permission at an equal or broader scope.`,
      );
    }
    const role = customRoles.find(
      (candidate) => idOf(candidate._id) === idOf(record.customRoleId),
    );
    if (
      customRolePermissions.some(
        (row) =>
          idOf(row.customRoleId) === idOf(record.customRoleId) &&
          row.permission === record.permission,
      )
    ) {
      throw new Error(`${role ? role.name : "This role"} already has it.`);
    }
    record.labels = (record.labels || []).map((value) =>
      labels.find((candidate) => idOf(candidate._id) === idOf(value)),
    );
    customRolePermissions.push(record);
  } else if (tableName === "CustomRole") {
    record.permissionCount = 0;
    customRoles.push(record);
  } else if (tableName === "TeamCustomRole") {
    const target = teams.find(
      (candidate) => idOf(candidate._id) === idOf(record.teamId),
    );
    if (target && !target.isPermissionsEditable) {
      throw new Error(
        "This team's permissions can't be changed, so it can't be given a custom role. Create a team of your own and give the role to it.",
      );
    }
    if (
      teamCustomRoles.some(
        (given) =>
          idOf(given.teamId) === idOf(record.teamId) &&
          idOf(given.customRoleId) === idOf(record.customRoleId),
      )
    ) {
      throw new Error("This team already has this role.");
    }
    teamCustomRoles.push(record);
  } else if (tableName === "ApiKeyCustomRole") {
    if (
      apiKeyCustomRoles.some(
        (given) =>
          idOf(given.apiKeyId) === idOf(record.apiKeyId) &&
          idOf(given.customRoleId) === idOf(record.customRoleId),
      )
    ) {
      throw new Error("This API key already has this role.");
    }
    apiKeyCustomRoles.push(record);
  } else if (tableName === "ApiKeyPermission") {
    apiKeyPermissions.push(record);
  } else if (tableName === "ApiKey") {
    // The key itself, which the server makes.
    record.apiKey = new ObjectID(newId("61"));
    apiKeys.push(record);
  } else if (tableName === "TeamPermission") {
    teamPermissions.push(record);
  } else if (tableName === "Team") {
    record.isPermissionsEditable = true;
    record.isTeamDeleteable = true;
    teams.push(record);
  } else {
    throw new Error(`The fixture does not model creating ${tableName}.`);
  }
}

ModelAPI.createOrUpdate = async (options) => {
  const record = options.model;
  const tableName = record.tableName;
  const isCreate = !record._id;

  if (isCreate) {
    record._id = newId("40");
    record.projectId = new ObjectID(PROJECT_ID);
    window.__fixture.creates.push({ tableName, data: serialize(record) });
    createRecord(tableName, record);
  } else {
    window.__fixture.updates.push({ tableName, data: serialize(record) });
    const existing = (RECORDS[tableName] || []).find(
      (candidate) => idOf(candidate._id) === idOf(record._id),
    );
    if (existing) {
      Object.assign(existing, record);
    }
  }

  recount();
  syncCopies();
  resolveRelations();

  return { data: record };
};

ModelAPI.updateById = async (options) => {
  const tableName = new options.modelType().tableName;
  window.__fixture.updates.push({
    tableName,
    id: idOf(options.id),
    data: serialize(options.data),
  });
  const existing = (RECORDS[tableName] || []).find(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );
  if (existing) {
    Object.assign(existing, options.data);
  }
  recount();
  syncCopies();
  resolveRelations();
  return { data: existing || {} };
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.deletes.push({ tableName, id });

  const rows = RECORDS[tableName] || [];
  const index = rows.findIndex((record) => idOf(record._id) === id);
  if (index === -1) {
    throw new Error(`${tableName} not found.`);
  }
  rows.splice(index, 1);

  // What the database deletes with them (ON DELETE CASCADE).
  if (tableName === "CustomRole") {
    for (const list of [
      customRolePermissions,
      teamCustomRoles,
      apiKeyCustomRoles,
    ]) {
      for (let position = list.length - 1; position >= 0; position--) {
        if (idOf(list[position].customRoleId) === id) {
          list.splice(position, 1);
        }
      }
    }
  }
  if (tableName === "ApiKey") {
    for (const list of [apiKeyCustomRoles, apiKeyPermissions]) {
      for (let position = list.length - 1; position >= 0; position--) {
        if (idOf(list[position].apiKeyId) === id) {
          list.splice(position, 1);
        }
      }
    }
  }

  recount();
  syncCopies();
  resolveRelations();
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
 * The project the pages are drawn for, as App.tsx hands it to every page: a
 * team's Permissions card adds a row to it (TeamPermissionTable's
 * onBeforeCreate reads its id).
 */
const CURRENT_PROJECT = new Project();
CURRENT_PROJECT._id = PROJECT_ID;
CURRENT_PROJECT.name = "Acme";

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return props.children;
}

/*
 * App.tsx reads the location itself, so the whole Dashboard is drawn again
 * on every navigation, and with it the Teams layout's side menu, which marks
 * the new page and opens its section. Read it here too: without it a click
 * in the menu changed the page under a menu still drawn for the last one.
 */
function Fixture() {
  useLocation();

  return (
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/teams/*"
        element={
          <Shell>
            <TeamsRoutes
              pageRoute={Navigation.getCurrentRoute()}
              currentProject={CURRENT_PROJECT}
              hasPaymentMethod={true}
            />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/settings/*"
        element={
          <Shell>
            <SettingsRoutes
              pageRoute={Navigation.getCurrentRoute()}
              currentProject={CURRENT_PROJECT}
              hasPaymentMethod={true}
            />
          </Shell>
        }
      />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
