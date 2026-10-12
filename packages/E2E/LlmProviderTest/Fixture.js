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
import LlmProvidersPage from "../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders";
import LlmProviderViewPage from "../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import LlmType from "Common/Types/LLM/LlmType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * The fixture page: the real LLM provider pages, with the API answered from
 * an in-page store (window.__llmProviderTestFixture) that the specs read -
 * every Test request, its body and its headers - and drive - what the
 * provider answers next, and when.
 *
 *   ?page=     view (default: a provider's own page) | list
 *   ?role=     owner (default) | member | settingsmember | editllm | viewer
 *              | readllm | blocked | loading
 *   ?verdict=  passed (default) | warning | truncated | badkey | badmodel
 *              | unreachable | refused | legacy | slow
 *   ?theme=dark   ?lang=ja|de
 */

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "view";
const role = params.get("role") || "owner";
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
const PROVIDER_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_PROVIDER_ID = "20000000-0000-4000-8000-000000000002";
const GLOBAL_PROVIDER_ID = "20000000-0000-4000-8000-000000000003";

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
  owner: { allow: [Permission.ProjectOwner], block: [] },
  member: { allow: [Permission.ProjectMember], block: [] },
  settingsmember: { allow: [Permission.SettingsMember], block: [] },
  editllm: {
    allow: [Permission.ReadProjectLlm, Permission.EditProjectLlm],
    block: [],
  },
  viewer: { allow: [Permission.Viewer], block: [] },
  readllm: { allow: [Permission.ReadProjectLlm], block: [] },
  blocked: {
    allow: [Permission.ProjectMember],
    block: [Permission.ProjectMember],
  },
  // The permission snapshot has not landed yet.
  loading: { allow: [], block: [] },
};
const granted = ROLES[role] || ROLES.owner;

function row(permission, isBlockPermission) {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
  };
}

PermissionUtil.getAllPermissions = () => {
  return granted.allow;
};
PermissionUtil.getProjectPermissions = () => {
  if (granted.allow.length === 0 && granted.block.length === 0) {
    return null;
  }
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      ...granted.allow.map((permission) => {
        return row(permission, false);
      }),
      ...granted.block.map((permission) => {
        return row(permission, true);
      }),
    ],
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

Navigation.getLastParamAsObjectID = () => {
  return new ObjectID(PROVIDER_ID);
};

function provider(id, fields) {
  const item = new LlmProvider();
  Object.assign(item, {
    _id: id,
    projectId: new ObjectID(PROJECT_ID),
    isDefault: false,
    hasAdditionalParams: false,
    createdAt: new Date("2026-10-12T08:00:00.000Z"),
    ...fields,
  });
  return item;
}

// The customer's provider, as their screenshot shows it.
const providers = [
  provider(PROVIDER_ID, {
    name: "Chatgpt",
    llmType: LlmType.OpenAI,
    modelName: "gpt-5.1",
    isDefault: true,
  }),
  provider(SECOND_PROVIDER_ID, {
    name: "Claude",
    description: "For investigations",
    llmType: LlmType.Anthropic,
    modelName: "claude-sonnet-5-5",
  }),
];

const globalProvider = provider(GLOBAL_PROVIDER_ID, {
  name: "OneUptime AI",
  description: "Included with your plan.",
  costPerMillionTokensInUSDCents: 0,
});
globalProvider.projectId = undefined;

/*
 * What the server answers a test with, word for word what it sends: the
 * verdicts of LlmProviderAPI and the failures of LlmProviderTestFailure.
 */
const VERDICTS = {
  passed: {
    status: 200,
    body: {
      success: true,
      supportsToolCalling: true,
      message:
        "Connection successful. The LLM provider responded to a test prompt and used tool calling.",
    },
  },
  warning: {
    status: 200,
    body: {
      success: true,
      supportsToolCalling: false,
      message:
        "Connection successful, but tool calling could not be verified — the model answered in prose instead of calling the tool it was offered. OneUptime's AI features (Ask AI, investigations) read your data through tools, so a provider that cannot call them will answer that it has no tool for the question. Check that this model and endpoint support tool/function calling.",
    },
  },
  truncated: {
    status: 200,
    body: {
      success: true,
      supportsToolCalling: false,
      message:
        "Connection successful, but tool calling could not be determined — the reply hit the output limit before any tool call appeared. This says nothing either way about the model; try the test again.",
    },
  },
  badkey: {
    status: 400,
    body: {
      message:
        "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key. OpenAI answered: Incorrect API key provided: sk-proj-****abcd.",
    },
  },
  badmodel: {
    status: 400,
    body: {
      message:
        "OpenAI found no such model, or nothing at the Base URL (HTTP 404). Check the Model Name and the Base URL. OpenAI answered: The model `gpt-9` does not exist or you do not have access to it.",
    },
  },
  unreachable: {
    status: 400,
    body: {
      message:
        "OneUptime could not reach OpenAI: the LLM provider refused the connection. Check the Base URL, and that the OneUptime server can reach it.",
    },
  },
  refused: {
    status: 403,
    body: {
      message:
        "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.",
    },
  },
  // What an older server answered every member: the customer's report.
  legacy: {
    status: 403,
    body: {
      message:
        "You do not have permissions to select on - isGlobalLlm. No permission allows it: the column is not readable through the API.",
    },
  },
};

const state = {
  // Every Test request: the URL's path, the body and the headers sent.
  tests: [],
  verdict: params.get("verdict") || "passed",
  // A held test waits here until the spec releases it.
  held: [],
};

function answer(name) {
  const verdict = VERDICTS[name] || VERDICTS.passed;
  return verdict.status === 200
    ? new HTTPResponse(200, verdict.body, {})
    : new HTTPErrorResponse(verdict.status, verdict.body, {});
}

window.__llmProviderTestFixture = {
  state: state,
  // What the provider answers the next test with.
  setVerdict: (name) => {
    state.verdict = name;
  },
  // Answer the tests held so far with `name`.
  release: (name) => {
    const held = state.held.splice(0);
    for (const resolve of held) {
      resolve(answer(name));
    }
  },
};

function matches(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || typeof value === "object") {
      continue;
    }
    if (String(item[key] || "") !== String(value)) {
      return false;
    }
  }
  return true;
}

function copy(item) {
  return Object.assign(new LlmProvider(), item);
}

ModelAPI.getList = async (args) => {
  const url = args.requestOptions?.overrideRequestUrl?.toString() || "";
  if (args.modelType === LlmProvider && url.endsWith("/global-llms")) {
    return { data: [copy(globalProvider)], count: 1, skip: 0, limit: 10 };
  }
  if (args.modelType === LlmProvider) {
    const data = providers
      .filter((item) => {
        return matches(item, args.query);
      })
      .map(copy);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.count = async () => {
  return providers.length;
};

ModelAPI.getItem = async (args) => {
  const found = providers.find((item) => {
    return item.id.toString() === args.id.toString();
  });
  return found ? copy(found) : null;
};

// The tenant header every Dashboard request carries.
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

API.post = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/llm-provider/test")) {
    state.tests.push({
      path: new URL(url).pathname,
      body: options.data,
      headers: options.headers || {},
    });

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push(resolve);
      });
    }

    return answer(state.verdict);
  }

  return new HTTPResponse(200, {}, {});
};

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6" data-testid="fixture-page">
        {page === "list" ? <LlmProvidersPage /> : <LlmProviderViewPage />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
