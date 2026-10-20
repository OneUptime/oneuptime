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
import LlmConnectPage from "../../App/FeatureSet/Dashboard/src/Pages/Llm/Connect";
import LlmUsagePage from "../../App/FeatureSet/Dashboard/src/Pages/Llm/Usage";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Project from "Common/Models/DatabaseModels/Project";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * The fixture page: the real AI / LLM Connect and Usage pages, with the API
 * answered from an in-page store (window.__llmConnectFixture) the specs
 * read - every connection saved or changed, every test and read-now
 * request - and drive - what a test answers next.
 *
 *   ?page=      connect (default) | usage
 *   ?state=     empty (default: nothing connected, no AI calls, no budget)
 *               | connected (two provider accounts, one working and one
 *               failing, and a company AI tool waiting for its first read)
 *               | done (all of that, AI calls and a budget too)
 *               | off (one Bedrock account, turned off)
 *   ?role=      owner (default) | member | loading
 *   ?verdict=   pass (default) | warn | auth | permission | settings | slow
 *   ?source=    providers (the Usage page's provider accounts)
 *   ?theme=dark   ?lang=ja|de
 */

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "connect";
const role = params.get("role") || "owner";
const dataState = params.get("state") || "empty";
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
const SERVICE_ID = "30000000-0000-4000-8000-000000000009";

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
  loading: [],
};
const granted = ROLES[role] || ROLES.owner;

PermissionUtil.getAllPermissions = () => {
  return granted;
};
PermissionUtil.getProjectPermissions = () => {
  if (granted.length === 0) {
    return null;
  }
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
  const item = new LlmObservabilityConnection();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    isEnabled: true,
    storeConversationText: true,
    conversationReaders: "admins",
    createdAt: new Date("2026-10-12T08:00:00.000Z"),
    ...fields,
  });
  return item;
}

const TURNED_OFF = connection("20000000-0000-4000-8000-000000000005", {
  name: "Bedrock us-east-1",
  provider: "aws-bedrock",
  isEnabled: false,
  config: { accessKeyId: "AKIAEXAMPLE", regions: "us-east-1" },
  lastPulledAt: new Date("2026-10-18T09:00:00.000Z"),
  lastSuccessfulPullAt: new Date("2026-10-18T09:00:00.000Z"),
  lastPullResult: {
    status: "success",
    kind: "usage",
    days: 3,
    inputTokens: 4200000,
    outputTokens: 800000,
  },
});

const connections =
  dataState === "empty"
    ? []
    : dataState === "off"
      ? [TURNED_OFF]
      : [
          connection("20000000-0000-4000-8000-000000000001", {
            name: "OpenAI production",
            provider: "openai",
            config: {},
            lastPulledAt: new Date("2026-10-19T11:45:00.000Z"),
            lastSuccessfulPullAt: new Date("2026-10-19T11:45:00.000Z"),
            lastPullResult: {
              status: "success",
              kind: "usage",
              days: 3,
              costUsd: 182.4,
              inputTokens: 1200000,
              outputTokens: 240000,
            },
          }),
          connection("20000000-0000-4000-8000-000000000002", {
            name: "Foundry East",
            provider: "azure-openai",
            config: {
              tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
              clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
              subscriptionId: "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0",
              cloud: "public",
            },
            lastPulledAt: new Date("2026-10-19T11:50:00.000Z"),
            lastError:
              'Azure OpenAI and Microsoft Foundry accounts request failed with HTTP 403: {"error":{"code":"AuthorizationFailed","message":"The client does not have authorization to perform action \'Microsoft.CognitiveServices/accounts/read\'."}}',
            lastPullResult: { status: "failed", failureKind: "permission" },
          }),
          connection("20000000-0000-4000-8000-000000000003", {
            name: "Claude at Sysnetix",
            provider: "claude-enterprise",
            config: {},
            serviceId: new ObjectID(SERVICE_ID),
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
  // Every aggregate the Usage page asked for: the metric and the groups.
  aggregates: [],
  // Every list of spans asked for, with its query.
  spanLists: [],
  verdict: params.get("verdict") || "pass",
  held: [],
};

const VERDICTS = {
  pass: {
    status: 200,
    body: {
      provider: "openai",
      status: "pass",
      message: "Connected. Found usage in the last 7 days.",
      counts: {
        days: 7,
        models: 3,
        people: 12,
        apiKeys: 4,
        projects: 2,
        inputTokens: 1200000,
        outputTokens: 240000,
        requests: 5400,
        costUsd: 182.4,
      },
      durationMs: 820,
    },
  },
  tool: {
    status: 200,
    body: {
      provider: "claude-enterprise",
      status: "pass",
      message: "Connected. Found conversations in the last 7 days.",
      counts: { days: 7, conversations: 48, people: 9 },
      durationMs: 420,
    },
  },
  warn: {
    status: 200,
    body: {
      provider: "openai",
      status: "warn",
      message: "Connected, but there is no usage in the last 7 days.",
      counts: { days: 7, models: 0 },
      durationMs: 400,
    },
  },
  auth: {
    status: 200,
    body: {
      provider: "openai",
      status: "fail",
      message:
        'OpenAI usage report failed with HTTP 401: {"error":{"message":"Incorrect API key provided: [REDACTED].","type":"invalid_request_error"}}',
      failureKind: "authentication",
      durationMs: 210,
    },
  },
  permission: {
    status: 200,
    body: {
      provider: "openai",
      status: "fail",
      message:
        "OpenAI usage report failed with HTTP 403: You have insufficient permissions for this operation.",
      failureKind: "permission",
      durationMs: 210,
    },
  },
  settings: {
    status: 200,
    body: {
      provider: "openai",
      status: "fail",
      message:
        "This is a project API key. Reading usage and costs needs an OpenAI admin key, which starts with sk-admin-.",
      failureKind: "settings",
      durationMs: 0,
    },
  },
};

function answer(name) {
  const verdict = VERDICTS[name] || VERDICTS.pass;
  return new HTTPResponse(verdict.status, verdict.body, {});
}

window.__llmConnectFixture = {
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

function matches(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) {
      continue;
    }
    if (value instanceof Includes) {
      if (!value.values.map(String).includes(String(item[key]))) {
        return false;
      }
      continue;
    }
    if (typeof value === "object") {
      continue;
    }
    if (String(item[key] || "") !== String(value)) {
      return false;
    }
  }
  return true;
}

function copy(item) {
  return Object.assign(new LlmObservabilityConnection(), item);
}

const ingestionKey = new TelemetryIngestionKey();
Object.assign(ingestionKey, {
  _id: "40000000-0000-4000-8000-000000000001",
  name: "AI calls key",
  secretKey: new ObjectID("50000000-0000-4000-8000-000000000001"),
  keyType: TelemetryIngestionKeyType.Server,
  projectId: new ObjectID(PROJECT_ID),
});

ModelAPI.getList = async (args) => {
  if (args.modelType === LlmObservabilityConnection) {
    const data = connections
      .filter((item) => {
        return matches(item, args.query);
      })
      .map(copy);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }
  if (args.modelType === TelemetryIngestionKey) {
    return { data: [ingestionKey], count: 1, skip: 0, limit: args.limit };
  }
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.count = async (args) => {
  if (args.modelType === LlmCostBudget) {
    return dataState === "done" ? 1 : 0;
  }
  if (args.modelType === LlmObservabilityConnection) {
    return connections.filter((item) => {
      return matches(item, args.query);
    }).length;
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
    conversationReaders: model.conversationReaders,
    storeConversationText: model.storeConversationText,
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

AnalyticsModelAPI.getList = async (args) => {
  if (args.modelType === Span) {
    state.spanLists.push(JSON.parse(JSON.stringify(args.query)));
    const data =
      dataState === "done"
        ? [Object.assign(new Span(), { spanId: "aaaaaaaaaaaaaaaa" })]
        : [];
    return { data, count: data.length, skip: 0, limit: args.limit };
  }
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

/*
 * The provider metrics the Usage page reads, as a connected OpenAI and a
 * connected Bedrock account would have written them.
 */
const PROVIDER_POINTS = [
  {
    model: "gpt-4o",
    person: "ana@sysnetix.com",
    provider: "openai",
    project: "Web",
    key: "web-prod",
    connection: "OpenAI production",
    cost: 120.5,
    estimated: "false",
    input: 900000,
    output: 180000,
    requests: 3200,
  },
  {
    model: "gpt-4o-mini",
    person: "bob@sysnetix.com",
    provider: "openai",
    project: "Support bot",
    key: "support",
    connection: "OpenAI production",
    cost: 41.9,
    estimated: "false",
    input: 300000,
    output: 60000,
    requests: 2200,
  },
  {
    model: "anthropic.claude-sonnet-4-5",
    person: "",
    provider: "aws.bedrock",
    project: "us-east-1",
    key: "",
    connection: "Bedrock",
    cost: 20,
    estimated: "true",
    input: 200000,
    output: 40000,
    requests: 0,
  },
];

const ATTRIBUTE_OF = {
  "gen_ai.request.model": "model",
  "user.email": "person",
  "gen_ai.provider.name": "provider",
  "oneuptime.llm.provider.project": "project",
  "oneuptime.llm.provider.api_key": "key",
  "oneuptime.llm.connection.name": "connection",
};

AnalyticsModelAPI.aggregate = async (args) => {
  if (args.modelType !== Metric) {
    return { data: [] };
  }
  const name = args.aggregateBy.query.name;
  const keys = args.aggregateBy.groupByAttributeKeys || [];
  state.aggregates.push({ name, keys });

  if (dataState === "empty") {
    return { data: [] };
  }

  const rows = [];
  for (const point of PROVIDER_POINTS) {
    const attributes = {};
    for (const key of keys) {
      if (ATTRIBUTE_OF[key]) {
        attributes[key] = point[ATTRIBUTE_OF[key]];
      }
    }
    if (name === "oneuptime.llm.provider.cost") {
      attributes["oneuptime.llm.cost.estimated"] = point.estimated;
      rows.push({ value: point.cost, attributes });
    } else if (name === "oneuptime.llm.provider.tokens") {
      rows.push({
        value: point.input,
        attributes: { ...attributes, "gen_ai.token.type": "input" },
      });
      rows.push({
        value: point.output,
        attributes: { ...attributes, "gen_ai.token.type": "output" },
      });
    } else if (name === "oneuptime.llm.provider.requests" && point.requests) {
      rows.push({ value: point.requests, attributes });
    }
  }
  return { data: rows };
};

API.post = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/llm-observability-connection/test")) {
    state.tests.push({ body: options.data, headers: options.headers || {} });

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push(resolve);
      });
    }

    if (state.verdict === "error") {
      return new HTTPErrorResponse(
        422,
        {
          message:
            "Project owners and project administrators can test and read AI connections.",
        },
        {},
      );
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
        {page === "usage" ? (
          <LlmUsagePage currentProject={project} />
        ) : (
          <LlmConnectPage currentProject={project} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
