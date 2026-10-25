/*
 * Offline fixture for the postmortems of every incident: Incidents ->
 * Postmortems (Pages/Incidents/Postmortems), an incident's Postmortem page
 * (Pages/Incidents/View/Postmortem) and Incidents -> Settings -> Postmortem
 * Statuses (Pages/Incidents/Settings/IncidentPostmortemStatuses), each in the
 * Dashboard's own frame beside its real side menu. The pages, their tiles,
 * chips, pills, menus and dialogs are the production ones from this branch;
 * only the ModelAPI / API data boundary and the signed-in user's permissions
 * are replaced.
 *
 * Steered by the query string:
 *   - page=list        Incidents -> Postmortems (the default)
 *   - page=tab         an incident's Postmortem page, with incident=1 (a
 *                      written draft, the default), 2 (nothing written yet)
 *                      or 3 (published on the status page)
 *   - page=settings    Incidents -> Settings -> Postmortem Statuses
 *   - custom=1         the project added In Review and archived a status of
 *                      its own (Legacy Done), with incidents in each
 *   - empty=1          the project has no incidents yet
 *   - templates=<n>    how many postmortem templates the project has (2 by
 *                      default)
 *   - ai=off           the project has AI switched off
 *   - role=viewer      may read only (Viewer); the default is a project owner
 *   - fail=move        the next status move is refused, as a server would
 *   - owners=none      nobody owns any incident yet
 *   - fail=owner-add   every owner the postmortem's Add owners list adds is
 *                      refused, as the server refuses a second row for an
 *                      owner
 *   - lang=de          the Dashboard's German words
 *   - theme=dark       dark mode (set before the bundle by server.js)
 *
 * What the pages send is recorded on window.__fixture: `updates` (each
 * updateById: model, id, data as JSON) and `saves` (each createOrUpdate), so
 * the spec checks what was sent, not only what was drawn. The tables answer
 * from in-memory records, which a move changes: the counts, the rows and the
 * pills read the new status, as they would from the server.
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
import PostmortemsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Postmortems";
import IncidentPostmortemPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem";
import PostmortemStatusesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPostmortemStatuses";
import IncidentsSideMenu from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu";
import IncidentViewSideMenu from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu";
import Page from "Common/UI/Components/Page/Page";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";

const params = new URLSearchParams(window.location.search);
const pageName = ["list", "tab", "settings"].includes(params.get("page"))
  ? params.get("page")
  : "list";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const isEmpty = params.get("empty") === "1";
const withCustom = params.get("custom") === "1";
const templateCount = Math.min(
  2,
  Math.max(0, Number(params.get("templates") ?? 2)),
);
const language = params.get("lang") === "de" ? "de" : "en";
let failNextMove = params.get("fail") === "move";
const failOwnerAdds = params.get("fail") === "owner-add";
const isOwnedByNobody = params.get("owners") === "none";

window.__fixture = { updates: [], saves: [] };

// ---- who is signed in -------------------------------------------------------

const HELD = {
  owner: [Permission.ProjectOwner],
  viewer: [Permission.Viewer, Permission.ProjectUser],
}[role];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
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
ProjectUtil.getCurrentPlan = () => PlanType.Growth;
// The project the dashboard has selected, which Enable AI is read off (ai=off).
ProjectUtil.getCurrentProject = () => ({
  _id: PROJECT_ID,
  name: "Acme Production",
  enableAi: params.get("ai") !== "off",
});
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

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

const project = record(Project, {
  _id: PROJECT_ID,
  name: "Acme Production",
  enableAi: params.get("ai") !== "off",
});

function status(number, name, color, order, flags, description) {
  return record(IncidentPostmortemStatus, {
    _id: `a0000000-0000-4000-8000-00000000000${number}`,
    projectId: new ObjectID(PROJECT_ID),
    name: name,
    color: new Color(color),
    order: order,
    description: description,
    isNotStartedStatus: false,
    isDraftStatus: false,
    isCompletedStatus: false,
    isArchived: false,
    ...flags,
  });
}

// The four a project starts with; custom=1 adds In Review and an archived one.
const STATUSES = [
  status(
    1,
    "Not Started",
    "#6b7280",
    1,
    { isNotStartedStatus: true },
    "Nobody has written this postmortem yet.",
  ),
  status(
    2,
    "Draft",
    "#ffbf53",
    2,
    { isDraftStatus: true },
    "The postmortem is being written.",
  ),
  ...(withCustom
    ? [
        status(
          5,
          "In Review",
          "#3b82f6",
          3,
          {},
          "The postmortem is written and waiting for the team's review.",
        ),
      ]
    : []),
  status(
    3,
    "Completed",
    "#2ab57d",
    withCustom ? 4 : 3,
    { isCompletedStatus: true },
    "The postmortem is written and done.",
  ),
  status(
    4,
    "Not Needed",
    "#c2c2c2",
    withCustom ? 5 : 4,
    {},
    "This incident does not need a postmortem.",
  ),
  ...(withCustom
    ? [
        status(
          6,
          "Legacy Done",
          "#8b5cf6",
          6,
          { isArchived: true },
          "From the old process.",
        ),
      ]
    : []),
];

function statusNumbered(number) {
  return STATUSES.find((candidate) => candidate._id.endsWith(`0${number}`));
}

const SEVERITIES = [
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e1",
    name: "Critical",
    color: new Color("#dc2626"),
    order: 1,
    isArchived: false,
  }),
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e2",
    name: "Major",
    color: new Color("#ea580c"),
    order: 2,
    isArchived: false,
  }),
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e3",
    name: "Minor",
    color: new Color("#ca8a04"),
    order: 3,
    isArchived: false,
  }),
];

const STATES = [
  record(IncidentState, {
    _id: "51000000-0000-4000-8000-0000000000e1",
    name: "Identified",
    color: new Color("#dc2626"),
    order: 1,
    isCreatedState: true,
    isArchived: false,
  }),
  record(IncidentState, {
    _id: "51000000-0000-4000-8000-0000000000e2",
    name: "Acknowledged",
    color: new Color("#ffbf53"),
    order: 2,
    isAcknowledgedState: true,
    isArchived: false,
  }),
  record(IncidentState, {
    _id: "51000000-0000-4000-8000-0000000000e3",
    name: "Resolved",
    color: new Color("#2ab57d"),
    order: 3,
    isResolvedState: true,
    isArchived: false,
  }),
];

const LABELS = [
  record(Label, {
    _id: "60000000-0000-4000-8000-0000000000f1",
    name: "production",
    color: new Color("#4f46e5"),
    isArchived: false,
  }),
  record(Label, {
    _id: "60000000-0000-4000-8000-0000000000f2",
    name: "database",
    color: new Color("#0d9488"),
    isArchived: false,
  }),
];

const USERS = [
  record(User, {
    _id: USER_ID,
    name: "Alice Smith",
    email: "alice@acme.test",
  }),
  record(User, {
    _id: "30000000-0000-4000-8000-0000000000c2",
    name: "Bob Jones",
    email: "bob@acme.test",
  }),
];

const TEAMS = [
  record(Team, {
    _id: "31000000-0000-4000-8000-0000000000c1",
    name: "SRE",
  }),
  record(Team, {
    _id: "31000000-0000-4000-8000-0000000000c2",
    name: "Database Team",
  }),
];

const NOTE = `## Summary

The primary Postgres node ran out of disk space at 09:12 UTC. Writes failed for 23 minutes, and the checkout API returned errors to about 4% of customers.

## Action items

1. Alert at 80% disk usage instead of 95%.
2. Automate WAL archiving to object storage.`;

function incident(number, fields) {
  const postmortemStatus = statusNumbered(fields.statusNumber);
  delete fields.statusNumber;

  return record(Incident, {
    _id: `b0000000-0000-4000-8000-00000000010${number}`,
    projectId: new ObjectID(PROJECT_ID),
    incidentNumber: 100 + number,
    incidentNumberWithPrefix: `INC-${100 + number}`,
    declaredAt: new Date(Date.UTC(2026, 9, 21 - number, 9, 12)),
    createdAt: new Date(Date.UTC(2026, 9, 21 - number, 9, 12)),
    showPostmortemOnStatusPage: false,
    notifySubscribersOnPostmortemPublished: true,
    isVisibleOnStatusPage: true,
    isPrivate: false,
    postmortemAttachments: [],
    labels: [],
    postmortemStatus: postmortemStatus,
    postmortemStatusId: new ObjectID(postmortemStatus._id),
    ...fields,
  });
}

/*
 * Six incidents: three not started, a draft, a completed one published on
 * the status page and one that needs no postmortem; custom=1 adds one in
 * review and one in the archived status.
 */
const INCIDENTS = isEmpty
  ? []
  : [
      incident(1, {
        title: "Checkout API errors after Postgres disk filled up",
        incidentSeverity: SEVERITIES[0],
        currentIncidentState: STATES[2],
        postmortemNote: NOTE,
        labels: [LABELS[0], LABELS[1]],
        statusNumber: 2,
      }),
      incident(2, {
        title: "Payments webhook delays",
        incidentSeverity: SEVERITIES[1],
        currentIncidentState: STATES[2],
        statusNumber: 1,
      }),
      incident(3, {
        title: "Login page down in EU region",
        incidentSeverity: SEVERITIES[0],
        currentIncidentState: STATES[2],
        postmortemNote: NOTE,
        showPostmortemOnStatusPage: true,
        postmortemPostedAt: new Date("2026-10-19T15:00:00Z"),
        labels: [LABELS[0]],
        statusNumber: 3,
      }),
      incident(4, {
        title: "Slow search results",
        incidentSeverity: SEVERITIES[2],
        currentIncidentState: STATES[2],
        statusNumber: 4,
      }),
      incident(5, {
        title:
          "Elevated 5xx on the public API gateway after the 14.0.80 deploy",
        incidentSeverity: SEVERITIES[1],
        currentIncidentState: STATES[1],
        labels: [LABELS[0]],
        statusNumber: 1,
      }),
      incident(6, {
        title: "Background jobs backlog",
        incidentSeverity: SEVERITIES[2],
        currentIncidentState: STATES[0],
        statusNumber: 1,
      }),
      ...(withCustom
        ? [
            incident(7, {
              title: "Certificate expired on status.acme.test",
              incidentSeverity: SEVERITIES[0],
              currentIncidentState: STATES[2],
              postmortemNote: NOTE,
              statusNumber: 5,
            }),
            incident(8, {
              title: "Old outage from before the new process",
              incidentSeverity: SEVERITIES[2],
              currentIncidentState: STATES[2],
              statusNumber: 6,
            }),
          ]
        : []),
    ];

// Alice owns the first and third; the Database Team the first; SRE the fifth.
const OWNER_USERS =
  isEmpty || isOwnedByNobody
  ? []
  : [
      record(IncidentOwnerUser, {
        _id: "c0000000-0000-4000-8000-000000000001",
        incidentId: new ObjectID(INCIDENTS[0]._id),
        userId: new ObjectID(USERS[0]._id),
        user: USERS[0],
      }),
      record(IncidentOwnerUser, {
        _id: "c0000000-0000-4000-8000-000000000002",
        incidentId: new ObjectID(INCIDENTS[1]._id),
        userId: new ObjectID(USERS[1]._id),
        user: USERS[1],
      }),
      record(IncidentOwnerUser, {
        _id: "c0000000-0000-4000-8000-000000000003",
        incidentId: new ObjectID(INCIDENTS[2]._id),
        userId: new ObjectID(USERS[0]._id),
        user: USERS[0],
      }),
    ];

const OWNER_TEAMS =
  isEmpty || isOwnedByNobody
  ? []
  : [
      record(IncidentOwnerTeam, {
        _id: "c1000000-0000-4000-8000-000000000001",
        incidentId: new ObjectID(INCIDENTS[0]._id),
        teamId: new ObjectID(TEAMS[1]._id),
        team: TEAMS[1],
      }),
      record(IncidentOwnerTeam, {
        _id: "c1000000-0000-4000-8000-000000000002",
        incidentId: new ObjectID(INCIDENTS[4]._id),
        teamId: new ObjectID(TEAMS[0]._id),
        team: TEAMS[0],
      }),
    ];

const TEMPLATES = [
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b01",
    templateName: "Customer-facing outage",
    postmortemNote: "## Summary\n\n## Impact\n\n## Action items",
  }),
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b02",
    templateName: "Database outage",
    postmortemNote: "## Summary\n\n## Timeline\n\n## Action items",
  }),
].slice(0, templateCount);

/*
 * The project's people, as the owners' Add owners list reads them: through
 * their team memberships (User itself is not project-listable).
 */
const TEAM_MEMBERS = USERS.map((user, index) => {
  return record(TeamMember, {
    _id: `c2000000-0000-4000-8000-00000000000${index + 1}`,
    teamId: new ObjectID(TEAMS[0]._id),
    team: TEAMS[0],
    userId: new ObjectID(user._id),
    user: user,
    hasAcceptedInvitation: true,
  });
});

const TABLES = {
  Project: [project],
  TeamMember: TEAM_MEMBERS,
  IncidentPostmortemStatus: STATUSES,
  IncidentSeverity: SEVERITIES,
  IncidentState: STATES,
  Label: LABELS,
  Incident: INCIDENTS,
  IncidentOwnerUser: OWNER_USERS,
  IncidentOwnerTeam: OWNER_TEAMS,
  IncidentPostmortemTemplate: TEMPLATES,
  User: USERS,
  Team: TEAMS,
};

// ---- the API -----------------------------------------------------------------

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
    return value._id.toString().toLowerCase();
  }

  return value.toString().toLowerCase();
}

function sorted(items, sort) {
  const [column, direction] = Object.entries(sort || {})[0] || [];

  if (!column) {
    // The server's default: newest first.
    return [...items].sort((first, second) => {
      return (
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime()
      );
    });
  }

  const sign = direction === SortOrder.Descending ? -1 : 1;

  return [...items].sort((first, second) => {
    const a = first[column];
    const b = second[column];

    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * sign;
    }

    if (a instanceof Date && b instanceof Date) {
      return (a.getTime() - b.getTime()) * sign;
    }

    return String(a ?? "").localeCompare(String(b ?? "")) * sign;
  });
}

// The ids a row holds under a key: a relation, a list of them, or an id column.
function heldIds(item, key) {
  const value = item[key] ?? item[`${key}Id`];

  if (Array.isArray(value)) {
    return value.map(idOf);
  }

  return [idOf(value)];
}

function matchesQuery(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (key === "projectId" || value === undefined || value === null) {
      continue;
    }

    if (typeof value === "boolean") {
      if (Boolean(item[key]) !== value) {
        return false;
      }
      continue;
    }

    if (value instanceof Search) {
      const text = String(item[key] ?? "").toLowerCase();
      if (!text.includes(String(value.toString()).toLowerCase())) {
        return false;
      }
      continue;
    }

    if (value instanceof Includes || value instanceof IncludesNone) {
      const wanted = (value.values || []).map(idOf);
      const held = heldIds(item, key);
      const anyHeld = held.some((id) => {
        return wanted.includes(id);
      });

      if (value instanceof Includes ? !anyHeld : anyHeld) {
        return false;
      }
      continue;
    }

    if (value instanceof ObjectID || typeof value === "string") {
      if (!heldIds(item, key).includes(idOf(value))) {
        return false;
      }
    }
  }

  return true;
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  const items = sorted(
    (TABLES[name] || []).filter((item) => matchesQuery(item, options.query)),
    options.sort,
  );
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
  return (TABLES[tableName(options.modelType)] || []).filter((item) =>
    matchesQuery(item, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  return table.find((item) => idOf(item._id) === idOf(options.id)) || null;
};

// A move of a postmortem: kept, so the counts, the rows and the pills follow it.
ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  const data = JSON.parse(JSON.stringify(options.data || {}));

  window.__fixture.updates.push({ model: name, id: idOf(options.id), data });

  if (failNextMove && data.postmortemStatusId !== undefined) {
    failNextMove = false;
    throw new HTTPErrorResponse(
      400,
      { message: "This postmortem status is archived. Pick another one." },
      {},
    );
  }

  const item = (TABLES[name] || []).find(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );

  if (item && options.data && options.data.postmortemStatusId) {
    const target = STATUSES.find(
      (candidate) =>
        idOf(candidate._id) === idOf(options.data.postmortemStatusId),
    );
    item.postmortemStatusId = new ObjectID(target._id);
    item.postmortemStatus = target;
  }

  return new HTTPResponse(200, {}, {});
};

ModelAPI.createOrUpdate = async (options) => {
  const name = tableName(options.modelType);
  const json = BaseModel.toJSON(options.model, options.modelType);

  window.__fixture.saves.push({ model: name, data: json });

  /*
   * An owner added from the postmortem: a row the incident's owners are
   * read from again, naming the person or the team as the server's join does.
   */
  if (name === "IncidentOwnerUser" || name === "IncidentOwnerTeam") {
    const isUser = name === "IncidentOwnerUser";

    if (failOwnerAdds) {
      throw new HTTPErrorResponse(
        400,
        {
          message: isUser
            ? "This user is already an owner of this incident."
            : "This team is already an owner of this incident.",
        },
        {},
      );
    }

    const pickedId = idOf(isUser ? options.model.userId : options.model.teamId);
    const rowNumber = OWNER_USERS.length + OWNER_TEAMS.length + 1;
    const row = record(isUser ? IncidentOwnerUser : IncidentOwnerTeam, {
      _id: `c3000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
      incidentId: new ObjectID(idOf(options.model.incidentId)),
      ...(isUser
        ? {
            userId: new ObjectID(pickedId),
            user: USERS.find((user) => idOf(user._id) === pickedId),
          }
        : {
            teamId: new ObjectID(pickedId),
            team: TEAMS.find((team) => idOf(team._id) === pickedId),
          }),
    });
    (isUser ? OWNER_USERS : OWNER_TEAMS).push(row);
  }

  return new HTTPResponse(200, json, {});
};
ModelAPI.create = ModelAPI.createOrUpdate;
ModelAPI.deleteItem = async () => {
  return undefined;
};

// Generate with AI's draft, and anything else the pages read beside ModelAPI.
API.post = async () => {
  return new HTTPResponse(200, { postmortemNote: "## Drafted by AI" }, {});
};
API.get = async () => {
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

// ---- the pages ---------------------------------------------------------------

function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { id } = useParams();
  const route = Navigation.getCurrentRoute();

  if (props.kind === "tab") {
    return (
      <Page
        title="Incident"
        sideMenu={<IncidentViewSideMenu modelId={new ObjectID(id)} />}
        breadcrumbLinks={[]}
      >
        <IncidentPostmortemPage
          pageRoute={route}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </Page>
    );
  }

  return (
    <Page
      title="Incidents"
      sideMenu={<IncidentsSideMenu project={project} />}
      breadcrumbLinks={[]}
    >
      {props.kind === "settings" ? (
        <PostmortemStatusesPage
          pageRoute={route}
          currentProject={project}
          hasPaymentMethod={true}
        />
      ) : (
        <PostmortemsPage
          pageRoute={route}
          currentProject={project}
          hasPaymentMethod={true}
        />
      )}
    </Page>
  );
}

const tabIncident =
  {
    1: INCIDENTS[0],
    2: INCIDENTS[1],
    3: INCIDENTS[2],
  }[Math.max(1, Number(params.get("incident") || 1))] || INCIDENTS[0];

const target = {
  list: `/dashboard/${PROJECT_ID}/incidents/postmortems`,
  settings: `/dashboard/${PROJECT_ID}/incidents/settings/postmortem-statuses`,
  tab: `/dashboard/${PROJECT_ID}/incidents/${
    tabIncident ? tabIncident._id : "b0000000-0000-4000-8000-000000000101"
  }/postmortem`,
}[pageName];

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/incidents/postmortems"
        element={<Shell kind="list" />}
      />
      <PageRoute
        path="/dashboard/:projectId/incidents/settings/postmortem-statuses"
        element={<Shell kind="settings" />}
      />
      <PageRoute
        path="/dashboard/:projectId/incidents/:id/postmortem"
        element={<Shell kind="tab" />}
      />
    </Routes>
  </BrowserRouter>,
);
