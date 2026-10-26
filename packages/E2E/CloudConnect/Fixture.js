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
import "Common/UI/Styles/Theme.css";
import CloudConnectPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Connect";
import CloudLayout from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Layout";
import CloudAccountsPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/Accounts";
import CloudAccountViewLayout from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Layout";
import CloudAccountOverviewPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Overview";
import CloudAccountResourcesPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Resources";
import PageMap from "../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
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

/*
 * The fixture page: the real Cloud > Connect page in the real Cloud layout
 * (its side menu, breadcrumbs and widths), at its own address
 * (/dashboard/<project>/cloud/connect), with the API answered from an
 * in-page store (window.__cloudConnectFixture) the specs read - every
 * connection saved or changed, every test and read-now request - and
 * drive - what a test answers next. An address the page links to that is
 * not modelled draws its path.
 *
 *   ?state=     empty (default: nothing connected)
 *               | connected (an AWS account that works, an Azure
 *               subscription that does not, a Google Cloud project that is
 *               turned off)
 *               | new (an Azure subscription just connected, waiting for
 *               its first read)
 *   ?role=      owner (default) | member
 *   ?aws=       role (default: this OneUptime can sign in to an AWS role)
 *               | key (it cannot: AWS connects with an access key)
 *   ?verdict=   pass (default) | warn | auth | slow
 *   ?cloud=     aws | azure | gcp (the page opens that cloud's form)
 *   ?theme=dark   ?lang=ja|de
 *
 * Cloud > Accounts and one account's pages are drawn too
 * (/dashboard/<project>/cloud/accounts[/<account>[/resources]]): with
 * ?state=connected, the AWS account the AWS connection reads (being read),
 * the Azure subscription of the connection that is not working (not read
 * lately) and a Google Cloud project no connection reads any more, each
 * with what it holds; the AWS account's resources are its Resources.
 */

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const dataState = params.get("state") || "empty";
const awsWay = params.get("aws") || "role";
const language = ["ja", "de"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    ja: { translation: JA },
    de: { translation: DE },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

const project = new Project();
project._id = PROJECT_ID;
project.name = "SYSNETIX DEMO";
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const ROLES = {
  owner: [Permission.ProjectOwner],
  member: [Permission.ProjectMember],
};
const granted = ROLES[role] || ROLES.owner;

PermissionUtil.getAllPermissions = () => {
  return granted;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: granted.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

function connection(id, fields) {
  const item = new CloudConnection();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    isEnabled: true,
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    ...fields,
  });
  return item;
}

// Just connected: no read yet, nothing failed.
const NEW_CONNECTIONS = [
  connection("20000000-0000-4000-8000-000000000004", {
    name: "Microsoft Azure",
    provider: "azure",
    config: {
      authMethod: "azure-client-secret",
      tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
      readIntervalInMinutes: "5",
    },
  }),
];

const connections =
  dataState === "empty"
    ? []
    : dataState === "new"
      ? NEW_CONNECTIONS
      : [
          connection("20000000-0000-4000-8000-000000000001", {
            name: "AWS 123456789012",
            provider: "aws",
            config: {
              authMethod: "aws-role",
              roleArn:
                "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e",
              readIntervalInMinutes: "10",
            },
            lastPulledAt: new Date("2026-10-21T09:50:00.000Z"),
            lastSuccessfulPullAt: new Date("2026-10-21T09:50:00.000Z"),
            lastPullResult: {
              status: "success",
              accounts: ["123456789012"],
              resourceCount: 46,
              resourceTypes: [
                { type: "AWS::EC2::Instance", count: 24 },
                { type: "AWS::RDS::DBInstance", count: 9 },
                { type: "AWS::Lambda::Function", count: 7 },
                { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
                { type: "AWS::S3::Bucket", count: 2 },
              ],
              regions: [
                { region: "us-east-1", count: 31 },
                { region: "eu-west-1", count: 15 },
              ],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 1840,
              changesRecorded: 12,
              requestCount: 64,
              warnings: [],
              durationMs: 5400,
              finishedAt: "2026-10-21T09:50:05.000Z",
            },
          }),
          connection("20000000-0000-4000-8000-000000000002", {
            name: "Contoso production",
            provider: "azure",
            config: {
              authMethod: "azure-client-secret",
              tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
              clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
              cloud: "public",
              readIntervalInMinutes: "5",
            },
            lastPulledAt: new Date("2026-10-21T09:55:00.000Z"),
            lastError:
              "Azure Resource Manager request failed with HTTP 403: The client '00001111-aaaa-2222-bbbb-3333cccc4444' does not have authorization to perform action 'Microsoft.Insights/metrics/read'.",
            lastPullResult: {
              status: "failed",
              failureKind: "permission",
              accounts: [],
              resourceCount: 0,
              resourceTypes: [],
              regions: [],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 0,
              requestCount: 2,
              warnings: [],
              durationMs: 400,
              finishedAt: "2026-10-21T09:55:01.000Z",
            },
          }),
          connection("20000000-0000-4000-8000-000000000003", {
            name: "Google Cloud acme-prod",
            provider: "gcp",
            isEnabled: false,
            config: {
              authMethod: "gcp-service-account-key",
              clientEmail:
                "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
              keyProjectId: "acme-prod",
              readIntervalInMinutes: "60",
            },
            lastPulledAt: new Date("2026-10-19T12:00:00.000Z"),
            lastSuccessfulPullAt: new Date("2026-10-19T12:00:00.000Z"),
            lastPullResult: {
              status: "success",
              accounts: ["acme-prod"],
              resourceCount: 3,
              resourceTypes: [{ type: "gce_instance", count: 3 }],
              regions: [{ region: "europe-west1", count: 3 }],
              newResources: 0,
              archivedResources: 0,
              pointsWritten: 90,
              requestCount: 13,
              warnings: [],
              durationMs: 900,
              finishedAt: "2026-10-19T12:00:01.000Z",
            },
          }),
        ];

/*
 * The accounts the connections read. One now for every time the fixture
 * stamps, so "read 4 minutes ago" never crosses the hour the status pill
 * turns at while a test runs.
 */
const NOW = Date.now();
const MINUTE = 60 * 1000;

function account(id, fields) {
  const item = new CloudAccount();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    labels: [],
    ...fields,
  });
  return item;
}

function readingConnection(id, name) {
  return Object.assign(new CloudConnection(), { _id: id, name: name });
}

const AWS_ACCOUNT_ID = "30000000-0000-4000-8000-000000000001";
const AZURE_ACCOUNT_ID = "30000000-0000-4000-8000-000000000002";
const GCP_ACCOUNT_ID = "30000000-0000-4000-8000-000000000003";

const accounts =
  dataState === "connected"
    ? [
        account(AWS_ACCOUNT_ID, {
          name: "Production",
          description: "Checkout, orders and the storefront.",
          provider: "aws",
          accountId: "123456789012",
          providerAccountName: "acme-production",
          cloudConnectionId: new ObjectID(
            "20000000-0000-4000-8000-000000000001",
          ),
          cloudConnection: readingConnection(
            "20000000-0000-4000-8000-000000000001",
            "AWS 123456789012",
          ),
          resourceCount: 46,
          regionCount: 2,
          resourceSummary: {
            resourceCount: 46,
            types: [
              { type: "AWS::EC2::Instance", count: 24 },
              { type: "AWS::RDS::DBInstance", count: 9 },
              { type: "AWS::Lambda::Function", count: 7 },
              { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
              { type: "AWS::S3::Bucket", count: 2 },
            ],
            regions: [
              { region: "us-east-1", count: 31 },
              { region: "eu-west-1", count: 15 },
            ],
          },
          lastSeenAt: new Date(NOW - 4 * MINUTE),
          inventoryListedAt: new Date(NOW - 22 * MINUTE),
        }),
        account(AZURE_ACCOUNT_ID, {
          name: "Contoso production",
          provider: "azure",
          accountId: "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
          providerAccountName: "Contoso production",
          cloudConnectionId: new ObjectID(
            "20000000-0000-4000-8000-000000000002",
          ),
          cloudConnection: readingConnection(
            "20000000-0000-4000-8000-000000000002",
            "Contoso production",
          ),
          resourceCount: 37,
          regionCount: 2,
          resourceSummary: {
            resourceCount: 37,
            types: [
              { type: "Microsoft.Compute/virtualMachines", count: 18 },
              { type: "Microsoft.Sql/servers/databases", count: 6 },
            ],
            regions: [
              { region: "westeurope", count: 29 },
              { region: "northeurope", count: 8 },
            ],
          },
          lastSeenAt: new Date(NOW - 26 * 60 * MINUTE),
          inventoryListedAt: new Date(NOW - 26 * 60 * MINUTE),
        }),
        account(GCP_ACCOUNT_ID, {
          name: "acme-legacy",
          provider: "gcp",
          accountId: "acme-legacy",
          resourceCount: 3,
          regionCount: 1,
          resourceSummary: {
            resourceCount: 3,
            types: [{ type: "gce_instance", count: 3 }],
            regions: [{ region: "europe-west1", count: 3 }],
          },
          lastSeenAt: new Date("2026-10-19T12:00:00.000Z"),
        }),
      ]
    : [];

function cloudResource(id, fields) {
  return Object.assign(new CloudResource(), {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    cloudProvider: "aws",
    cloudAccountId: "123456789012",
    isArchived: false,
    labels: [],
    ...fields,
  });
}

// The AWS account's resources, as its Resources page lists them.
const AWS_RESOURCES = [
  cloudResource("40000000-0000-4000-8000-000000000001", {
    name: "web-alb",
    cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    cloudRegion: "us-east-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
  }),
  cloudResource("40000000-0000-4000-8000-000000000002", {
    name: "orders-db",
    cloudResourceType: "AWS::RDS::DBInstance",
    cloudRegion: "eu-west-1",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW - 3 * MINUTE),
  }),
  cloudResource("40000000-0000-4000-8000-000000000003", {
    name: "nightly-export",
    cloudResourceType: "AWS::Lambda::Function",
    cloudRegion: "us-east-1",
    otelCollectorStatus: "disconnected",
    lastSeenAt: new Date(NOW - 3 * 24 * 60 * MINUTE),
  }),
];

// A query's value as the list sent it: an Includes' values, or the value.
function plainValues(value) {
  if (value && typeof value === "object" && Array.isArray(value.values)) {
    return value.values.map(String);
  }
  if (value && typeof value === "object" && Array.isArray(value.value)) {
    return value.value.map(String);
  }
  return value === undefined || value === null ? [] : [String(value)];
}

const state = {
  // What each list read asked for, by model.
  listRequests: [],
  // Every connection a form created, as the model it sent.
  creates: [],
  // Every update: the id and the data.
  updates: [],
  deletes: [],
  // Every test request body, and every read-now path.
  tests: [],
  readNows: [],
  // How often the page asked for one connection: a read it watches.
  itemAsks: 0,
  roleSetupAsks: 0,
  verdict: params.get("verdict") || "pass",
  held: [],
};

/*
 * What a test answers, for the cloud it tests - the form's own cloud, or a
 * saved connection's - as the server answers: what it found reads in that
 * cloud's words.
 */
const FOUND = {
  aws: {
    accounts: ["123456789012"],
    resourceCount: 46,
    resourceTypes: [
      { type: "AWS::EC2::Instance", count: 24 },
      { type: "AWS::RDS::DBInstance", count: 9 },
      { type: "AWS::Lambda::Function", count: 7 },
      { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 4 },
      { type: "AWS::S3::Bucket", count: 2 },
    ],
    regions: [
      { region: "us-east-1", count: 31 },
      { region: "eu-west-1", count: 15 },
    ],
  },
  azure: {
    accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
    resourceCount: 37,
    resourceTypes: [
      { type: "Microsoft.Compute/virtualMachines", count: 18 },
      { type: "Microsoft.Sql/servers/databases", count: 6 },
      { type: "Microsoft.Web/sites", count: 5 },
      { type: "Microsoft.Storage/storageAccounts", count: 4 },
      { type: "Microsoft.Network/loadBalancers", count: 2 },
      { type: "Microsoft.Cache/Redis", count: 2 },
    ],
    regions: [
      { region: "westeurope", count: 29 },
      { region: "northeurope", count: 8 },
    ],
  },
  gcp: {
    accounts: ["acme-prod"],
    resourceCount: 12,
    resourceTypes: [
      { type: "gce_instance", count: 8 },
      { type: "cloudsql_database", count: 3 },
      { type: "cloud_run_revision", count: 1 },
    ],
    regions: [{ region: "europe-west1", count: 12 }],
  },
};

// What each cloud says when it refuses a key.
const REFUSED = {
  aws: "The security token included in the request is invalid.",
  azure:
    "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID.",
  gcp: "invalid_grant: Invalid JWT Signature.",
};

function verdict(name, provider) {
  const cloud = FOUND[provider] ? provider : "azure";

  if (name === "warn") {
    return {
      provider: cloud,
      status: "warn",
      message: "Signed in; nothing reports metrics yet.",
      accounts: FOUND[cloud].accounts,
      resourceCount: 0,
      resourceTypes: [],
      regions: [],
      durationMs: 700,
    };
  }

  if (name === "auth") {
    return {
      provider: cloud,
      status: "fail",
      message: REFUSED[cloud],
      failureKind: "authentication",
      durationMs: 300,
    };
  }

  return {
    provider: cloud,
    status: "pass",
    message: "Signed in and counted what there is to monitor.",
    ...FOUND[cloud],
    isSample: true,
    durationMs: 1300,
  };
}

// The cloud a test is for: the form's, or the saved connection's.
function providerOf(body) {
  if (body && body.provider) {
    return body.provider;
  }

  const saved = connections.find((item) => {
    return Boolean(body) && item.id.toString() === String(body.connectionId);
  });

  return saved ? saved.provider : "azure";
}

function answer(name, provider) {
  return new HTTPResponse(200, verdict(name, provider), {});
}

window.__cloudConnectFixture = {
  state: state,
  setVerdict: (name) => {
    state.verdict = name;
  },
  release: (name) => {
    const held = state.held.splice(0);
    for (const entry of held) {
      entry.resolve(answer(name, entry.provider));
    }
  },
  // A read the page started (Read now) ends: the connection was read now.
  finishRead: (id) => {
    const found = connections.find((item) => {
      return item.id.toString() === id;
    });
    if (found) {
      const now = new Date();
      found.lastPulledAt = now;
      found.lastSuccessfulPullAt = now;
      found.lastError = undefined;
      found.lastPullResult = {
        status: "success",
        accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
        resourceCount: 37,
        resourceTypes: [
          { type: "Microsoft.Compute/virtualMachines", count: 18 },
        ],
        regions: [
          { region: "westeurope", count: 29 },
          { region: "northeurope", count: 8 },
        ],
        newResources: 37,
        archivedResources: 0,
        pointsWritten: 512,
        requestCount: 40,
        warnings: [],
        durationMs: 4000,
        finishedAt: now.toISOString(),
      };
    }
  },
};

function copy(item) {
  return Object.assign(new CloudConnection(), item);
}

ModelAPI.getList = async (args) => {
  if (args.modelType === CloudConnection) {
    const data = connections.map(copy);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === CloudAccount) {
    state.listRequests.push({ model: "CloudAccount" });
    const data = accounts.map((item) => {
      return Object.assign(new CloudAccount(), item);
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === CloudResource) {
    const query = args.query || {};
    const provider = String(query.cloudProvider || "");
    const accountIds = plainValues(query.cloudAccountId);
    state.listRequests.push({
      model: "CloudResource",
      cloudProvider: provider,
      cloudAccountIds: accountIds,
      isArchived: query.isArchived,
    });
    const data = AWS_RESOURCES.filter((item) => {
      return (
        item.cloudProvider === provider &&
        accountIds.includes(item.cloudAccountId)
      );
    }).map((item) => {
      return Object.assign(new CloudResource(), item);
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  return { data: [], count: 0, skip: 0, limit: args.limit };
};

// One connection, as the list asks after a read it started (Read now).
ModelAPI.getItem = async (args) => {
  if (args.modelType === CloudAccount) {
    const found = accounts.find((item) => {
      return item._id === args.id.toString();
    });
    return found ? Object.assign(new CloudAccount(), found) : null;
  }

  state.itemAsks++;
  if (args.modelType === CloudConnection) {
    const found = connections.find((item) => {
      return item.id.toString() === args.id.toString();
    });
    return found ? copy(found) : null;
  }
  return null;
};

ModelAPI.count = async (args) => {
  if (args.modelType === CloudConnection) {
    return connections.length;
  }
  if (args.modelType === CloudAccount) {
    return accounts.length;
  }
  return 0;
};

ModelAPI.create = async (args) => {
  const model = args.model;
  state.creates.push({
    name: model.name,
    provider: model.provider,
    config: model.config,
    secrets: model.secrets,
    isEnabled: model.isEnabled,
  });
  return new HTTPResponse(200, {}, {});
};

ModelAPI.updateById = async (args) => {
  state.updates.push({ id: args.id.toString(), data: args.data });
  const found = connections.find((item) => {
    return item.id.toString() === args.id.toString();
  });
  if (found) {
    Object.assign(found, args.data);
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (args) => {
  state.deletes.push(args.id.toString());
  const index = connections.findIndex((item) => {
    return item.id.toString() === args.id.toString();
  });
  if (index >= 0) {
    connections.splice(index, 1);
  }
};

ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

API.get = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/cloud-connection/aws-role-setup")) {
    state.roleSetupAsks++;
    return new HTTPResponse(
      200,
      awsWay === "key"
        ? { isAvailable: false, externalId: "" }
        : {
            isAvailable: true,
            trustedPrincipalArn: "arn:aws:iam::999988887777:root",
            externalId: "oneuptime-6c2b8f0e4d1a9b3c7e5f2a8d0c6b4e1f",
          },
      {},
    );
  }

  return new HTTPResponse(200, {}, {});
};

API.post = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/cloud-connection/test")) {
    state.tests.push({ body: options.data });

    const provider = providerOf(options.data);

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push({ resolve, provider });
      });
    }

    return answer(state.verdict, provider);
  }

  if (url.endsWith("/read-now")) {
    state.readNows.push(new URL(url).pathname);
    return new HTTPResponse(200, { queued: true }, {});
  }

  return new HTTPResponse(200, {}, {});
};

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

const CONNECT_ROUTE = RouteMap[PageMap.CLOUD_CONNECT];

function FixtureLayout() {
  useNavigationHooks();

  return (
    <CloudLayout
      currentProject={project}
      pageRoute={CONNECT_ROUTE}
      hasPaymentMethod={true}
    />
  );
}

function FixtureConnect() {
  useNavigationHooks();

  return (
    <CloudConnectPage
      currentProject={project}
      pageRoute={CONNECT_ROUTE}
      hasPaymentMethod={true}
    />
  );
}

const ACCOUNTS_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNTS];
const ACCOUNT_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW];
const ACCOUNT_RESOURCES_ROUTE = RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES];

// A Dashboard page, given what App.tsx gives every page.
function withNavigation(Component, pageRoute) {
  return function NavigatedPage() {
    useNavigationHooks();

    return (
      <Component
        currentProject={project}
        pageRoute={pageRoute}
        hasPaymentMethod={true}
      />
    );
  };
}

const FixtureAccountsLayout = withNavigation(CloudLayout, ACCOUNTS_ROUTE);
const FixtureAccounts = withNavigation(CloudAccountsPage, ACCOUNTS_ROUTE);
const FixtureAccountLayout = withNavigation(
  CloudAccountViewLayout,
  ACCOUNT_ROUTE,
);
const FixtureAccountOverview = withNavigation(
  CloudAccountOverviewPage,
  ACCOUNT_ROUTE,
);
const FixtureAccountResources = withNavigation(
  CloudAccountResourcesPage,
  ACCOUNT_RESOURCES_ROUTE,
);

// A page the Connect page links to that is not modelled: says where it is.
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

/*
 * App.tsx reads the location itself, so the whole Dashboard is drawn again
 * on every navigation, and with it the side menu, which marks the page.
 */
function FixtureApp() {
  useLocation();

  return (
    <div className="min-h-screen bg-gray-50 pb-10" data-testid="fixture-page">
      <Routes>
        <Route element={<FixtureLayout />}>
          <Route path={CONNECT_ROUTE.toString()} element={<FixtureConnect />} />
        </Route>
        <Route element={<FixtureAccountsLayout />}>
          <Route
            path={ACCOUNTS_ROUTE.toString()}
            element={<FixtureAccounts />}
          />
        </Route>
        <Route element={<FixtureAccountLayout />}>
          <Route
            path={ACCOUNT_ROUTE.toString()}
            element={<FixtureAccountOverview />}
          />
          <Route
            path={ACCOUNT_RESOURCES_ROUTE.toString()}
            element={<FixtureAccountResources />}
          />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
