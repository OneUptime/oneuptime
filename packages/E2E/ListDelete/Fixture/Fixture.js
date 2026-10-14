/*
 * Offline fixture for the real Status Pages list and its Archived page.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The pages, their ModelTable (the row ⋯ menu, the
 * bulk bar, both Delete dialogs and the bulk result) and the facet bar are
 * the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=archived  the Archived Status Pages page instead of the list
 *   - role=viewer    a member who may read status pages but not delete them
 *                    (Viewer); the default is a project owner
 *   - refuse=<ids>   status pages (comma-separated ids) whose delete the
 *                    server refuses, as it refuses a delete the member's
 *                    label-scoped permission does not cover
 *   - rows=<n>       how many extra status pages to list (pagination)
 *
 * Every delete request is recorded on `window.__fixture.deletes`, and every
 * list request on `window.__fixture.listRequests`, so the spec checks what
 * the page sent, not only what it drew.
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
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const params = new URLSearchParams(window.location.search);
const isArchivedPage = params.get("page") === "archived";
const role = params.get("role") || "owner";
const refused = (params.get("refuse") || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter(Boolean);
const extraRows = Number(params.get("rows") || 0);

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

for (let index = 0; index < extraRows; index++) {
  statusPages.push(
    statusPage(
      `31000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      `Regional Status ${String(index + 1).padStart(2, "0")}`,
      "One region's page",
    ),
  );
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

window.__fixture = {
  listRequests: [],
  deletes: [],
  refusedDeletes: [],
};

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
  }
  return true;
}

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

ModelAPI.getItem = async () => null;

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

  const items =
    tableName === "StatusPage"
      ? statusPages.filter((record) => matchesQuery(record, options.query))
      : [];

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  return tableName === "StatusPage"
    ? statusPages.filter((record) => matchesQuery(record, options.query)).length
    : 0;
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = options.id.toString().toLowerCase();

  window.__fixture.deletes.push({ tableName, id });

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

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Page = isArchivedPage ? StatusPagesArchived : StatusPages;
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        Status Pages{" "}
        {isArchivedPage ? (
          <>
            <span className="mx-2">/</span> Archived
          </>
        ) : null}
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
