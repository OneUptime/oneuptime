/*
 * Dashboards -> Playlists as a signed-in member opens them (issue #5235):
 * the real Dashboards routes (Routes/DashboardRoutes - the Playlists list,
 * a playlist's page and the player, with the Dashboards layout, its side
 * menu and breadcrumbs) inside a stand-in for the app's header, with only
 * the data boundary replaced: ModelAPI, AnalyticsModelAPI and API.
 *
 * The fixture's server keeps the playlists for the tab (sessionStorage), so
 * a create, an edit or a delete followed by a reload shows what was saved,
 * as the real API would. Steered by the query string, read before the app
 * starts:
 *
 *   - role=viewer    a Viewer: reads and plays playlists, changes none
 *   - lang=de|ja|fa  the Dashboard's German, Japanese or Persian words
 *   - theme=dark     (read by server.js) the dark theme
 *   - reads=fail     every read of a playlist fails (the player's error)
 *
 * Everything the pages ask for is recorded on
 * window.__dashboardPlaylistsFixture: each read of a dashboard (its id and
 * when, to see the next one is read ahead of its turn), each read of a
 * playlist, what was created, edited and deleted, and every read the fixture
 * does not model (unexpected - the suite fails on any). setPlaylist(key,
 * dashboardKeys) changes a playlist the way someone else's edit would.
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
import DashboardRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/DashboardRoutes";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  DASHBOARDS,
  METRIC_TYPES,
  PLAYLISTS,
  PROJECT_ID,
  buildConfig,
  getDashboardById,
  isReadableDashboard,
  seriesFor,
} from "./Boards";

const USER_ID = "40000000-0000-4000-8000-0000000000e4";
const SERVER_KEY = "dashboard-playlists-fixture-server";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const readsFail = params.get("reads") === "fail";

const record = {
  dashboardReads: [],
  playlistReads: [],
  dashboardLists: [],
  creates: [],
  edits: [],
  deletes: [],
  unexpected: [],
};

function unexpected(call) {
  record.unexpected.push(call);
}

// ---- the fixture's server: the playlists, for the tab ------------------------

function readServer() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SERVER_KEY) || "null");
  } catch {
    return null;
  }
}

function writeServer(playlists) {
  window.sessionStorage.setItem(SERVER_KEY, JSON.stringify(playlists));
}

let playlists =
  readServer() ||
  Object.values(PLAYLISTS).map((playlist) => {
    return { ...playlist };
  });

function idOf(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }

  return value.toString().toLowerCase();
}

function toPlaylist(stored) {
  const playlist = new DashboardPlaylist();
  playlist._id = stored.id;
  playlist.id = new ObjectID(stored.id);
  playlist.projectId = new ObjectID(PROJECT_ID);
  playlist.name = stored.name;
  playlist.dashboards = JSON.parse(JSON.stringify(stored.dashboards || []));
  playlist.intervalInSeconds = stored.intervalInSeconds;
  playlist.createdAt = new Date("2026-10-20T09:00:00Z");
  playlist.updatedAt = new Date("2026-10-26T09:00:00Z");
  return playlist;
}

function toDashboard(stored) {
  const dashboard = new Dashboard();
  dashboard._id = stored.id;
  dashboard.id = new ObjectID(stored.id);
  dashboard.projectId = new ObjectID(PROJECT_ID);
  dashboard.name = stored.name;
  dashboard.description = "";
  dashboard.isArchived = Boolean(stored.isArchived);
  return dashboard;
}

window.__dashboardPlaylistsFixture = {
  record,
  // Someone else's edit: the playlist `key` now names these dashboards.
  setPlaylist: (key, dashboardKeys, intervalInSeconds) => {
    const stored = playlists.find((playlist) => {
      return playlist.id === PLAYLISTS[key].id;
    });

    if (!stored) {
      return;
    }

    stored.dashboards = dashboardKeys.map((dashboardKey) => {
      return { dashboardId: DASHBOARDS[dashboardKey].id };
    });

    if (intervalInSeconds) {
      stored.intervalInSeconds = intervalInSeconds;
    }

    writeServer(playlists);
  },
  // Someone deleted the playlist `key`.
  deletePlaylist: (key) => {
    playlists = playlists.filter((playlist) => {
      return playlist.id !== PLAYLISTS[key].id;
    });
    writeServer(playlists);
  },
};

// ---- who is signed in -------------------------------------------------------

const heldPermissions =
  role === "viewer" ? [Permission.Viewer] : [Permission.ProjectOwner];

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme";

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [
  ...heldPermissions,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
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
ProjectUtil.getCurrentProject = () => project;
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary -------------------------------------------------------

function tableOf(options) {
  return new options.modelType().tableName;
}

// Tables the pages read that hold nothing here: saved views and the like.
const EMPTY_TABLES = ["TableView", "Incident", "Alert", "Label"];

function failure() {
  return new HTTPErrorResponse(
    500,
    { message: "The playlist could not be read. Try again in a moment." },
    {},
  );
}

function sorted(items, sort) {
  const [column, direction] = Object.entries(sort || {})[0] || [];

  if (!column) {
    return items;
  }

  const sign = direction === SortOrder.Descending ? -1 : 1;

  return [...items].sort((first, second) => {
    return (
      String(first[column] ?? "").localeCompare(String(second[column] ?? "")) *
      sign
    );
  });
}

// The dashboards a list read asks for: some ids, or all of them.
function wantedIds(query) {
  const condition = query && query._id;

  if (condition instanceof Includes) {
    return condition.values.map(idOf);
  }

  return null;
}

function matchesName(item, query) {
  const condition = query && query.name;

  if (condition instanceof Search) {
    return String(item.name || "")
      .toLowerCase()
      .includes(String(condition.value || "").toLowerCase());
  }

  return true;
}

ModelAPI.getItem = async (options) => {
  const table = tableOf(options);
  const id = idOf(options.id);

  if (table === "Dashboard") {
    record.dashboardReads.push({ id, at: Date.now() });

    const stored = getDashboardById(id);

    if (!isReadableDashboard(stored)) {
      return null;
    }

    const dashboard = toDashboard(stored);
    dashboard.dashboardViewConfig = buildConfig(stored);
    return dashboard;
  }

  if (table === "DashboardPlaylist") {
    record.playlistReads.push({ id, at: Date.now() });

    if (readsFail) {
      throw failure();
    }

    const stored = playlists.find((playlist) => {
      return playlist.id === id;
    });

    return stored ? toPlaylist(stored) : null;
  }

  unexpected(`getItem ${table}`);
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  if (table === "Dashboard") {
    const ids = wantedIds(options.query);

    record.dashboardLists.push({ ids: ids, at: Date.now() });

    const data = sorted(
      Object.values(DASHBOARDS)
        .filter((dashboard) => {
          return (
            isReadableDashboard(dashboard) &&
            (!ids || ids.includes(dashboard.id))
          );
        })
        .map(toDashboard),
      options.sort,
    );

    return {
      data: data.slice(skip, skip + limit),
      count: data.length,
      skip,
      limit,
    };
  }

  if (table === "DashboardPlaylist") {
    if (readsFail) {
      throw failure();
    }

    const data = sorted(
      playlists.map(toPlaylist).filter((playlist) => {
        return matchesName(playlist, options.query);
      }),
      options.sort,
    );

    return {
      data: data.slice(skip, skip + limit),
      count: data.length,
      skip,
      limit,
    };
  }

  if (table === "MetricType") {
    const data = METRIC_TYPES.map(([name, unit]) => {
      const metricType = new MetricType();
      metricType.name = name;
      metricType.unit = unit;
      return metricType;
    });

    return { data, count: data.length, skip: 0, limit: data.length };
  }

  if (EMPTY_TABLES.includes(table)) {
    return { data: [], count: 0, skip, limit };
  }

  unexpected(`getList ${table}`);
  return { data: [], count: 0, skip, limit };
};

ModelAPI.count = async (options) => {
  const table = tableOf(options);

  if (table === "DashboardPlaylist") {
    return playlists.length;
  }

  if (EMPTY_TABLES.includes(table)) {
    return 0;
  }

  unexpected(`count ${table}`);
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

const newPlaylistId = () => {
  return `91000000-0000-4000-8000-${String(100 + record.creates.length).padStart(12, "0")}`;
};

// A create or an edit through a playlist's form: kept, and recorded as sent.
ModelAPI.createOrUpdate = async (options) => {
  const table = tableOf(options);

  if (table !== "DashboardPlaylist") {
    unexpected(`createOrUpdate ${table}`);
    return new HTTPResponse(200, {}, {});
  }

  const json = JSON.parse(
    JSON.stringify(BaseModel.toJSON(options.model, options.modelType)),
  );
  const editedId = idOf(options.model._id);

  if (!editedId) {
    record.creates.push(json);

    const created = {
      id: newPlaylistId(),
      name: json.name,
      dashboards: json.dashboards || [],
      intervalInSeconds: json.intervalInSeconds || 60,
    };

    playlists.push(created);
    writeServer(playlists);

    return new HTTPResponse(
      200,
      BaseModel.toJSON(toPlaylist(created), DashboardPlaylist),
      {},
    );
  }

  record.edits.push({ id: editedId, data: json });

  const stored = playlists.find((playlist) => {
    return playlist.id === editedId;
  });

  if (stored) {
    for (const key of ["name", "dashboards", "intervalInSeconds"]) {
      if (json[key] !== undefined) {
        stored[key] = json[key];
      }
    }

    writeServer(playlists);
  }

  return new HTTPResponse(200, json, {});
};
ModelAPI.create = ModelAPI.createOrUpdate;

ModelAPI.updateById = async (options) => {
  const table = tableOf(options);

  if (table !== "DashboardPlaylist") {
    unexpected(`updateById ${table}`);
    return new HTTPResponse(200, {}, {});
  }

  const id = idOf(options.id);
  const data = JSON.parse(JSON.stringify(options.data || {}));

  record.edits.push({ id, data });

  const stored = playlists.find((playlist) => {
    return playlist.id === id;
  });

  if (stored) {
    Object.assign(stored, data);
    writeServer(playlists);
  }

  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (options) => {
  const table = tableOf(options);

  if (table !== "DashboardPlaylist") {
    unexpected(`deleteItem ${table}`);
    return;
  }

  const id = idOf(options.id);
  record.deletes.push(id);
  playlists = playlists.filter((playlist) => {
    return playlist.id !== id;
  });
  writeServer(playlists);
};

function timestampOf(value) {
  return value ? new Date(value).getTime() : null;
}

// The template's log stream reads the window's logs: none here.
AnalyticsModelAPI.getList = async () => {
  return { data: [], count: 0, skip: 0, limit: 10 };
};

AnalyticsModelAPI.count = async (options) => {
  unexpected(`analytics count ${tableOf(options)}`);
  return 0;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const aggregateBy = options.aggregateBy || {};
  const start = timestampOf(aggregateBy.startTimestamp);
  const end = timestampOf(aggregateBy.endTimestamp);
  const metricName =
    (aggregateBy.query && aggregateBy.query.name) || "unknown.metric";

  return {
    data: seriesFor({
      start: start || Date.now() - 60 * 60 * 1000,
      end: end || Date.now(),
      metricName,
      aggregationInterval: aggregateBy.aggregationInterval,
    }),
  };
};

API.post = async (options) => {
  unexpected(`API.post ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  unexpected(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

// ---- the Dashboard's words --------------------------------------------------

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// ---- the page ------------------------------------------------------------------

/*
 * The Dashboards routes as App.tsx mounts them, once the router's hooks are
 * handed to Navigation, under a stand-in for the app's header: the player
 * must cover it.
 */
function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50">
      <header
        className="sticky top-0 z-10 flex h-14 items-center border-b border-gray-200 bg-white px-6 text-sm font-semibold text-gray-800"
        data-testid="fixture-app-header"
      >
        OneUptime
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
        <DashboardRoutes
          pageRoute={Navigation.getCurrentRoute()}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/dashboards/*"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);
