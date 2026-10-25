/*
 * Offline fixture for the real Network Overview of a project with nothing on
 * it: the first-run path (Components/Network/NetworkGetStarted) and its
 * "Add a probe" dialog (Components/Network/AddProbeModal).
 *
 * The Network Layout (Page + the Network side menu) and the Overview are the
 * production components from this branch, mounted under their real RouteMap
 * patterns. Only the data boundary (ModelAPI / API) and the signed-in user are
 * replaced. Every record is fabricated for an "Acme Networks" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?probes=   none (default): no probe of the project's own
 *              waiting: one added ("Office probe") that has never checked in
 *              connected: one checking in ("Data centre probe")
 *   ?connectAfter=  how many times the dialog asks after a probe it added
 *              before that probe checks in (default 2); "never" keeps it waiting
 *   ?role=     owner (default) | member (may add a probe, may not read its key)
 *   ?alerts=   how many alert policies are on (default 0)
 *   ?devices=  how many devices the network has (default 0: the first-run path)
 *   ?server=   1: this server runs a probe of its own (a self-hosted install)
 *   ?plan=     free | growth: OneUptime Cloud (billing on, see server.js) with
 *              the project on that plan; adding a probe needs Growth
 *   ?lang=     de reads the German locale file
 *   ?theme=    dark adds html.dark (handled by server.js)
 *
 * Every read and write is recorded on window.__networkFirstRunFixture:
 * listRequests, countRequests, itemRequests, creates, apiRequests and
 * unhandled - anything the fixture does not model. The spec asserts
 * `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import NetworkLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Network/Layout";
import NetworkOverview from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Overview";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const probeMode = ["waiting", "connected"].includes(params.get("probes"))
  ? params.get("probes")
  : "none";
const connectAfter =
  params.get("connectAfter") === "never"
    ? Number.POSITIVE_INFINITY
    : Number(params.get("connectAfter") || 2);
const roleMode = params.get("role") === "member" ? "member" : "owner";
const alertPolicies = Number(params.get("alerts") || 0);
const deviceCount = Number(params.get("devices") || 0);
const hasServerProbe = params.get("server") === "1";
const planMode = ["free", "growth"].includes(params.get("plan"))
  ? params.get("plan")
  : "";
const language = params.get("lang") === "de" ? "de" : "en";
/*
 * lists=busy: the Overview's lists of a network that has been running for a
 * while, of different lengths - six devices and one site needing attention,
 * three vendors, no discovery scan yet - so its rows of cards are uneven.
 */
const hasBusyLists = params.get("lists") === "busy";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [
  ...GLOBAL_PERMISSIONS,
  roleMode === "member" ? Permission.ProjectMember : Permission.ProjectOwner,
];

/*
 * ---------------------------------------------------------------------------
 * Ids and records
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

let probeCounter = 0;

function nextProbeId() {
  probeCounter += 1;
  return uuid("20000000", probeCounter);
}

/*
 * On OneUptime Cloud the project's plan is read from its subscription's
 * price id, as ProjectUtil.getCurrentPlan reads it: the monthly price of the
 * plan server.js configures under that name.
 */
const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Networks",
  ...(planMode ? { paymentProviderPlanId: `price_${planMode}_monthly` } : {}),
});

/*
 * The project's own probes, as the server holds them. Keys are made-up and
 * shown only to roles that may read them.
 */
const probes = [];

function addProbe(record) {
  const row = {
    _id: nextProbeId(),
    projectId: projectObjectId,
    key: `key-${String(probes.length + 1).padStart(4, "0")}-acme-networks`,
    connectionStatus: undefined,
    lastAlive: undefined,
    statusReads: 0,
    ...record,
  };
  probes.push(row);
  return row;
}

if (probeMode === "waiting") {
  addProbe({ name: "Office probe" });
}

if (probeMode === "connected") {
  addProbe({ name: "Data centre probe", connectionStatus: "connected" });
}

const serverProbes = hasServerProbe
  ? [{ _id: uuid("21000000", 1), name: "Server probe", isGlobalProbe: true }]
  : [];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    probes: probeMode,
    connectAfter: String(connectAfter),
    role: roleMode,
    alerts: alertPolicies,
    devices: deviceCount,
    server: hasServerProbe,
    plan: planMode || "self-hosted",
    language,
  },
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  creates: [],
  apiRequests: [],
  unhandled: [],
  probes,
};
window.__networkFirstRunFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function ok(data) {
  return new HTTPResponse(200, serialize(data), {});
}

function tableName(modelType) {
  return new modelType().tableName;
}

// A probe row as the API returns it: only the selected columns.
function probeModel(row, select) {
  const model = new Probe();
  for (const column of Object.keys(select || { _id: true, name: true })) {
    if (column === "key" && roleMode !== "owner") {
      continue;
    }
    if (row[column] !== undefined) {
      model[column] = row[column];
    }
  }
  model._id = row._id;
  return model;
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-networks.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const isGlobal = Boolean(options.requestOptions?.overrideRequestUrl);
  fixture.listRequests.push({
    modelName,
    global: isGlobal,
    query: serialize(options.query),
    select: serialize(options.select),
  });

  if (options.modelType === Probe) {
    const rows = isGlobal ? serverProbes : probes;
    const data = rows.map((row) => {
      return probeModel(row, options.select);
    });
    return { data, count: data.length, skip: 0, limit: data.length };
  }

  if (options.modelType === NetworkDeviceDiscoveryScan) {
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  fixture.unhandled.push({ kind: "getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (options.modelType === NetworkAlertPolicy) {
    return alertPolicies;
  }

  fixture.unhandled.push({ kind: "count", modelName });
  return 0;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  const select = serialize(options.select) || {};
  fixture.itemRequests.push({ modelName, id, select });

  if (options.modelType !== Probe) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const row = probes.find((probe) => {
    return probe._id === id;
  });

  if (!row) {
    return null;
  }

  // The dialog watching for the probe it is showing to check in.
  if (select.connectionStatus) {
    row.statusReads += 1;
    if (row.statusReads > connectAfter) {
      row.connectionStatus = "connected";
    }
  }

  return probeModel(row, select);
};

ModelAPI.create = async (options) => {
  const modelName = tableName(options.modelType);

  if (options.modelType !== Probe) {
    fixture.unhandled.push({ kind: "create", modelName });
    return ok({});
  }

  const row = addProbe({ name: options.model.name });
  fixture.creates.push({
    modelName,
    name: options.model.name,
    projectId: options.model.projectId?.toString(),
  });

  /*
   * As ModelAPI.create hands it back: the response's data read into a model
   * (BaseModel.fromJSONObject), so `.id` is the new probe's.
   */
  const created = new Probe();
  created._id = row._id;
  created.name = row.name;
  const response = new HTTPResponse(200, { _id: row._id, name: row.name }, {});
  response.data = created;
  return response;
};

// The lists=busy Overview's rows, read at one moment.
const BUSY_READ_AT = Date.now();
const BUSY_ATTENTION_DEVICES = [
  ["core-switch-01", true, false, 0],
  ["edge-router-02", true, false, 0],
  ["access-switch-14", false, true, 0],
  ["access-switch-15", false, false, 3],
  ["firewall-dc-1", false, false, 1],
  ["wifi-controller", false, true, 0],
].map(([name, isDown, isSnmpFailing, interfacesDown], index) => {
  return {
    _id: uuid("70000000", index + 1),
    name,
    lastSeenAt: isDown
      ? new Date(BUSY_READ_AT - 45 * 60 * 1000).toISOString()
      : null,
    interfacesDown,
    isDown,
    isMonitorBacked: false,
    isSnmpFailing,
  };
});
const BUSY_ATTENTION_SITES = [
  {
    _id: uuid("71000000", 1),
    name: "Head office",
    siteType: "Office",
    statusName: "Degraded",
    statusColor: "#f59e0b",
  },
];
const BUSY_VENDORS = [
  { vendor: "Cisco", count: 3 },
  { vendor: "Juniper", count: 2 },
  { vendor: "Ubiquiti", count: 1 },
];

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url });

  if (method === "POST" && url.endsWith("/network-device/overview")) {
    return ok({
      // The busy network's counts agree with its lists below.
      fleet: {
        total: deviceCount,
        up: hasBusyLists ? deviceCount - 2 : deviceCount,
        down: hasBusyLists ? 2 : 0,
        pending: 0,
        interfacesDown: hasBusyLists ? 4 : 0,
        snmpFailing: hasBusyLists ? 2 : 0,
      },
      siteCount: hasBusyLists ? 1 : 0,
      unhealthySiteCount: hasBusyLists ? 1 : 0,
      endpointCount: 0,
      vendors: hasBusyLists ? BUSY_VENDORS : [],
      attentionDevices: hasBusyLists ? BUSY_ATTENTION_DEVICES : [],
      attentionSites: hasBusyLists ? BUSY_ATTENTION_SITES : [],
    });
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function FixtureNetworkLayout() {
  useNavigationHooks();
  return <NetworkLayout {...pageProps(PageMap.NETWORK_OVERVIEW)} />;
}

function OverviewPage() {
  useNavigationHooks();
  return <NetworkOverview {...pageProps(PageMap.NETWORK_OVERVIEW)} />;
}

// A page the first-run path links to that is not modelled: says where it is.
function StubPage(props) {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p
        data-testid="stub-page"
        data-page={props.pageKey}
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

const LINKED_PAGES = [
  [PageMap.NETWORK_DEVICES, "Devices"],
  [PageMap.NETWORK_DEVICE_DISCOVERY, "Discovery"],
  [PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES, "Alert Policies"],
  [PageMap.SETTINGS_BILLING, "Billing"],
];

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Networks</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureNetworkLayout />}>
          <Route
            path={RouteMap[PageMap.NETWORK_OVERVIEW].toString()}
            element={<OverviewPage />}
          />
        </Route>
        {LINKED_PAGES.map(([pageKey, title]) => {
          return (
            <Route
              key={pageKey}
              path={RouteMap[pageKey].toString()}
              element={<StubPage pageKey={pageKey} title={title} />}
            />
          );
        })}
        <Route
          path="*"
          element={<StubPage pageKey="other" title="Not modelled" />}
        />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
