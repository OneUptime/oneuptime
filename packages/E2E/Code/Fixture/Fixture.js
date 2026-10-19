/*
 * Offline fixture for Code: the project's repositories (Pages/Code/Code), a
 * repository's page where AI is asked (Pages/Code/Repository/Tasks), its
 * settings, a task's conversation (Pages/Code/Task/Conversation) and its Log
 * - the production route group (Routes/CodeRoutes) with its layouts, side
 * menus and breadcrumbs, and the old Tasks and Code Repositories addresses
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
 *                       search box shows
 *   - other=1           tasks that have no repository (Other tasks)
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
 *   - fail=repositories|repository|list|task  that read fails
 *   - delay=<ms>        how long each request takes
 *   - lang=de|ja        the Dashboard's German or Japanese words
 *   - theme=dark        dark mode (server.js)
 *
 * What the pages send is recorded on window.__fixture: `creates`,
 * `replies`, `retries`, `stops`, `settings` (each repository update),
 * `deletes` and `navigations` (addresses outside the Dashboard, such as
 * GitHub's), so the spec checks what was sent, not only what was drawn.
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
};

const TASK_IDS = {
  retries: "40000000-0000-4000-8000-0000000000d1",
  question: "40000000-0000-4000-8000-0000000000d2",
  exception: "40000000-0000-4000-8000-0000000000d3",
  failed: "40000000-0000-4000-8000-0000000000d4",
  stopped: "40000000-0000-4000-8000-0000000000d5",
  working: "40000000-0000-4000-8000-0000000000d6",
  orphan: "40000000-0000-4000-8000-0000000000d7",
};

const RECORD_IDS = {
  incident: "50000000-0000-4000-8000-0000000000e1",
  alert: "50000000-0000-4000-8000-0000000000e2",
  exception: "50000000-0000-4000-8000-0000000000e3",
  monitor: "50000000-0000-4000-8000-0000000000e4",
  service: "50000000-0000-4000-8000-0000000000e5",
};

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const reposParam = params.get("repos") || "some";
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

const repositories =
  reposParam === "none"
    ? []
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

const settingsByRepository = {};
for (const repository of repositories) {
  settingsByRepository[repository.id] = {
    mainBranchName: repository.mainBranchName,
    maxOpenFixPullRequests: null,
    isGitHubCommandsEnabled: true,
    gitHubTriggerLabel: null,
    setupCommand: "npm ci",
    buildCommand: "npm run build",
    testCommand: "npm test",
  };
}

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
    !task.repositoryId ||
    repositories.some((repository) => {
      return repository.id === task.repositoryId;
    })
  );
});

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
    "No Runner with Runs AI Code Fixes is online. Turn it on for a Runner in Runbooks > Runners.",
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
    return { type: blockerParam, message: BLOCKER_MESSAGES[blockerParam] };
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
  return summary;
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
  const own = tasks.filter((task) => {
    return task.repositoryId === repositoryId;
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
          return { ...repository, stats: statsOf(repository.id) };
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
        repository,
        stats: statsOf(repository.id),
        canAsk: CAN_ASK,
        blocker: blockerFor(repository),
      },
      {},
    );
  }

  if (path === "/list") {
    window.__fixture.reads.list++;
    if (failParam === "list") {
      return refused(500, "The tasks could not be read right now.");
    }
    const own = tasks.filter((task) => {
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
        repository,
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
    const firstTurn = newRequestTurn({
      message: body.message,
      context: contextItemsOf(body.context),
    });
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
    const again = newRequestTurn(latest.request);
    task.turns.push(again);
    return new HTTPResponse(200, { taskId: task.id, runId: again.runId }, {});
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

API.post = async (options) => {
  const url = options.url.toString();
  if (delay) {
    await wait(delay);
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
  model.repositoryHostedAt = CodeRepositoryType.GitHub;
  model.gitHubAppInstallationId = repository.isConnected ? "51234567" : null;
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
