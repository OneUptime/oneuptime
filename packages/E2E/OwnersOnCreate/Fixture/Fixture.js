/*
 * Offline fixture for the Owners field of Declare Incident and Create Alert
 * (Dashboard Components/OwnersOnCreate): under More fields at the end of the
 * form's first step, the owners people picker with the person's own teams
 * one click away under it ("Your teams"), and on the review step a row that
 * always says who will own it - the owners picked, then each owner rule
 * that will run, by name, with whom it adds. The pages, the form, the
 * picker, the suggestions and the review are the production ones from this
 * branch; only the ModelAPI / API data boundary and the signed-in user are
 * replaced.
 *
 * The project: Ada Lovelace (signed in), Grace Hopper and Linus Torvalds;
 * the Platform, Database, SRE On-call, Members and Frontend teams. Ada is in
 * Platform, Database and Members (?teams=many, the default), Platform alone
 * (?teams=one) or no team (?teams=none).
 *
 * The owner rule preview (POST /<event>/owner-rule-preview) answers as the
 * server would for these rules:
 *
 *   Database incidents                   an incident labelled "database":
 *                                        Grace Hopper and the Database team
 *   Add the creator's team as an owner   every incident: of Platform,
 *                                        Database and Frontend, the ones Ada
 *                                        is in
 *   Checkout alerts                      every alert: Linus Torvalds and the
 *                                        SRE On-call team
 *
 * The incident and alert owner rules pages (Settings > Owner Rules) are
 * here too, for the Creator's Team an owner rule lists: one incident rule
 * that lists Platform, Database and Frontend, and one saved before anyone
 * asked a rule to add something, which adds nothing.
 *
 * Steered by the query string:
 *   - form=alert   Create Alert (default: Declare Incident)
 *   - form=incident-rules|alert-rules   the owner rules pages
 *   - teams=none|one|many
 *   - rules=none   no rule adds anyone
 *   - rules=error  the preview fails (a 500)
 *   - rules=denied the person may not read the owner rules (a 422)
 *   - rules=slow   the preview never answers
 *   - lang=de      the Dashboard's German words
 *   - theme=dark   dark mode (set before the bundle by server.js)
 *
 * Recorded on window.__fixture: every preview asked (`previews`: the URL,
 * the body and the headers), every create sent (`saves`: the model and its
 * misc data, as ModelForm sends them) and every read of a table this fixture
 * does not model (`unhandled`; the spec fails on any).
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
import IncidentCreate from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import AlertCreate from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Create";
import IncidentOwnerRulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules";
import AlertOwnerRulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertOwnerRules";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOwnerRule from "Common/Models/DatabaseModels/IncidentOwnerRule";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000c7";
const ADA_ID = "20000000-0000-4000-8000-0000000000c7";

const params = new URLSearchParams(window.location.search);
const form = ["alert", "incident-rules", "alert-rules"].includes(
  params.get("form"),
)
  ? params.get("form")
  : "incident";
const isRulesPage = form === "incident-rules" || form === "alert-rules";
const teamsMode = ["none", "one"].includes(params.get("teams"))
  ? params.get("teams")
  : "many";
const rulesMode = params.get("rules") || "some";
const language = params.get("lang") === "de" ? "de" : "en";

window.__fixture = {
  previews: [],
  saves: [],
  unhandled: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(ADA_ID);
UserUtil.getName = () => new Name("Ada Lovelace");
UserUtil.getEmail = () => new Email("ada@example.com");
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

const project = new Project();
project._id = PROJECT_ID;
project.id = new ObjectID(PROJECT_ID);
project.name = "Acme Production";

ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

let counter = 0;

function uuid(prefix) {
  counter++;
  return `${prefix}000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function record(ModelType, prefix, fields) {
  const item = new ModelType();
  const id = fields._id || uuid(prefix);
  item._id = id;
  item.id = new ObjectID(id);
  item.projectId = new ObjectID(PROJECT_ID);
  item.createdAt = new Date("2026-10-10T09:00:00Z");
  item.updatedAt = new Date("2026-10-12T09:00:00Z");
  // The pickers offer only what is not archived.
  item.isArchived = false;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  return item;
}

const ADA = record(User, "", {
  _id: ADA_ID,
  name: new Name("Ada Lovelace"),
  email: new Email("ada@example.com"),
});
const GRACE = record(User, "30", {
  name: new Name("Grace Hopper"),
  email: new Email("grace@example.com"),
});
const LINUS = record(User, "30", {
  name: new Name("Linus Torvalds"),
  email: new Email("linus@example.com"),
});

const PLATFORM = record(Team, "40", { name: "Platform" });
const DATABASE = record(Team, "40", { name: "Database" });
const SRE = record(Team, "40", { name: "SRE On-call" });
const MEMBERS = record(Team, "40", { name: "Members" });
const FRONTEND = record(Team, "40", { name: "Frontend" });

const MY_TEAMS =
  teamsMode === "none"
    ? []
    : teamsMode === "one"
      ? [PLATFORM]
      : [PLATFORM, DATABASE, MEMBERS];

function membership(user, team) {
  return record(TeamMember, "50", {
    userId: user.id,
    user: user,
    teamId: team.id,
    team: team,
    hasAcceptedInvitation: true,
  });
}

const DATABASE_LABEL = record(Label, "60", {
  name: "database",
  color: new Color("#b45309"),
});

// What an owner rule adds when it lists nobody and inherits nothing.
const ADDS_NOTHING = {
  ownerUsers: [],
  ownerTeams: [],
  creatorTeams: [],
  inheritOwnersFromMonitors: false,
  inheritOwnersFromHosts: false,
  inheritOwnersFromKubernetesClusters: false,
  inheritOwnersFromDockerHosts: false,
  inheritOwnersFromPodmanHosts: false,
  inheritOwnersFromServices: false,
};

const INCIDENT_OWNER_RULES = [
  record(IncidentOwnerRule, "a1", {
    ...ADDS_NOTHING,
    name: "Add the creator's team as an owner",
    description: "Whoever declares an incident brings their team along.",
    isEnabled: true,
    notifyOwners: true,
    creatorTeams: [PLATFORM, DATABASE, FRONTEND],
  }),
  record(IncidentOwnerRule, "a1", {
    ...ADDS_NOTHING,
    name: "Old checkout rule",
    description: "Saved before a rule had to add someone.",
    isEnabled: true,
    notifyOwners: true,
  }),
];

const TABLES = {
  User: [ADA, GRACE, LINUS],
  Team: [PLATFORM, DATABASE, SRE, MEMBERS, FRONTEND],
  TeamMember: [
    ...MY_TEAMS.map((team) => membership(ADA, team)),
    membership(GRACE, DATABASE),
    membership(LINUS, SRE),
  ],
  IncidentSeverity: [
    record(IncidentSeverity, "70", {
      name: "Critical",
      color: new Color("#dc2626"),
      order: 1,
    }),
    record(IncidentSeverity, "70", {
      name: "Major",
      color: new Color("#ea580c"),
      order: 2,
    }),
  ],
  IncidentState: [
    record(IncidentState, "71", {
      name: "Identified",
      color: new Color("#dc2626"),
      order: 1,
      isCreatedState: true,
    }),
  ],
  AlertSeverity: [
    record(AlertSeverity, "72", {
      name: "High",
      color: new Color("#dc2626"),
      order: 1,
    }),
  ],
  AlertState: [
    record(AlertState, "73", {
      name: "Created",
      color: new Color("#dc2626"),
      order: 1,
      isCreatedState: true,
    }),
  ],
  IncidentRole: [
    record(IncidentRole, "74", {
      name: "Incident Commander",
      color: new Color("#4f46e5"),
      isPrimaryRole: true,
    }),
  ],
  Label: [
    DATABASE_LABEL,
    record(Label, "60", {
      name: "customer-facing",
      color: new Color("#4f46e5"),
    }),
  ],
  Monitor: [record(Monitor, "80", { name: "Checkout API" })],
  IncidentOwnerRule: INCIDENT_OWNER_RULES,
  // Read by the pages, empty in this project.
  IncidentEpisodeOwnerRule: [],
  AlertOwnerRule: [],
  AlertEpisodeOwnerRule: [],
  MonitorStatus: [],
  OnCallDutyPolicy: [],
  StatusPage: [],
  IncidentTemplate: [],
  IncidentCustomField: [],
  AlertCustomField: [],
  TableView: [],
  Host: [],
  KubernetesCluster: [],
  DockerHost: [],
  PodmanHost: [],
  ProxmoxCluster: [],
  VMwareVCenter: [],
  CephCluster: [],
  StorageArray: [],
  DockerSwarmCluster: [],
  IoTFleet: [],
  DatabaseServer: [],
  Service: [],
};

// The ids the spec checks what was sent against.
window.__fixture.ids = {
  ada: ADA._id,
  grace: GRACE._id,
  linus: LINUS._id,
  platform: PLATFORM._id,
  database: DATABASE._id,
  sre: SRE._id,
  members: MEMBERS._id,
  frontend: FRONTEND._id,
  databaseLabel: DATABASE_LABEL._id,
};

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function plain(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof ObjectID) {
    return value.toString();
  }
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }
  return value;
}

// Whether a record answers a list read's query, as the API would.
function matches(item, query) {
  for (const [field, expected] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }

    const actual = plain(item[field]);

    if (expected instanceof Includes) {
      const values = expected.values.map((value) => String(plain(value)));
      if (!values.includes(String(actual))) {
        return false;
      }
      continue;
    }

    if (expected instanceof Search) {
      if (
        !String(actual || "")
          .toLowerCase()
          .includes(String(expected.toString()).toLowerCase())
      ) {
        return false;
      }
      continue;
    }

    if (expected instanceof ObjectID) {
      if (String(actual).toLowerCase() !== expected.toString().toLowerCase()) {
        return false;
      }
      continue;
    }

    // Other operators (a sort helper, a "not archived") are not modelled.
    if (expected && typeof expected === "object") {
      continue;
    }

    if (String(actual) !== String(plain(expected))) {
      return false;
    }
  }

  return true;
}

function rowsOf(modelType, fn) {
  const name = tableName(modelType);
  const table = TABLES[name];

  if (!table) {
    window.__fixture.unhandled.push({ fn, model: name });
    return [];
  }

  return table;
}

// A list read's sort, as the API applies it: by each field asked, in turn.
function sorted(rows, sort) {
  const fields = Object.entries(sort || {});

  if (fields.length === 0) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const [field, order] of fields) {
      const a = String(plain(left[field]) || "");
      const b = String(plain(right[field]) || "");
      const compared = a.localeCompare(b);

      if (compared !== 0) {
        return order === "DESC" ? -compared : compared;
      }
    }

    return 0;
  });
}

ModelAPI.getList = async (options) => {
  const rows = sorted(
    rowsOf(options.modelType, "getList").filter((item) =>
      matches(item, options.query),
    ),
    options.sort,
  );
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: rows.slice(skip, skip + limit),
    count: rows.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  return rowsOf(options.modelType, "count").filter((item) =>
    matches(item, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const id = String(plain(options.id)).toLowerCase();
  return (
    rowsOf(options.modelType, "getItem").find(
      (item) => String(item._id).toLowerCase() === id,
    ) || null
  );
};

// A create, as ModelForm sends it: recorded, and answered with a new id.
ModelAPI.createOrUpdate = async (options) => {
  window.__fixture.saves.push({
    model: tableName(options.modelType),
    data: BaseModel.toJSON(options.model, options.modelType),
    miscDataProps: JSON.parse(JSON.stringify(options.miscDataProps || {})),
  });

  return new HTTPResponse(200, { _id: uuid("90") }, {});
};

// ---- the owner rule preview, as the server answers it ------------------------

function teamIdsOf(teams) {
  return teams.map((team) => team._id);
}

function incidentRules(draft) {
  const rules = [];

  if ((draft.labelIds || []).includes(DATABASE_LABEL._id)) {
    rules.push({
      ruleId: "a0000000-0000-4000-8000-0000000000c1",
      ruleName: "Database incidents",
      userIds: [GRACE._id],
      teamIds: [DATABASE._id],
      creatorTeamIds: [],
      notifiesOwners: true,
    });
  }

  const creatorTeams = MY_TEAMS.filter((team) =>
    [PLATFORM, DATABASE, FRONTEND].includes(team),
  );

  rules.push({
    ruleId: "a0000000-0000-4000-8000-0000000000c2",
    ruleName: "Add the creator's team as an owner",
    userIds: [],
    teamIds: teamIdsOf(creatorTeams),
    creatorTeamIds: teamIdsOf(creatorTeams),
    notifiesOwners: true,
  });

  return rules;
}

function alertRules() {
  return [
    {
      ruleId: "a0000000-0000-4000-8000-0000000000c3",
      ruleName: "Checkout alerts",
      userIds: [LINUS._id],
      teamIds: [SRE._id],
      creatorTeamIds: [],
      notifiesOwners: true,
    },
  ];
}

API.post = async (options) => {
  const url = String(options.url);

  if (url.endsWith("/owner-rule-preview")) {
    window.__fixture.previews.push({
      url,
      body: JSON.parse(JSON.stringify(options.data || {})),
      headers: options.headers || {},
    });

    if (rulesMode === "slow") {
      return await new Promise(() => {});
    }

    if (rulesMode === "error") {
      return new HTTPErrorResponse(
        500,
        { message: "Something went wrong." },
        {},
      );
    }

    if (rulesMode === "denied") {
      return new HTTPErrorResponse(
        422,
        {
          message:
            "You do not have permission to see which owner rules would run.",
        },
        {},
      );
    }

    if (rulesMode === "none") {
      return new HTTPResponse(200, { rules: [] }, {});
    }

    return new HTTPResponse(
      200,
      {
        rules: url.endsWith("/incident/owner-rule-preview")
          ? incidentRules(options.data || {})
          : alertRules(),
      },
      {},
    );
  }

  // "Will notify" on Declare Incident: no status page in this project.
  if (url.endsWith("/incident/subscriber-audience")) {
    return new HTTPResponse(
      200,
      {
        hasMonitors: false,
        isScoped: false,
        isHiddenFromStatusPages: false,
        statusPages: [],
        excludedStatusPages: [],
        hiddenStatusPageCount: 0,
        hiddenSubscriberCounts: {},
      },
      {},
    );
  }

  window.__fixture.unhandled.push({ fn: "API.post", url });
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  window.__fixture.unhandled.push({ fn: "API.get", url: String(options.url) });
  return new HTTPResponse(200, {}, {});
};

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

  if (isRulesPage) {
    const RulesPage =
      form === "alert-rules" ? AlertOwnerRulesPage : IncidentOwnerRulesPage;

    return (
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
        <RulesPage
          pageRoute={Navigation.getCurrentRoute()}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </main>
    );
  }

  const Create = form === "alert" ? AlertCreate : IncidentCreate;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
      <Create
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

const target = `/dashboard/${PROJECT_ID}/${
  form === "alert" || form === "alert-rules" ? "alerts" : "incidents"
}/${isRulesPage ? "settings/owner-rules" : "create"}`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/incidents/create"
        element={<Shell />}
      />
      <PageRoute
        path="/dashboard/:projectId/alerts/create"
        element={<Shell />}
      />
      <PageRoute
        path="/dashboard/:projectId/incidents/settings/owner-rules"
        element={<Shell />}
      />
      <PageRoute
        path="/dashboard/:projectId/alerts/settings/owner-rules"
        element={<Shell />}
      />
      <PageRoute
        path="*"
        element={<p data-testid="left-the-form">Created</p>}
      />
    </Routes>
  </BrowserRouter>,
);
