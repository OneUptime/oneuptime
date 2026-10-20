/*
 * Offline fixture for the Runbooks pages runbook variables changed:
 *
 *   - Runbooks -> Settings -> Global Variables (Pages/Runbook/Variables):
 *     the project's own variables, plain and secret;
 *   - a runbook's Settings -> Variables (Pages/Runbook/View/Variables): the
 *     runbook's own;
 *   - a runbook's Steps (Pages/Runbook/View/Steps): the SSH step (machine,
 *     sign-in variable, bash script) and the kubectl step (kubeconfig
 *     variable, script), each with its More fields;
 *   - Runbooks -> Runners -> AI Access (Pages/Runbook/Runners/
 *     RunnerCredentials): what OneUptime AI's commands reach.
 *
 * Only the ModelAPI / API data boundary and the synthetic user's
 * permissions are replaced. The pages, their tables, forms, folds and
 * pickers are the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=variables | runbook-variables | steps | ai-access   (default:
 *                            variables)
 *   - variables=none         the project has no variables yet
 *   - steps=none             the runbook has no steps yet (the step cards)
 *   - legacy=1               the runbook also has an SSH and a Kubernetes
 *                            step written with a credential, through the API
 *   - custom=<n>             how many Runners of its own the project has
 *                            (1 by default, at most 2)
 *   - global=0               the server runs no global Runner
 *   - role=runbook-admin     a Runbook Admin (reads variables, may not
 *                            change them); role=member: may not read them
 *   - delay=<ms>             how long a save takes
 *   - lang=de                the Dashboard's German words
 *   - theme=dark             dark mode
 *
 * What the pages send is recorded on window.__fixture: `updates` (each
 * updateById: the model, the id and the data) and `creates` (each created
 * record). window.__fixture.addVariable(name) adds a secret global
 * variable, as if someone created one in another tab: the next read lists it.
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
import GlobalVariablesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Variables";
import RunbookVariablesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Variables";
import StepsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import AiAccessPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import Runner from "Common/Models/DatabaseModels/Runner";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import {
  BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
  BUNDLED_GLOBAL_RUNNER_ID,
  BUNDLED_GLOBAL_RUNNER_NAME,
} from "Common/Types/Runner/BundledGlobalRunner";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID = "20000000-0000-4000-8000-0000000000b1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const RUNNER_IDS = [
  "40000000-0000-4000-8000-0000000000d1",
  "40000000-0000-4000-8000-0000000000d2",
];
const CREDENTIAL_ID = "90000000-0000-4000-8000-000000000c01";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "variables";
const noVariables = params.get("variables") === "none";
const noSteps = params.get("steps") === "none";
const withLegacy = params.get("legacy") === "1";
const customCount = Math.min(2, Math.max(0, Number(params.get("custom") ?? 1)));
const globalCount = params.get("global") === "0" ? 0 : 1;
const role = params.get("role") || "owner";
const delay = Math.max(0, Number(params.get("delay") || 0));
const language = params.get("lang") === "de" ? "de" : "en";

const wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

window.__fixture = {
  updates: [],
  creates: [],
  reads: [],
};

window.__fixture.addVariable = () => {};

// ---- who is signed in -------------------------------------------------------

const HELD = {
  owner: [Permission.ProjectOwner],
  "runbook-admin": [
    Permission.ProjectUser,
    Permission.RunbookAdmin,
    Permission.ReadRunner,
  ],
  member: [Permission.ProjectUser, Permission.RunbookMember],
}[role] || [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
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
  useGlobalRunners: true,
});

const GLOBAL_RUNNERS = [
  record(Runner, {
    _id: BUNDLED_GLOBAL_RUNNER_ID,
    name: BUNDLED_GLOBAL_RUNNER_NAME,
    description: BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
    isGlobalRunner: true,
    canRunRunbooks: true,
    lastAlive: OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      -20,
    ),
  }),
].slice(0, globalCount);

const RUNNERS = [
  record(Runner, {
    _id: RUNNER_IDS[0],
    projectId: new ObjectID(PROJECT_ID),
    name: "prod-bastion",
    description: "Production VPC; reaches the databases and the cluster.",
    isGlobalRunner: false,
    canRunRunbooks: true,
    lastAlive: OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      -20,
    ),
  }),
  record(Runner, {
    _id: RUNNER_IDS[1],
    projectId: new ObjectID(PROJECT_ID),
    name: "office-runner",
    description: "Office network.",
    isGlobalRunner: false,
    canRunRunbooks: true,
    lastAlive: OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -3),
  }),
].slice(0, customCount);

function variable(fields) {
  return record(RunbookVariable, {
    projectId: new ObjectID(PROJECT_ID),
    isAvailableToGlobalRunners: false,
    runners: [],
    ...fields,
  });
}

const VARIABLES = noVariables
  ? []
  : [
      variable({
        _id: "80000000-0000-4000-8000-000000000b01",
        name: "DB_HOST",
        description: "The primary database host.",
        isSecret: false,
        value: "10.0.4.21",
      }),
      variable({
        _id: "80000000-0000-4000-8000-000000000b02",
        name: "PROD_DB_SSH_KEY",
        description: "Private key of the deploy user on the database hosts.",
        isSecret: true,
        runners: RUNNERS.slice(0, 1),
      }),
      variable({
        _id: "80000000-0000-4000-8000-000000000b03",
        name: "PROD_KUBECONFIG",
        description: "kubeconfig of the production cluster.",
        isSecret: true,
        runners: RUNNERS.slice(0, 1),
      }),
      variable({
        _id: "80000000-0000-4000-8000-000000000b04",
        name: "STATUSPAGE_TOKEN",
        description: "Read-only token for the public status API.",
        isSecret: true,
        isAvailableToGlobalRunners: true,
      }),
      // A long plain value, as a URL often is: it must not widen the list.
      variable({
        _id: "80000000-0000-4000-8000-000000000b06",
        name: "STATUS_API_URL",
        description: "The internal status API the runbooks post to.",
        isSecret: false,
        value:
          "https://internal-api.eu-west-1.prod.acme-corp.example.com/v2/admin/maintenance?region=eu-west-1",
      }),
      variable({
        _id: "80000000-0000-4000-8000-000000000b05",
        runbookId: new ObjectID(RUNBOOK_ID),
        name: "NAMESPACE",
        description: "Where the checkout service runs.",
        isSecret: false,
        value: "checkout",
      }),
    ];

const STEPS = noSteps
  ? []
  : [
      {
        id: "70000000-0000-4000-8000-000000000a01",
        order: 0,
        type: RunbookStepType.SSH,
        title: "Restart the database proxy",
        config: {
          host: "{{global.variables.DB_HOST}}",
          username: "deploy",
          signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
          script:
            "sudo systemctl restart pgbouncer\nsystemctl status pgbouncer --no-pager",
          agentId: RUNNER_IDS[0],
        },
        continueOnFailure: false,
        requireApproval: false,
      },
      {
        id: "70000000-0000-4000-8000-000000000a02",
        order: 1,
        type: RunbookStepType.Kubernetes,
        title: "Restart checkout",
        config: {
          kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
          script:
            "kubectl rollout restart deployment/checkout-api --namespace {{local.variables.NAMESPACE}}\nkubectl rollout status deployment/checkout-api --namespace {{local.variables.NAMESPACE}} --timeout=120s",
          agentId: RUNNER_IDS[0],
        },
        continueOnFailure: false,
        requireApproval: true,
      },
      ...(withLegacy
        ? [
            {
              id: "70000000-0000-4000-8000-000000000a03",
              order: 2,
              type: RunbookStepType.SSH,
              title: "Clear the cache (written through the API)",
              config: {
                credentialId: CREDENTIAL_ID,
                command: "redis-cli FLUSHALL",
                agentId: RUNNER_IDS[0],
              },
            },
            {
              id: "70000000-0000-4000-8000-000000000a04",
              order: 3,
              type: RunbookStepType.Kubernetes,
              title: "Scale workers (written through the API)",
              config: {
                credentialId: CREDENTIAL_ID,
                action: "ScaleWorkload",
                workloadKind: "Deployment",
                namespace: "jobs",
                workloadName: "workers",
                replicas: 4,
                agentId: RUNNER_IDS[0],
              },
            },
          ]
        : []),
    ];

const runbook = record(Runbook, {
  _id: RUNBOOK_ID,
  projectId: new ObjectID(PROJECT_ID),
  name: "Database failover",
  isEnabled: true,
  steps: STEPS,
});

const CREDENTIALS = [
  record(RunbookCredential, {
    _id: CREDENTIAL_ID,
    projectId: new ObjectID(PROJECT_ID),
    name: "cache-hosts",
    credentialType: RunbookCredentialType.SSH,
    description: "OneUptime AI's diagnostics on the cache hosts.",
    runners: RUNNERS.slice(0, 1),
  }),
];

const TABLES = {
  Project: [project],
  Runbook: [runbook],
  Runner: RUNNERS,
  RunbookVariable: VARIABLES,
  RunbookCredential: CREDENTIALS,
};

window.__fixture.addVariable = (name) => {
  TABLES.RunbookVariable.push(
    variable({
      _id: "80000000-0000-4000-8000-000000000b99",
      name: name || "NEW_SSH_KEY",
      isSecret: true,
      runners: RUNNERS.slice(0, 1),
    }),
  );
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

function list(data, limit) {
  return { data, count: data.length, skip: 0, limit: limit || 10 };
}

// A query's runbookId: the global variables (IsNull) or one runbook's.
function matchesRunbook(row, wanted) {
  if (wanted === undefined) {
    return true;
  }
  if (wanted instanceof IsNull || (wanted && wanted._type === "IsNull")) {
    return !row.runbookId;
  }
  return idOf(row.runbookId) === idOf(wanted);
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  const overrideUrl = String(
    (options.requestOptions &&
      options.requestOptions.overrideRequestUrl &&
      options.requestOptions.overrideRequestUrl.toString()) ||
      "",
  );

  window.__fixture.reads.push({ model: name });

  if (name === "Runner" && overrideUrl.includes("/runner/global-runners")) {
    return list(GLOBAL_RUNNERS, options.limit);
  }

  if (name === "RunbookVariable") {
    // Someone who may not read variables is refused, as the API refuses them.
    if (role === "member") {
      throw new Error("You do not have permission to read runbook variables.");
    }

    const query = options.query || {};
    return list(
      TABLES.RunbookVariable.filter((row) => {
        return matchesRunbook(row, query.runbookId);
      }),
      options.limit,
    );
  }

  return list(TABLES[name] || [], options.limit);
};

ModelAPI.count = async (options) => {
  return (TABLES[tableName(options.modelType)] || []).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  return table.find((item) => idOf(item._id) === idOf(options.id)) || null;
};

ModelAPI.updateById = async (options) => {
  const data = JSON.parse(JSON.stringify(options.data || {}));
  window.__fixture.updates.push({
    model: tableName(options.modelType),
    id: idOf(options.id),
    data,
  });
  if (delay) {
    await wait(delay);
  }
  const table = TABLES[tableName(options.modelType)] || [];
  const item = table.find(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );
  if (item) {
    Object.assign(item, options.data || {});
  }
  return new HTTPResponse(200, {}, {});
};

function created(options) {
  const json =
    options.model && options.model.toJSON
      ? options.model.toJSON()
      : options.model;
  window.__fixture.creates.push({
    model: tableName(options.modelType),
    data: JSON.parse(JSON.stringify(json)),
  });
  return new HTTPResponse(200, json, {});
}

ModelAPI.create = async (options) => {
  if (delay) {
    await wait(delay);
  }
  return created(options);
};
ModelAPI.createOrUpdate = ModelAPI.create;

// The Steps page asks which AI providers there are; none here.
API.post = async () => new HTTPResponse(200, { providers: [] }, {});
API.get = async () => new HTTPResponse(200, {}, {});

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
  const Page = props.component;
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">Runbooks / {props.trail}</div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

const target = {
  variables: `/dashboard/${PROJECT_ID}/runbooks/settings/variables`,
  "runbook-variables": `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/variables`,
  steps: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`,
  "ai-access": `/dashboard/${PROJECT_ID}/runbooks/runner-credentials`,
}[page];

if (target && window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/runbooks/settings/variables"
        element={
          <Shell
            component={GlobalVariablesPage}
            trail="Settings / Global Variables"
          />
        }
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/runner-credentials"
        element={<Shell component={AiAccessPage} trail="Runners / AI Access" />}
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/:id/variables"
        element={
          <Shell
            component={RunbookVariablesPage}
            trail="Database failover / Variables"
          />
        }
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/:id/steps"
        element={
          <Shell component={StepsPage} trail="Database failover / Steps" />
        }
      />
    </Routes>
  </BrowserRouter>,
);
