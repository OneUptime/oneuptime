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
import "Common/UI/Styles/Theme.css";
import CloudConnectPage from "../../App/FeatureSet/Dashboard/src/Pages/Cloud/Connect";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
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
 * The fixture page: the real Cloud > Connect page, with the API answered
 * from an in-page store (window.__cloudConnectFixture) the specs read -
 * every connection saved or changed, every test and read-now request - and
 * drive - what a test answers next.
 *
 *   ?state=     empty (default: nothing connected)
 *               | connected (an AWS account that works, an Azure
 *               subscription that does not, a Google Cloud project that is
 *               turned off)
 *   ?role=      owner (default) | member
 *   ?aws=       role (default: this OneUptime can sign in to an AWS role)
 *               | key (it cannot: AWS connects with an access key)
 *   ?verdict=   pass (default) | warn | auth | slow
 *   ?cloud=     aws | azure | gcp (the page opens that cloud's form)
 *   ?theme=dark   ?lang=ja|de
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

const connections =
  dataState === "empty"
    ? []
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

const state = {
  // Every connection a form created, as the model it sent.
  creates: [],
  // Every update: the id and the data.
  updates: [],
  deletes: [],
  // Every test request body, and every read-now path.
  tests: [],
  readNows: [],
  roleSetupAsks: 0,
  verdict: params.get("verdict") || "pass",
  held: [],
};

const VERDICTS = {
  pass: {
    provider: "azure",
    status: "pass",
    message: "Signed in to 1 subscription and found 37 resources.",
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
    isSample: true,
    durationMs: 1300,
  },
  warn: {
    provider: "azure",
    status: "warn",
    message: "Signed in to 1 subscription; it has no resources yet.",
    accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
    resourceCount: 0,
    resourceTypes: [],
    regions: [],
    durationMs: 700,
  },
  auth: {
    provider: "azure",
    status: "fail",
    message:
      "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID.",
    failureKind: "authentication",
    durationMs: 300,
  },
};

function answer(name) {
  return new HTTPResponse(200, VERDICTS[name] || VERDICTS.pass, {});
}

window.__cloudConnectFixture = {
  state: state,
  setVerdict: (name) => {
    state.verdict = name;
  },
  release: (name) => {
    const held = state.held.splice(0);
    for (const resolve of held) {
      resolve(answer(name));
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
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.count = async (args) => {
  if (args.modelType === CloudConnection) {
    return connections.length;
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

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push(resolve);
      });
    }

    return answer(state.verdict);
  }

  if (url.endsWith("/read-now")) {
    state.readNows.push(new URL(url).pathname);
    return new HTTPResponse(200, { queued: true }, {});
  }

  return new HTTPResponse(200, {}, {});
};

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6" data-testid="fixture-page">
        <CloudConnectPage currentProject={project} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
