/*
 * Offline fixture for the real Status Pages list and its Archived page, an
 * incident's State Timeline page and the Teams list.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, their ModelTable (the row ⋯ menu, the
 * bulk bar, both Delete dialogs and the bulk result) and the facet bar are
 * the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=archived           the Archived Status Pages page instead of the
 *                             list
 *   - page=incident-timeline  an incident's State Timeline page; the
 *                             incident is the one the path names
 *                             (.../incidents/<id>/state-timeline): one with
 *                             three states, or one with only the state it
 *                             was declared in
 *   - page=teams              the Teams list: Owners and Admin, which come
 *                             with every project, Members and a team of the
 *                             project's own
 *   - page=monitors           the Monitors list, whose Delete says the most
 *                             about what goes with a record
 *   - page=status-page-delete a status page's own Delete page (Status Page
 *                             > Delete); the status page is the one the path
 *                             names (.../status-pages/<id>/delete)
 *   - role=viewer             a member who may read status pages but not
 *                             delete them (Viewer); the default is a project
 *                             owner
 *   - refuse=<ids>            status pages (comma-separated ids) whose delete
 *                             the server refuses, as it refuses a delete the
 *                             member's label-scoped permission does not cover
 *   - rows=<n>                how many extra status pages to list
 *                             (pagination)
 *   - long=1                  two status pages with long names: one of many
 *                             words, one a single word with no break in it
 *   - delay=<ms>              how long each delete takes, so a bulk Delete
 *                             can be seen while it runs
 *   - lang=de|ja              the Dashboard's German or Japanese words
 *
 * Every delete request is recorded on `window.__fixture.deletes`, and every
 * list request on `window.__fixture.listRequests`, so the spec checks what
 * the page sent, not only what it drew. The timeline and the teams answer a
 * delete as their services do: the only state, and a team that comes with
 * every project, are refused in the server's words.
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
import StatusPages from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import StatusPagesArchived from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Archived";
import IncidentStateTimelinePage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import TeamsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import MonitorsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import StatusPageDeletePage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Delete";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorType from "Common/Types/Monitor/MonitorType";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Team from "Common/Models/DatabaseModels/Team";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { BUILT_IN_TEAM_DELETE_MESSAGE } from "Common/Types/Team/BuiltInTeam";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "Common/Utils/StateTimeline/StateTimelineRowDelete";
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
const page = params.get("page") || "list";
const isArchivedPage = page === "archived";
const role = params.get("role") || "owner";
const refused = (params.get("refuse") || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter(Boolean);
const extraRows = Number(params.get("rows") || 0);
const hasLongNames = params.get("long") === "1";
const deleteDelay = Math.max(0, Number(params.get("delay") || 0));
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

// The server's words when a label-scoped permission does not cover the row.
const REFUSAL =
  "You do not have permission to delete this Status Page. You need to have one of the following labels: Marketing.";

function statusPage(id, name, description, isArchived) {
  const record = new StatusPage();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.labels = [];
  record.isArchived = Boolean(isArchived);
  if (isArchived) {
    record.archivedAt = new Date("2026-09-30T09:15:00.000Z");
  }
  return record;
}

// The three rows of the maintainer's screenshot, and two archived ones.
const statusPages = [
  statusPage(
    "30000000-0000-4000-8000-000000000001",
    "Demo Status 13",
    "Demo Status234",
  ),
  statusPage(
    "30000000-0000-4000-8000-000000000002",
    "Demo Status",
    "Demo Status",
  ),
  statusPage(
    "30000000-0000-4000-8000-000000000003",
    "Production Status Page",
    "Production Status Page",
  ),
  statusPage(
    "30000000-0000-4000-8000-000000000004",
    "Old Marketing Page",
    "Retired with the 2025 launch",
    true,
  ),
  statusPage(
    "30000000-0000-4000-8000-000000000005",
    "Staging Status",
    "Not used any more",
    true,
  ),
];

/*
 * Names as long as people give them: a sentence of a name, and a single word
 * with nowhere to break (a host name, a slug).
 */
const LONG_NAMES = [
  "Customer-Facing Status Page for EU-West Enterprise Customers, Partners and Resellers (Primary)",
  "status.eu-west-1.enterprise-customers.partners-and-resellers.example.com",
];

if (hasLongNames) {
  LONG_NAMES.forEach((name, index) => {
    statusPages.push(
      statusPage(
        `32000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name,
        "A page with a long name",
      ),
    );
  });
}

for (let index = 0; index < extraRows; index++) {
  statusPages.push(
    statusPage(
      `31000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      `Regional Status ${String(index + 1).padStart(2, "0")}`,
      "One region's page",
    ),
  );
}

/*
 * Two incidents: one that went Created -> Acknowledged -> Resolved, and one
 * still in the state it was declared in, whose only state can't be deleted.
 */
const INCIDENT_WITH_HISTORY = "40000000-0000-4000-8000-000000000001";
const INCIDENT_JUST_DECLARED = "40000000-0000-4000-8000-000000000002";

function incidentState(id, name, color) {
  const state = new IncidentState();
  state._id = id;
  state.name = name;
  state.color = new Color(color);
  return state;
}

const CREATED = incidentState(
  "41000000-0000-4000-8000-000000000001",
  "Created",
  "#ef4444",
);
const ACKNOWLEDGED = incidentState(
  "41000000-0000-4000-8000-000000000002",
  "Acknowledged",
  "#f59e0b",
);
const RESOLVED = incidentState(
  "41000000-0000-4000-8000-000000000003",
  "Resolved",
  "#10b981",
);

function timelineRow(id, incidentId, state, startsAt, endsAt) {
  const row = new IncidentStateTimeline();
  row._id = id;
  row.projectId = new ObjectID(PROJECT_ID);
  row.incidentId = new ObjectID(incidentId);
  row.incidentStateId = new ObjectID(state._id);
  row.incidentState = state;
  row.startsAt = new Date(startsAt);
  if (endsAt) {
    row.endsAt = new Date(endsAt);
  }
  row.subscriberNotificationStatus =
    StatusPageSubscriberNotificationStatus.Skipped;
  row.subscriberNotificationStatusMessage =
    "Status page subscribers were not asked to be notified.";
  return row;
}

const timeline = [
  timelineRow(
    "42000000-0000-4000-8000-000000000001",
    INCIDENT_WITH_HISTORY,
    CREATED,
    "2026-10-14T08:00:00.000Z",
    "2026-10-14T08:12:00.000Z",
  ),
  timelineRow(
    "42000000-0000-4000-8000-000000000002",
    INCIDENT_WITH_HISTORY,
    ACKNOWLEDGED,
    "2026-10-14T08:12:00.000Z",
    "2026-10-14T09:05:00.000Z",
  ),
  timelineRow(
    "42000000-0000-4000-8000-000000000003",
    INCIDENT_WITH_HISTORY,
    RESOLVED,
    "2026-10-14T09:05:00.000Z",
  ),
  timelineRow(
    "42000000-0000-4000-8000-000000000004",
    INCIDENT_JUST_DECLARED,
    CREATED,
    "2026-10-14T10:30:00.000Z",
  ),
];

function team(id, name, description, isTeamDeleteable) {
  const record = new Team();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.isTeamDeleteable = isTeamDeleteable;
  return record;
}

// The three teams every project starts with, and one of its own.
const teams = [
  team(
    "50000000-0000-4000-8000-000000000001",
    "Owners",
    "Owners of this project.",
    false,
  ),
  team(
    "50000000-0000-4000-8000-000000000002",
    "Admin",
    "Admins of this project.",
    false,
  ),
  team(
    "50000000-0000-4000-8000-000000000003",
    "Members",
    "Members of this project.",
    true,
  ),
  team(
    "50000000-0000-4000-8000-000000000004",
    "Platform On-Call",
    "Who is paged for the platform.",
    true,
  ),
];

function monitorStatus(id, name, color) {
  const status = new MonitorStatus();
  status._id = id;
  status.name = name;
  status.color = new Color(color);
  return status;
}

const OPERATIONAL = monitorStatus(
  "61000000-0000-4000-8000-000000000001",
  "Operational",
  "#10b981",
);
const DEGRADED = monitorStatus(
  "61000000-0000-4000-8000-000000000002",
  "Degraded",
  "#f59e0b",
);

function monitor(id, name, description, monitorType, status) {
  const record = new Monitor();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.monitorType = monitorType;
  record.currentMonitorStatus = status;
  record.currentMonitorStatusId = new ObjectID(status._id);
  record.labels = [];
  record.isArchived = false;
  return record;
}

const monitors = [
  monitor(
    "60000000-0000-4000-8000-000000000001",
    "Checkout API",
    "The payment path customers use",
    MonitorType.API,
    OPERATIONAL,
  ),
  monitor(
    "60000000-0000-4000-8000-000000000002",
    "Marketing Website",
    "www, from three regions",
    MonitorType.Website,
    DEGRADED,
  ),
  monitor(
    "60000000-0000-4000-8000-000000000003",
    "Primary Database Ping",
    "The writer's address",
    MonitorType.Ping,
    OPERATIONAL,
  ),
];

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

window.__fixture = {
  listRequests: [],
  deletes: [],
  refusedDeletes: [],
};

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
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
    if (typeof condition === "boolean") {
      if (Boolean(record[key]) !== condition) {
        return false;
      }
      continue;
    }
    if (condition instanceof LessThanOrEqual) {
      if (!(record[key] <= new Date(condition.value))) {
        return false;
      }
      continue;
    }
    if (condition instanceof GreaterThan) {
      if (!(record[key] > new Date(condition.value))) {
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
    // The record a row belongs to: the timeline's incidentId.
    if (
      key.endsWith("Id") &&
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
    return first[field] > second[field]
      ? direction
      : first[field] < second[field]
        ? -direction
        : 0;
  });
}

const RECORDS = {
  StatusPage: statusPages,
  IncidentStateTimeline: timeline,
  Team: teams,
  Monitor: monitors,
};

/*
 * A project owner, or a Viewer: may read status pages, may not delete them.
 * Not a master admin, so the gates read this snapshot as they do for anyone.
 */
const heldPermission =
  role === "viewer" ? Permission.Viewer : Permission.ProjectOwner;

User.isMasterAdmin = () => false;
User.getUserId = () => new ObjectID(USER_ID);
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

// A record's own page reads it by its id: the Delete page, for its name.
ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
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

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  return (RECORDS[tableName] || []).filter((record) =>
    matchesQuery(record, options.query),
  ).length;
};

/*
 * What the incident state timeline's service does when one row is deleted
 * by its id: the only state is refused; otherwise the state before it runs
 * on over its time (to the next state's start, or on as the current state).
 */
function deleteTimelineRow(id) {
  const row = timeline.find((candidate) => idOf(candidate._id) === id);
  if (!row) {
    throw new Error("Incident state timeline not found.");
  }
  const incidentRows = sortRows(
    timeline.filter(
      (candidate) => idOf(candidate.incidentId) === idOf(row.incidentId),
    ),
    { startsAt: SortOrder.Ascending },
  );
  if (incidentRows.length === 1) {
    throw new Error(ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.Incident]);
  }
  const position = incidentRows.indexOf(row);
  const before = incidentRows[position - 1];
  const after = incidentRows[position + 1];
  if (before) {
    before.endsAt = after ? after.startsAt : row.endsAt;
  }
  timeline.splice(timeline.indexOf(row), 1);
}

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = options.id.toString().toLowerCase();

  window.__fixture.deletes.push({ tableName, id });

  if (deleteDelay) {
    await new Promise((resolve) => {
      setTimeout(resolve, deleteDelay);
    });
  }

  if (tableName === "IncidentStateTimeline") {
    deleteTimelineRow(id);
    return;
  }

  if (tableName === "Team") {
    const record = teams.find((candidate) => idOf(candidate._id) === id);
    if (!record) {
      throw new Error("Team not found.");
    }
    if (!record.isTeamDeleteable) {
      throw new Error(BUILT_IN_TEAM_DELETE_MESSAGE);
    }
    teams.splice(teams.indexOf(record), 1);
    return;
  }

  if (tableName === "Monitor") {
    const index = monitors.findIndex((record) => idOf(record._id) === id);
    if (index === -1) {
      throw new Error("Monitor not found.");
    }
    monitors.splice(index, 1);
    return;
  }

  if (tableName !== "StatusPage") {
    throw new Error(`The fixture does not model deleting ${tableName}.`);
  }

  if (refused.includes(id)) {
    window.__fixture.refusedDeletes.push(id);
    throw new Error(REFUSAL);
  }

  const index = statusPages.findIndex((record) => {
    return record._id.toLowerCase() === id;
  });

  if (index === -1) {
    throw new Error("Status Page not found.");
  }

  statusPages.splice(index, 1);
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
  list: { component: StatusPages, trail: ["Status Pages"] },
  archived: {
    component: StatusPagesArchived,
    trail: ["Status Pages", "Archived"],
  },
  "incident-timeline": {
    component: IncidentStateTimelinePage,
    trail: ["Incidents", "State Timeline"],
  },
  teams: { component: TeamsPage, trail: ["Settings", "Teams"] },
  monitors: { component: MonitorsPage, trail: ["Monitors"] },
  "status-page-delete": {
    component: StatusPageDeletePage,
    trail: ["Status Pages", "Demo Status", "Delete"],
  },
};

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page] || PAGES.list;
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
