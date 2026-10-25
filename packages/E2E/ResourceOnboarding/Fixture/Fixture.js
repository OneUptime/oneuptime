/*
 * Offline fixture for adding resources the way a host is added
 * (Components/ResourceOnboarding): a list's Add button opens the resource's
 * setup guide in a dialog, the guide asks for the name the agent is told and
 * writes it into the commands, and its last step watches for the resource to
 * connect. An empty list shows the same guide as its first-run card. A
 * database or a queue is added with its form, and its guide then opens on
 * its own.
 *
 * The layouts (Page + each product's side menu) and the list pages are the
 * production components from this branch, mounted under their real RouteMap
 * patterns. Only the data boundary (ModelAPI / API) and the signed-in user
 * are replaced. Every record is fabricated for an "Acme Infrastructure"
 * workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?clusters=1  the project has two clusters: "my-cluster" (reporting) and
 *                "legacy-east" (added by hand long ago, never connected)
 *   ?keys=none   the project has no ingestion key (one Server and one
 *                Browser key by default)
 *   ?lang=       de reads the German locale file
 *   ?theme=      dark adds html.dark (handled by server.js)
 *
 * window.__resourceOnboardingFixture.arrive(kind, name) is an agent
 * reporting for the first time: ingest registers the record (kind:
 * kubernetes | docker | iot | serverless | rum). report(kind, name) is a
 * record the project already has reporting again, engineMetrics(name) is a
 * database's first engine metrics and queueData(name) a queue's first data.
 * Create on the Databases, Queues and RUM lists stores what the form sent,
 * as the services fill it in.
 *
 * Every read is recorded on window.__resourceOnboardingFixture: listRequests,
 * countRequests, creates, apiRequests and unhandled - anything the fixture
 * does not model. The spec asserts `unhandled` is empty.
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
import KubernetesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Layout";
import KubernetesClustersPage from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters";
import DockerLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/Layout";
import DockerHostsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/Hosts";
import IoTLayout from "../../../App/FeatureSet/Dashboard/src/Pages/IoT/Layout";
import IoTFleetsPage from "../../../App/FeatureSet/Dashboard/src/Pages/IoT/Fleets";
import ServerlessLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Serverless/Layout";
import ServerlessFunctionsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Serverless/ServerlessFunctions";
import RumLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/Layout";
import RumApplicationsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/RumApplications";
import DatabaseLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Layout";
import DatabasesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import MessageQueueLayout from "../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Layout";
import MessageQueuesPage from "../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/MessageQueues";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import Project from "Common/Models/DatabaseModels/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Search from "Common/Types/BaseDatabase/Search";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
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

const hasClusters = params.get("clusters") === "1";
const hasKeys = params.get("keys") !== "none";
const language = params.get("lang") === "de" ? "de" : "en";

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

// The secrets the commands carry once a key is picked.
const SERVER_KEY_SECRET = "acme-server-key-0123456789";
const BROWSER_KEY_SECRET = "acme-browser-key-9876543210";

const HOURS = 60 * 60 * 1000;

/*
 * What each kind of resource is, as ingest stores the one its agent first
 * reports: the table, the column the agent's name lands in, and the rest of
 * the row.
 */
const KINDS = {
  kubernetes: {
    modelType: KubernetesCluster,
    nameField: "clusterIdentifier",
    prefix: "30000000",
    extra: { nodeCount: 3, podCount: 41 },
  },
  docker: {
    modelType: DockerHost,
    nameField: "hostIdentifier",
    prefix: "31000000",
    extra: {},
  },
  iot: {
    modelType: IoTFleet,
    nameField: "name",
    prefix: "32000000",
    extra: {},
  },
  serverless: {
    modelType: ServerlessFunction,
    nameField: "functionIdentifier",
    prefix: "33000000",
    extra: { cloudPlatform: "aws_lambda" },
  },
  rum: {
    modelType: RumApplication,
    nameField: "appIdentifier",
    prefix: "34000000",
    extra: { clientType: "browser" },
  },
};

/*
 * The project's records, by table. The tables the pages read that this
 * project has nothing in (owners, labels, saved views) are modelled as
 * empty; a read of any other is `unhandled`.
 */
const store = {
  KubernetesCluster: [],
  KubernetesClusterOwnerUser: [],
  KubernetesClusterOwnerTeam: [],
  DockerHost: [],
  DockerHostOwnerUser: [],
  DockerHostOwnerTeam: [],
  IoTFleet: [],
  IoTFleetOwnerUser: [],
  IoTFleetOwnerTeam: [],
  ServerlessFunction: [],
  ServerlessFunctionOwnerUser: [],
  ServerlessFunctionOwnerTeam: [],
  RumApplication: [],
  RumApplicationOwnerUser: [],
  RumApplicationOwnerTeam: [],
  DatabaseServer: [],
  DatabaseServerEndpoint: [],
  DatabaseServerOwnerUser: [],
  DatabaseServerOwnerTeam: [],
  MessageQueue: [],
  MessageQueueOwnerUser: [],
  MessageQueueOwnerTeam: [],
  Label: [],
  TableView: [],
  TelemetryIngestionKey: [],
};

if (hasKeys) {
  store.TelemetryIngestionKey.push(
    {
      _id: uuid("40000000", 1),
      name: "Production",
      description: "",
      secretKey: SERVER_KEY_SECRET,
      keyType: TelemetryIngestionKeyType.Server,
    },
    {
      _id: uuid("40000000", 2),
      name: "Storefront browser",
      description: "",
      secretKey: BROWSER_KEY_SECRET,
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://shop.acme-infrastructure.example"],
    },
  );
}

/*
 * A project that already has clusters: one reporting under the guide's
 * example name, and one added by hand before the Add guide, that never
 * connected.
 */
if (hasClusters) {
  store.KubernetesCluster.push(
    {
      _id: uuid("30000000", 90),
      name: "my-cluster",
      clusterIdentifier: "my-cluster",
      otelCollectorStatus: "connected",
      nodeCount: 6,
      podCount: 120,
      createdAt: new Date(Date.now() - 30 * 24 * HOURS),
      lastSeenAt: new Date(Date.now() - 60 * 1000),
      isArchived: false,
    },
    {
      _id: uuid("30000000", 91),
      name: "Legacy East",
      clusterIdentifier: "legacy-east",
      otelCollectorStatus: "disconnected",
      createdAt: new Date(Date.now() - 90 * 24 * HOURS),
      lastSeenAt: null,
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
  scenario: { clusters: hasClusters, keys: hasKeys, language },
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  creates: [],
  apiRequests: [],
  unhandled: [],
  // An agent reports for the first time: ingest registers the record.
  arrive: (kind, name) => {
    const spec = KINDS[kind];
    const table = store[tableName(spec.modelType)];
    const now = new Date();
    const record = {
      _id: uuid(spec.prefix, table.length + 1),
      name: name,
      ...spec.extra,
      otelCollectorStatus: "connected",
      createdAt: now,
      lastSeenAt: now,
      isArchived: false,
    };
    record[spec.nameField] = name;
    table.push(record);
    return record._id;
  },
  // A record the project has reports again.
  report: (kind, name) => {
    const spec = KINDS[kind];
    const record = store[tableName(spec.modelType)].find((candidate) => {
      return candidate[spec.nameField] === name;
    });
    record.otelCollectorStatus = "connected";
    record.lastSeenAt = new Date();
  },
  // A database's first engine metrics, from the Database Agent.
  engineMetrics: (name) => {
    const record = store.DatabaseServer.find((candidate) => {
      return candidate.name === name;
    });
    const now = new Date();
    record.collectorLastSeenAt = now;
    record.lastSeenAt = now;
    record.otelCollectorStatus = "connected";
  },
  // A queue's first data, from its apps' spans or its broker's metrics.
  queueData: (name) => {
    const record = store.MessageQueue.find((candidate) => {
      return candidate.name === name;
    });
    record.lastSeenAt = new Date();
  },
};
window.__resourceOnboardingFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function idOf(value) {
  return value === null || value === undefined ? "" : value.toString();
}

function asTime(value) {
  if (!value) {
    return NaN;
  }
  return new Date(value).getTime();
}

/*
 * The query, matched as the server would: plain values must be equal, a
 * Search is a case-insensitive "contains", a GreaterThanOrEqual compares
 * dates. The facet chips' richer filters are not set by any test.
 */
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }

    const value = record[field];

    if (wanted instanceof Search) {
      if (
        typeof value !== "string" ||
        !value.toLowerCase().includes(wanted.value.toLowerCase())
      ) {
        return false;
      }
      continue;
    }

    if (wanted instanceof GreaterThanOrEqual) {
      if (!(asTime(value) >= asTime(wanted.value))) {
        return false;
      }
      continue;
    }

    if (wanted instanceof ObjectID) {
      if (idOf(value) !== wanted.toString()) {
        return false;
      }
      continue;
    }

    if (
      typeof wanted !== "string" &&
      typeof wanted !== "boolean" &&
      typeof wanted !== "number"
    ) {
      continue;
    }

    if ((value ?? false) !== wanted) {
      return false;
    }
  }
  return true;
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  const found = store[name].filter((record) => {
    return matches(record, query);
  });
  if (sort && sort.createdAt) {
    found.sort((first, second) => {
      return asTime(second.createdAt) - asTime(first.createdAt);
    });
  }
  return found.map((record) => {
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

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const limited = data.slice(0, options.limit || data.length);
  return {
    data: limited,
    count: data.length,
    skip: 0,
    limit: options.limit || 10,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.itemRequests.push({ modelName, id: idOf(options.id) });

  const table = store[modelName];
  if (!table) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }
  const record = table.find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });
  return record ? Object.assign(new options.modelType(), record) : null;
};

// What the services fill in for a database, a queue or an application added by hand.
const CREATED_DEFAULTS = {
  RumApplication: (json) => {
    const identifier = String(json.appIdentifier || "").trim();
    return {
      name: String(json.name || "").trim() || identifier,
      appIdentifier: identifier,
    };
  },
  DatabaseServer: (json) => {
    const address = String(json.serverAddress || "").trim();
    const port = json.serverPort || 5432;
    return {
      name: String(json.name || "").trim() || `PostgreSQL ${address}:${port}`,
      dbSystem: json.dbSystem || "postgresql",
      serverAddress: address,
      serverPort: port,
      discoverySource: "manual",
    };
  },
  MessageQueue: (json) => {
    const destination = String(json.destinationName || json.name || "").trim();
    const system = json.messagingSystem || "rabbitmq";
    return {
      name: String(json.name || "").trim() || destination,
      destinationName: destination,
      messagingSystem: system,
      // The identity discovery keys a queue on, as the service works it out.
      queueIdentifier: `${system}|${destination}`,
      discoverySource: "manual",
    };
  },
};

const CREATED_PREFIXES = {
  DatabaseServer: "35000000",
  MessageQueue: "36000000",
  RumApplication: "37000000",
};

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const json = BaseModel.toJSON(options.model, options.modelType);
  fixture.creates.push({ modelName, data: serialize(json) });

  const defaults = CREATED_DEFAULTS[modelName];
  if (!defaults || options.model._id) {
    fixture.unhandled.push({ kind: "createOrUpdate", modelName });
    throw new HTTPErrorResponse(400, { message: "Not modelled." }, {});
  }

  const table = store[modelName];
  const created = {
    _id: uuid(CREATED_PREFIXES[modelName], 1 + table.length),
    ...defaults(json),
    createdAt: new Date(),
    lastSeenAt: null,
    isArchived: false,
  };
  table.push(created);

  return new HTTPResponse(
    200,
    BaseModel.toJSON(
      Object.assign(new options.modelType(), created),
      options.modelType,
    ),
    {},
  );
};
ModelAPI.create = ModelAPI.createOrUpdate;

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

const LISTS = [
  [KubernetesLayout, KubernetesClustersPage, PageMap.KUBERNETES_CLUSTERS],
  [DockerLayout, DockerHostsPage, PageMap.DOCKER_HOSTS],
  [IoTLayout, IoTFleetsPage, PageMap.IOT_FLEETS],
  [ServerlessLayout, ServerlessFunctionsPage, PageMap.SERVERLESS_FUNCTIONS],
  [RumLayout, RumApplicationsPage, PageMap.RUM_APPLICATIONS],
  [DatabaseLayout, DatabasesPage, PageMap.DATABASE_SERVERS],
  [MessageQueueLayout, MessageQueuesPage, PageMap.MESSAGE_QUEUES],
].map(([Layout, Page, pageKey]) => {
  return {
    pageKey,
    Layout: withNavigation(Layout, pageKey),
    Page: withNavigation(Page, pageKey),
  };
});

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
        {LISTS.map((list) => {
          return (
            <Route key={list.pageKey} element={<list.Layout />}>
              <Route
                path={RouteMap[list.pageKey].toString()}
                element={<list.Page />}
              />
            </Route>
          );
        })}
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
