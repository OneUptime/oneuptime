/*
 * Offline fixture for archiving the values records pick from
 * (Common/Utils/ArchivableValues): the real Incident Severity and Incident
 * State settings pages, and the real Incident Templates page, whose Create
 * form picks a severity, a state and labels.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, their ModelTable (the row ⋯ menu, the
 * Delete dialog), the archive hook (Archive, the folded Archived section,
 * Unarchive) and the form's pickers are the production ones from this
 * branch.
 *
 * Steered by the query string:
 *   - page=severities   Incidents > Settings > Incident Severity (default)
 *   - page=states       Incidents > Settings > Incident State
 *   - page=templates    Incidents > Settings > Incident Templates
 *   - theme=dark        the Dashboard's dark mode
 *   - refuse-archive=1  the server refuses every archive, in its own words
 *   - slow-usage=1      what uses a value takes a second and a half to answer,
 *                       as on a big project: the dialogs say they are checking
 *   - lang=de           the Dashboard's German words (fa: Persian, right to
 *                       left, as the Dashboard draws it)
 *
 * Every update is recorded on `window.__fixture.updates`, every delete on
 * `window.__fixture.deletes`, every list request on
 * `window.__fixture.listRequests`, every usage read on
 * `window.__fixture.usageReads` and every read of several values at once (a
 * bulk Delete's) on `window.__fixture.bulkUsageReads`, so the spec checks
 * what the page sent as well as what it drew.
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
import IncidentSeveritiesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSeverity";
import IncidentStatesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState";
import IncidentTemplatesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import UserModel from "Common/Models/DatabaseModels/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "severities";
const refuseArchive = params.get("refuse-archive") === "1";
const slowUsage = params.get("slow-usage") === "1";
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  updates: [],
  deletes: [],
  listRequests: [],
  usageReads: [],
  bulkUsageReads: [],
};

function stamp(record, values) {
  record._id = values.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = values.name;
  record.description = values.description || "";
  record.color = new Color(values.color);
  record.isArchived = Boolean(values.isArchived);
  if (values.isArchived) {
    record.archivedAt = new Date("2026-10-14T09:15:00.000Z");
    const archivedBy = new UserModel();
    archivedBy._id = USER_ID;
    archivedBy.name = "Maya Chen";
    archivedBy.email = "maya.chen@acme-commerce.example";
    record.archivedByUser = archivedBy;
  }
  return record;
}

function severity(values) {
  const record = stamp(new IncidentSeverity(), values);
  record.order = values.order;
  return record;
}

function state(values) {
  const record = stamp(new IncidentState(), values);
  record.order = values.order;
  record.isCreatedState = Boolean(values.isCreatedState);
  record.isAcknowledgedState = Boolean(values.isAcknowledgedState);
  record.isResolvedState = Boolean(values.isResolvedState);
  return record;
}

function label(values) {
  return stamp(new Label(), values);
}

const IDS = {
  critical: "20000000-0000-4000-8000-000000000001",
  major: "20000000-0000-4000-8000-000000000002",
  minor: "20000000-0000-4000-8000-000000000003",
  veryCritical: "20000000-0000-4000-8000-000000000004",
  identified: "21000000-0000-4000-8000-000000000001",
  investigating: "21000000-0000-4000-8000-000000000002",
  acknowledged: "21000000-0000-4000-8000-000000000003",
  resolved: "21000000-0000-4000-8000-000000000004",
  monitoringFix: "21000000-0000-4000-8000-000000000005",
  payments: "22000000-0000-4000-8000-000000000001",
  legacyDb: "22000000-0000-4000-8000-000000000002",
};

// The maintainer's screenshot: a severity renamed so nobody picks it.
const severities = [
  severity({
    id: IDS.critical,
    name: "Critical",
    description: "Customers can't use the product.",
    color: "#b70400",
    order: 1,
  }),
  severity({
    id: IDS.major,
    name: "Major",
    description: "A part of the product is down.",
    color: "#fd625e",
    order: 2,
  }),
  severity({
    id: IDS.minor,
    name: "Minor",
    description: "Small impact, handled in working hours.",
    color: "#ffbf53",
    order: 3,
  }),
  severity({
    id: IDS.veryCritical,
    name: "[DONOTUSE] Very critical",
    description: "Retired: use Critical.",
    color: "#7f1d1d",
    order: 4,
    isArchived: true,
  }),
];

const states = [
  state({
    id: IDS.identified,
    name: "Identified",
    color: "#ef4444",
    order: 1,
    isCreatedState: true,
  }),
  state({
    id: IDS.investigating,
    name: "Investigating",
    color: "#f59e0b",
    order: 2,
  }),
  state({
    id: IDS.acknowledged,
    name: "Acknowledged",
    color: "#eab308",
    order: 3,
    isAcknowledgedState: true,
  }),
  state({
    id: IDS.resolved,
    name: "Resolved",
    color: "#10b981",
    order: 4,
    isResolvedState: true,
  }),
  state({
    id: IDS.monitoringFix,
    name: "Monitoring fix",
    color: "#8b5cf6",
    order: 5,
    isArchived: true,
  }),
];

const labels = [
  label({ id: IDS.payments, name: "payments", color: "#2563eb" }),
  label({
    id: IDS.legacyDb,
    name: "legacy-db",
    color: "#64748b",
    isArchived: true,
  }),
];

const RECORDS = {
  IncidentSeverity: severities,
  IncidentState: states,
  Label: labels,
};

/*
 * Everybody's own on-call rules for a severity, as the server counts them:
 * by person, members of the project only (ArchivableValueUsage - the
 * maintainer's "Notification Rules (22)" was two people's rules, one per
 * kind and method).
 */
function onCallRulesOf(people) {
  return {
    tableName: "UserNotificationRule",
    title: "Notification Rules",
    singularTitle: "Notification Rule",
    count: people,
    isCountCapped: false,
    effect: "Deleted",
    kind: "Personal",
  };
}

/*
 * What uses each value, as POST <value route>/:id/usage answers: Critical
 * is on incidents (a delete is refused), in on-call rules and in the own
 * on-call rules of 11 people; Major only in a label rule; Minor only in the
 * own on-call rules of 2 people - the maintainer's dialog; the rest nothing.
 */
const USAGE = {
  [IDS.critical]: [
    {
      tableName: "Incident",
      title: "Incidents",
      singularTitle: "Incident",
      count: 12,
      isCountCapped: false,
      effect: "Refused",
      kind: "Records",
    },
    {
      tableName: "IncidentOnCallRule",
      title: "Incident On-Call Rules",
      singularTitle: "Incident On-Call Rule",
      count: 3,
      isCountCapped: false,
      effect: "RemovedFromList",
      kind: "Settings",
    },
    onCallRulesOf(11),
  ],
  [IDS.minor]: [onCallRulesOf(2)],
  [IDS.major]: [
    {
      tableName: "IncidentLabelRule",
      title: "Incident Label Rules",
      singularTitle: "Incident Label Rule",
      count: 1,
      isCountCapped: false,
      effect: "RemovedFromList",
      kind: "Settings",
    },
  ],
  [IDS.investigating]: [
    {
      tableName: "IncidentStateTimeline",
      title: "Incident State Timelines",
      singularTitle: "Incident State Timeline",
      count: 40,
      isCountCapped: false,
      effect: "Deleted",
      kind: "Records",
    },
  ],
};

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return String(value._id).toLowerCase();
  }
  return String(value).toLowerCase();
}

function serialize(query) {
  const out = {};
  for (const [key, value] of Object.entries(query || {})) {
    out[key] =
      value instanceof Includes
        ? { includes: value.values.map(idOf) }
        : typeof value === "object" && value !== null
          ? idOf(value)
          : value;
  }
  return out;
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

User.isMasterAdmin = () => false;
User.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
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

ModelAPI.count = async (options) => {
  const tableName = new options.modelType().tableName;
  return (RECORDS[tableName] || []).filter((record) =>
    matchesQuery(record, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

// Archive and Unarchive: an update of the archive switch, stamped as the server does.
ModelAPI.updateById = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.updates.push({ tableName, id, data: options.data });

  if (refuseArchive && options.data && options.data.isArchived === true) {
    throw new Error(
      "Every new incident needs a severity, so keep at least one that is not archived.",
    );
  }

  const record = (RECORDS[tableName] || []).find(
    (candidate) => idOf(candidate._id) === id,
  );

  if (!record) {
    throw new Error(`${tableName} not found.`);
  }

  for (const [key, value] of Object.entries(options.data || {})) {
    record[key] = value;
  }

  if (options.data && options.data.isArchived === true) {
    record.archivedAt = new Date("2026-10-21T10:00:00.000Z");
    const archivedBy = new UserModel();
    archivedBy._id = USER_ID;
    archivedBy.name = "Maya Chen";
    archivedBy.email = "maya.chen@acme-commerce.example";
    record.archivedByUser = archivedBy;
  }

  if (options.data && options.data.isArchived === false) {
    record.archivedAt = undefined;
    record.archivedByUser = undefined;
  }

  return { data: {} };
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.deletes.push({ tableName, id });
  const rows = RECORDS[tableName] || [];
  const index = rows.findIndex((record) => idOf(record._id) === id);
  if (index >= 0) {
    rows.splice(index, 1);
  }
};

/*
 * Several values' uses together, as POST <value route>/usage answers a bulk
 * dialog: one line per table and effect, the counts added up - people once
 * (the same people's rules name every severity).
 */
function together(ids, keep) {
  const lines = [];

  for (const id of ids) {
    for (const item of (USAGE[id] || []).filter(keep)) {
      const line = lines.find((candidate) => {
        return (
          candidate.tableName === item.tableName &&
          candidate.effect === item.effect &&
          candidate.kind === item.kind
        );
      });

      if (!line) {
        lines.push({ ...item });
      } else if (item.kind === "Personal") {
        line.count = Math.max(line.count, item.count);
      } else {
        line.count += item.count;
      }
    }
  }

  return lines;
}

const VALUE_USAGE = /\/([0-9a-f-]{36})\/usage$/;
const VALUES_USAGE = /\/incident-severity\/usage$/;

// POST <value route>/:id/usage and <value route>/usage, and nothing else the pages ask the API.
API.post = async (options) => {
  const url = options.url.toString();
  const match = VALUE_USAGE.exec(url);

  if (match) {
    window.__fixture.usageReads.push(match[1]);

    if (slowUsage) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
    }

    return { data: { usage: USAGE[match[1]] || [] } };
  }

  if (VALUES_USAGE.test(url)) {
    const ids = (options.data.ids || []).map((id) => {
      return String(id).toLowerCase();
    });
    const purpose = options.data.purpose;

    window.__fixture.bulkUsageReads.push({ ids, purpose });

    if (slowUsage) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
    }

    const refusedValueIds =
      purpose === "Delete"
        ? ids.filter((id) => {
            return (USAGE[id] || []).some((item) => {
              return item.effect === "Refused";
            });
          })
        : [];

    return {
      data: {
        refusedValueIds,
        refusedUsage: together(refusedValueIds, (item) => {
          return item.effect === "Refused";
        }),
        usage: together(
          ids.filter((id) => {
            return !refusedValueIds.includes(id);
          }),
          () => {
            return true;
          },
        ),
      },
    };
  }

  return { data: { data: [], count: 0 } };
};
API.get = async () => ({ data: { data: [], count: 0 } });

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
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

const PAGES = {
  severities: {
    component: IncidentSeveritiesPage,
    trail: ["Incidents", "Settings", "Incident Severity"],
  },
  states: {
    component: IncidentStatesPage,
    trail: ["Incidents", "Settings", "Incident State"],
  },
  templates: {
    component: IncidentTemplatesPage,
    trail: ["Incidents", "Settings", "Incident Templates"],
  },
};

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page] || PAGES.severities;
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
