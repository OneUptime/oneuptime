/*
 * Offline fixture for the Runbooks side menu, after AI Access went.
 *
 * The real route groups are mounted at their real addresses, as App.tsx
 * mounts them:
 *
 *   - Routes/RunbookRoutes at /dashboard/:projectId/runbooks/*: the Runbooks
 *     layout (Pages/Runbook/Layout: the page header, breadcrumbs and the
 *     side menu, Pages/Runbook/SideMenu) around the real list pages -
 *     Runbooks, Executions, Runners, Global Variables - and the forwarding
 *     of the old AI Access address (runner-credentials) to the Runners;
 *   - Routes/SettingsRoutes at /dashboard/:projectId/settings/*, for the
 *     oldest address of the same page - the one it had in Project
 *     Settings, as Runner Credentials - which forwards to the Runners too.
 *
 * Only the ModelAPI / API data boundary and the signed-in user are
 * replaced: the project, and no runbooks, executions, Runners or
 * variables, so every page draws its empty state beside the menu. Steered
 * by the query string:
 *   - lang=de      the Dashboard's German words
 *   - theme=dark   dark mode
 *
 * The reads the pages make that the fixture does not model are recorded on
 * window.__runbooksMenuFixture.reads, by kind and table, for a reader
 * debugging a run; the spec does not hold them to anything, as the pages
 * are real and read what they need.
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
import RunbookRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/RunbookRoutes";
import SettingsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/SettingsRoutes";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000e1";
const USER_ID = "40000000-0000-4000-8000-0000000000e4";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") === "de" ? "de" : "en";

window.__runbooksMenuFixture = { reads: [] };

function read(kind, table) {
  window.__runbooksMenuFixture.reads.push({ kind, table });
}

// ---- who is signed in, in which project --------------------------------------

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: [
    {
      _type: "UserPermission",
      permission: Permission.ProjectOwner,
      labelIds: [],
    },
  ],
  isBlockPermission: false,
});

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";

ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary: the project, and nothing else yet ---------------------

function tableOf(options) {
  try {
    return String(new options.modelType().tableName);
  } catch {
    return "unknown";
  }
}

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);

  if (table === "Project") {
    return Object.assign(new Project(), project);
  }

  read("getItem", table);
  return null;
};

ModelAPI.getList = async (options) => {
  read("getList", tableOf(options));

  return {
    data: [],
    count: 0,
    skip: Number(options.skip || 0),
    limit: Number(options.limit || 10),
  };
};

ModelAPI.count = async (options) => {
  read("count", tableOf(options));
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

API.get = async (options) => {
  read("API.get", String(options?.url || options));
  return new HTTPResponse(200, {}, {});
};
API.post = async (options) => {
  read("API.post", String(options?.url || options));
  return new HTTPResponse(200, {}, {});
};

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

// ---- the route groups, as App.tsx mounts them ---------------------------------

/*
 * What App.tsx does around every route group: tell Navigation where the
 * page is, and hand the group the project.
 */
function RouteGroup(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Group = props.group;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      <Group
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path={RouteMap[PageMap.RUNBOOKS_ROOT].toString()}
        element={<RouteGroup group={RunbookRoutes} />}
      />
      <PageRoute
        path={RouteMap[PageMap.SETTINGS_ROOT].toString()}
        element={<RouteGroup group={SettingsRoutes} />}
      />
    </Routes>
  </BrowserRouter>,
);
