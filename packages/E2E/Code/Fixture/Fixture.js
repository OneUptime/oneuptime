/*
 * Offline fixture for Code: its first page - the request box, with the
 * repository and branch pickers, over every task (Pages/Code/Code) - the
 * connected repositories (Pages/Code/Repositories), a repository's page
 * where AI is asked (Pages/Code/Repository/Tasks), its settings, a task's
 * conversation (Pages/Code/Task/Conversation) and its Log - the production
 * route group (Routes/CodeRoutes) with its layouts, side menus and
 * breadcrumbs, and the old Tasks and Code Repositories addresses
 * (Routes/MovedTaskRoutes, Routes/MovedRepositoryRoutes) that forward to it.
 *
 * Only the data boundary is replaced: API.post / API.get (the /code-task
 * routes, a turn's log, the GitHub connection), ModelAPI (the repository's
 * name and settings, the record pickers) and the signed-in person's
 * permissions. Behind them is an in-memory Code server that keeps what the
 * real one keeps (Common/Server/API/CodeTaskAPI): repositories with their
 * tasks, every task a conversation of turns, and an AI that takes each new
 * turn through Queued, Running (its steps as it takes them) and Completed -
 * one stage each time the page reads the task, so the page's own polling
 * drives it.
 *
 * Steered by the query string:
 *   - repos=none        no repository yet: Code's first page teaches what it
 *                       is for and offers Connect GitHub; many: 8, so the
 *                       search box shows; stale: the project the maintainer
 *                       showed - 15 repositories of one organization, one of
 *                       them (oneuptime, last by name) connected and the other
 *                       14 imported by an installation the project has left
 *   - connected=none    GitHub reaches none of the repositories (the
 *                       project's GitHub connection is gone)
 *   - tasks=none        no task yet in any repository
 *   - names=long        checkout-api goes by a long name (and a long
 *                       organization), and has a long branch, for the
 *                       request box's pickers and the rows to cut short
 *   - branches=many     checkout-api has more branches than one read of
 *                       them holds (140), so the branch picker searches the
 *                       server by what is typed
 *   - other=1           tasks that have no repository (Other tasks)
 *   - hosts=1           repositories beyond GitHub too, each through its
 *                       connection: billing-service on GitLab (gitlab.com)
 *                       with merge request !12, status-widgets on Forgejo
 *                       (codeberg.org) and infra-scripts on a Git server only
 *                       a Runner of the project's own reaches (10.0.4.12),
 *                       whose task pushed a branch; token=refused: GitLab
 *                       refused billing-service's access token;
 *                       gitrunner=none: infra-scripts picks no Runner
 *
 * The connect dialog's server (/code-repository-connection, Common/Server/
 * API/CodeRepositoryConnectionAPI) answers too: the project's connections,
 * the repositories a token reaches on GitLab (gitlab.com, or any server
 * address) and Forgejo (codeberg.org), connecting them, any Git server -
 * one on a private network asked about first - and replacing a token. A
 * token beginning "revoked" is refused, as a host refuses one.
 *   - github=unconfigured  a server with no GitHub App (server.js)
 *   - plan=free         billing on and the Free plan: the plan gate answers
 *                       on Code's first page, and every repository and
 *                       task answers PlanRequired
 *   - role=viewer      may read the repositories' tasks, not ask AI
 *                       (NoPermission); member: may ask (Project Member);
 *                       the default is a project owner
 *   - blocker=<type>    what stops AI working (CodeTaskBlockerType): every
 *                       repository and task answers with it
 *   - ai=ask            a new turn ends asking the person something;
 *                       ai=fail ends failed; ai=stall keeps working until
 *                       it is stopped
 *   - pace=<ms>         how long a new turn stays in each stage before the
 *                       next read moves it on (default 1000, so a task is
 *                       seen queued first and then moves one stage a poll)
 *   - refuse=create|reply  the server refuses that send (its sentence)
 *   - fail=repositories|repository|list|task|branches  that read fails
 *   - commands=1        checkout-api has the build and test commands an
 *                       operator set before Code stopped asking for them
 *                       (npm ci, npm run build, npm test); by default none
 *   - ghcommands=off|unset  checkout-api's GitHub commands are off, or never
 *                       set (a repository from before the column's default);
 *                       by default on
 *   - runner=prod|gone  the Runner checkout-api picks in its settings:
 *                       prod-eu-west-1, or one the page is not shown (a
 *                       Runner the reader does not have access to); by
 *                       default none (a global Runner)
 *   - uses=0            the project turned global Runners off
 *   - global=0          the server runs no global Runner for code;
 *                       gstatus=disconnected: it is not heard from
 *   - delay=<ms>        how long each request takes
 *   - lang=de|ja        the Dashboard's German or Japanese words
 *   - theme=dark        dark mode (server.js)
 *   - review=off|unset|on  checkout-api's Production Review is off, never
 *                       set (a repository connected before it existed), or
 *                       on even where GitHub no longer reaches it
 *                       (connected=none); by default on while connected
 *   - reviews=none      no pull request of checkout-api reviewed yet
 *   - reviewcomment=Link|ReviewEvenIfPublic  what checkout-api's production
 *                       review comment shows; by default never chosen (the
 *                       review, or a link on a public repository)
 *   - reviewcase=<case> pull request #42's latest review: failed (tried
 *                       again and failed again, the review before it kept),
 *                       closed (not reviewed: the pull request was closed),
 *                       unread (its traces and profiles could not be read),
 *                       aioff (AI is off: no points, and why), public (a
 *                       public repository: the pull request only links to
 *                       it), outside (its author cannot write to the
 *                       repository) or long (long names of code and
 *                       services, for a phone to wrap)
 *
 * checkout-api's pull requests are reviewed against production
 * (Common/Server/Utils/CodeRepository/ProductionReview): #42 found
 * something in every part, #57 changed no code production runs, and #61 is
 * waiting to be reviewed. Review again takes a review through Queued and
 * Running to a new review, one stage each time the page reads it, as a
 * request's turn is; the tasks lists leave the reviews out, as the server
 * does, and a list read with kind productionReviews answers only them.
 *
 * What the pages send is recorded on window.__fixture: `creates`,
 * `replies`, `retries`, `stops`, `settings` (each repository update),
 * `deletes`, `navigations` (addresses outside the Dashboard, such as
 * GitHub's), `branchReads` (each read of a repository's branches, with what
 * was searched), `lists` (each task list read, by its scope),
 * `reviewLists` (each production reviews list read, by its repository) and
 * `reviewAgains` (each Review again, by its task), so the spec checks what
 * was sent, not only what was drawn.
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
import CodeRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/CodeRoutes";
import MovedRepositoryRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/MovedRepositoryRoutes";
import MovedTaskRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/MovedTaskRoutes";
import Alert from "Common/Models/DatabaseModels/Alert";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Incident from "Common/Models/DatabaseModels/Incident";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskStateUtil,
  CodeTaskStepKind,
  CodeTaskTitle,
} from "Common/Types/AI/CodeTask";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  ProductionReviewAiNoteCode,
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewSection,
  ProductionReviewTrigger,
  ProductionReviewUtil,
  ProductionReviewWhere,
} from "Common/Types/CodeRepository/ProductionReview";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000c1";
const ADA_ID = "30000000-0000-4000-8000-0000000000a1";
const GRACE_ID = "30000000-0000-4000-8000-0000000000a2";

const REPOSITORY_IDS = {
  checkout: "20000000-0000-4000-8000-0000000000b1",
  web: "20000000-0000-4000-8000-0000000000b2",
  payments: "20000000-0000-4000-8000-0000000000b3",
  // hosts=1: on GitLab, Forgejo and a Git server.
  billing: "20000000-0000-4000-8000-0000000000b4",
  widgets: "20000000-0000-4000-8000-0000000000b5",
  infra: "20000000-0000-4000-8000-0000000000b6",
};

const TASK_IDS = {
  retries: "40000000-0000-4000-8000-0000000000d1",
  question: "40000000-0000-4000-8000-0000000000d2",
  exception: "40000000-0000-4000-8000-0000000000d3",
  failed: "40000000-0000-4000-8000-0000000000d4",
  stopped: "40000000-0000-4000-8000-0000000000d5",
  working: "40000000-0000-4000-8000-0000000000d6",
  orphan: "40000000-0000-4000-8000-0000000000d7",
  // hosts=1: a GitLab merge request, and a branch pushed to a Git server.
  invoices: "40000000-0000-4000-8000-0000000000d8",
  terraform: "40000000-0000-4000-8000-0000000000d9",
};

const RECORD_IDS = {
  incident: "50000000-0000-4000-8000-0000000000e1",
  alert: "50000000-0000-4000-8000-0000000000e2",
  exception: "50000000-0000-4000-8000-0000000000e3",
  monitor: "50000000-0000-4000-8000-0000000000e4",
  service: "50000000-0000-4000-8000-0000000000e5",
};

/*
 * The project's own Runners a repository may pick, alphabetically as the
 * picker reads them, and the in-cluster Runner the Kubernetes agent chart
 * installed, which no repository may pick.
 */
const RUNNER_IDS = {
  office: "60000000-0000-4000-8000-0000000000f2",
  prod: "60000000-0000-4000-8000-0000000000f1",
  agent: "60000000-0000-4000-8000-0000000000f3",
  gone: "60000000-0000-4000-8000-0000000000f9",
};

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const runnerParam = params.get("runner");
const usesGlobalRunners = params.get("uses") !== "0";
const globalCodeRunnerStatus =
  params.get("gstatus") === "disconnected" ? "disconnected" : "connected";
const hasGlobalCodeRunner = params.get("global") !== "0";
const reposParam = params.get("repos") || "some";
const isGitHubGone = params.get("connected") === "none";
const hasNoTasks = params.get("tasks") === "none";
const hasManyBranches = params.get("branches") === "many";
const hasLongNames = params.get("names") === "long";
const blockerParam = params.get("blocker");
const aiParam = params.get("ai") || "done";
const refuseParam = params.get("refuse");
const failParam = params.get("fail");
const delay = Math.max(0, Number(params.get("delay") || 0));
const pace = Math.max(0, Number(params.get("pace") || 1000));
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

window.__fixture = {
  creates: [],
  replies: [],
  retries: [],
  stops: [],
  settings: [],
  deletes: [],
  navigations: [],
  branchReads: [],
  lists: [],
  reviewLists: [],
  reviewAgains: [],
  // The connect dialog: each listing read, connect, Git connect and token replaced.
  connectReads: [],
  connects: [],
  gitConnects: [],
  tokenReplacements: [],
  reads: { task: 0, list: 0, repositories: 0, repository: 0 },
};

const now = Date.now();
const minutesAgo = (minutes) => {
  return new Date(now - minutes * 60000).toISOString();
};

const PEOPLE = {
  [ADA_ID]: { id: ADA_ID, name: "Ada Lovelace" },
  [GRACE_ID]: { id: GRACE_ID, name: "Grace Hopper" },
};

// ---- repositories --------------------------------------------------------

const BASE_REPOSITORIES = [
  {
    id: REPOSITORY_IDS.checkout,
    name: "checkout-api",
    description: "The checkout and payment API behind the store.",
    organizationName: "acme",
    repositoryName: "checkout-api",
    mainBranchName: "main",
    repositoryUrl: "https://github.com/acme/checkout-api",
    isConnected: true,
  },
  {
    id: REPOSITORY_IDS.web,
    name: "storefront-web",
    description: "The customer-facing web app.",
    organizationName: "acme",
    repositoryName: "storefront-web",
    mainBranchName: "main",
    repositoryUrl: "https://github.com/acme/storefront-web",
    isConnected: true,
  },
  {
    id: REPOSITORY_IDS.payments,
    name: "payments-worker",
    organizationName: "acme",
    repositoryName: "payments-worker",
    mainBranchName: "master",
    repositoryUrl: "https://github.com/acme/payments-worker",
    isConnected: false,
  },
];

const EXTRA_REPOSITORY_NAMES = [
  "inventory-service",
  "notifications",
  "search-indexer",
  "admin-console",
  "mobile-backend",
];

/*
 * The project in the maintainer's screenshot: fourteen repositories an
 * installation the project has since left imported, and the one it uses -
 * last by name - connected.
 */
const STALE_REPOSITORIES = [
  ["ads", "Ads for OneUptime"],
  ["back-to-metal", ""],
  ["blog", "Engineering Uptime Blog"],
  ["certificates", ""],
  [
    "deployment",
    "Development and disaster recovery principles of OneUptime.com",
  ],
  ["gtm-ops", "GTM Ops for OneUptime"],
  ["handbook", "Core Values of the company"],
  ["helm-chart", "Helm Chart for OneUptime"],
  ["infrastructure", ""],
  ["landing-pages", ""],
  ["marketing-site", ""],
  ["mobile", ""],
  ["oneuptime", "The complete open-source observability platform."],
  ["status-page-templates", ""],
  ["terraform-provider", ""],
].map(([name, description], index) => {
  return {
    id:
      name === "oneuptime"
        ? REPOSITORY_IDS.checkout
        : `20000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
    name: name,
    ...(description ? { description: description } : {}),
    organizationName: "OneUptime",
    repositoryName: name,
    mainBranchName: name === "oneuptime" ? "master" : "main",
    repositoryUrl: `https://github.com/OneUptime/${name}`,
    isConnected: name === "oneuptime",
  };
});

const repositories =
  reposParam === "none"
    ? []
    : reposParam === "stale"
      ? STALE_REPOSITORIES
      : reposParam === "many"
        ? [
            ...BASE_REPOSITORIES,
            ...EXTRA_REPOSITORY_NAMES.map((name, index) => {
              return {
                id: `20000000-0000-4000-8000-0000000001${index}0`,
                name: name,
                organizationName: "acme",
                repositoryName: name,
                mainBranchName: "main",
                repositoryUrl: `https://github.com/acme/${name}`,
                isConnected: true,
              };
            }),
          ]
        : BASE_REPOSITORIES;

// GitHub's connection to the project is gone: no repository is reached.
// Names long enough that the request box and the rows must cut them short.
const LONG_REPOSITORY_NAME = "checkout-and-payments-platform-api-service";
const LONG_BRANCH_NAME =
  "feature/very-long-branch-name-for-the-new-checkout-flow-with-apple-pay";
if (hasLongNames && repositories[0]) {
  repositories[0].name = LONG_REPOSITORY_NAME;
  repositories[0].organizationName = "acme-commerce-engineering";
  repositories[0].repositoryName = LONG_REPOSITORY_NAME;
}

if (isGitHubGone) {
  for (const repository of repositories) {
    repository.isConnected = false;
  }
}

/*
 * hosts=1: repositories on GitLab, Forgejo and a Git server, each through
 * one of the project's connections - its server, the account its token
 * acts as and the token's last characters, never the token itself
 * (CodeTaskRepositoryConnectionJSON). infra-scripts' Git server is on a
 * private network: only a Runner of the project's own reaches it.
 */
const hasOtherHosts = params.get("hosts") === "1";
const CONNECTION_IDS = {
  gitlab: "70000000-0000-4000-8000-0000000000a1",
  forgejo: "70000000-0000-4000-8000-0000000000a2",
  git: "70000000-0000-4000-8000-0000000000a3",
};
const connections = hasOtherHosts
  ? [
      {
        id: CONNECTION_IDS.gitlab,
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.com",
        accountLogin: "ada",
        credentialHint: "x7Kq",
        isTokenRefused: params.get("token") === "refused",
        isReachableFromServer: true,
      },
      {
        id: CONNECTION_IDS.forgejo,
        provider: CodeRepositoryType.Forgejo,
        hostUrl: "https://codeberg.org",
        hostProduct: "Forgejo",
        accountLogin: "ada",
        credentialHint: "9fLm",
        isTokenRefused: false,
        isReachableFromServer: true,
      },
      {
        id: CONNECTION_IDS.git,
        provider: CodeRepositoryType.Git,
        hostUrl: "https://10.0.4.12",
        accountLogin: "deploy",
        credentialHint: "",
        isTokenRefused: false,
        isReachableFromServer: false,
      },
    ]
  : [];

function connectionById(id) {
  return (
    connections.find((connection) => {
      return connection.id === id;
    }) || null
  );
}

// What Code is told of a connection: never its token.
function connectionJSON(connection) {
  return {
    id: connection.id,
    provider: connection.provider,
    hostUrl: connection.hostUrl,
    ...(connection.hostProduct ? { hostProduct: connection.hostProduct } : {}),
    ...(connection.accountLogin
      ? { accountLogin: connection.accountLogin }
      : {}),
    ...(connection.credentialHint
      ? { credentialHint: connection.credentialHint }
      : {}),
    isTokenRefused: connection.isTokenRefused,
    isReachableFromServer: connection.isReachableFromServer,
    repositoryCount: repositories.filter((repository) => {
      return repository.connectionId === connection.id;
    }).length,
  };
}

if (hasOtherHosts) {
  repositories.push(
    {
      id: REPOSITORY_IDS.billing,
      name: "billing-service",
      description: "Invoices, refunds and the ledger.",
      organizationName: "acme",
      repositoryName: "billing-service",
      mainBranchName: "main",
      repositoryUrl: "https://gitlab.com/acme/billing-service",
      isConnected: params.get("token") !== "refused",
      provider: CodeRepositoryType.GitLab,
      connectionId: CONNECTION_IDS.gitlab,
    },
    {
      id: REPOSITORY_IDS.widgets,
      name: "status-widgets",
      organizationName: "acme",
      repositoryName: "status-widgets",
      mainBranchName: "main",
      repositoryUrl: "https://codeberg.org/acme/status-widgets",
      isConnected: true,
      provider: CodeRepositoryType.Forgejo,
      connectionId: CONNECTION_IDS.forgejo,
    },
    {
      id: REPOSITORY_IDS.infra,
      name: "infra-scripts",
      organizationName: "ops",
      repositoryName: "infra-scripts",
      mainBranchName: "main",
      repositoryUrl: "https://10.0.4.12/ops/infra-scripts.git",
      isConnected: true,
      provider: CodeRepositoryType.Git,
      connectionId: CONNECTION_IDS.git,
    },
  );
}

// A repository on GitHub: the fixture's own, and those the App imports.
function isOnGitHub(repository) {
  return (
    !repository.provider || repository.provider === CodeRepositoryType.GitHub
  );
}

/*
 * Each repository's branches on GitHub, its main branch among them. With
 * branches=many, checkout-api has 140: more than one read of them holds.
 */
const BRANCHES_BY_REPOSITORY = {
  [REPOSITORY_IDS.checkout]: hasManyBranches
    ? [
        "main",
        ...Array.from({ length: 139 }, (_value, index) => {
          return `feature/task-${String(index + 1).padStart(3, "0")}`;
        }),
      ]
    : [
        ...(hasLongNames ? [LONG_BRANCH_NAME] : []),
        "chore/node-22",
        "feature/coupon-tests",
        "fix/gateway-timeout",
        "main",
        "release/2026-10",
      ],
  [REPOSITORY_IDS.web]: ["main", "redesign/checkout-page"],
  [REPOSITORY_IDS.payments]: ["master"],
  [REPOSITORY_IDS.billing]: ["fix/invoice-rounding", "main", "release/2026-10"],
  [REPOSITORY_IDS.widgets]: ["main"],
};

// What one read of a repository's branches holds, as the server's page.
const BRANCH_PAGE_SIZE = 100;

function branchesOf(repository) {
  return BRANCHES_BY_REPOSITORY[repository.id] || [repository.mainBranchName];
}

/*
 * What each repository's settings hold. A repository the GitHub App
 * imports has GitHub commands on and no build or test command: the agent
 * reads how from the repository's AGENTS.md. commands=1 gives checkout-api
 * the commands an operator set before Code stopped asking for them;
 * ghcommands=off turns its GitHub commands off, ghcommands=unset leaves the
 * column empty, as a repository from before it had a default.
 */
const settingsByRepository = {};
for (const repository of repositories) {
  settingsByRepository[repository.id] = {
    mainBranchName: repository.mainBranchName,
    maxOpenFixPullRequests: null,
    isGitHubCommandsEnabled: true,
    gitHubTriggerLabel: null,
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
    // The Runner AI works in it on: none picked, a global Runner.
    runnerId: null,
    /*
     * Connected through the GitHub App from now on: reviewed against
     * production. Only GitHub's are: production reviews are the App's.
     */
    isProductionReviewEnabled: repository.isConnected && isOnGitHub(repository),
    // Never chosen: the review, or a link on a public repository.
    productionReviewPullRequestContent: null,
  };
}

const checkoutSettings = settingsByRepository[REPOSITORY_IDS.checkout];

// infra-scripts works on prod-eu-west-1, on its Git server's network.
if (hasOtherHosts && params.get("gitrunner") !== "none") {
  settingsByRepository[REPOSITORY_IDS.infra].runnerId = RUNNER_IDS.prod;
}

if (checkoutSettings && params.get("commands") === "1") {
  checkoutSettings.setupCommand = "npm ci";
  checkoutSettings.buildCommand = "npm run build";
  checkoutSettings.testCommand = "npm test";
}

if (checkoutSettings && params.get("ghcommands") === "off") {
  checkoutSettings.isGitHubCommandsEnabled = false;
}

if (checkoutSettings && params.get("ghcommands") === "unset") {
  checkoutSettings.isGitHubCommandsEnabled = null;
}

if (checkoutSettings && params.get("review") === "off") {
  checkoutSettings.isProductionReviewEnabled = false;
}

// On whatever else is asked: a repository turned on, then no longer reached.
if (checkoutSettings && params.get("review") === "on") {
  checkoutSettings.isProductionReviewEnabled = true;
}

if (checkoutSettings && params.get("review") === "unset") {
  checkoutSettings.isProductionReviewEnabled = null;
}

if (
  checkoutSettings &&
  ["Link", "ReviewEvenIfPublic"].includes(params.get("reviewcomment"))
) {
  checkoutSettings.productionReviewPullRequestContent =
    params.get("reviewcomment");
}

// Whether a repository's pull requests are reviewed against production, as Code's reads answer it.
function withProductionReview(repository) {
  const settings = settingsByRepository[repository.id] || {};
  const { connectionId, ...shown } = repository;
  const connection = connectionId ? connectionById(connectionId) : null;
  return {
    ...shown,
    // How a repository off GitHub connects, as the server says it.
    ...(connection ? { connection: connectionJSON(connection) } : {}),
    isProductionReviewEnabled: settings.isProductionReviewEnabled === true,
    // Unset is on, as the server reads it.
    isGitHubCommandsEnabled: settings.isGitHubCommandsEnabled !== false,
  };
}

if (
  runnerParam &&
  RUNNER_IDS[runnerParam] &&
  settingsByRepository[REPOSITORY_IDS.checkout]
) {
  settingsByRepository[REPOSITORY_IDS.checkout].runnerId =
    RUNNER_IDS[runnerParam];
}

function runnerModel(id, name, lastAlive, hostInfo) {
  const model = new Runner();
  model._id = id;
  model.id = new ObjectID(id);
  model.projectId = new ObjectID(PROJECT_ID);
  model.name = name;
  model.lastAlive = lastAlive;
  if (hostInfo) {
    model.hostInfo = hostInfo;
  }
  return model;
}

const PROJECT_RUNNERS = [
  runnerModel(RUNNER_IDS.agent, "kubernetes-agent/prod-us", minutesAgo(1), {
    kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
  }),
  runnerModel(RUNNER_IDS.office, "office-runner", minutesAgo(180)),
  runnerModel(RUNNER_IDS.prod, "prod-eu-west-1", minutesAgo(0.5)),
];

// ---- tasks: each a conversation of turns -----------------------------------

function step(sequence, kind, subject, isError) {
  return {
    sequence,
    kind,
    subject,
    isError: Boolean(isError),
    createdAt: minutesAgo(1),
  };
}

const RETRIES_DIFF = [
  "@@ -12,9 +12,24 @@ export class PaymentClient {",
  "   public async charge(order: Order): Promise<Charge> {",
  '-    return await this.gateway.post("/charges", order);',
  "+    return await withRetries(",
  '+      () => this.gateway.post("/charges", order),',
  "+      {",
  "+        attempts: 3,",
  "+        backoffInMs: 200,",
  "+        retryOn: isGatewayTimeout,",
  "+      },",
  "+    );",
  "   }",
].join("\n");

const RETRY_TEST_DIFF = [
  "@@ -0,0 +1,14 @@",
  '+import { withRetries } from "../src/payments/retries";',
  "+",
  '+describe("withRetries", () => {',
  '+  test("tries a timed-out charge again", async () => {',
  "+    let calls = 0;",
  "+    const result = await withRetries(async () => {",
  "+      calls++;",
  "+      if (calls < 3) throw new GatewayTimeout();",
  '+      return "charged";',
  "+    }, { attempts: 3, backoffInMs: 0, retryOn: isGatewayTimeout });",
  '+    expect(result).toBe("charged");',
  "+  });",
  "+});",
].join("\n");

const LOGGING_DIFF = [
  "@@ -40,6 +40,10 @@ export async function withRetries<T>(",
  "     } catch (error) {",
  "       if (attempt < options.attempts && options.retryOn(error)) {",
  '+        logger.warn("Retrying a charge after a gateway timeout", {',
  "+          attempt,",
  "+          attempts: options.attempts,",
  "+        });",
  "         await sleep(options.backoffInMs * attempt);",
].join("\n");

function turn(data) {
  return {
    runId: data.runId,
    recipe: data.recipe || CodeFixTaskType.CodeRequest,
    status: data.status,
    createdAt: data.createdAt,
    startedAt: data.startedAt,
    completedAt: data.completedAt,
    userId: data.userId,
    request: data.request,
    steps: data.steps || [],
    outcome: data.outcome,
    changes: data.changes,
    pullRequests: data.pullRequests || [],
    errorMessage: data.errorMessage,
    needsUserInput: Boolean(data.needsUserInput),
    // A turn the fixture's AI is still taking through its stages.
    stage: data.stage,
    stageAt: data.stageAt,
  };
}

const PULL_REQUEST_418 = {
  number: 418,
  url: "https://github.com/acme/checkout-api/pull/418",
  title: "Retry charges when the payment gateway times out",
  state: "open",
  branch: "oneuptime-task-12-1a2b3c4d",
};

const tasks = [
  {
    id: TASK_IDS.working,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 13,
    title: "Write tests for the coupon validator",
    turns: [
      turn({
        runId: TASK_IDS.working,
        status: AIRunStatus.Running,
        createdAt: minutesAgo(2),
        startedAt: minutesAgo(2),
        userId: GRACE_ID,
        request: {
          message:
            "Write tests for the coupon validator. Cover expired coupons and coupons that only apply to some products.",
          context: [
            {
              type: CodeTaskContextType.File,
              label: "src/coupons/validator.ts",
              path: "src/coupons/validator.ts",
            },
          ],
        },
        steps: [
          step(1, CodeTaskStepKind.Read, "src/coupons/validator.ts"),
          step(2, CodeTaskStepKind.Listed, "test/coupons"),
          step(3, CodeTaskStepKind.Searched, "isExpired("),
          step(4, CodeTaskStepKind.Edited, "test/coupons/validator.test.ts"),
          step(5, CodeTaskStepKind.Ran, "npm test -- coupons"),
        ],
        // Keeps working while the page watches it.
        stage: "live",
      }),
    ],
  },
  {
    id: TASK_IDS.retries,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 12,
    title: "Retry charges when the payment gateway times out",
    turns: [
      turn({
        runId: TASK_IDS.retries,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(180),
        startedAt: minutesAgo(179),
        completedAt: minutesAgo(171),
        userId: ADA_ID,
        request: {
          message:
            "Retry charges when the payment gateway times out. Three attempts at most, and never retry a declined card.",
          context: [
            {
              type: CodeTaskContextType.Incident,
              label: "Incident #87: Checkout fails for some customers",
              recordId: RECORD_IDS.incident,
            },
            {
              type: CodeTaskContextType.File,
              label: "src/payments/client.ts",
              path: "src/payments/client.ts",
            },
          ],
        },
        steps: [
          step(1, CodeTaskStepKind.Read, "src/payments/client.ts"),
          step(2, CodeTaskStepKind.Searched, "gateway.post("),
          step(3, CodeTaskStepKind.Read, "src/payments/errors.ts"),
          step(4, CodeTaskStepKind.Edited, "src/payments/client.ts"),
          step(5, CodeTaskStepKind.Edited, "test/payments/retries.test.ts"),
          step(6, CodeTaskStepKind.Ran, "npm test"),
          step(7, CodeTaskStepKind.PullRequest, "Opened pull request #418"),
        ],
        outcome: {
          summary:
            "Charges now retry up to **3 times** when the gateway times out, waiting a little longer each time. A declined card is never retried: only `GatewayTimeout` errors are.\n\nI added `test/payments/retries.test.ts`, and the tests pass.",
          filesChanged: [
            {
              path: "src/payments/client.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 9,
              deletions: 1,
            },
            {
              path: "test/payments/retries.test.ts",
              status: CodeTaskFileStatus.Added,
              additions: 14,
              deletions: 0,
            },
          ],
          branchName: PULL_REQUEST_418.branch,
          pullRequestNumber: 418,
          pullRequestUrl: PULL_REQUEST_418.url,
          openedPullRequest: true,
        },
        changes: {
          files: [
            {
              path: "src/payments/client.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 9,
              deletions: 1,
              patch: RETRIES_DIFF,
            },
            {
              path: "test/payments/retries.test.ts",
              status: CodeTaskFileStatus.Added,
              additions: 14,
              deletions: 0,
              patch: RETRY_TEST_DIFF,
            },
          ],
          isTruncated: false,
        },
        pullRequests: [PULL_REQUEST_418],
      }),
      turn({
        runId: "40000000-0000-4000-8000-0000000001d1",
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(95),
        startedAt: minutesAgo(94),
        completedAt: minutesAgo(90),
        userId: ADA_ID,
        request: {
          message:
            "Also log each retry at warn level, with the attempt number.",
          context: [],
        },
        steps: [
          step(1, CodeTaskStepKind.Read, "src/payments/retries.ts"),
          step(2, CodeTaskStepKind.Edited, "src/payments/retries.ts"),
          step(3, CodeTaskStepKind.Ran, "npm test"),
        ],
        outcome: {
          summary:
            "Each retry now logs a warning with its attempt number. I pushed it to pull request #418.",
          filesChanged: [
            {
              path: "src/payments/retries.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 4,
              deletions: 0,
            },
          ],
          branchName: PULL_REQUEST_418.branch,
          pullRequestNumber: 418,
          pullRequestUrl: PULL_REQUEST_418.url,
          openedPullRequest: false,
        },
        changes: {
          files: [
            {
              path: "src/payments/retries.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 4,
              deletions: 0,
              patch: LOGGING_DIFF,
            },
          ],
          isTruncated: false,
        },
      }),
    ],
  },
  {
    id: TASK_IDS.question,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 11,
    title: "Make the order confirmation email faster",
    turns: [
      turn({
        runId: TASK_IDS.question,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(300),
        startedAt: minutesAgo(299),
        completedAt: minutesAgo(296),
        userId: GRACE_ID,
        needsUserInput: true,
        request: {
          message:
            "Make the order confirmation email faster. Customers wait up to 30 seconds for it.",
          context: [
            {
              type: CodeTaskContextType.Logs,
              label: 'Logs matching "order-confirmation"',
              search: "order-confirmation",
              hours: 24,
            },
          ],
        },
        steps: [
          step(1, CodeTaskStepKind.Searched, "sendOrderConfirmation"),
          step(2, CodeTaskStepKind.Read, "src/orders/confirmation.ts"),
          step(3, CodeTaskStepKind.Read, "src/email/queue.ts"),
        ],
        outcome: {
          summary:
            "The email waits for the invoice PDF, which takes most of the 30 seconds. I can send the email first and attach a link to the invoice instead, or keep the attachment and render the PDF in the background before the order completes.\n\nWhich do you prefer?",
          filesChanged: [],
        },
      }),
    ],
  },
  {
    id: TASK_IDS.exception,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 10,
    title: "",
    turns: [
      turn({
        runId: TASK_IDS.exception,
        recipe: CodeFixTaskType.FixException,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(60 * 26),
        startedAt: minutesAgo(60 * 26 - 1),
        completedAt: minutesAgo(60 * 26 - 9),
        steps: [
          step(1, CodeTaskStepKind.Read, "src/cart/totals.ts"),
          step(2, CodeTaskStepKind.Edited, "src/cart/totals.ts"),
        ],
        outcome: {
          summary:
            "The cart total read `item.price.amount` for items whose price had not loaded yet. It now skips them until their price arrives.",
          filesChanged: [
            {
              path: "src/cart/totals.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 3,
              deletions: 1,
            },
          ],
          pullRequestNumber: 402,
          pullRequestUrl: "https://github.com/acme/checkout-api/pull/402",
          openedPullRequest: true,
        },
        pullRequests: [
          {
            number: 402,
            url: "https://github.com/acme/checkout-api/pull/402",
            title: "Fix TypeError in cart totals",
            state: "merged",
            branch: "oneuptime-fix-exception-7f3e9a1c",
          },
        ],
      }),
    ],
    origin: {
      type: CodeTaskOriginType.Exception,
      label:
        "TypeError: Cannot read properties of undefined (reading 'amount')",
      recordId: RECORD_IDS.exception,
    },
  },
  {
    id: TASK_IDS.failed,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 9,
    title: "Upgrade express to version 5",
    turns: [
      turn({
        runId: TASK_IDS.failed,
        status: AIRunStatus.Error,
        createdAt: minutesAgo(60 * 50),
        startedAt: minutesAgo(60 * 50 - 1),
        completedAt: minutesAgo(60 * 50 - 14),
        userId: ADA_ID,
        request: {
          message: "Upgrade express to version 5.",
          context: [
            {
              type: CodeTaskContextType.Link,
              label: "Moving to Express 5",
              url: "https://expressjs.com/en/guide/migrating-5.html",
            },
          ],
        },
        steps: [
          step(1, CodeTaskStepKind.Edited, "package.json"),
          step(2, CodeTaskStepKind.Ran, "npm ci"),
          step(3, CodeTaskStepKind.Ran, "npm run build", true),
        ],
        errorMessage:
          "npm run build still failed after 2 repair attempts: 14 type errors in src/routes.",
      }),
    ],
  },
  {
    id: TASK_IDS.stopped,
    repositoryId: REPOSITORY_IDS.checkout,
    taskNumber: 8,
    title: "Rename the Order model to Purchase everywhere",
    turns: [
      turn({
        runId: TASK_IDS.stopped,
        status: AIRunStatus.Cancelled,
        createdAt: minutesAgo(60 * 75),
        startedAt: minutesAgo(60 * 75 - 1),
        completedAt: minutesAgo(60 * 75 - 3),
        userId: GRACE_ID,
        request: {
          message: "Rename the Order model to Purchase everywhere.",
          context: [],
        },
        steps: [step(1, CodeTaskStepKind.Searched, "class Order")],
        errorMessage: "Stopped by Grace Hopper.",
      }),
    ],
  },
  {
    id: TASK_IDS.orphan,
    repositoryId: null,
    taskNumber: 4,
    title: "",
    turns: [
      turn({
        runId: TASK_IDS.orphan,
        recipe: CodeFixTaskType.FixException,
        status: AIRunStatus.NoFixFound,
        createdAt: minutesAgo(60 * 24 * 9),
        startedAt: minutesAgo(60 * 24 * 9 - 1),
        completedAt: minutesAgo(60 * 24 * 9 - 2),
        errorMessage:
          "No connected repository holds the files in this exception's stack trace.",
      }),
    ],
    origin: {
      type: CodeTaskOriginType.Exception,
      label: "ECONNRESET: socket hang up",
      recordId: RECORD_IDS.exception,
    },
  },
].filter((task) => {
  return (
    !hasNoTasks &&
    (!task.repositoryId ||
      repositories.some((repository) => {
        return repository.id === task.repositoryId;
      }))
  );
});

// ---- production reviews: one task per pull request, reviewed in place -----

const REVIEW_IDS = {
  found: "40000000-0000-4000-8000-0000000000f1",
  nothing: "40000000-0000-4000-8000-0000000000f2",
  waiting: "40000000-0000-4000-8000-0000000000f3",
};

const REVIEW_RECORD_IDS = {
  service: RECORD_IDS.service,
  worker: "50000000-0000-4000-8000-0000000000e6",
  exception: RECORD_IDS.exception,
  incident: RECORD_IDS.incident,
  pastIncident: "50000000-0000-4000-8000-0000000000e7",
};

// The commit a pull request was reviewed at, and the one Review again reads.
const REVIEW_SHAS = {
  first: "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  next: "9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a09",
};

/*
 * A review that found something in every part, as the server keeps it
 * (Types/CodeRepository/ProductionReview): only counts, durations and the
 * names of code.
 */
function foundReport(reviewedAt, headSha) {
  return {
    pullRequest: {
      number: 42,
      title: "Retry charges when the gateway times out",
      url: "https://github.com/acme/checkout-api/pull/42",
      authorLogin: "ada",
      headSha,
      baseRefName: "main",
      isFromFork: false,
      isAuthorTrusted: true,
    },
    reviewedAt,
    trigger: ProductionReviewTrigger.PullRequestChanged,
    changedFileCount: 4,
    codeFileCount: 3,
    services: [
      {
        id: REVIEW_RECORD_IDS.service,
        name: "checkout-api",
        requestCount: 12840,
        p99Ms: 840,
      },
      { id: REVIEW_RECORD_IDS.worker, name: "payments-worker" },
    ],
    exceptions: [
      {
        exceptionId: REVIEW_RECORD_IDS.exception,
        type: "GatewayTimeoutError",
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        path: "src/payments/charge.ts",
        line: 88,
        functionName: "chargeCard",
        where: ProductionReviewWhere.ChangedLine,
        occurrences: 1240,
        isWindowCount: true,
        firstSeenAt: minutesAgo(60 * 30),
        lastSeenAt: minutesAgo(12),
        isUnhandled: true,
        isNew: true,
      },
      {
        exceptionId: "50000000-0000-4000-8000-0000000000e8",
        type: "RangeError",
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        path: "src/payments/retry-policy-for-card-networks-and-wallets.ts",
        where: ProductionReviewWhere.ChangedFile,
        occurrences: 17,
        isWindowCount: false,
        lastSeenAt: minutesAgo(60 * 26),
        isUnhandled: false,
        isNew: false,
      },
    ],
    operations: [
      {
        name: "POST /api/charges",
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        path: "src/payments/charge.ts",
        matchedBy: ProductionReviewOperationMatch.Route,
        requestCount: 9300,
        errorCount: 93,
        p95Ms: 1240,
      },
      {
        name: "PaymentClient.chargeWithRetries",
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        path: "src/payments/client.ts",
        functionName: "chargeWithRetries",
        matchedBy: ProductionReviewOperationMatch.CodeAttribute,
        requestCount: 9120,
        errorCount: 0,
        p95Ms: 610,
      },
    ],
    hotFunctions: [
      {
        functionName: "chargeCard",
        path: "src/payments/charge.ts",
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        totalPercent: 18.4,
        selfPercent: 2.5,
        isChangedFunction: true,
        profileKind: "CPU time",
      },
    ],
    incidents: {
      total: 4,
      open: 1,
      items: [
        {
          incidentId: REVIEW_RECORD_IDS.incident,
          label: "INC-87",
          severity: "Critical",
          state: "Investigating",
          isOpen: true,
          declaredAt: minutesAgo(90),
        },
        {
          incidentId: REVIEW_RECORD_IDS.pastIncident,
          label: "INC-61",
          severity: "Major",
          state: "Resolved",
          isOpen: false,
          declaredAt: minutesAgo(60 * 24 * 9),
          mentions: "chargeCard",
        },
      ],
    },
    suspectDeploys: [
      {
        serviceId: REVIEW_RECORD_IDS.service,
        serviceName: "checkout-api",
        at: minutesAgo(180),
        version: "v2.14.0",
        impact:
          "p95 latency of POST /api/charges rose from 420 ms to 1.2 s after it.",
      },
    ],
    points: [
      {
        text: "This change retries `chargeCard()` on a timeout - the line that threw `GatewayTimeoutError` 1,240 times this week. Make sure a retried charge cannot charge a card twice.",
      },
      {
        text: "INC-87 is open on checkout-api: consider merging after it is resolved.",
      },
    ],
    unreadSections: [],
    posting: ProductionReviewPosting.Review,
    isPublicRepository: false,
    commentUrl:
      "https://github.com/acme/checkout-api/pull/42#issuecomment-1001",
  };
}

// A review of a change to no code production runs: nothing to post.
function nothingReport(reviewedAt) {
  return {
    pullRequest: {
      number: 57,
      title: "Update the README's setup steps",
      url: "https://github.com/acme/checkout-api/pull/57",
      authorLogin: "grace",
      headSha: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
      baseRefName: "main",
      isFromFork: false,
    },
    reviewedAt,
    trigger: ProductionReviewTrigger.PullRequestChanged,
    changedFileCount: 1,
    codeFileCount: 0,
    services: [],
    exceptions: [],
    operations: [],
    hotFunctions: [],
    incidents: { total: 0, open: 0, items: [] },
    suspectDeploys: [],
    points: [],
    unreadSections: [],
    posting: ProductionReviewPosting.None,
  };
}

function reviewTurn(data) {
  return turn({
    recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
    ...data,
  });
}

function reviewOutcome(report) {
  return {
    summary: report.exceptions.length
      ? "Production review: 2 exceptions, 2 operations, 1 hot function, 2 incidents and 1 suspect deploy in or around the changed code."
      : "Nothing in production runs through this pull request's changes.",
    filesChanged: [],
    productionReview: report,
  };
}

const REVIEW_TASKS = [
  {
    id: REVIEW_IDS.waiting,
    repositoryId: REPOSITORY_IDS.checkout,
    kind: "review",
    title: "Cache coupon lookups for a minute",
    turns: [
      reviewTurn({
        runId: REVIEW_IDS.waiting,
        status: AIRunStatus.Queued,
        createdAt: minutesAgo(1),
      }),
    ],
    origin: {
      type: CodeTaskOriginType.GitHubPullRequest,
      label: "#61",
      url: "https://github.com/acme/checkout-api/pull/61",
    },
  },
  {
    id: REVIEW_IDS.found,
    repositoryId: REPOSITORY_IDS.checkout,
    kind: "review",
    title: "Retry charges when the gateway times out",
    turns: [
      reviewTurn({
        runId: REVIEW_IDS.found,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(60 * 3),
        startedAt: minutesAgo(6),
        completedAt: minutesAgo(5),
        outcome: reviewOutcome(foundReport(minutesAgo(5), REVIEW_SHAS.first)),
      }),
    ],
    origin: {
      type: CodeTaskOriginType.GitHubPullRequest,
      label: "#42",
      url: "https://github.com/acme/checkout-api/pull/42",
    },
  },
  {
    id: REVIEW_IDS.nothing,
    repositoryId: REPOSITORY_IDS.checkout,
    kind: "review",
    title: "Update the README's setup steps",
    turns: [
      reviewTurn({
        runId: REVIEW_IDS.nothing,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(60 * 26),
        startedAt: minutesAgo(60 * 26 - 1),
        completedAt: minutesAgo(60 * 26 - 2),
        outcome: reviewOutcome(nothingReport(minutesAgo(60 * 26 - 2))),
      }),
    ],
    origin: {
      type: CodeTaskOriginType.GitHubPullRequest,
      label: "#57",
      url: "https://github.com/acme/checkout-api/pull/57",
    },
  },
];

// The failure a review ends with once it was tried again (ProductionReviewRunner).
const REVIEW_FAILED_MESSAGE =
  "OneUptime could not finish this production review, even after trying again. A push to the pull request, or Review again, starts a new one.";

/*
 * reviewcase: #42's latest review in one of the states its page draws, as
 * the server leaves it - a review that failed or was not done keeps the
 * one before it.
 */
function applyReviewCase(task, reviewCase) {
  const latest = task.turns[task.turns.length - 1];
  const report = latest.outcome.productionReview;
  if (reviewCase === "failed") {
    latest.status = AIRunStatus.Error;
    latest.errorMessage = REVIEW_FAILED_MESSAGE;
  }
  if (reviewCase === "closed") {
    latest.errorMessage = "The pull request is closed, so it was not reviewed.";
  }
  if (reviewCase === "unread") {
    report.unreadSections = [
      ProductionReviewSection.Operations,
      ProductionReviewSection.Profiles,
    ];
    report.operations = [];
    report.hotFunctions = [];
  }
  if (reviewCase === "aioff") {
    report.points = [];
    report.aiNote = { code: ProductionReviewAiNoteCode.AiOff };
  }
  if (reviewCase === "public") {
    report.posting = ProductionReviewPosting.Link;
    report.isPublicRepository = true;
  }
  if (reviewCase === "outside") {
    report.pullRequest.isAuthorTrusted = false;
    report.pullRequest.isFromFork = true;
    report.trigger = ProductionReviewTrigger.GitHubCommand;
  }
  if (reviewCase === "long") {
    report.services[0].name = "checkout-api-payments-gateway-eu-west-1";
    report.exceptions[0].type = "PaymentGatewayIdempotencyKeyConflictError";
    report.exceptions[0].path =
      "services/checkout/src/payments/gateway/adapters/stripe/retry-policy-for-card-networks-and-wallets.ts";
    report.operations[1].name =
      "PaymentGatewayClient.chargeWithRetriesAndIdempotencyKeys";
    report.operations.push({
      name: "GET /api/v2/organizations/:organizationId/payment-methods/:paymentMethodId/verification",
      serviceId: REVIEW_RECORD_IDS.service,
      serviceName: "checkout-api-payments-gateway-eu-west-1",
      path: "src/payments/verification.ts",
      matchedBy: ProductionReviewOperationMatch.Route,
      requestCount: 120,
      errorCount: 30,
      p95Ms: 64000,
    });
    report.hotFunctions[0].path =
      "services/checkout/src/payments/gateway/adapters/stripe/charge-card-with-retries.ts";
  }
}

if (
  params.get("reviews") !== "none" &&
  repositories.some((repository) => {
    return repository.id === REPOSITORY_IDS.checkout;
  })
) {
  tasks.push(...REVIEW_TASKS);
  if (params.get("reviewcase")) {
    applyReviewCase(
      REVIEW_TASKS.find((task) => {
        return task.id === REVIEW_IDS.found;
      }),
      params.get("reviewcase"),
    );
  }
}

function isReview(task) {
  return task.kind === "review";
}

/*
 * One stage of a review the fixture's server is doing: Queued, Running,
 * then a new review in place - the last one's report stays on the turn
 * until then, as the server keeps it.
 */
function advanceReview(task, current) {
  /*
   * Only a review someone asked for again moves on: #61 waits for its
   * minute after the pull request last changed, and is seen waiting.
   */
  if (
    !current.stageAt ||
    (current.status !== AIRunStatus.Queued &&
      current.status !== AIRunStatus.Running)
  ) {
    return;
  }
  if (Date.now() - current.stageAt < pace) {
    return;
  }
  current.stageAt = Date.now();
  if (current.status === AIRunStatus.Queued) {
    current.status = AIRunStatus.Running;
    current.startedAt = new Date().toISOString();
    return;
  }
  current.status = AIRunStatus.Completed;
  current.completedAt = new Date().toISOString();
  current.errorMessage = undefined;
  const report =
    task.id === REVIEW_IDS.nothing
      ? nothingReport(current.completedAt)
      : foundReport(current.completedAt, REVIEW_SHAS.next);
  current.outcome = reviewOutcome(report);
}

/*
 * hosts=1: billing-service's task opened GitLab's merge request !12, and
 * infra-scripts' pushed a branch - OneUptime opens no pull request on a
 * Git server - saying where to open one (Runner PushedBranches).
 */
if (hasOtherHosts) {
  tasks.push(
    {
      id: TASK_IDS.invoices,
      repositoryId: REPOSITORY_IDS.billing,
      taskNumber: 7,
      title: "Round invoice totals the way the ledger does",
      turns: [
        turn({
          runId: TASK_IDS.invoices,
          status: AIRunStatus.Completed,
          createdAt: minutesAgo(40),
          startedAt: minutesAgo(39),
          completedAt: minutesAgo(33),
          userId: ADA_ID,
          request: {
            message:
              "Round invoice totals the way the ledger does: half up, to the cent.",
            context: [],
          },
          steps: [
            step(1, CodeTaskStepKind.Read, "src/invoices/total.ts"),
            step(2, CodeTaskStepKind.Edited, "src/invoices/total.ts"),
            step(3, CodeTaskStepKind.Ran, "npm test"),
            step(4, CodeTaskStepKind.PullRequest, "Opened merge request !12"),
          ],
          outcome: {
            summary:
              "Invoice totals now round **half up, to the cent**, as the ledger does. The tests pass.",
            filesChanged: [
              {
                path: "src/invoices/total.ts",
                status: CodeTaskFileStatus.Modified,
                additions: 3,
                deletions: 1,
              },
            ],
            branchName: "oneuptime-task-7-5e6f7a8b",
            pullRequestNumber: 12,
            pullRequestUrl:
              "https://gitlab.com/acme/billing-service/-/merge_requests/12",
            openedPullRequest: true,
          },
          changes: {
            files: [
              {
                path: "src/invoices/total.ts",
                status: CodeTaskFileStatus.Modified,
                additions: 3,
                deletions: 1,
                patch: [
                  "@@ -4,4 +4,6 @@ export function invoiceTotal(lines: Array<Line>): number {",
                  "   const sum: number = lines.reduce(addLine, 0);",
                  "-  return Math.round(sum * 100) / 100;",
                  "+  // Half up, to the cent, as the ledger rounds.",
                  "+  const cents: number = Math.floor(sum * 100 + 0.5);",
                  "+  return cents / 100;",
                  " }",
                ].join("\n"),
              },
            ],
            isTruncated: false,
          },
          pullRequests: [
            {
              number: 12,
              url: "https://gitlab.com/acme/billing-service/-/merge_requests/12",
              title: "Round invoice totals the way the ledger does",
              state: "open",
              branch: "oneuptime-task-7-5e6f7a8b",
            },
          ],
        }),
      ],
    },
    {
      id: TASK_IDS.terraform,
      repositoryId: REPOSITORY_IDS.infra,
      taskNumber: 6,
      title: "Pin the Terraform provider versions",
      turns: [
        turn({
          runId: TASK_IDS.terraform,
          status: AIRunStatus.Completed,
          createdAt: minutesAgo(70),
          startedAt: minutesAgo(69),
          completedAt: minutesAgo(64),
          userId: GRACE_ID,
          request: {
            message:
              "Pin every Terraform provider to the version we run in production.",
            context: [],
          },
          steps: [
            step(1, CodeTaskStepKind.Read, "terraform/versions.tf"),
            step(2, CodeTaskStepKind.Edited, "terraform/versions.tf"),
            step(3, CodeTaskStepKind.Ran, "terraform validate"),
          ],
          outcome: {
            summary:
              "Every provider in `terraform/versions.tf` is now pinned to the version production runs, and `terraform validate` passes.\n\nPushed the branch `oneuptime-task-6-9a8b7c6d` to ops/infra-scripts. Open a pull request from it into `main` on your Git server.",
            filesChanged: [
              {
                path: "terraform/versions.tf",
                status: CodeTaskFileStatus.Modified,
                additions: 2,
                deletions: 2,
              },
            ],
            branchName: "oneuptime-task-6-9a8b7c6d",
            openedPullRequest: false,
          },
        }),
      ],
    },
  );
}

let nextTaskNumber = 14;
let nextRunNumber = 1;
let nextPullRequest = 419;

function newRunId() {
  const id = `60000000-0000-4000-8000-${String(nextRunNumber).padStart(12, "0")}`;
  nextRunNumber++;
  return id;
}

// ---- who is signed in -----------------------------------------------------

const READS = [
  Permission.ProjectUser,
  Permission.ReadCodeRepository,
  Permission.ReadAIRun,
];
const HELD = {
  owner: [Permission.ProjectOwner],
  member: [Permission.ProjectMember],
  viewer: READS,
}[role] || [Permission.ProjectOwner];
const CAN_ASK = role !== "viewer";

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(ADA_ID);
UserUtil.getName = () => "Ada Lovelace";
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
ProjectUtil.getCurrentPlan = () => {
  return params.get("plan") === "free" ? PlanType.Free : PlanType.Scale;
};
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
OneUptimeDate.getCurrentTimezone = () => "Europe/London";

// Leaving the Dashboard (GitHub's install page) is recorded, not followed.
const navigate = Navigation.navigate.bind(Navigation);
Navigation.navigate = (to, options) => {
  if (to instanceof URL) {
    window.__fixture.navigations.push(to.toString());
    return;
  }
  return navigate(to, options);
};

// ---- the AI: a new turn takes a stage each time the task is read ------------

const BLOCKER_MESSAGES = {
  [CodeTaskBlockerType.NoPermission]:
    "You can read this repository's tasks. Asking AI to work in it takes permission to edit the repository - ask a project admin for it.",
  [CodeTaskBlockerType.PlanRequired]:
    "AI in Code needs the Growth plan or above. Upgrade the project's plan in Project Settings > Billing and Invoices > Billing.",
  [CodeTaskBlockerType.SubscriptionUnpaid]:
    "This project's subscription is unpaid. Update the payment method in Project Settings > Billing and Invoices > Billing to use AI.",
  [CodeTaskBlockerType.AiDisabled]:
    "AI is turned off for this project. A project admin can turn it on in Project Settings > AI > AI Features.",
  [CodeTaskBlockerType.RepositoryNotConnected]:
    "AI can only work in a GitHub repository connected through the GitHub App, and this one is not. Connect GitHub again from Code.",
  [CodeTaskBlockerType.NoLlmProvider]:
    "No LLM provider is set up for this project. Add one in Project Settings > AI > LLM Providers.",
  [CodeTaskBlockerType.NoAiCredits]:
    "This project's AI credits are used up. Add AI credits in Project Settings > AI > AI Credits.",
  [CodeTaskBlockerType.DailyLimitReached]:
    "This project used its daily AI token limit of 2,000,000 tokens. AI starts again at midnight UTC.",
  [CodeTaskBlockerType.NoAgent]:
    "No global Runner is online to work in this repository. Pick one of your Runners for it in the repository's settings in Code, or try again once the global Runner is back.",
  [CodeTaskBlockerType.RunnerNotOnline]:
    'The Runner "prod-eu-west-1" this repository picks is not online. Check that its container is running, or pick another Runner in the repository\'s settings in Code.',
  [CodeTaskBlockerType.GlobalRunnersOff]:
    "This project does not use global Runners, and this repository picks no Runner of its own. Pick one of your Runners for it in the repository's settings in Code, or turn global Runners on under Runbooks → Runners.",
  [CodeTaskBlockerType.RepositoryTokenRefused]:
    "GitLab refused this repository's access token, so AI cannot work in it. It may have expired: replace it on the repository's Settings page in Code.",
  [CodeTaskBlockerType.RepositoryNeedsOwnRunner]:
    "This repository's Git server is on a network OneUptime does not reach, so a global Runner cannot work in it. Pick one of your own Runners on that network in the repository's settings in Code.",
};

function blockerFor(repository) {
  // The plan comes before permission, as the server's gate asks (CodeTaskGate).
  if (params.get("plan") === "free") {
    return {
      type: CodeTaskBlockerType.PlanRequired,
      message: BLOCKER_MESSAGES[CodeTaskBlockerType.PlanRequired],
    };
  }
  if (!CAN_ASK) {
    return {
      type: CodeTaskBlockerType.NoPermission,
      message: BLOCKER_MESSAGES[CodeTaskBlockerType.NoPermission],
    };
  }
  if (blockerParam && BLOCKER_MESSAGES[blockerParam]) {
    // The server names the Runner a repository picks when it is offline.
    if (blockerParam === CodeTaskBlockerType.RunnerNotOnline) {
      return {
        type: blockerParam,
        message: BLOCKER_MESSAGES[blockerParam],
        runnerName: "prod-eu-west-1",
      };
    }
    return { type: blockerParam, message: BLOCKER_MESSAGES[blockerParam] };
  }
  // Off GitHub, as CodeTaskGate asks: a refused token, then a private network.
  const connection =
    repository && repository.connectionId
      ? connectionById(repository.connectionId)
      : null;
  if (connection && connection.isTokenRefused) {
    return {
      type: CodeTaskBlockerType.RepositoryTokenRefused,
      message: BLOCKER_MESSAGES[CodeTaskBlockerType.RepositoryTokenRefused],
    };
  }
  if (
    connection &&
    !connection.isReachableFromServer &&
    !(settingsByRepository[repository.id] || {}).runnerId
  ) {
    return {
      type: CodeTaskBlockerType.RepositoryNeedsOwnRunner,
      message: BLOCKER_MESSAGES[CodeTaskBlockerType.RepositoryNeedsOwnRunner],
    };
  }
  if (repository && !repository.isConnected) {
    return {
      type: CodeTaskBlockerType.RepositoryNotConnected,
      message: BLOCKER_MESSAGES[CodeTaskBlockerType.RepositoryNotConnected],
    };
  }
  return null;
}

function workingPullRequestOf(task) {
  for (let index = task.turns.length - 1; index >= 0; index--) {
    const open = task.turns[index].pullRequests.find((pullRequest) => {
      return pullRequest.state === "open";
    });
    if (open) {
      return open;
    }
  }
  return null;
}

// One stage of a turn the fixture's AI is working on.
function advance(task, current) {
  if (isReview(task)) {
    advanceReview(task, current);
    return;
  }
  if (!current.stage || current.stage === "live") {
    return;
  }
  if (Date.now() - (current.stageAt || 0) < pace) {
    return;
  }
  current.stageAt = Date.now();
  const repository = repositories.find((item) => {
    return item.id === task.repositoryId;
  });
  if (current.stage === "queued") {
    current.status = AIRunStatus.Running;
    current.startedAt = new Date().toISOString();
    current.steps = [
      step(1, CodeTaskStepKind.Listed, "src"),
      step(2, CodeTaskStepKind.Read, "src/payments/client.ts"),
    ];
    current.stage = "reading";
    return;
  }
  if (current.stage === "reading") {
    current.steps = [
      ...current.steps,
      step(3, CodeTaskStepKind.Searched, "timeout"),
      step(4, CodeTaskStepKind.Edited, "src/payments/client.ts"),
      step(5, CodeTaskStepKind.Ran, "npm test"),
    ];
    current.stage = aiParam === "stall" ? "live" : "finishing";
    return;
  }
  // finishing
  current.completedAt = new Date().toISOString();
  current.stage = undefined;
  if (aiParam === "fail") {
    current.status = AIRunStatus.Error;
    current.errorMessage =
      "The Runner lost its connection to GitHub while pushing the branch.";
    return;
  }
  current.status = AIRunStatus.Completed;
  if (aiParam === "ask") {
    current.needsUserInput = true;
    current.outcome = {
      summary:
        "Should the timeout apply to every gateway call, or only to charges?",
      filesChanged: [],
    };
    return;
  }
  const working = workingPullRequestOf(task);
  const pullRequest = working || {
    number: nextPullRequest++,
    url: `${repository ? repository.repositoryUrl : "https://github.com/acme/repo"}/pull/${nextPullRequest - 1}`,
    title: task.title,
    state: "open",
    branch: `oneuptime-task-${task.taskNumber}-${current.runId.substring(0, 8)}`,
  };
  current.outcome = {
    summary:
      "Done. The gateway call now times out after **5 seconds**, and the tests pass.",
    filesChanged: [
      {
        path: "src/payments/client.ts",
        status: CodeTaskFileStatus.Modified,
        additions: 6,
        deletions: 2,
      },
    ],
    branchName: pullRequest.branch,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    openedPullRequest: !working,
  };
  current.changes = {
    files: [
      {
        path: "src/payments/client.ts",
        status: CodeTaskFileStatus.Modified,
        additions: 6,
        deletions: 2,
        patch: [
          "@@ -8,7 +8,11 @@ export class PaymentClient {",
          "-  private readonly timeoutInMs = 30000;",
          "+  private readonly timeoutInMs = 5000;",
        ].join("\n"),
      },
    ],
    isTruncated: false,
  };
  if (!working) {
    current.pullRequests = [pullRequest];
  }
}

// ---- what the Code API answers ----------------------------------------------

function stateOf(item) {
  return CodeTaskStateUtil.fromRun({
    status: item.status,
    needsUserInput: item.needsUserInput,
  });
}

function originOf(task) {
  if (task.origin) {
    return task.origin;
  }
  const first = task.turns[0];
  return {
    type: CodeTaskOriginType.Request,
    label: first.userId ? PEOPLE[first.userId].name : "",
  };
}

function lastActivityOf(task) {
  let latest = 0;
  for (const item of task.turns) {
    for (const moment of [item.createdAt, item.completedAt]) {
      if (moment && new Date(moment).getTime() > latest) {
        latest = new Date(moment).getTime();
      }
    }
  }
  return new Date(latest).toISOString();
}

function summaryOf(task) {
  const latest = task.turns[task.turns.length - 1];
  const pullRequests = [];
  for (const item of task.turns) {
    pullRequests.push(...item.pullRequests);
  }
  const pullRequest =
    pullRequests.find((candidate) => {
      return candidate.state === "open";
    }) || pullRequests[0];
  const summary = {
    id: task.id,
    taskNumber: task.taskNumber,
    // As the server: a task nobody asked for in Code is named by its origin.
    title: task.title || originOf(task).label,
    recipe: task.turns[0].recipe,
    state: stateOf(latest),
    isQueued: latest.status === AIRunStatus.Queued,
    createdAt: task.turns[0].createdAt,
    lastActivityAt: lastActivityOf(task),
    origin: originOf(task),
    turnCount: task.turns.length,
  };
  if (task.turns[0].userId) {
    summary.requestedBy = PEOPLE[task.turns[0].userId];
  }
  if (pullRequest) {
    summary.pullRequest = pullRequest;
  }
  if (task.repositoryId) {
    summary.codeRepositoryId = task.repositoryId;
  }
  const changes = changesOf(task);
  if (changes) {
    summary.changes = changes;
  }
  // A production review: what its latest review found, at a glance.
  const review = latest.outcome && latest.outcome.productionReview;
  if (isReview(task) && review) {
    summary.productionReview = ProductionReviewUtil.summarize(review);
  }
  return summary;
}

/*
 * What a task changed over its turns, as the server adds it up
 * (CodeTaskChangeStats): each file once, and every turn's lines.
 */
function changesOf(task) {
  const paths = new Set();
  let additions = 0;
  let deletions = 0;
  for (const item of task.turns) {
    for (const file of (item.outcome && item.outcome.filesChanged) || []) {
      paths.add(file.path);
      additions += file.additions || 0;
      deletions += file.deletions || 0;
    }
  }
  return paths.size > 0 ? { files: paths.size, additions, deletions } : null;
}

function turnJSON(task, item, index, canSeeChanges) {
  const json = {
    runId: item.runId,
    recipe: item.recipe,
    status: item.status,
    state: stateOf(item),
    createdAt: item.createdAt,
    steps: item.steps,
    pullRequests: item.pullRequests,
    needsInput: Boolean(
      item.needsUserInput && item.status === AIRunStatus.Completed,
    ),
  };
  if (item.startedAt) {
    json.startedAt = item.startedAt;
  }
  if (item.completedAt) {
    json.completedAt = item.completedAt;
  }
  if (item.userId) {
    json.requestedBy = PEOPLE[item.userId];
  }
  if (item.request) {
    json.request = item.request;
  } else if (index === 0) {
    json.origin = originOf(task);
  }
  if (item.outcome) {
    json.outcome = item.outcome;
  }
  if (canSeeChanges && item.changes) {
    json.changes = item.changes;
  }
  if (item.errorMessage) {
    json.errorMessage = item.errorMessage;
  }
  return json;
}

function statsOf(repositoryId) {
  // A pull request's production review is not one of a repository's tasks.
  const own = tasks.filter((task) => {
    return task.repositoryId === repositoryId && !isReview(task);
  });
  let working = 0;
  let waitingForYou = 0;
  let openPullRequests = 0;
  let lastActivityAt;
  for (const task of own) {
    const state = stateOf(task.turns[task.turns.length - 1]);
    if (state === CodeTaskState.Working) {
      working++;
    }
    if (state === CodeTaskState.WaitingForYou) {
      waitingForYou++;
    }
    for (const item of task.turns) {
      openPullRequests += item.pullRequests.filter((pullRequest) => {
        return pullRequest.state === "open";
      }).length;
    }
    const activity = lastActivityOf(task);
    if (!lastActivityAt || activity > lastActivityAt) {
      lastActivityAt = activity;
    }
  }
  const stats = {
    working,
    waitingForYou,
    openPullRequests,
    taskCount: own.length,
  };
  if (lastActivityAt) {
    stats.lastActivityAt = lastActivityAt;
  }
  return stats;
}

function refused(status, message) {
  return new HTTPErrorResponse(status, { message }, {});
}

function findTask(taskId) {
  return tasks.find((task) => {
    return (
      task.id === taskId ||
      task.turns.some((item) => {
        return item.runId === taskId;
      })
    );
  });
}

function repositoryOf(task) {
  return (
    repositories.find((repository) => {
      return repository.id === task.repositoryId;
    }) || null
  );
}

function newRequestTurn(request) {
  return turn({
    runId: newRunId(),
    status: AIRunStatus.Queued,
    createdAt: new Date().toISOString(),
    userId: ADA_ID,
    request,
    stage: "queued",
    stageAt: Date.now(),
  });
}

// The context a request carries, as the server keeps it (labels it writes).
function contextItemsOf(inputs) {
  return (inputs || []).map((input) => {
    switch (input.type) {
      case CodeTaskContextType.File:
        return { type: input.type, label: input.path, path: input.path };
      case CodeTaskContextType.Note:
        return {
          type: input.type,
          label: input.text.split(/\s+/).join(" ").substring(0, 60),
          text: input.text,
        };
      case CodeTaskContextType.Link:
        return {
          type: input.type,
          label: input.title || new globalThis.URL(input.url).host,
          url: input.url,
        };
      case CodeTaskContextType.Trace:
        return {
          type: input.type,
          label: `Trace ${input.traceId.substring(0, 8)}…`,
          traceId: input.traceId,
        };
      case CodeTaskContextType.Logs:
        return {
          type: input.type,
          label: `Logs matching "${input.search}"`,
          search: input.search,
          hours: input.hours,
        };
      default: {
        const record = RECORDS[input.type].find((item) => {
          return item._id === input.id;
        });
        return {
          type: input.type,
          label: record ? record.label : input.type,
          recordId: input.id,
        };
      }
    }
  });
}

async function answer(path, body) {
  const repositoriesMatch = path === "/repositories";
  if (repositoriesMatch) {
    window.__fixture.reads.repositories++;
    if (failParam === "repositories") {
      return refused(500, "The repositories could not be read right now.");
    }
    return new HTTPResponse(
      200,
      {
        repositories: repositories.map((repository) => {
          return {
            ...withProductionReview(repository),
            stats: statsOf(repository.id),
          };
        }),
        tasksWithoutRepositoryCount:
          params.get("other") === "1"
            ? tasks.filter((task) => {
                return !task.repositoryId;
              }).length
            : 0,
      },
      {},
    );
  }

  if (path.startsWith("/repository/")) {
    window.__fixture.reads.repository++;
    const repository = repositories.find((item) => {
      return item.id === path.substring("/repository/".length);
    });
    if (!repository || failParam === "repository") {
      return refused(
        404,
        "Repository not found, or you do not have access to it.",
      );
    }
    return new HTTPResponse(
      200,
      {
        repository: withProductionReview(repository),
        stats: statsOf(repository.id),
        canAsk: CAN_ASK,
        blocker: blockerFor(repository),
      },
      {},
    );
  }

  if (path === "/list") {
    window.__fixture.reads.list++;
    // A repository's production reviews: a list of their own.
    const isReviews = body.kind === "productionReviews";
    if (isReviews) {
      window.__fixture.reviewLists.push(body.repositoryId);
    } else {
      window.__fixture.lists.push(
        body.allRepositories
          ? "all"
          : body.withoutRepository
            ? "none"
            : body.repositoryId,
      );
    }
    if (failParam === "list") {
      return refused(500, "The tasks could not be read right now.");
    }
    const own = tasks.filter((task) => {
      // The tasks leave the reviews out; the reviews list holds only them.
      if (isReview(task) !== isReviews) {
        return false;
      }
      // Every task; those with no repository too, where the project has some.
      if (body.allRepositories) {
        return Boolean(task.repositoryId) || params.get("other") === "1";
      }
      return body.withoutRepository
        ? !task.repositoryId
        : task.repositoryId === body.repositoryId;
    });
    for (const task of own) {
      advance(task, task.turns[task.turns.length - 1]);
    }
    const sorted = own.slice().sort((a, b) => {
      return (
        new Date(b.turns[0].createdAt).getTime() -
        new Date(a.turns[0].createdAt).getTime()
      );
    });
    const skip = Number(body.skip || 0);
    const limit = Number(body.limit || 20);
    return new HTTPResponse(
      200,
      {
        tasks: sorted.slice(skip, skip + limit).map(summaryOf),
        totalCount: sorted.length,
        skip,
        limit,
      },
      {},
    );
  }

  /*
   * A repository's branches, as the server answers them: its main branch
   * first, then the first page of the rest - or, searched, those that start
   * with what was typed.
   */
  if (path.startsWith("/branches/")) {
    const repositoryId = path.substring("/branches/".length);
    const search = typeof body.search === "string" ? body.search : "";
    window.__fixture.branchReads.push({ repositoryId, search });
    const repository = repositories.find((item) => {
      return item.id === repositoryId;
    });
    if (!repository) {
      return refused(
        404,
        "Repository not found, or you do not have access to it.",
      );
    }
    if (!CAN_ASK) {
      return refused(403, BLOCKER_MESSAGES[CodeTaskBlockerType.NoPermission]);
    }
    if (!repository.isConnected) {
      return refused(
        400,
        BLOCKER_MESSAGES[CodeTaskBlockerType.RepositoryNotConnected],
      );
    }
    // OneUptime's server never reaches a Git server only a Runner reaches.
    const branchesConnection = repository.connectionId
      ? connectionById(repository.connectionId)
      : null;
    if (branchesConnection && !branchesConnection.isReachableFromServer) {
      return refused(
        400,
        "OneUptime does not read this repository's branches: only a Runner of the project's own reaches its Git server.",
      );
    }
    if (failParam === "branches") {
      return refused(
        400,
        "OneUptime could not read this repository's branches from GitHub. Try again in a moment.",
      );
    }
    const main = repository.mainBranchName;
    const others = branchesOf(repository).filter((name) => {
      return name !== main && (!search || name.startsWith(search));
    });
    const page = others.slice(0, BRANCH_PAGE_SIZE);
    if (!search || main.startsWith(search)) {
      page.unshift(main);
    }
    return new HTTPResponse(
      200,
      {
        branches: page,
        defaultBranch: main,
        isComplete: others.length <= BRANCH_PAGE_SIZE,
      },
      {},
    );
  }

  if (path.startsWith("/get/")) {
    window.__fixture.reads.task++;
    const task = findTask(path.substring("/get/".length));
    if (!task || failParam === "task") {
      return refused(404, "Task not found, or you do not have access to it.");
    }
    advance(task, task.turns[task.turns.length - 1]);
    const repository = repositoryOf(task);
    return new HTTPResponse(
      200,
      {
        task: summaryOf(task),
        turns: task.turns.map((item, index) => {
          return turnJSON(task, item, index, CAN_ASK);
        }),
        repository: repository ? withProductionReview(repository) : null,
        canAsk: Boolean(repository) && CAN_ASK,
        canSeeChanges: Boolean(repository) && CAN_ASK,
        canReadLogContent: role === "owner",
        blocker: repository ? blockerFor(repository) : null,
      },
      {},
    );
  }

  if (path === "/create") {
    window.__fixture.creates.push(JSON.parse(JSON.stringify(body)));
    const repository = repositories.find((item) => {
      return item.id === body.repositoryId;
    });
    const blocker = blockerFor(repository);
    if (blocker) {
      return refused(400, blocker.message);
    }
    if (refuseParam === "create") {
      return refused(
        400,
        "This project used its daily AI token limit of 2,000,000 tokens. AI starts again at midnight UTC.",
      );
    }
    // A branch other than the main one must be on GitHub, as the server checks.
    const branch = typeof body.branch === "string" ? body.branch : null;
    if (branch && !branchesOf(repository).includes(branch)) {
      return refused(
        400,
        "That branch is not in the repository on GitHub any more. Pick another branch.",
      );
    }
    const request = {
      message: body.message,
      context: contextItemsOf(body.context),
    };
    if (branch && branch !== repository.mainBranchName) {
      request.baseBranch = branch;
    }
    const firstTurn = newRequestTurn(request);
    const task = {
      id: firstTurn.runId,
      repositoryId: repository.id,
      taskNumber: nextTaskNumber++,
      title: CodeTaskTitle.fromMessage(body.message),
      turns: [firstTurn],
    };
    tasks.unshift(task);
    return new HTTPResponse(200, { taskId: task.id }, {});
  }

  if (path.startsWith("/reply/")) {
    window.__fixture.replies.push({
      taskId: path.substring("/reply/".length),
      ...JSON.parse(JSON.stringify(body)),
    });
    const task = findTask(path.substring("/reply/".length));
    if (refuseParam === "reply") {
      return refused(
        400,
        "AI is still working on this task. Wait for it to finish, or stop it, before you reply.",
      );
    }
    const reply = newRequestTurn({
      message: body.message,
      context: contextItemsOf(body.context),
    });
    task.turns.push(reply);
    return new HTTPResponse(200, { taskId: task.id, runId: reply.runId }, {});
  }

  if (path.startsWith("/retry/")) {
    window.__fixture.retries.push(path.substring("/retry/".length));
    const task = findTask(path.substring("/retry/".length));
    const latest = task.turns[task.turns.length - 1];
    // The same words and context; the branch stays on the first turn.
    const again = newRequestTurn({
      message: latest.request.message,
      context: latest.request.context,
    });
    task.turns.push(again);
    return new HTTPResponse(200, { taskId: task.id, runId: again.runId }, {});
  }

  /*
   * Review again: the pull request's review is asked again, at once, as
   * the server's ProductionReviewQueue asks it - for those who may ask AI
   * in the repository, while GitHub reaches it.
   */
  if (path.startsWith("/review-again/")) {
    const taskId = path.substring("/review-again/".length);
    window.__fixture.reviewAgains.push(taskId);
    const task = findTask(taskId);
    if (!task || !isReview(task)) {
      return refused(
        400,
        "Only a pull request's production review can be reviewed again.",
      );
    }
    if (!CAN_ASK) {
      return refused(
        403,
        "Reviewing a pull request again takes permission to edit its repository - ask a project admin for it.",
      );
    }
    const repository = repositoryOf(task);
    if (!repository || !repository.isConnected) {
      return refused(
        400,
        BLOCKER_MESSAGES[CodeTaskBlockerType.RepositoryNotConnected],
      );
    }
    const latest = task.turns[task.turns.length - 1];
    if (
      latest.status !== AIRunStatus.Queued &&
      latest.status !== AIRunStatus.Running
    ) {
      latest.status = AIRunStatus.Queued;
      latest.stageAt = Date.now();
      latest.completedAt = undefined;
    }
    return new HTTPResponse(200, { taskId: task.id }, {});
  }

  if (path.startsWith("/stop/")) {
    window.__fixture.stops.push(path.substring("/stop/".length));
    const task = findTask(path.substring("/stop/".length));
    const latest = task.turns[task.turns.length - 1];
    let stopped = 0;
    if (
      latest.status === AIRunStatus.Queued ||
      latest.status === AIRunStatus.Running
    ) {
      latest.status = AIRunStatus.Cancelled;
      latest.completedAt = new Date().toISOString();
      latest.errorMessage = "Stopped by Ada Lovelace.";
      latest.stage = undefined;
      stopped = 1;
    }
    return new HTTPResponse(200, { stopped }, {});
  }

  return refused(404, `The fixture does not model ${path}.`);
}

// A turn's Log page: its recorded events, verbatim.
function logOf(runId) {
  const task = findTask(runId);
  const item = task
    ? task.turns.find((candidate) => {
        return candidate.runId === runId;
      }) || task.turns[0]
    : null;
  if (!item) {
    return refused(404, "Run not found.");
  }
  const events = item.steps.map((entry) => {
    return {
      _id: `70000000-0000-4000-8000-${String(entry.sequence).padStart(12, "0")}`,
      sequence: entry.sequence,
      eventType: entry.isError
        ? AIRunEventType.ToolCallFailed
        : AIRunEventType.ToolCallCompleted,
      toolName: {
        [CodeTaskStepKind.Read]: "read_file",
        [CodeTaskStepKind.Edited]: "write_file",
        [CodeTaskStepKind.Listed]: "list_directory",
        [CodeTaskStepKind.Searched]: "search_code",
        [CodeTaskStepKind.Ran]: "run_command",
        [CodeTaskStepKind.PullRequest]: "open_pull_request",
        [CodeTaskStepKind.Note]: "note",
      }[entry.kind],
      message: entry.subject,
      createdAt: entry.createdAt,
    };
  });
  return new HTTPResponse(
    200,
    {
      run: { _id: item.runId, status: item.status },
      events,
      llmLogs: [],
      canReadContent: role === "owner",
    },
    {},
  );
}

/*
 * The repositories a token reaches on a host, as the connect dialog lists
 * them: those it may only read cannot be picked, and those the project has
 * already say so.
 */
function listedRepository(hostUrl, ownerPath, name, extra) {
  const isConnected = repositories.some((repository) => {
    return (
      repository.organizationName === ownerPath &&
      repository.repositoryName === name &&
      (repository.repositoryUrl || "").startsWith(hostUrl)
    );
  });
  return {
    id: `${ownerPath}/${name}`,
    name,
    ownerPath,
    fullName: `${ownerPath}/${name}`,
    defaultBranch: "main",
    webUrl: `${hostUrl}/${ownerPath}/${name}`,
    isPrivate: true,
    canPush: true,
    isConnected,
    ...(extra || {}),
  };
}

function hostListingOf(provider, hostUrl) {
  if (provider === CodeRepositoryType.Forgejo) {
    return {
      account: { login: "ada", name: "Ada Lovelace" },
      hostUrl,
      hostProduct: "Forgejo",
      repositories: [
        listedRepository(hostUrl, "acme", "status-widgets"),
        listedRepository(hostUrl, "acme", "uptime-badges", {
          description: "Badges for the status page.",
          isPrivate: false,
        }),
      ],
    };
  }
  return {
    account: { login: "ada", name: "Ada Lovelace" },
    hostUrl,
    repositories: [
      listedRepository(hostUrl, "acme", "billing-service", {
        description: "Invoices, refunds and the ledger.",
      }),
      listedRepository(hostUrl, "acme", "ledger", {
        description: "Double-entry bookkeeping for every order.",
      }),
      listedRepository(hostUrl, "acme", "handbook", {
        description: "How the team works.",
        isPrivate: false,
        canPush: false,
      }),
      listedRepository(hostUrl, "acme", "mobile-app"),
    ],
  };
}

// The last characters of a token long enough to show them of.
function hintOf(token) {
  return token.length >= 16 ? token.substring(token.length - 4) : "";
}

const HOST_NAMES = {
  [CodeRepositoryType.GitLab]: "GitLab",
  [CodeRepositoryType.Forgejo]: "Forgejo",
  [CodeRepositoryType.Git]: "The Git server",
};

let nextConnectionNumber = 1;
let nextConnectedRepositoryNumber = 1;

// A source the dialog sends: a connection the project has, or a new token.
function connectionOfSource(body) {
  if (body.connectionId) {
    return connectionById(body.connectionId);
  }
  return {
    id: `70000000-0000-4000-8000-${String(100 + nextConnectionNumber).padStart(12, "0")}`,
    provider: body.provider,
    hostUrl: body.hostUrl,
    ...(body.provider === CodeRepositoryType.Forgejo
      ? { hostProduct: "Forgejo" }
      : {}),
    accountLogin: "ada",
    credentialHint: hintOf(String(body.token || "")),
    isTokenRefused: false,
    isReachableFromServer: true,
  };
}

function isPrivateHost(hostname) {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "localhost"
  );
}

function addConnectedRepository(data) {
  const id = `20000000-0000-4000-8000-0000000003${String(nextConnectedRepositoryNumber).padStart(2, "0")}`;
  nextConnectedRepositoryNumber++;
  repositories.push({
    id,
    name: data.name,
    ...(data.description ? { description: data.description } : {}),
    organizationName: data.ownerPath,
    repositoryName: data.name,
    mainBranchName: data.defaultBranch || "main",
    repositoryUrl: data.webUrl,
    isConnected: true,
    provider: data.provider,
    connectionId: data.connectionId,
  });
  settingsByRepository[id] = {
    mainBranchName: data.defaultBranch || "main",
    maxOpenFixPullRequests: null,
    isGitHubCommandsEnabled: true,
    gitHubTriggerLabel: null,
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
    runnerId: null,
    isProductionReviewEnabled: false,
    productionReviewPullRequestContent: null,
  };
  return id;
}

function answerConnect(path, body) {
  if (path === "/list") {
    return new HTTPResponse(
      200,
      { connections: connections.map(connectionJSON) },
      {},
    );
  }

  if (path === "/repositories") {
    window.__fixture.connectReads.push(JSON.parse(JSON.stringify(body)));
    const connection = connectionOfSource(body);
    if (!connection) {
      return refused(404, "That connection is not one of this project's.");
    }
    if (String(body.token || "").startsWith("revoked")) {
      return refused(
        400,
        `${HOST_NAMES[connection.provider]} refused the access token. It may have expired or been revoked: create a new token and use it instead.`,
      );
    }
    const listing = hostListingOf(connection.provider, connection.hostUrl);
    const search = typeof body.search === "string" ? body.search : "";
    return new HTTPResponse(
      200,
      {
        ...listing,
        repositories: listing.repositories.filter((repository) => {
          return !search || repository.fullName.includes(search);
        }),
        hasMore: false,
      },
      {},
    );
  }

  if (path === "/connect") {
    window.__fixture.connects.push(JSON.parse(JSON.stringify(body)));
    const connection = connectionOfSource(body);
    if (!connection) {
      return refused(404, "That connection is not one of this project's.");
    }
    if (!body.connectionId) {
      connections.push(connection);
      nextConnectionNumber++;
    }
    const listing = hostListingOf(connection.provider, connection.hostUrl);
    const ids = [];
    for (const id of body.repositoryIds || []) {
      const listed = listing.repositories.find((repository) => {
        return repository.id === id;
      });
      if (!listed || !listed.canPush || listed.isConnected) {
        continue;
      }
      ids.push(
        addConnectedRepository({
          ...listed,
          provider: connection.provider,
          connectionId: connection.id,
        }),
      );
    }
    return new HTTPResponse(
      200,
      {
        connectionId: connection.id,
        imported: ids.length,
        reconnected: 0,
        skipped: (body.repositoryIds || []).length - ids.length,
        repositoryIds: ids,
      },
      {},
    );
  }

  if (path === "/connect-git") {
    window.__fixture.gitConnects.push(JSON.parse(JSON.stringify(body)));
    let address;
    try {
      address = new globalThis.URL(String(body.url || ""));
    } catch {
      return refused(
        400,
        "That is not a web address. Enter it as https://git.example.com.",
      );
    }
    const isPrivate = isPrivateHost(address.hostname);
    if (isPrivate && !body.connectWithoutCheck) {
      return new HTTPResponse(
        200,
        {
          needsConfirmation: true,
          message: `OneUptime cannot reach ${address.host}. Check the address. If the server is on a private network, connect it anyway and pick one of your own Runners on that network to work in it.`,
        },
        {},
      );
    }
    const parts = address.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    const name = parts[parts.length - 1] || "repository";
    const ownerPath = parts.slice(0, -1).join("/");
    const connection = {
      id: `70000000-0000-4000-8000-${String(200 + nextConnectionNumber).padStart(12, "0")}`,
      provider: CodeRepositoryType.Git,
      hostUrl: address.origin,
      accountLogin: body.username || "",
      credentialHint: hintOf(String(body.password || "")),
      isTokenRefused: false,
      isReachableFromServer: !isPrivate,
    };
    nextConnectionNumber++;
    connections.push(connection);
    const repositoryId = addConnectedRepository({
      name,
      ownerPath,
      defaultBranch: "main",
      webUrl: address.toString(),
      provider: CodeRepositoryType.Git,
      connectionId: connection.id,
    });
    return new HTTPResponse(200, { repositoryId }, {});
  }

  const token = /^\/([0-9a-f-]+)\/token$/.exec(path);
  if (token) {
    window.__fixture.tokenReplacements.push({
      connectionId: token[1],
      ...JSON.parse(JSON.stringify(body)),
    });
    const connection = connectionById(token[1]);
    if (!connection) {
      return refused(404, "That connection is not one of this project's.");
    }
    if (String(body.token || "").startsWith("revoked")) {
      return refused(
        400,
        `${HOST_NAMES[connection.provider]} refused the access token. It may have expired or been revoked: create a new token and use it instead.`,
      );
    }
    connection.isTokenRefused = false;
    connection.credentialHint = hintOf(String(body.token || ""));
    if (typeof body.username === "string" && body.username) {
      connection.accountLogin = body.username;
    }
    for (const repository of repositories) {
      if (repository.connectionId === connection.id) {
        repository.isConnected = true;
      }
    }
    return new HTTPResponse(
      200,
      {
        accountLogin: connection.accountLogin || null,
        credentialHint: connection.credentialHint,
      },
      {},
    );
  }

  return refused(404, `The fixture does not model ${path}.`);
}

API.post = async (options) => {
  const url = options.url.toString();
  if (delay) {
    await wait(delay);
  }
  const connect = url.indexOf("/code-repository-connection/");
  if (connect >= 0) {
    try {
      return answerConnect(
        url
          .substring(connect + "/code-repository-connection".length)
          .split("?")[0],
        options.data || {},
      );
    } catch (error) {
      console.error(`Code fixture failed on ${url}: ${error.stack}`);
      return refused(500, `The fixture failed: ${error.message}`);
    }
  }
  const codeTask = url.indexOf("/code-task/");
  if (codeTask >= 0) {
    try {
      return await answer(
        url.substring(codeTask + "/code-task".length).split("?")[0],
        options.data || {},
      );
    } catch (error) {
      // A mistake in the fixture itself, said loudly rather than as a page state.
      console.error(`Code fixture failed on ${url}: ${error.stack}`);
      return refused(500, `The fixture failed: ${error.message}`);
    }
  }
  const log = url.indexOf("/code-fix-run/logs/");
  if (log >= 0) {
    return logOf(url.substring(log + "/code-fix-run/logs/".length));
  }
  // The global Runners for code, by how each is doing (RunnerAPI).
  if (url.includes("/runner/global-code-runners")) {
    return new HTTPResponse(
      200,
      {
        globalRunners: hasGlobalCodeRunner
          ? [{ liveStatus: globalCodeRunnerStatus }]
          : [],
      },
      {},
    );
  }
  return refused(404, `The fixture does not model ${url}.`);
};

API.get = async (options) => {
  const url = options.url.toString();
  if (url.includes("/github/install-url")) {
    return new HTTPResponse(
      200,
      {
        installUrl:
          "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      },
      {},
    );
  }
  if (url.includes("/github/connect-existing-url")) {
    return new HTTPResponse(
      200,
      {
        authorizeUrl:
          "https://github.com/login/oauth/authorize?client_id=fixture",
      },
      {},
    );
  }
  return new HTTPResponse(200, {}, {});
};

// ---- records the request box can add, and the repository's own row ----------

const RECORDS = {
  [CodeTaskContextType.Incident]: [
    {
      _id: RECORD_IDS.incident,
      title: "Checkout fails for some customers",
      label: "Incident #87: Checkout fails for some customers",
    },
  ],
  [CodeTaskContextType.Alert]: [
    {
      _id: RECORD_IDS.alert,
      title: "p95 latency over 2s on checkout-api",
      label: "Alert #312: p95 latency over 2s on checkout-api",
    },
  ],
  [CodeTaskContextType.Exception]: [
    {
      _id: RECORD_IDS.exception,
      message:
        "TypeError: Cannot read properties of undefined (reading 'amount')",
      label:
        "TypeError: Cannot read properties of undefined (reading 'amount')",
    },
  ],
  [CodeTaskContextType.Monitor]: [
    {
      _id: RECORD_IDS.monitor,
      name: "Checkout API",
      label: "Checkout API",
    },
  ],
};

const MODEL_RECORDS = [
  [Incident, CodeTaskContextType.Incident],
  [Alert, CodeTaskContextType.Alert],
  [TelemetryException, CodeTaskContextType.Exception],
  [Monitor, CodeTaskContextType.Monitor],
];

function asModel(ModelType, data) {
  const model = new ModelType();
  for (const [key, value] of Object.entries(data)) {
    if (key !== "label") {
      model[key] = value;
    }
  }
  return model;
}

function readRepositoryModel(id) {
  const repository = repositories.find((item) => {
    return item.id === id;
  });
  if (!repository) {
    return null;
  }
  const model = new CodeRepository();
  model._id = repository.id;
  model.projectId = new ObjectID(PROJECT_ID);
  model.name = repository.name;
  model.description = repository.description || "";
  model.organizationName = repository.organizationName;
  model.repositoryName = repository.repositoryName;
  model.repositoryHostedAt = repository.provider || CodeRepositoryType.GitHub;
  // Only a GitHub repository is connected through the GitHub App.
  model.gitHubAppInstallationId =
    repository.isConnected && isOnGitHub(repository) ? "51234567" : null;
  model.labels = [];
  for (const [key, value] of Object.entries(
    settingsByRepository[repository.id] || {},
  )) {
    if (value !== null && value !== undefined) {
      model[key] = value;
    }
  }
  return model;
}

ModelAPI.getItem = async (options) => {
  if (options.modelType === CodeRepository) {
    return readRepositoryModel(idOf(options.id));
  }
  // Whether the project uses global Runners (Project.useGlobalRunners).
  if (options.modelType === Project) {
    const project = new Project();
    project._id = PROJECT_ID;
    project.useGlobalRunners = usesGlobalRunners;
    return project;
  }
  return null;
};

ModelAPI.getList = async (options) => {
  const match = MODEL_RECORDS.find((entry) => {
    return entry[0] === options.modelType;
  });
  if (match) {
    const items = RECORDS[match[1]].map((record) => {
      return asModel(options.modelType, record);
    });
    return { data: items, count: items.length, skip: 0, limit: 10 };
  }
  if (options.modelType === Service) {
    const service = asModel(Service, {
      _id: RECORD_IDS.service,
      name: "checkout-api",
    });
    return { data: [service], count: 1, skip: 0, limit: 10 };
  }
  if (options.modelType === Label) {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }
  // The project's own Runners, for a repository's Runner picker.
  if (options.modelType === Runner) {
    return {
      data: PROJECT_RUNNERS,
      count: PROJECT_RUNNERS.length,
      skip: 0,
      limit: 10,
    };
  }
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.count = async () => 0;

ModelAPI.updateById = async (options) => {
  const data = { ...options.data };
  window.__fixture.settings.push(JSON.parse(JSON.stringify(data)));
  const id = idOf(options.id);
  const repository = repositories.find((item) => {
    return item.id === id;
  });
  if (repository) {
    if (typeof data.name === "string") {
      repository.name = data.name;
    }
    if (typeof data.description === "string") {
      repository.description = data.description;
    }
    Object.assign(settingsByRepository[id], data);
  }
  return new HTTPResponse(200, {}, {});
};

/*
 * A repository's Settings form saves through createOrUpdate, with the
 * repository as the form built it: what it holds of the settings is saved
 * as updateById saves it (recorded on window.__fixture.settings), the
 * Runner it picks as its id, or null for a global Runner.
 */
const SETTING_KEYS = [
  "name",
  "description",
  "mainBranchName",
  "maxOpenFixPullRequests",
  "isGitHubCommandsEnabled",
  "gitHubTriggerLabel",
  "setupCommand",
  "buildCommand",
  "testCommand",
  "runnerId",
  "isProductionReviewEnabled",
  "productionReviewPullRequestContent",
];

ModelAPI.createOrUpdate = async (options) => {
  if (options.modelType !== CodeRepository) {
    return refused(404, "The fixture does not model this save.");
  }
  const model = options.model;
  const data = {};
  for (const key of SETTING_KEYS) {
    const value = model[key];
    if (value === undefined) {
      continue;
    }
    data[key] =
      value !== null && typeof value === "object" ? value.toString() : value;
  }
  return await ModelAPI.updateById({
    modelType: CodeRepository,
    id: model._id,
    data,
  });
};

ModelAPI.deleteItem = async (options) => {
  window.__fixture.deletes.push(idOf(options.id));
  const index = repositories.findIndex((item) => {
    return item.id === idOf(options.id);
  });
  if (index >= 0) {
    repositories.splice(index, 1);
  }
};

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

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
    ja: { translation: JA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

/*
 * What App.tsx does around every route group: the Dashboard's navigation
 * reads the router through these, and the page props every group passes on.
 */
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Group = props.group;
  return (
    <main className="mx-auto max-w-[1440px] px-3 py-6 sm:px-6">
      <Group
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

// Where a link out of Code lands: a record's page, Settings, Runners.
function Elsewhere() {
  const location = useLocation();
  return (
    <div
      className="m-6 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500"
      data-testid="fixture-elsewhere"
    >
      {location.pathname}
    </div>
  );
}

if (window.location.pathname === "/" || window.location.pathname === "") {
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/code${window.location.search}`,
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/code/*"
        element={<Shell group={CodeRoutes} />}
      />
      <PageRoute
        path="/dashboard/:projectId/ai/agents/*"
        element={<Shell group={MovedTaskRoutes} />}
      />
      <PageRoute
        path="/dashboard/:projectId/code-repository/*"
        element={<Shell group={MovedRepositoryRoutes} />}
      />
      <PageRoute path="*" element={<Elsewhere />} />
    </Routes>
  </BrowserRouter>,
);
