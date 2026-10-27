/*
 * Offline fixture for the real first run of the infrastructure lists: a
 * project with nothing on it opens Hosts, VMware vCenters or Cloud
 * resources, sees the empty table and what goes under it - the showcase,
 * or Cloud resources' Connect tiles and folded guide - and the list fills
 * in on its own when the first record arrives.
 *
 * The layouts (Page + each product's side menu) and the list pages are the
 * production components from this branch, mounted under their real
 * RouteMap patterns. Only the data boundary (ModelAPI / API) and the
 * signed-in user are replaced. Every record is fabricated for an "Acme
 * Infrastructure" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?hosts=1   the project already has a host ("web-01")
 *   ?vcenters=1  the project already has two vCenters: "vcenter-lab", which
 *              a probe collects, and "vcenter-prod", which an outdated
 *              VMware Agent sends
 *   ?failFirstCount=1  the page's first count of its list fails (once)
 *   ?lang=     de reads the German locale file
 *   ?theme=    dark adds html.dark (handled by server.js)
 *
 * window.__infrastructureFirstRunFixture.arrive(kind) is the agent
 * reporting (kind: host | vcenter | cloudResource): the record is in the
 * project from then on, for the page to find.
 *
 * Every read is recorded on window.__infrastructureFirstRunFixture:
 * countRequests, listRequests, apiRequests and unhandled - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
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
import HostLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Layout";
import HostsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import VMwareLayout from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/Layout";
import VCentersPage from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/VCenters";
import CloudLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Layout";
import CloudMonitoredResourcesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/MonitoredResources";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Host from "Common/Models/DatabaseModels/Host";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
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

const hasHost = params.get("hosts") === "1";
const hasVCenters = params.get("vcenters") === "1";
const language = params.get("lang") === "de" ? "de" : "en";
// How many of the list's counts still fail: the first one, when asked for.
let failingCounts = params.get("failFirstCount") === "1" ? 1 : 0;

const COUNT_FAILURE = "The server did not answer. Try again in a moment.";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

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

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Infrastructure",
});

const GIB = 1024 * 1024 * 1024;

// What each agent reports first, as the server stores it.
const FIRST_RECORDS = {
  host: () => {
    return {
      modelType: Host,
      record: {
        _id: uuid("30000000", 1),
        name: "web-01",
        hostIdentifier: "web-01",
        osType: "linux",
        hostIpAddresses: "10.0.0.11",
        cpuCores: 4,
        totalMemoryBytes: 16 * GIB,
        processCount: 212,
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
        isArchived: false,
      },
    };
  },
  vcenter: () => {
    return {
      modelType: VMwareVCenter,
      record: {
        _id: uuid("31000000", 1),
        name: "vcenter-lab",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
        isArchived: false,
      },
    };
  },
  cloudResource: () => {
    return {
      modelType: CloudResource,
      record: {
        _id: uuid("32000000", 1),
        name: "orders-db",
        cloudResourceKind: "resource",
        cloudProvider: "azure",
        cloudRegion: "westeurope",
        cloudResourceGroup: "orders",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
        isArchived: false,
      },
    };
  },
};

/*
 * The project's records, by table. The tables the pages read that this
 * project has nothing in (owners, labels, saved views, ingestion keys,
 * probes) are modelled as empty; a read of any other is `unhandled`.
 */
const store = {
  Host: [],
  VMwareVCenter: [],
  CloudResource: [],
  HostOwnerUser: [],
  HostOwnerTeam: [],
  VMwareVCenterOwnerUser: [],
  VMwareVCenterOwnerTeam: [],
  // The Owners column of Cloud > Resources, once a resource is there.
  CloudResourceOwnerUser: [],
  CloudResourceOwnerTeam: [],
  Label: [],
  TableView: [],
  TelemetryIngestionKey: [],
  Probe: [],
};

if (hasHost) {
  store.Host.push(FIRST_RECORDS.host().record);
}

/*
 * A project that has vCenters both ways: one a probe collects (so its
 * Collected By names the probe), and one the VMware Agent sends, with a
 * version older than the collector the agent's files pin (so its Agent
 * Version carries the upgrade sign).
 */
if (hasVCenters) {
  store.VMwareVCenter.push(
    {
      _id: uuid("31000000", 2),
      name: "vcenter-lab",
      otelCollectorStatus: "connected",
      collectionMethod: "Probe",
      collectionProbe: Object.assign(new Probe(), {
        _id: uuid("33000000", 1),
        name: "Lab Probe",
      }),
      lastSeenAt: new Date(),
      isArchived: false,
    },
    {
      _id: uuid("31000000", 3),
      name: "vcenter-prod",
      otelCollectorStatus: "connected",
      collectionMethod: "Agent",
      agentVersion: "0.100.0",
      lastSeenAt: new Date(),
      isArchived: false,
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    hosts: hasHost,
    vcenters: hasVCenters,
    language,
    failFirstCount: failingCounts > 0,
  },
  countRequests: [],
  listRequests: [],
  apiRequests: [],
  unhandled: [],
  // The agent reports: from now on the project has this record.
  arrive: (kind) => {
    const first = FIRST_RECORDS[kind]();
    store[new first.modelType().tableName].push(first.record);
  },
};
window.__infrastructureFirstRunFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

// A stored value and a query's value, compared as the server would.
function plain(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

/*
 * The query's plain values (isArchived, cloudResourceKind) must match; the
 * facet chips' richer filters are not set by any test.
 */
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    const value = plain(wanted);
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      continue;
    }
    if (field === "projectId") {
      continue;
    }
    if ((record[field] ?? false) !== value) {
      return false;
    }
  }
  return true;
}

function rows(modelType, query) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return store[name]
    .filter((record) => {
      return matches(record, query);
    })
    .map((record) => {
      return Object.assign(new modelType(), record);
    });
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
  return "sam@acme-infrastructure.example";
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
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (failingCounts > 0) {
    failingCounts--;
    throw new Error(COUNT_FAILURE);
  }

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url });
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
    pageRoute: RouteMap[pageKey],
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function withNavigation(Component, pageKey) {
  return function NavigatedPage() {
    useNavigationHooks();
    return <Component {...pageProps(pageKey)} />;
  };
}

const FixtureHostLayout = withNavigation(HostLayout, PageMap.HOSTS);
const FixtureHosts = withNavigation(HostsPage, PageMap.HOSTS);
const FixtureVMwareLayout = withNavigation(
  VMwareLayout,
  PageMap.VMWARE_VCENTERS,
);
const FixtureVCenters = withNavigation(VCentersPage, PageMap.VMWARE_VCENTERS);
const FixtureCloudLayout = withNavigation(
  CloudLayout,
  PageMap.CLOUD_MONITORED_RESOURCES,
);
const FixtureCloudResources = withNavigation(
  CloudMonitoredResourcesPage,
  PageMap.CLOUD_MONITORED_RESOURCES,
);

// A page the lists link to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

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
          <span className="text-sm text-gray-500">Acme Infrastructure</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureHostLayout />}>
          <Route
            path={RouteMap[PageMap.HOSTS].toString()}
            element={<FixtureHosts />}
          />
        </Route>
        <Route element={<FixtureVMwareLayout />}>
          <Route
            path={RouteMap[PageMap.VMWARE_VCENTERS].toString()}
            element={<FixtureVCenters />}
          />
        </Route>
        <Route element={<FixtureCloudLayout />}>
          <Route
            path={RouteMap[PageMap.CLOUD_MONITORED_RESOURCES].toString()}
            element={<FixtureCloudResources />}
          />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
