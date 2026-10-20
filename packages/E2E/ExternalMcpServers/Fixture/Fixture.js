/*
 * Offline fixture for Project Settings -> AI -> External MCP Servers: the
 * MCP servers outside OneUptime whose tools OneUptime AI may use. The pages
 * (Pages/Settings/ExternalMcpServers and Pages/Settings/ExternalMcpServerView),
 * the create and edit form (Components/ExternalMcpServer/ExternalMcpServerFormFields),
 * the Test connection dialog, the status pill, the Tools card and the
 * switch that turns a server off are the production ones from this branch;
 * only the ModelAPI / API data boundary and the signed-in user's
 * permissions are replaced.
 *
 * Steered by the query string:
 *   - page=view       a server's own page (the list by default)
 *   - server=github   which server page=view opens: aws (default), github,
 *                     azure or internal
 *   - servers=0       the project has no server yet (four by default: AWS,
 *                     connected; GitHub, which can't connect; Azure, not
 *                     checked yet; Internal runbooks, off)
 *   - role=member     may read the servers only (Project Member); viewer is
 *                     a Viewer; loading has no permissions yet; the default
 *                     is a project owner
 *   - verdict=refused what a test answers: connected (default), refused (the
 *                     sign-in), unreachable, notools or slow (held until the
 *                     spec releases it)
 *   - ai=off          OneUptime AI is off for the project
 *   - lang=de         the Dashboard's German words
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * What the pages send is recorded on window.__externalMcpServersFixture:
 * `creates` (each created server as JSON), `edits` (each edit as JSON),
 * `updates` (each switch: id and data), `deletes` (ids) and `tests` (each
 * Test request: path, body and headers) - so the spec checks what was sent,
 * not only what was drawn. `setVerdict(name)` changes what the next test
 * answers, and `release(name)` answers the tests a slow verdict held.
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
import ExternalMcpServersPage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/ExternalMcpServers";
import ExternalMcpServerViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/ExternalMcpServerView";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const LIST_PATH = `/dashboard/${PROJECT_ID}/settings/external-mcp-servers`;

const params = new URLSearchParams(window.location.search);
const page = params.get("page") === "view" ? "view" : "list";
const role = ["member", "viewer", "loading"].includes(params.get("role"))
  ? params.get("role")
  : "owner";
const language = params.get("lang") === "de" ? "de" : "en";
const hasServers = params.get("servers") !== "0";
const isAiOff = params.get("ai") === "off";

// ---- who is signed in -------------------------------------------------------

const HELD = {
  owner: [Permission.ProjectOwner],
  member: [Permission.ProjectMember],
  viewer: [Permission.Viewer],
  // The permission snapshot has not landed yet.
  loading: [],
}[role];

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => {
  if (HELD.length === 0) {
    return null;
  }

  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: HELD.map((permission) => ({
      _type: "UserPermission",
      permission,
      labelIds: [],
      isBlockPermission: false,
    })),
  };
};
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
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

function record(ModelType, fields) {
  const item = new ModelType();
  item._id = fields._id;
  item.id = new ObjectID(fields._id);
  item.createdAt = new Date("2026-10-10T09:00:00Z");
  item.updatedAt = new Date("2026-10-12T09:00:00Z");
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  return item;
}

const project = record(Project, {
  _id: PROJECT_ID,
  name: "Acme Production",
  enableAi: !isAiOff,
});

const SERVER_IDS = {
  aws: "c0000000-0000-4000-8000-000000000e01",
  github: "c0000000-0000-4000-8000-000000000e02",
  azure: "c0000000-0000-4000-8000-000000000e03",
  internal: "c0000000-0000-4000-8000-000000000e04",
};

// The tools an AWS MCP server offers: two that read, one that changes things.
const AWS_TOOLS = [
  {
    name: "describe_instances",
    title: "Describe EC2 instances",
    description: "Lists the EC2 instances in a region, with their state.",
    readsOnly: true,
  },
  {
    name: "get_cloudwatch_alarms",
    description: "Reads the CloudWatch alarms that are firing.",
    readsOnly: true,
  },
  {
    name: "reboot_instance",
    title: "Reboot an EC2 instance",
    description: "Reboots one EC2 instance by its id.",
    readsOnly: false,
  },
];

const SERVERS = hasServers
  ? [
      record(ExternalMcpServer, {
        _id: SERVER_IDS.aws,
        projectId: new ObjectID(PROJECT_ID),
        name: "AWS",
        description: "Production AWS account, read-only role",
        url: "https://mcp.aws.example.com/mcp",
        authType: "BearerToken",
        isEnabled: true,
        transport: "StreamableHttp",
        serverName: "aws-mcp",
        serverVersion: "1.4.0",
        protocolVersion: "2025-06-18",
        tools: AWS_TOOLS,
        lastConnectedAt: new Date("2026-10-19T08:00:00Z"),
        lastCheckedAt: new Date("2026-10-19T08:00:00Z"),
      }),
      record(ExternalMcpServer, {
        _id: SERVER_IDS.github,
        projectId: new ObjectID(PROJECT_ID),
        name: "GitHub",
        url: "https://mcp.github.example.com/mcp",
        authType: "Headers",
        headerNames: "X-API-Key",
        isEnabled: true,
        lastError:
          "The server refused the sign-in (HTTP 401): Bad credentials.",
        lastCheckedAt: new Date("2026-10-19T08:05:00Z"),
      }),
      record(ExternalMcpServer, {
        _id: SERVER_IDS.azure,
        projectId: new ObjectID(PROJECT_ID),
        name: "Azure",
        url: "https://mcp.azure.example.com/mcp",
        authType: "OAuthClientCredentials",
        oauthTokenUrl:
          "https://login.microsoftonline.com/7f3e0c2a-0000-4000-8000-00000000aa01/oauth2/v2.0/token",
        oauthClientId: "4f1c2b3a-0000-4000-8000-00000000bb02",
        oauthScope: "api://mcp-azure/.default",
        isEnabled: true,
      }),
      record(ExternalMcpServer, {
        _id: SERVER_IDS.internal,
        projectId: new ObjectID(PROJECT_ID),
        name: "Internal runbooks",
        url: "https://mcp.internal.example.com/mcp",
        authType: "None",
        isEnabled: false,
        transport: "Sse",
        tools: [
          {
            name: "run_playbook",
            description: "Runs one of the team's playbooks.",
            readsOnly: false,
          },
        ],
        lastConnectedAt: new Date("2026-10-15T08:00:00Z"),
        lastCheckedAt: new Date("2026-10-15T08:00:00Z"),
      }),
    ]
  : [];

const TABLES = {
  ExternalMcpServer: SERVERS,
  Project: [project],
};

/*
 * What a test answers, as POST /external-mcp-server/test sends it: a server
 * that cannot be reached is an answer (isConnected false), not a failure.
 */
const VERDICTS = {
  connected: {
    isConnected: true,
    message: "",
    transport: "StreamableHttp",
    serverName: "aws-mcp",
    serverVersion: "1.4.0",
    protocolVersion: "2025-06-18",
    tools: AWS_TOOLS,
    toolsLeftOut: 0,
    durationInMs: 840,
  },
  notools: {
    isConnected: true,
    message: "",
    transport: "Sse",
    tools: [],
    toolsLeftOut: 0,
    durationInMs: 410,
  },
  refused: {
    isConnected: false,
    failureKind: "SignInRefused",
    message: "The server refused the sign-in (HTTP 401): Bad credentials.",
    tools: [],
    toolsLeftOut: 0,
    durationInMs: 220,
  },
  unreachable: {
    isConnected: false,
    failureKind: "Unreachable",
    message: "The server's host name could not be found.",
    tools: [],
    toolsLeftOut: 0,
    durationInMs: 35,
  },
};

const state = {
  creates: [],
  edits: [],
  updates: [],
  deletes: [],
  tests: [],
  verdict: params.get("verdict") || "connected",
  // A held test waits here until the spec releases it.
  held: [],
};

// ---- the API -----------------------------------------------------------------

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

function copy(item) {
  return Object.assign(new item.constructor(), item);
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

// The query's plain values: a switch or a word. Ids and searches are the project's.
function matchesQuery(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (
      (typeof value === "boolean" || typeof value === "string") &&
      item[key] !== value
    ) {
      return false;
    }
  }
  return true;
}

ModelAPI.getList = async (options) => {
  const items = sorted(
    (TABLES[tableName(options.modelType)] || []).filter((item) =>
      matchesQuery(item, options.query),
    ),
    options.sort,
  );
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: items.slice(skip, skip + limit).map(copy),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  return (TABLES[tableName(options.modelType)] || []).filter((item) =>
    matchesQuery(item, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  const found = table.find((item) => idOf(item._id) === idOf(options.id));
  return found ? copy(found) : null;
};

// The switch that turns a server off or on.
ModelAPI.updateById = async (options) => {
  const data = JSON.parse(JSON.stringify(options.data || {}));
  state.updates.push({ id: idOf(options.id), data });

  const item = (TABLES[tableName(options.modelType)] || []).find(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );

  if (item) {
    Object.assign(item, options.data || {});
  }

  return new HTTPResponse(200, {}, {});
};

// The secrets a server is sent are written, never read back: kept out of the record.
const SECRETS = ["bearerToken", "headers", "oauthClientSecret"];

function keep(item, json) {
  for (const [key, value] of Object.entries(json)) {
    if (key === "_id" || SECRETS.includes(key)) {
      continue;
    }
    item[key] = value;
  }

  if (json.headers && typeof json.headers === "object") {
    item.headerNames = Object.keys(json.headers).sort().join(", ");
  }
}

// A create or an edit through the form: kept, and recorded as sent.
ModelAPI.createOrUpdate = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  // What the API is sent: the model as the Dashboard serialises it.
  const json = BaseModel.toJSON(options.model, options.modelType);
  const isCreate = !options.model._id;

  if (isCreate) {
    state.creates.push(json);

    const created = record(options.modelType, {
      _id: `c0000000-0000-4000-8000-0000000000${String(
        10 + state.creates.length,
      ).padStart(2, "0")}`,
      projectId: new ObjectID(PROJECT_ID),
      isEnabled: true,
    });
    keep(created, json);
    table.push(created);

    return new HTTPResponse(
      200,
      BaseModel.toJSON(created, options.modelType),
      {},
    );
  }

  state.edits.push({ id: idOf(options.model._id), data: json });

  const item = table.find(
    (candidate) => idOf(candidate._id) === idOf(options.model._id),
  );

  if (item) {
    keep(item, json);
  }

  return new HTTPResponse(200, json, {});
};
ModelAPI.create = ModelAPI.createOrUpdate;

ModelAPI.deleteItem = async (options) => {
  state.deletes.push(idOf(options.id));

  const table = TABLES[tableName(options.modelType)] || [];
  const index = table.findIndex(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );

  if (index !== -1) {
    table.splice(index, 1);
  }
};

// What a test found is kept on the server's record, as the API keeps it.
function keepTestResult(serverId, verdict) {
  const item = SERVERS.find((candidate) => idOf(candidate._id) === serverId);

  if (!item) {
    return;
  }

  const now = new Date();
  item.lastCheckedAt = now;

  if (verdict.isConnected) {
    item.lastConnectedAt = now;
    item.lastError = null;
    item.tools = verdict.tools;
    item.transport = verdict.transport;
    item.serverName = verdict.serverName;
    item.serverVersion = verdict.serverVersion;
    item.protocolVersion = verdict.protocolVersion;
  } else {
    item.lastError = verdict.message;
  }
}

function answer(name, serverId) {
  const verdict = VERDICTS[name] || VERDICTS.connected;
  keepTestResult(serverId, verdict);
  return new HTTPResponse(200, JSON.parse(JSON.stringify(verdict)), {});
}

window.__externalMcpServersFixture = {
  state,
  // What the next test answers.
  setVerdict: (name) => {
    state.verdict = name;
  },
  // Answer the tests held so far with `name`.
  release: (name) => {
    for (const held of state.held.splice(0)) {
      held.resolve(answer(name, held.serverId));
    }
  },
};

API.post = async (options) => {
  const url = options.url.toString();

  if (url.endsWith("/external-mcp-server/test")) {
    const serverId = idOf(options.data && options.data.externalMcpServerId);

    state.tests.push({
      path: new URL(url).pathname,
      body: JSON.parse(JSON.stringify(options.data || {})),
      headers: options.headers || {},
    });

    if (state.verdict === "slow") {
      return await new Promise((resolve) => {
        state.held.push({ resolve, serverId });
      });
    }

    if (state.verdict === "forbidden") {
      return new HTTPErrorResponse(
        422,
        {
          message:
            "You do not have permission to test this MCP server. You need one of these permissions: Project Owner, Project Admin.",
        },
        {},
      );
    }

    return answer(state.verdict, serverId);
  }

  // POST /ai-chat/providers: the project has the global provider.
  if (url.endsWith("/ai-chat/providers")) {
    return new HTTPResponse(
      200,
      {
        isAIEnabledForProject: !isAiOff,
        defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
        providers: [
          {
            id: "9d9d9d9d-0000-4000-8000-000000000001",
            name: "OneUptime AI",
            isGlobal: true,
            isDefault: false,
          },
        ],
      },
      {},
    );
  }

  return new HTTPResponse(200, {}, {});
};
API.get = async () => new HTTPResponse(200, {}, {});

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does.
 */
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

function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const Page =
    props.page === "view" ? ExternalMcpServerViewPage : ExternalMcpServersPage;

  return (
    <main
      className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8"
      data-testid="fixture-page"
    >
      <div className="mb-7 text-sm text-gray-500">
        Project Settings / AI / External MCP Servers
      </div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

const target =
  page === "view"
    ? `${LIST_PATH}/${SERVER_IDS[params.get("server")] || SERVER_IDS.aws}`
    : LIST_PATH;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/settings/external-mcp-servers"
        element={<Shell page="list" />}
      />
      <PageRoute
        path="/dashboard/:projectId/settings/external-mcp-servers/:modelId"
        element={<Shell page="view" key="view" />}
      />
    </Routes>
  </BrowserRouter>,
);
