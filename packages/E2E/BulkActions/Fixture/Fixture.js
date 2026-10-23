/*
 * Offline fixture for the bulk actions the table audit added through the
 * shared bulk switch (Common/UI/Components/BulkUpdate/BulkSwitchActions):
 * Enable and Disable on the Workflows and Monitors lists, and Unsubscribe on
 * a status page's Email Subscribers - and for the Admin Dashboard's
 * Enterprise Licenses list, its row Delete and its bulk Change Expiry Date
 * and Delete.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, their ModelTable (the bulk bar, the
 * confirmation, the result) and the dialogs are the production ones from
 * this branch.
 *
 * Steered by the query string:
 *   - page=workflows    the Workflows list (the default)
 *   - page=monitors     the Monitors list, whose Enable and Disable write
 *                       Disable Monitoring the other way round
 *   - page=subscribers  a status page's Email Subscribers
 *   - page=licenses     the Admin Dashboard's Enterprise Licenses (served
 *                       under /admin/, with billing on, as OneUptime Cloud
 *                       runs it); a master admin is signed in
 *   - role=viewer       a member who may read the lists but not change them
 *                       (Viewer); the default is a project owner
 *   - refuse=<ids>      records (comma-separated ids) whose update or delete
 *                       the server refuses, as it refuses one the member's
 *                       label-scoped permission does not cover
 *   - lang=de|ja        the Dashboard's (or the Admin Dashboard's) German or
 *                       Japanese words
 *   - theme=dark        dark mode (read by server.js's page)
 *
 * Every update is recorded on `window.__fixture.updates` and every delete
 * on `window.__fixture.deletes`, so the specs check what the page sent as
 * well as what it drew.
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
import WorkflowsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows";
import MonitorsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import EmailSubscribersPage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmailSubscribers";
// The Admin Dashboard's shell, which renders the Enterprise screen where it is.
import EnterpriseLicensesPage from "../../../App/FeatureSet/AdminDashboard/src/Pages/EnterpriseLicenses/Index";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import ADMIN_EN from "../../../App/FeatureSet/AdminDashboard/src/Locales/en.json";
import ADMIN_DE from "../../../App/FeatureSet/AdminDashboard/src/Locales/de.json";
import ADMIN_JA from "../../../App/FeatureSet/AdminDashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID = "30000000-0000-4000-8000-000000000001";
const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "workflows";
const isAdmin = page === "licenses";
const role = params.get("role") || "owner";
const refused = (params.get("refuse") || "")
  .split(",")
  .map((id) => {
    return id.trim().toLowerCase();
  })
  .filter(Boolean);
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

/*
 * The server's words when a label-scoped permission does not cover the row,
 * by what is refused.
 */
const REFUSALS = {
  Workflow:
    "You do not have permission to update this Workflow. You need to have one of the following labels: Production.",
  Monitor:
    "You do not have permission to update this Monitor. You need to have one of the following labels: Production.",
  StatusPageSubscriber:
    "You do not have permission to update this Status Page Subscriber.",
  EnterpriseLicense: "Enterprise License not found.",
};

function workflow(id, name, description, isEnabled) {
  const record = new Workflow();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.isEnabled = isEnabled;
  record.isArchived = false;
  record.labels = [];
  return record;
}

// Two that run and two that are off, as a project's list holds them.
const workflows = [
  workflow(
    "20000000-0000-4000-8000-000000000001",
    "Page the on-call team",
    "When a P1 incident is declared",
    true,
  ),
  workflow(
    "20000000-0000-4000-8000-000000000002",
    "Post incidents to Slack",
    "#incidents, for every new incident",
    true,
  ),
  workflow(
    "20000000-0000-4000-8000-000000000003",
    "Nightly cleanup",
    "Archives resolved alerts after 30 days",
    false,
  ),
  workflow(
    "20000000-0000-4000-8000-000000000004",
    "Sync to Jira",
    "Opens a ticket for each new incident",
    false,
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

function monitor(id, name, description, monitorType, isDisabled) {
  const record = new Monitor();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.description = description;
  record.monitorType = monitorType;
  record.currentMonitorStatus = OPERATIONAL;
  record.currentMonitorStatusId = new ObjectID(OPERATIONAL._id);
  record.disableActiveMonitoring = isDisabled;
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
    false,
  ),
  monitor(
    "60000000-0000-4000-8000-000000000002",
    "Marketing Website",
    "www, from three regions",
    MonitorType.Website,
    false,
  ),
  monitor(
    "60000000-0000-4000-8000-000000000003",
    "Legacy FTP",
    "Turned off while it is migrated",
    MonitorType.Ping,
    true,
  ),
];

const statusPage = new StatusPage();
statusPage._id = STATUS_PAGE_ID;
statusPage.projectId = new ObjectID(PROJECT_ID);
statusPage.name = "Production Status Page";
statusPage.enableEmailSubscribers = true;
statusPage.allowSubscribersToChooseResources = false;
statusPage.allowSubscribersToChooseEventTypes = false;

function subscriber(id, email, isUnsubscribed) {
  const record = new StatusPageSubscriber();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.statusPageId = new ObjectID(STATUS_PAGE_ID);
  record.subscriberEmail = new Email(email);
  record.isSubscriptionConfirmed = true;
  record.isUnsubscribed = isUnsubscribed;
  record.createdAt = new Date("2026-09-01T10:00:00.000Z");
  if (isUnsubscribed) {
    record.unsubscribedAt = new Date("2026-10-02T08:30:00.000Z");
  }
  return record;
}

const subscribers = [
  subscriber("70000000-0000-4000-8000-000000000001", "ops@example.com", false),
  subscriber(
    "70000000-0000-4000-8000-000000000002",
    "site03-all@example.com",
    false,
  ),
  subscriber(
    "70000000-0000-4000-8000-000000000003",
    "former.customer@example.com",
    true,
  ),
];

function license(id, companyName, keyStart, keyEnd, expiresAt, extra) {
  const record = new EnterpriseLicense();
  record._id = id;
  record.companyName = companyName;
  record.licenseKey = `${keyStart}${"0".repeat(56)}${keyEnd}`;
  record.expiresAt = new Date(expiresAt);
  record.isEvaluationLicense = Boolean(extra && extra.isEvaluationLicense);
  record.userLimit = (extra && extra.userLimit) || 50;
  record.currentUserCount = (extra && extra.currentUserCount) || 0;
  record.createdAt = new Date("2026-08-01T09:00:00.000Z");
  return record;
}

/*
 * The maintainer's screen: two expired evaluation licenses of one company,
 * the second issued when the first was not found, and a license in use.
 */
const licenses = [
  license(
    "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e01",
    "Netlock.hu",
    "da74",
    "7c7a",
    "2026-09-30T00:00:00.000Z",
    { isEvaluationLicense: true },
  ),
  license(
    "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e02",
    "Netlock.hu",
    "e639",
    "e1f4",
    "2026-09-30T00:00:00.000Z",
    { isEvaluationLicense: true },
  ),
  license(
    "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e03",
    "GovTech Singapore",
    "832c",
    "8915",
    "2099-10-09T00:00:00.000Z",
    { userLimit: 150, currentUserCount: 13 },
  ),
];

const globalConfig = new GlobalConfig();
globalConfig._id = ObjectID.getZeroObjectID().toString();
globalConfig.enterpriseLicenseExpiryReminderDays = 30;

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

window.__fixture = {
  listRequests: [],
  updates: [],
  deletes: [],
  refused: [],
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
      const hit = condition.fields.some((field) => {
        return String(record[field] || "")
          .toLowerCase()
          .includes(needle);
      });
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
    // The record a row belongs to: a subscriber's status page.
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
  Workflow: workflows,
  Monitor: monitors,
  StatusPage: [statusPage],
  StatusPageSubscriber: subscribers,
  EnterpriseLicense: licenses,
  GlobalConfig: [globalConfig],
};

if (isAdmin) {
  // The Admin Dashboard's reader: a master admin, with no project roles.
  User.isMasterAdmin = () => {
    return true;
  };
  User.getUserId = () => {
    return new ObjectID(USER_ID);
  };
  PermissionUtil.getAllPermissions = () => {
    return [];
  };
  PermissionUtil.getProjectPermissions = () => {
    return null;
  };
  PermissionUtil.getGlobalPermissions = () => {
    return null;
  };
} else {
  /*
   * A project owner, or a Viewer: may read every list, may change none.
   * Not a master admin, so the gates read this snapshot as they do for
   * anyone.
   */
  const heldPermission =
    role === "viewer" ? Permission.Viewer : Permission.ProjectOwner;

  User.isMasterAdmin = () => {
    return false;
  };
  User.getUserId = () => {
    return new ObjectID(USER_ID);
  };
  PermissionUtil.getAllPermissions = () => {
    return [heldPermission];
  };
  PermissionUtil.getProjectPermissions = () => {
    return {
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
    };
  };
  PermissionUtil.getGlobalPermissions = () => {
    return {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      projectIds: [new ObjectID(PROJECT_ID)],
    };
  };
  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(PROJECT_ID);
  };
  ModelAPI.getCommonHeaders = () => {
    return { tenantid: PROJECT_ID };
  };
}

function findRecord(tableName, id) {
  return (RECORDS[tableName] || []).find((record) => {
    return idOf(record._id) === idOf(id);
  });
}

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  return findRecord(tableName, options.id) || null;
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

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  return (RECORDS[tableName] || []).filter((record) => {
    return matchesQuery(record, options.query);
  }).length;
};

/*
 * One update by id, as the bulk actions send them: what was written is
 * recorded, and the record takes it, unless the server refuses it.
 */
ModelAPI.updateById = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);

  window.__fixture.updates.push({
    tableName,
    id,
    data: serialize(options.data),
  });

  if (refused.includes(id)) {
    window.__fixture.refused.push(id);
    throw new Error(REFUSALS[tableName] || "Not allowed.");
  }

  const record = findRecord(tableName, id);

  if (!record) {
    throw new Error(`${tableName} not found.`);
  }

  for (const [key, value] of Object.entries(options.data || {})) {
    record[key] =
      key === "expiresAt" && value ? new Date(value.toString()) : value;
  }

  return {};
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);

  window.__fixture.deletes.push({ tableName, id });

  if (refused.includes(id)) {
    window.__fixture.refused.push(id);
    throw new Error(REFUSALS[tableName] || "Not allowed.");
  }

  const records = RECORDS[tableName] || [];
  const index = records.findIndex((record) => {
    return idOf(record._id) === id;
  });

  if (index === -1) {
    throw new Error(`${tableName} not found.`);
  }

  records.splice(index, 1);
};

API.get = async () => {
  return { data: { data: [], count: 0 } };
};
API.post = async () => {
  return { data: { data: [], count: 0 } };
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does. The Admin Dashboard reads
 * its own locale files, and its nested keys ("pages.enterpriseLicenses.title")
 * as nested; its shared components look English text up flat, per call.
 */
await i18next.use(initReactI18next).init(
  isAdmin
    ? {
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: ADMIN_EN },
          de: { translation: ADMIN_DE },
          ja: { translation: ADMIN_JA },
        },
        interpolation: { escapeValue: false },
      }
    : {
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
      },
);
document.documentElement.lang = language;

const PAGES = {
  workflows: { component: WorkflowsPage, trail: ["Workflows"] },
  monitors: { component: MonitorsPage, trail: ["Monitors"] },
  subscribers: {
    component: EmailSubscribersPage,
    trail: ["Status Pages", "Production Status Page", "Email Subscribers"],
  },
  licenses: {
    component: EnterpriseLicensesPage,
    trail: ["Admin Dashboard", "Settings", "Enterprise Licenses"],
  },
};

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const { component: Page, trail } = PAGES[page] || PAGES.workflows;
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        {trail.map((title, index) => {
          return (
            <React.Fragment key={title}>
              {index > 0 ? <span className="mx-2">/</span> : null}
              {title}
            </React.Fragment>
          );
        })}
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
