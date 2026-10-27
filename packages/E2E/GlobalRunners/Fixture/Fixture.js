/*
 * Offline fixture for the Runbooks pages that show global Runners - the
 * Runners OneUptime runs for every project:
 *
 *   - Runbooks -> Runners (Pages/Runbook/Runners/Runners): the Global
 *     Runners card, the project's own Custom Runners, and the Use Global
 *     Runners switch;
 *   - a runbook's Steps (Pages/Runbook/View/Steps): each step's Runner
 *     picker (Components/Runner/RunnerPicker);
 *   - Runbooks -> Settings -> Global Variables (Pages/Runbook/Variables):
 *     whether global Runners may use a secret variable;
 *   - a Runner's own page (Pages/Runbook/Runners/RunnerView): its
 *     capabilities, the code repositories that pick it (a repository
 *     picks its Runner in Code; a Runner has no AI code fix switch), the
 *     AI rules that pick it, and whether it is the project's default
 *     Runner.
 *
 * Only the ModelAPI / API data boundary and the synthetic user's
 * permissions are replaced. The pages, their tables, cards, switches,
 * dialogs and the picker are the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=steps | variables | runner
 *                            the runbook's Steps page, the Global
 *                            Variables page or the first Runner of the
 *                            project's own (custom=1 or more);
 *                            the default is Runbooks -> Runners
 *   - runner=2               page=runner opens the second Runner of the
 *                            project's own (office-runner; custom=2)
 *   - longname=1             the first Runner of the project's own has a
 *                            long name (production-eu-west-1-bastion-...)
 *   - picks=0                no code repository picks that Runner
 *                            (by default one does: checkout-service), and
 *                            no AI rule does (by default two do: an
 *                            incident rule and an alert rule)
 *   - airules=denied         the reader may not read AI rules
 *   - global=<n>             how many global Runners the server has: 0, 1
 *                            (the default: the bundled one) or 2
 *   - gstatus=disconnected   the global Runners last heard from hours ago;
 *                            never: never heard from
 *   - custom=<n>             how many Runners of its own the project has
 *                            (0 by default, at most 2)
 *   - default=<n>            which of them is the project's default Runner:
 *                            1 (prod-eu-west-1) or 2 (office-runner); none
 *                            by default
 *   - jspick=global          the JavaScript step picks the Global Runner
 *                            itself ("global"); bashpick=global the same for
 *                            the Bash step (as an API client could)
 *   - norunbooks=1           office-runner has Runs Runbooks off
 *   - uses=0                 the project turned global Runners off
 *   - admin=1                a master admin is signed in
 *   - role=viewer            may read runbooks and Runners only (Runbook
 *                            Viewer); the default is a project owner
 *   - delay=<ms>             how long a save takes, so its state can be seen
 *   - lang=de                the Dashboard's German words
 *   - theme=dark             dark mode
 *
 * What the pages send is recorded on window.__fixture: `updates` (each
 * updateById: the model, the id and the data) and `creates` (each created
 * record), so the spec checks what was sent, not only what was drawn.
 * window.__fixture.addCustomRunner() adds a Runner of the project's own,
 * as if someone created one in another tab: the next read lists it.
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
import RunnersPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners";
import StepsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import VariablesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Variables";
import RunnerViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import Runner from "Common/Models/DatabaseModels/Runner";
import Label from "Common/Models/DatabaseModels/Label";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
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
const CUSTOM_RUNNER_IDS = [
  "40000000-0000-4000-8000-0000000000d1",
  "40000000-0000-4000-8000-0000000000d2",
];
const SECOND_GLOBAL_RUNNER_ID = "50000000-0000-4000-8000-0000000000e1";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "runners";
const globalCount = Math.min(2, Math.max(0, Number(params.get("global") ?? 1)));
const customCount = Math.min(2, Math.max(0, Number(params.get("custom") ?? 0)));
const usesGlobalRunners = params.get("uses") !== "0";
const globalStatus = params.get("gstatus") || "connected";
const isMasterAdmin = params.get("admin") === "1";
const role = params.get("role") || "owner";
const delay = Math.max(0, Number(params.get("delay") || 0));
const language = params.get("lang") === "de" ? "de" : "en";
const repositoryPicksRunner = params.get("picks") !== "0";
const aiRulesDenied = params.get("airules") === "denied";
const defaultRunnerIndex = Math.min(
  2,
  Math.max(0, Number(params.get("default") || 0)),
);
const javaScriptPick = params.get("jspick") === "global" ? "global" : "";
const bashPick = params.get("bashpick") === "global" ? "global" : "";
const officeRunsRunbooks = params.get("norunbooks") !== "1";
const runnerPageIndex = params.get("runner") === "2" ? 1 : 0;
const longRunnerName = params.get("longname") === "1";

const wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

window.__fixture = {
  updates: [],
  creates: [],
};

/*
 * A Runner of the project's own added "in another tab": the next read of
 * the project's Runners lists it, as the server would once someone created
 * one under Runbooks -> Runners. Set below, once the tables exist.
 */
window.__fixture.addCustomRunner = () => {};

// ---- who is signed in -------------------------------------------------------

const READS = [
  Permission.ProjectUser,
  Permission.ReadRunbook,
  Permission.ReadRunner,
  Permission.ReadRunbookSecret,
];
const HELD = {
  owner: [Permission.ProjectOwner],
  viewer: [...READS, Permission.RunbookViewer],
}[role] || [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => isMasterAdmin;
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

// When a Runner was last heard from, for each status the pages draw.
function lastAliveFor(status) {
  if (status === "never") {
    return undefined;
  }
  if (status === "disconnected") {
    return OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -3);
  }
  return OneUptimeDate.addRemoveSeconds(OneUptimeDate.getCurrentDate(), -20);
}

const project = record(Project, {
  _id: PROJECT_ID,
  name: "Acme Production",
  useGlobalRunners: usesGlobalRunners,
});

const PRODUCTION = record(Label, {
  _id: "60000000-0000-4000-8000-0000000000f1",
  name: "production",
  color: new Color("#4f46e5"),
});

// The bundled global Runner first, then one a master admin added.
const GLOBAL_RUNNERS = [
  record(Runner, {
    _id: BUNDLED_GLOBAL_RUNNER_ID,
    name: BUNDLED_GLOBAL_RUNNER_NAME,
    description: BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
    isGlobalRunner: true,
    canRunRunbooks: true,
    lastAlive: lastAliveFor(globalStatus),
  }),
  record(Runner, {
    _id: SECOND_GLOBAL_RUNNER_ID,
    name: "global-runner-frankfurt",
    description: "Frankfurt.",
    isGlobalRunner: true,
    canRunRunbooks: true,
    lastAlive: lastAliveFor(globalStatus),
  }),
].slice(0, globalCount);

const CUSTOM_RUNNERS = [
  record(Runner, {
    _id: CUSTOM_RUNNER_IDS[0],
    projectId: new ObjectID(PROJECT_ID),
    name: longRunnerName
      ? "production-eu-west-1-bastion-primary-runner-for-databases"
      : "prod-eu-west-1",
    description: "Production VPC; reaches the databases.",
    key: "a-key-only-admins-read-0123456789",
    isGlobalRunner: false,
    canRunRunbooks: true,
    canRunAiCommands: false,
    isProjectDefault: defaultRunnerIndex === 1,
    lastAlive: lastAliveFor("connected"),
    labels: [PRODUCTION],
  }),
  record(Runner, {
    _id: CUSTOM_RUNNER_IDS[1],
    projectId: new ObjectID(PROJECT_ID),
    name: "office-runner",
    description: "Office network.",
    key: "another-key-only-admins-read-0123",
    isGlobalRunner: false,
    canRunRunbooks: officeRunsRunbooks,
    canRunAiCommands: false,
    isProjectDefault: defaultRunnerIndex === 2,
    lastAlive: lastAliveFor("disconnected"),
    labels: [],
  }),
].slice(0, customCount);

/*
 * The runbook's steps, as the Steps page saves them: a JavaScript step and
 * a Bash step, neither of which picked a Runner.
 */
const STEPS = [
  {
    id: "70000000-0000-4000-8000-000000000a01",
    order: 0,
    type: RunbookStepType.JavaScript,
    title: "Look up the status page",
    config: {
      script:
        'const response = await axios.get("https://status.example.com/api/v2/status.json");\nreturn response.data.status;',
      agentId: javaScriptPick,
    },
  },
  {
    id: "70000000-0000-4000-8000-000000000a02",
    order: 1,
    type: RunbookStepType.Bash,
    title: "Restart the web service",
    config: { script: "systemctl restart web", agentId: bashPick },
  },
];

const runbook = record(Runbook, {
  _id: RUNBOOK_ID,
  projectId: new ObjectID(PROJECT_ID),
  name: "Database failover",
  isEnabled: true,
  steps: STEPS,
});

const VARIABLES = [
  record(RunbookVariable, {
    _id: "80000000-0000-4000-8000-000000000b01",
    projectId: new ObjectID(PROJECT_ID),
    name: "STATUSPAGE_TOKEN",
    description: "Read-only token for the public status API.",
    isSecret: true,
    isAvailableToGlobalRunners: true,
    runners: [],
  }),
  record(RunbookVariable, {
    _id: "80000000-0000-4000-8000-000000000b02",
    projectId: new ObjectID(PROJECT_ID),
    name: "DB_PASSWORD",
    description: "The replica's admin password.",
    isSecret: true,
    isAvailableToGlobalRunners: false,
    runners: CUSTOM_RUNNERS.slice(0, 1),
  }),
];

/*
 * The project's code repositories, and the Runner each picks in Code
 * (CodeRepository.runnerId): checkout-service picks prod-eu-west-1,
 * web-app picks none (it follows the project's default Runner, else a
 * global Runner), and docs-site picked the Global Runner itself
 * (isGlobalRunnerPicked), so it never follows the default.
 */
const CODE_REPOSITORIES = [
  record(CodeRepository, {
    _id: "90000000-0000-4000-8000-000000000c01",
    projectId: new ObjectID(PROJECT_ID),
    name: "checkout-service",
    runnerId: repositoryPicksRunner
      ? new ObjectID(CUSTOM_RUNNER_IDS[0])
      : undefined,
  }),
  record(CodeRepository, {
    _id: "90000000-0000-4000-8000-000000000c02",
    projectId: new ObjectID(PROJECT_ID),
    name: "web-app",
  }),
  record(CodeRepository, {
    _id: "90000000-0000-4000-8000-000000000c03",
    projectId: new ObjectID(PROJECT_ID),
    name: "docs-site",
    isGlobalRunnerPicked: true,
  }),
];

/*
 * The project's AI rules, and the Runner each runs OneUptime AI's commands
 * on (AutoRemediationRule.runnerId): "Restart checkout" (incidents) and
 * "Fix database alerts" (alerts) pick prod-eu-west-1, and "Investigate
 * everything" picks none.
 */
const AI_RULES = [
  record(AutoRemediationRule, {
    _id: "91000000-0000-4000-8000-000000000a01",
    projectId: new ObjectID(PROJECT_ID),
    name: "Restart checkout",
    triggerEntityType: AutoRemediationTriggerEntity.Incident,
    runnerId: repositoryPicksRunner
      ? new ObjectID(CUSTOM_RUNNER_IDS[0])
      : undefined,
  }),
  record(AutoRemediationRule, {
    _id: "91000000-0000-4000-8000-000000000a02",
    projectId: new ObjectID(PROJECT_ID),
    name: "Fix database alerts",
    triggerEntityType: AutoRemediationTriggerEntity.Alert,
    runnerId: repositoryPicksRunner
      ? new ObjectID(CUSTOM_RUNNER_IDS[0])
      : undefined,
  }),
  record(AutoRemediationRule, {
    _id: "91000000-0000-4000-8000-000000000a03",
    projectId: new ObjectID(PROJECT_ID),
    name: "Investigate everything",
    triggerEntityType: AutoRemediationTriggerEntity.Incident,
  }),
];

const TABLES = {
  Project: [project],
  Runbook: [runbook],
  Runner: CUSTOM_RUNNERS,
  RunbookVariable: VARIABLES,
  Label: [PRODUCTION],
  CodeRepository: CODE_REPOSITORIES,
  AutoRemediationRule: AI_RULES,
};

window.__fixture.addCustomRunner = () => {
  TABLES.Runner.push(
    record(Runner, {
      _id: "40000000-0000-4000-8000-0000000000d9",
      projectId: new ObjectID(PROJECT_ID),
      name: "new-runner",
      description: "Added in another tab.",
      isGlobalRunner: false,
      canRunRunbooks: true,
      canRunAiCommands: false,
      isProjectDefault: false,
      lastAlive: lastAliveFor("connected"),
      labels: [],
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

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  const overrideUrl = String(
    (options.requestOptions &&
      options.requestOptions.overrideRequestUrl &&
      options.requestOptions.overrideRequestUrl.toString()) ||
      "",
  );

  // The global Runners, from their own endpoint: no project owns them.
  if (name === "Runner" && overrideUrl.includes("/runner/global-runners")) {
    return list(GLOBAL_RUNNERS, options.limit);
  }

  /*
   * The repositories that pick a Runner, as a Runner's page asks - or, for
   * the project's default Runner, the ones that pick none (IsNull), which
   * follow it unless they picked the Global Runner.
   */
  if (name === "CodeRepository") {
    const asked = options.query && options.query.runnerId;

    if (asked instanceof IsNull) {
      return list(
        TABLES.CodeRepository.filter((repository) => {
          return !idOf(repository.runnerId);
        }),
        options.limit,
      );
    }

    const runnerId = idOf(asked);
    return list(
      TABLES.CodeRepository.filter((repository) => {
        return !runnerId || idOf(repository.runnerId) === runnerId;
      }),
      options.limit,
    );
  }

  /*
   * The AI rules that pick a Runner, as a Runner's page asks - refused for
   * a reader who may not read them (airules=denied).
   */
  if (name === "AutoRemediationRule") {
    if (aiRulesDenied) {
      throw new Error("You do not have permission to read AI rules.");
    }

    const runnerId = idOf(options.query && options.query.runnerId);
    return list(
      TABLES.AutoRemediationRule.filter((rule) => {
        return !runnerId || idOf(rule.runnerId) === runnerId;
      }),
      options.limit,
    );
  }

  // The project's default Runner, as Runbooks -> Runners asks for it.
  if (
    name === "Runner" &&
    options.query &&
    options.query.isProjectDefault === true
  ) {
    return list(
      TABLES.Runner.filter((runner) => {
        return runner.isProjectDefault === true;
      }).slice(0, options.limit || 1),
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
  /*
   * A Runner made the project default takes it from the others, as the
   * server does once the write succeeded (ProjectDefaultRow).
   */
  if (
    tableName(options.modelType) === "Runner" &&
    options.data &&
    options.data.isProjectDefault === true
  ) {
    for (const runner of TABLES.Runner) {
      if (idOf(runner._id) !== idOf(options.id)) {
        runner.isProjectDefault = false;
      }
    }
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
  runners: `/dashboard/${PROJECT_ID}/runbooks/runners`,
  steps: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`,
  variables: `/dashboard/${PROJECT_ID}/runbooks/settings/variables`,
  runner: `/dashboard/${PROJECT_ID}/runbooks/runners/${CUSTOM_RUNNER_IDS[runnerPageIndex]}`,
}[page];

if (target && window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/runbooks/runners"
        element={<Shell component={RunnersPage} trail="Runners" />}
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/runners/:id"
        element={<Shell component={RunnerViewPage} trail="Runners / Runner" />}
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/settings/variables"
        element={
          <Shell
            component={VariablesPage}
            trail="Settings / Global Variables"
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
