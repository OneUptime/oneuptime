/*
 * Offline fixture for a runbook's Steps page and a run's execution page -
 * where a step asks for approval before it runs, and where every step's
 * options are folded under More fields:
 *
 *   - a runbook's Steps (Pages/Runbook/View/Steps): one step of every type a
 *     runbook author adds - Manual, JavaScript, HTTP request, Bash, SSH,
 *     kubectl and AI - the kubectl step asking for approval before it runs;
 *   - a run's execution page (Pages/Runbook/View/ExecutionView): a run that
 *     waits for approval before a step, on a Manual step, or - started
 *     before approvals moved - after a step that ran, and a run whose
 *     approved step ran.
 *
 * Only the ModelAPI / API data boundary and the synthetic user's
 * permissions are replaced. The pages, their cards, folds, switches and
 * buttons are the production ones from this branch.
 *
 * Steered by the query string:
 *   - page=steps | execution   (default: steps)
 *   - steps=none               the runbook has no steps yet (the step cards)
 *   - legacy=1                 the runbook's steps as a client still writes
 *                              them through the API: an approval after the
 *                              SSH step and one after the last step
 *   - wait=approval | manual | legacy | approved   (execution page; default
 *                              approval): what the run waits on, or a
 *                              finished run whose approved step ran
 *   - lang=de                  the Dashboard's German words
 *   - theme=dark               dark mode
 *
 * What the pages send is recorded on window.__fixture: `updates` (each
 * updateById: the model, the id and the data) and `posts` (each step route
 * the execution page calls: complete, skip, cancel). The execution page's
 * routes answer the way the server does: the step rules decide
 * (decideRunbookStepAction), an approved step runs, and the run goes on to
 * its next stop.
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
import StepsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import ExecutionPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import Runner from "Common/Models/DatabaseModels/Runner";
import User from "Common/Models/DatabaseModels/User";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import {
  RunbookStepAction,
  decideRunbookStepAction,
} from "Common/Types/Runbook/RunbookStepAction";
import {
  RunbookStepWait,
  getRunbookStepWait,
  hasApprovalAfterStep,
  isApprovalNeededBeforeRunning,
} from "Common/Types/Runbook/RunbookStepApproval";
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
const EXECUTION_ID = "50000000-0000-4000-8000-0000000000e1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const RUNNER_ID = "40000000-0000-4000-8000-0000000000d1";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "steps";
const noSteps = params.get("steps") === "none";
const withLegacy = params.get("legacy") === "1";
const wait = params.get("wait") || "approval";
const language = params.get("lang") === "de" ? "de" : "en";

window.__fixture = {
  updates: [],
  posts: [],
  reads: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

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
];

const RUNNERS = [
  record(Runner, {
    _id: RUNNER_ID,
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
];

const VARIABLES = [
  record(RunbookVariable, {
    _id: "80000000-0000-4000-8000-000000000b02",
    projectId: new ObjectID(PROJECT_ID),
    name: "PROD_DB_SSH_KEY",
    description: "Private key of the deploy user on the database hosts.",
    isSecret: true,
    isAvailableToGlobalRunners: false,
    runners: RUNNERS,
  }),
  record(RunbookVariable, {
    _id: "80000000-0000-4000-8000-000000000b03",
    projectId: new ObjectID(PROJECT_ID),
    name: "PROD_KUBECONFIG",
    description: "kubeconfig of the production cluster.",
    isSecret: true,
    isAvailableToGlobalRunners: false,
    runners: RUNNERS,
  }),
];

/*
 * One step of every type a runbook author adds. The kubectl step - the one
 * that changes production - asks for approval before it runs. With
 * ?legacy=1 the same runbook as a client still writes it through the API:
 * the approval after the SSH step (the step before kubectl) and one after
 * the last step.
 */
const STEPS = noSteps
  ? []
  : [
      {
        id: "70000000-0000-4000-8000-000000000a01",
        order: 0,
        type: RunbookStepType.Manual,
        title: "Check the replication dashboard",
        description:
          "Confirm the replica's lag is under **5 seconds** before going on.",
        config: {},
      },
      {
        id: "70000000-0000-4000-8000-000000000a02",
        order: 1,
        type: RunbookStepType.JavaScript,
        title: "Work out the new primary",
        config: {
          script: "return { primary: 'db-eu-2' };",
          agentId: "",
        },
        continueOnFailure: false,
        requireApprovalBeforeRunning: false,
      },
      {
        id: "70000000-0000-4000-8000-000000000a03",
        order: 2,
        type: RunbookStepType.HttpRequest,
        title: "Page the database team",
        config: {
          method: "POST",
          url: "https://events.pagerduty.com/v2/enqueue",
          headersJson: '{ "Content-Type": "application/json" }',
          body: '{ "routing_key": "R0UT1NG", "event_action": "trigger" }',
        },
        continueOnFailure: true,
        requireApprovalBeforeRunning: false,
      },
      {
        id: "70000000-0000-4000-8000-000000000a04",
        order: 3,
        type: RunbookStepType.Bash,
        title: "Capture the database's state",
        config: {
          script: "pg_isready -h db-eu-1\npsql -c 'select now()'",
          agentId: RUNNER_ID,
        },
        continueOnFailure: false,
        requireApprovalBeforeRunning: false,
      },
      {
        id: "70000000-0000-4000-8000-000000000a05",
        order: 4,
        type: RunbookStepType.SSH,
        title: "Stop writes on the old primary",
        config: {
          host: "10.0.4.21",
          username: "deploy",
          signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
          script: "sudo systemctl stop pgbouncer",
          agentId: RUNNER_ID,
        },
        continueOnFailure: false,
        ...(withLegacy
          ? { requireApproval: true }
          : { requireApprovalBeforeRunning: false }),
      },
      {
        id: "70000000-0000-4000-8000-000000000a06",
        order: 5,
        type: RunbookStepType.Kubernetes,
        title: "Promote the replica",
        config: {
          kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
          script:
            "kubectl patch postgrescluster checkout-db --namespace data --type merge --patch '{\"spec\":{\"primary\":\"db-eu-2\"}}'",
          agentId: RUNNER_ID,
        },
        continueOnFailure: false,
        ...(withLegacy
          ? { requireApproval: false }
          : { requireApprovalBeforeRunning: true }),
      },
      {
        id: "70000000-0000-4000-8000-000000000a07",
        order: 6,
        type: RunbookStepType.AI,
        title: "Summarize the failover",
        config: {
          prompt:
            "Summarize what the steps above did and whether the failover worked.",
          includePreviousStepContext: true,
          includeTriggerContext: true,
        },
        continueOnFailure: false,
        ...(withLegacy ? { requireApproval: true } : {}),
      },
    ];

const runbook = record(Runbook, {
  _id: RUNBOOK_ID,
  projectId: new ObjectID(PROJECT_ID),
  name: "Database failover",
  isEnabled: true,
  steps: STEPS,
});

const user = record(User, {
  _id: USER_ID,
  name: "Ada Lovelace",
  email: "ada@acme.example.com",
});

// ---- a run --------------------------------------------------------------------

const minutesAgo = (minutes) => {
  return OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    -minutes,
  ).toISOString();
};

function done(step, output, minutes) {
  return {
    step,
    status: RunbookStepExecutionStatus.Completed,
    startedAt: minutesAgo(minutes),
    completedAt: minutesAgo(minutes - 1),
    output,
  };
}

function pending(step) {
  return { step, status: RunbookStepExecutionStatus.Pending };
}

const RUN_STEPS = {
  bash: {
    id: "71000000-0000-4000-8000-000000000a01",
    order: 0,
    type: RunbookStepType.Bash,
    title: "Capture the database's state",
    config: { script: "pg_isready -h db-eu-1", agentId: RUNNER_ID },
  },
  http: {
    id: "71000000-0000-4000-8000-000000000a02",
    order: 1,
    type: RunbookStepType.HttpRequest,
    title: "Page the database team",
    config: { method: "POST", url: "https://events.pagerduty.com/v2/enqueue" },
  },
  kubectl: {
    id: "71000000-0000-4000-8000-000000000a03",
    order: 2,
    type: RunbookStepType.Kubernetes,
    title: "Promote the replica",
    description: "Fails the database over to **db-eu-2**.",
    config: { script: "kubectl patch postgrescluster checkout-db" },
    requireApprovalBeforeRunning: true,
  },
  manual: {
    id: "71000000-0000-4000-8000-000000000a04",
    order: 3,
    type: RunbookStepType.Manual,
    title: "Confirm writes reach the new primary",
    description: "Watch the write rate on the **checkout** dashboard.",
    config: {},
  },
  notify: {
    id: "71000000-0000-4000-8000-000000000a05",
    order: 4,
    type: RunbookStepType.HttpRequest,
    title: "Post the all-clear",
    config: { method: "POST", url: "https://hooks.slack.example.com/T0/B0" },
  },
};

function runStepExecutions() {
  if (wait === "manual") {
    return [
      done(RUN_STEPS.bash, "db-eu-1:5432 - accepting connections", 9),
      done(RUN_STEPS.http, "HTTP 202", 8),
      {
        ...done(RUN_STEPS.kubectl, "postgrescluster.x/checkout-db patched", 6),
        approvedAt: minutesAgo(7),
        approvedByUserId: USER_ID,
      },
      {
        step: RUN_STEPS.manual,
        status: RunbookStepExecutionStatus.WaitingForUser,
        startedAt: minutesAgo(5),
      },
      pending(RUN_STEPS.notify),
    ];
  }

  if (wait === "legacy") {
    // A run started before approvals moved: approval after the page step.
    return [
      done(RUN_STEPS.bash, "db-eu-1:5432 - accepting connections", 9),
      {
        step: { ...RUN_STEPS.http, requireApproval: true },
        status: RunbookStepExecutionStatus.WaitingForUser,
        startedAt: minutesAgo(8),
        completedAt: minutesAgo(8),
        output: "HTTP 202",
      },
      pending({
        ...RUN_STEPS.kubectl,
        requireApprovalBeforeRunning: undefined,
      }),
      pending(RUN_STEPS.manual),
      pending(RUN_STEPS.notify),
    ];
  }

  if (wait === "approved") {
    return [
      done(RUN_STEPS.bash, "db-eu-1:5432 - accepting connections", 9),
      done(RUN_STEPS.http, "HTTP 202", 8),
      {
        ...done(RUN_STEPS.kubectl, "postgrescluster.x/checkout-db patched", 6),
        approvedAt: minutesAgo(7),
        approvedByUserId: USER_ID,
      },
      {
        ...done(RUN_STEPS.manual, "", 4),
        output: undefined,
        completedByUserId: USER_ID,
      },
      done(RUN_STEPS.notify, "HTTP 200", 2),
    ];
  }

  return [
    done(RUN_STEPS.bash, "db-eu-1:5432 - accepting connections", 9),
    done(RUN_STEPS.http, "HTTP 202", 8),
    {
      step: RUN_STEPS.kubectl,
      status: RunbookStepExecutionStatus.WaitingForUser,
    },
    pending(RUN_STEPS.manual),
    pending(RUN_STEPS.notify),
  ];
}

const execution = record(RunbookExecution, {
  _id: EXECUTION_ID,
  projectId: new ObjectID(PROJECT_ID),
  runbookId: new ObjectID(RUNBOOK_ID),
  runbookNameSnapshot: "Database failover",
  status:
    wait === "approved"
      ? RunbookExecutionStatus.Completed
      : RunbookExecutionStatus.WaitingForManualStep,
  stepExecutions: runStepExecutions(),
  startedAt: new Date(minutesAgo(10)),
  completedAt: wait === "approved" ? new Date(minutesAgo(1)) : undefined,
  triggerType: RunbookTriggerType.Manual,
  triggeredByUserId: new ObjectID(USER_ID),
  triggeredByUser: user,
});

const TABLES = {
  Project: [project],
  Runbook: [runbook],
  RunbookExecution: [execution],
  Runner: RUNNERS,
  RunbookVariable: VARIABLES,
  User: [user],
};

// ---- the step routes, as the server answers them ------------------------------

/*
 * What the Worker does once a run is queued again: runs every step that
 * neither asks for a person nor has run, stops on the next one that does,
 * and finishes the run after the last.
 */
function resume(steps) {
  for (const stepExecution of steps) {
    if (
      stepExecution.status === RunbookStepExecutionStatus.Completed ||
      stepExecution.status === RunbookStepExecutionStatus.Skipped
    ) {
      continue;
    }

    if (
      stepExecution.step.type === RunbookStepType.Manual ||
      isApprovalNeededBeforeRunning(stepExecution)
    ) {
      stepExecution.status = RunbookStepExecutionStatus.WaitingForUser;
      execution.status = RunbookExecutionStatus.WaitingForManualStep;
      return;
    }

    stepExecution.status = RunbookStepExecutionStatus.Completed;
    stepExecution.startedAt = new Date().toISOString();
    stepExecution.completedAt = new Date().toISOString();
    stepExecution.output = `${stepExecution.step.title}: done`;

    if (hasApprovalAfterStep(stepExecution.step)) {
      stepExecution.status = RunbookStepExecutionStatus.WaitingForUser;
      execution.status = RunbookExecutionStatus.WaitingForManualStep;
      return;
    }
  }

  execution.status = RunbookExecutionStatus.Completed;
  execution.completedAt = new Date();
}

function act(action, stepId) {
  const steps = execution.stepExecutions;
  const decision = decideRunbookStepAction({
    action,
    executionStatus: execution.status,
    stepExecutions: steps,
    stepId,
  });

  if (!decision.allowed) {
    return new HTTPErrorResponse(400, { message: decision.reason }, {});
  }

  const stepExecution = steps.find((candidate) => {
    return candidate.step.id === stepId;
  });
  const isApprovalToRun =
    action === RunbookStepAction.Complete &&
    getRunbookStepWait(stepExecution) === RunbookStepWait.ApprovalToRun;

  if (isApprovalToRun) {
    stepExecution.status = RunbookStepExecutionStatus.Pending;
    stepExecution.approvedAt = new Date().toISOString();
    stepExecution.approvedByUserId = USER_ID;
  } else {
    stepExecution.status =
      action === RunbookStepAction.Complete
        ? RunbookStepExecutionStatus.Completed
        : RunbookStepExecutionStatus.Skipped;
    stepExecution.completedAt = new Date().toISOString();
    stepExecution.completedByUserId = USER_ID;
  }

  if (decision.resumesExecution) {
    resume(steps);
  }

  return new HTTPResponse(200, { status: "ok" }, {});
}

API.post = async (options) => {
  const url = String(options.url && options.url.toString());

  // The Steps page asks which AI providers there are.
  if (url.endsWith("/ai-chat/providers")) {
    return new HTTPResponse(
      200,
      {
        providers: [
          {
            id: "60000000-0000-4000-8000-000000000f01",
            name: "Company GPT",
            llmType: "OpenAI",
            modelName: "gpt-5",
            isDefault: true,
          },
        ],
      },
      {},
    );
  }

  const route = url.split("/execution/")[1] || "";
  const parts = route.split("/");

  window.__fixture.posts.push({
    route: parts.length >= 4 ? parts[3] : parts[1] || "",
    stepId: parts.length >= 4 ? parts[2] : "",
  });

  if (parts[1] === "cancel") {
    execution.status = RunbookExecutionStatus.Cancelled;
    return new HTTPResponse(200, { status: "Cancelled" }, {});
  }

  if (parts[3] === "complete") {
    return act(RunbookStepAction.Complete, parts[2]);
  }

  if (parts[3] === "skip") {
    return act(RunbookStepAction.Skip, parts[2]);
  }

  return new HTTPResponse(200, {}, {});
};
API.get = async () => new HTTPResponse(200, {}, {});

// ---- the model API ---------------------------------------------------------------

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
  const item = table.find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });

  // A copy, as a read from the server is: the page never holds the fixture's row.
  if (item && tableName(options.modelType) === "RunbookExecution") {
    return record(RunbookExecution, {
      ...item,
      _id: item._id,
      stepExecutions: JSON.parse(JSON.stringify(item.stepExecutions)),
    });
  }

  return item || null;
};

ModelAPI.updateById = async (options) => {
  const data = JSON.parse(JSON.stringify(options.data || {}));
  window.__fixture.updates.push({
    model: tableName(options.modelType),
    id: idOf(options.id),
    data,
  });
  const table = TABLES[tableName(options.modelType)] || [];
  const item = table.find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });
  if (item) {
    Object.assign(item, options.data || {});
  }
  return new HTTPResponse(200, {}, {});
};

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
  steps: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`,
  execution: `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions/${EXECUTION_ID}`,
}[page];

if (target && window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/runbooks/:id/steps"
        element={
          <Shell component={StepsPage} trail="Database failover / Steps" />
        }
      />
      <PageRoute
        path="/dashboard/:projectId/runbooks/:id/executions/:subModelId"
        element={
          <Shell
            component={ExecutionPage}
            trail="Database failover / Executions / Run"
          />
        }
      />
    </Routes>
  </BrowserRouter>,
);
