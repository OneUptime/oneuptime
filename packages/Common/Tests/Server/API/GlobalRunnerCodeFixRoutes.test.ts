import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import AIAgentTaskLogAPI from "../../../Server/API/AIAgentTaskLogAPI";
import AIAgentGitHubAPI from "../../../Server/API/AIAgentGitHubAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import ExceptionFixStartedBy from "../../../Server/Utils/AI/CodeFix/ExceptionFixStartedBy";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeFixAgentCompletion from "../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
import CodeFixPullRequestRecord from "../../../Server/Utils/AI/CodeFix/CodeFixPullRequestRecord";
import CodeRepositoryRunnerChoice from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import OpenPullRequestCap from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubConversation from "../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import GitHubCommandType from "../../../Types/CodeRepository/GitHubCommand";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CODE_AGENT_COMMAND_TOOL_NAME } from "../../../Types/Runner/GlobalRunnerWork";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * EVERY CODE-FIX ROUTE HOLDS A GLOBAL RUNNER TO THE RUN IT CLAIMED.
 *
 * Global Runners now take OneUptime AI's code fixes, so a global Runner's key
 * - held on a host that also runs every project's JavaScript steps, or on
 * one a master admin started - authenticates on the code-fix protocol. A
 * global identity has no project, and every route's project check let it
 * through, so the key reached every project's runs at will: report any run's
 * outcome into its project's Code thread, plant log lines in its trail,
 * spend its LLM budget, read its exception's stack trace and its
 * repositories' commands, or be handed a token that pushes to any repository
 * on the Global Runner without holding a run there.
 *
 * Route by route, a global Runner is now:
 *   - served the work only for the run it claimed while it still holds it
 *     (Running): the run's details, its exception, its repositories, an LLM
 *     completion, a repository token, a GitHub review;
 *   - heard reporting only on a run it claimed: its status, its log lines,
 *     the pull requests it opened;
 *   - never handed a repository's own commands, nor offered the command
 *     tool for its model;
 * and refused everything else exactly like a missing run. A project's own
 * Runner keeps its project scope, as before.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "1c2d3e4f-1111-4a5b-8c6d-7e8f9a0b1c2d",
);
const RUN_ID: ObjectID = new ObjectID("1c2d3e4f-2222-4a5b-8c6d-7e8f9a0b1c2d");
const REPOSITORY_ID: ObjectID = new ObjectID(
  "1c2d3e4f-3333-4a5b-8c6d-7e8f9a0b1c2d",
);
const EXCEPTION_ID: ObjectID = new ObjectID(
  "1c2d3e4f-4444-4a5b-8c6d-7e8f9a0b1c2d",
);
const OTHER_EXCEPTION_ID: ObjectID = new ObjectID(
  "1c2d3e4f-5555-4a5b-8c6d-7e8f9a0b1c2d",
);
const WORKER_ID: ObjectID = new ObjectID(
  "1c2d3e4f-6666-4a5b-8c6d-7e8f9a0b1c2d",
);
const OTHER_WORKER_ID: ObjectID = new ObjectID(
  "1c2d3e4f-7777-4a5b-8c6d-7e8f9a0b1c2d",
);

const GLOBAL_RUNNER: CodeFixAgentIdentity = {
  id: WORKER_ID,
  source: CodeFixAgentSource.Runner,
};

const PROJECT_RUNNER: CodeFixAgentIdentity = {
  id: WORKER_ID,
  projectId: PROJECT_ID,
  source: CodeFixAgentSource.Runner,
};

let identity: CodeFixAgentIdentity;
let storedRun: AIRun | null;

/*
 * How the run is held: by whom (its aiAgentId) and in what state. Every
 * route is asked with each.
 */
interface RunHold {
  name: string;
  claimedBy: ObjectID | undefined;
  status: AIRunStatus;
}

const HELD_BY_IT: RunHold = {
  name: "the run it claimed and still holds",
  claimedBy: WORKER_ID,
  status: AIRunStatus.Running,
};

const HELD_BY_ANOTHER: RunHold = {
  name: "the run another worker holds",
  claimedBy: OTHER_WORKER_ID,
  status: AIRunStatus.Running,
};

const WAITING: RunHold = {
  name: "a run nobody claimed yet",
  claimedBy: undefined,
  status: AIRunStatus.Queued,
};

const ENDED_ITS_OWN: RunHold = {
  name: "the run it claimed, which has ended",
  claimedBy: WORKER_ID,
  status: AIRunStatus.Completed,
};

function makeRun(data: {
  hold: RunHold;
  taskType: CodeFixTaskType;
  extra?: (run: AIRun) => void;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = data.taskType;
  run.status = data.hold.status;

  if (data.hold.claimedBy) {
    run.aiAgentId = data.hold.claimedBy;
  }

  data.extra?.(run);

  return run;
}

interface Answer {
  error: Error | undefined;
  json: JSONObject | undefined;
  emptySuccess: boolean;
}

async function call(uri: string, body: JSONObject): Promise<Answer> {
  const next: jest.Mock = jest.fn();

  await mockRouter.match("post", uri).handlerFunction(
    {
      body: { aiAgentId: WORKER_ID.toString(), aiAgentKey: "a-key", ...body },
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  expect(next).not.toHaveBeenCalled();

  const errors: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;
  const answers: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    error: errors.length > 0 ? (errors[0]![2] as Error) : undefined,
    json: answers.length > 0 ? (answers[0]![2] as JSONObject) : undefined,
    emptySuccess:
      (Response.sendEmptySuccessResponse as unknown as jest.Mock).mock.calls
        .length > 0,
  };
}

function githubRepository(): CodeRepository {
  const repository: CodeRepository = new CodeRepository();
  repository._id = REPOSITORY_ID.toString();
  repository.projectId = PROJECT_ID;
  repository.name = "users-api";
  repository.repositoryHostedAt = CodeRepositoryType.GitHub;
  repository.organizationName = "acme";
  repository.repositoryName = "users-api";
  repository.mainBranchName = "main";
  repository.gitHubAppInstallationId = "4242";
  repository.setupCommand = "npm ci";
  repository.buildCommand = "npm run build";
  repository.testCommand = "npm test";
  return repository;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentDataAPI();
  new AIAgentTaskAPI();
  new AIAgentTaskLogAPI();
  new AIAgentGitHubAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  identity = GLOBAL_RUNNER;
  storedRun = null;

  jest.spyOn(CodeFixAgentAuth, "checkCredential").mockImplementation(
    async () => {
      return credentialCheckProving(identity);
    },
  );

  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    return storedRun;
  });
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-agent-task/update-task-status (a report)", () => {
  const ROUTE: string = "/ai-agent-task/update-task-status";

  async function reportProgress(): Promise<Answer> {
    return await call(ROUTE, {
      taskId: RUN_ID.toString(),
      status: AIAgentTaskStatus.InProgress,
    });
  }

  test.each([HELD_BY_IT, ENDED_ITS_OWN])(
    "a global Runner reports on $name",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await reportProgress();

      expect(answer.error).toBeUndefined();
    },
  );

  test.each([HELD_BY_ANOTHER, WAITING])(
    "a global Runner is refused a report on $name, exactly as no run",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await reportProgress();

      expect(answer.error?.message).toBe("Task not found");
      expect(AIRunService.updateOneBy).not.toHaveBeenCalled();
    },
  );

  test("a project's own Runner reports on its project's run, whoever claimed it", async () => {
    identity = PROJECT_RUNNER;
    storedRun = makeRun({
      hold: HELD_BY_ANOTHER,
      taskType: CodeFixTaskType.FixException,
    });

    expect((await reportProgress()).error).toBeUndefined();
  });
});

describe("POST /ai-agent-task-log/create-log (a report)", () => {
  const ROUTE: string = "/ai-agent-task-log/create-log";

  beforeEach(() => {
    jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);
  });

  async function log(): Promise<Answer> {
    return await call(ROUTE, {
      taskId: RUN_ID.toString(),
      severity: "Information",
      message: "Cloning the repository",
    });
  }

  test("a global Runner logs to the run it claimed", async () => {
    storedRun = makeRun({
      hold: HELD_BY_IT,
      taskType: CodeFixTaskType.FixException,
    });

    const answer: Answer = await log();

    expect(answer.error).toBeUndefined();
    expect(AIRunEventService.appendEventToRun).toHaveBeenCalledTimes(1);
  });

  test.each([HELD_BY_ANOTHER, WAITING])(
    "a global Runner plants no line in $name",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await log();

      expect(answer.error?.message).toBe("Task not found");
      expect(AIRunEventService.appendEventToRun).not.toHaveBeenCalled();
    },
  );
});

describe("POST /ai-agent-data/record-pull-request (a report)", () => {
  const ROUTE: string = "/ai-agent-data/record-pull-request";

  beforeEach(() => {
    jest.spyOn(CodeFixPullRequestRecord, "record").mockResolvedValue({
      created: true,
      pullRequest: { _id: "1c2d3e4f-8888-4a5b-8c6d-7e8f9a0b1c2d" },
    } as never);
  });

  async function record(): Promise<Answer> {
    return await call(ROUTE, {
      taskId: RUN_ID.toString(),
      codeRepositoryId: REPOSITORY_ID.toString(),
      pullRequestUrl: "https://github.com/acme/users-api/pull/7",
      pullRequestNumber: 7,
      title: "Fix the null check",
    });
  }

  test.each([HELD_BY_IT, ENDED_ITS_OWN])(
    "a global Runner records a pull request of $name",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await record();

      expect(answer.error).toBeUndefined();
      expect(CodeFixPullRequestRecord.record).toHaveBeenCalledTimes(1);
    },
  );

  test.each([HELD_BY_ANOTHER, WAITING])(
    "a global Runner records nothing on $name",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await record();

      expect(answer.error?.message).toBe("Task not found");
      expect(CodeFixPullRequestRecord.record).not.toHaveBeenCalled();
    },
  );
});

describe("POST /ai-agent-data/llm-completion (work)", () => {
  const ROUTE: string = "/ai-agent-data/llm-completion";

  const TOOLS: Array<JSONObject> = [
    "read_file",
    "write_file",
    CODE_AGENT_COMMAND_TOOL_NAME,
    "search_files",
  ].map((name: string): JSONObject => {
    return {
      name,
      description: `${name} tool`,
      inputSchema: { type: "object", properties: {} },
    };
  });

  beforeEach(() => {
    jest.spyOn(CodeFixAgentCompletion, "execute").mockResolvedValue({
      content: "Done",
      toolCalls: [],
      stopReason: "stop",
      budget: {},
    } as never);
  });

  async function complete(): Promise<Answer> {
    return await call(ROUTE, {
      taskId: RUN_ID.toString(),
      messages: [{ role: "user", content: "Fix the null check." }],
      tools: TOOLS,
    });
  }

  function offeredToolNames(): Array<string> {
    const request: { tools?: Array<{ name: string }> } = (
      CodeFixAgentCompletion.execute as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    return (request.tools || []).map((tool: { name: string }): string => {
      return tool.name;
    });
  }

  test("a global Runner's model is never offered the command tool, on the run it holds", async () => {
    storedRun = makeRun({
      hold: HELD_BY_IT,
      taskType: CodeFixTaskType.FixException,
    });

    const answer: Answer = await complete();

    expect(answer.error).toBeUndefined();
    expect(offeredToolNames()).toEqual([
      "read_file",
      "write_file",
      "search_files",
    ]);
  });

  test("a project's own Runner's model is offered every tool it sent, the command tool included", async () => {
    identity = PROJECT_RUNNER;
    storedRun = makeRun({
      hold: HELD_BY_IT,
      taskType: CodeFixTaskType.FixException,
    });

    await complete();

    expect(offeredToolNames()).toEqual([
      "read_file",
      "write_file",
      CODE_AGENT_COMMAND_TOOL_NAME,
      "search_files",
    ]);
  });

  test.each([HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN])(
    "a global Runner spends nothing of $name",
    async (hold: RunHold) => {
      storedRun = makeRun({ hold, taskType: CodeFixTaskType.FixException });

      const answer: Answer = await complete();

      expect(answer.error?.message).toBe("Task not found");
      expect(CodeFixAgentCompletion.execute).not.toHaveBeenCalled();
    },
  );
});

describe("POST /ai-agent-data/get-exception-details and get-code-repositories (work)", () => {
  function exception(): TelemetryException {
    const value: TelemetryException = new TelemetryException();
    value._id = EXCEPTION_ID.toString();
    value.projectId = PROJECT_ID;
    value.message = "TypeError: cannot read properties of null";
    value.stackTrace = "at handler (src/users.ts:12:5)";
    value.exceptionType = "TypeError";
    return value;
  }

  beforeEach(() => {
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(exception() as never);
    jest.spyOn(ExceptionFixStartedBy, "read").mockResolvedValue(null);
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: REPOSITORY_ID.toString(),
        organizationName: "acme",
        repositoryName: "users-api",
        servicePathInRepository: "",
        method: "stack-trace",
        evidence: "src/users.ts",
      } as never);
    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(githubRepository() as never);
  });

  function exceptionRun(hold: RunHold, exceptionId: ObjectID): AIRun {
    return makeRun({
      hold,
      taskType: CodeFixTaskType.FixException,
      extra: (run: AIRun): void => {
        run.triggeredByTelemetryExceptionId = exceptionId;
      },
    });
  }

  for (const route of [
    "/ai-agent-data/get-exception-details",
    "/ai-agent-data/get-code-repositories",
  ]) {
    describe(route, () => {
      test("a global Runner reads the exception of the run it holds", async () => {
        storedRun = exceptionRun(HELD_BY_IT, EXCEPTION_ID);

        const answer: Answer = await call(route, {
          exceptionId: EXCEPTION_ID.toString(),
          taskId: RUN_ID.toString(),
        });

        expect(answer.error).toBeUndefined();
        expect(answer.json).toBeDefined();
      });

      test("a global Runner that names no run, or a malformed one, reads nothing", async () => {
        storedRun = exceptionRun(HELD_BY_IT, EXCEPTION_ID);

        for (const taskId of [undefined, "", "not-a-uuid", 42]) {
          jest.clearAllMocks();

          const answer: Answer = await call(route, {
            exceptionId: EXCEPTION_ID.toString(),
            ...(taskId === undefined ? {} : { taskId: taskId as never }),
          });

          expect(answer.error?.message).toBe("Exception not found");
          expect(answer.json).toBeUndefined();
        }
      });

      test("a global Runner reads no exception but its run's own: the run must be about this exception", async () => {
        storedRun = exceptionRun(HELD_BY_IT, OTHER_EXCEPTION_ID);

        const answer: Answer = await call(route, {
          exceptionId: EXCEPTION_ID.toString(),
          taskId: RUN_ID.toString(),
        });

        expect(answer.error?.message).toBe("Exception not found");
      });

      test.each([HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN])(
        "a global Runner reads nothing for $name",
        async (hold: RunHold) => {
          storedRun = exceptionRun(hold, EXCEPTION_ID);

          const answer: Answer = await call(route, {
            exceptionId: EXCEPTION_ID.toString(),
            taskId: RUN_ID.toString(),
          });

          expect(answer.error?.message).toBe("Exception not found");
          expect(answer.json).toBeUndefined();
        },
      );

      test("a project's own Runner reads its project's exception, naming a run or not, as before", async () => {
        identity = PROJECT_RUNNER;

        const answer: Answer = await call(route, {
          exceptionId: EXCEPTION_ID.toString(),
        });

        expect(answer.error).toBeUndefined();
        expect(answer.json).toBeDefined();
      });
    });
  }

  test("get-code-repositories hands a global Runner the repository without its commands, and a project's Runner with them", async () => {
    storedRun = exceptionRun(HELD_BY_IT, EXCEPTION_ID);

    const global: Answer = await call("/ai-agent-data/get-code-repositories", {
      exceptionId: EXCEPTION_ID.toString(),
      taskId: RUN_ID.toString(),
    });

    const globalRepository: JSONObject = (
      global.json!["repositories"] as Array<JSONObject>
    )[0]!;

    expect(globalRepository["repositoryName"]).toBe("users-api");
    expect(globalRepository["setupCommand"]).toBeNull();
    expect(globalRepository["buildCommand"]).toBeNull();
    expect(globalRepository["testCommand"]).toBeNull();

    jest.clearAllMocks();
    identity = PROJECT_RUNNER;

    const own: Answer = await call("/ai-agent-data/get-code-repositories", {
      exceptionId: EXCEPTION_ID.toString(),
    });

    const ownRepository: JSONObject = (
      own.json!["repositories"] as Array<JSONObject>
    )[0]!;

    expect(ownRepository["setupCommand"]).toBe("npm ci");
    expect(ownRepository["buildCommand"]).toBe("npm run build");
    expect(ownRepository["testCommand"]).toBe("npm test");
  });
});

describe("POST /ai-agent-data/get-instrumentation-task-details (work)", () => {
  const ROUTE: string = "/ai-agent-data/get-instrumentation-task-details";

  function loggingRun(hold: RunHold): AIRun {
    return makeRun({
      hold,
      taskType: CodeFixTaskType.ImproveLogging,
      extra: (run: AIRun): void => {
        run.taskContext = {
          telemetryServiceId: "1c2d3e4f-9999-4a5b-8c6d-7e8f9a0b1c2d",
          serviceName: "users-api",
        };
      },
    });
  }

  beforeEach(() => {
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: REPOSITORY_ID.toString(),
        organizationName: "acme",
        repositoryName: "users-api",
        servicePathInRepository: "",
        method: "name-match",
        evidence: "users-api",
      } as never);
    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(githubRepository() as never);
  });

  test("a global Runner gets the run it holds, its repository without commands", async () => {
    storedRun = loggingRun(HELD_BY_IT);

    const answer: Answer = await call(ROUTE, { taskId: RUN_ID.toString() });

    expect(answer.error).toBeUndefined();

    const repository: JSONObject = (
      answer.json!["repositories"] as Array<JSONObject>
    )[0]!;

    expect(repository["repositoryName"]).toBe("users-api");
    expect(repository["setupCommand"]).toBeNull();
    expect(repository["buildCommand"]).toBeNull();
    expect(repository["testCommand"]).toBeNull();
  });

  test("a project's own Runner gets the repository with its commands", async () => {
    identity = PROJECT_RUNNER;
    storedRun = loggingRun(HELD_BY_ANOTHER);

    const answer: Answer = await call(ROUTE, { taskId: RUN_ID.toString() });

    const repository: JSONObject = (
      answer.json!["repositories"] as Array<JSONObject>
    )[0]!;

    expect(repository["setupCommand"]).toBe("npm ci");
    expect(repository["testCommand"]).toBe("npm test");
  });

  test.each([HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN])(
    "a global Runner gets nothing of $name",
    async (hold: RunHold) => {
      storedRun = loggingRun(hold);

      const answer: Answer = await call(ROUTE, { taskId: RUN_ID.toString() });

      expect(answer.error?.message).toBe("Task not found");
      expect(answer.json).toBeUndefined();
      expect(
        CodeRepositoryService.resolveRepositoryForException,
      ).not.toHaveBeenCalled();
    },
  );
});

describe("POST /ai-agent-data/get-repository-token (work)", () => {
  const ROUTE: string = "/ai-agent-data/get-repository-token";

  let mintSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(githubRepository() as never);
    jest
      .spyOn(CodeRepositoryRunnerChoice, "mayWorkInRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);
    jest
      .spyOn(OpenPullRequestCap, "checkForRepository")
      .mockResolvedValue({ allowed: true } as never);

    mintSpy = jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({
        token: "ghs_minted_for_one_repository",
        expiresAt: OneUptimeDate.getCurrentDate(),
      });
  });

  function fixRun(hold: RunHold): AIRun {
    return makeRun({
      hold,
      taskType: CodeFixTaskType.FixException,
      extra: (run: AIRun): void => {
        run.codeRepositoryId = REPOSITORY_ID;
      },
    });
  }

  test("a global Runner is handed a token for a repository of the run it holds, minted for that one repository", async () => {
    storedRun = fixRun(HELD_BY_IT);

    const answer: Answer = await call(ROUTE, {
      codeRepositoryId: REPOSITORY_ID.toString(),
      taskId: RUN_ID.toString(),
    });

    expect(answer.error).toBeUndefined();
    expect(answer.json?.["token"]).toBe("ghs_minted_for_one_repository");
    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(mintSpy.mock.calls[0]![0]).toBe("4242");
    expect(mintSpy.mock.calls[0]![1]).toEqual({
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
      repositories: ["users-api"],
    });
  });

  test("a global Runner that names no run is handed no token, exactly as for a missing repository", async () => {
    storedRun = fixRun(HELD_BY_IT);

    const answer: Answer = await call(ROUTE, {
      codeRepositoryId: REPOSITORY_ID.toString(),
    });

    expect(answer.error?.message).toBe("Code repository not found");
    expect(mintSpy).not.toHaveBeenCalled();
  });

  test.each([HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN])(
    "a global Runner is handed no token for $name",
    async (hold: RunHold) => {
      storedRun = fixRun(hold);

      const answer: Answer = await call(ROUTE, {
        codeRepositoryId: REPOSITORY_ID.toString(),
        taskId: RUN_ID.toString(),
      });

      expect(answer.error?.message).toBe("Code repository not found");
      expect(mintSpy).not.toHaveBeenCalled();
    },
  );

  test("a global Runner is handed no token for a run of another project than the repository's", async () => {
    storedRun = fixRun(HELD_BY_IT);
    storedRun.projectId = new ObjectID("1c2d3e4f-aaaa-4a5b-8c6d-7e8f9a0b1c2d");

    const answer: Answer = await call(ROUTE, {
      codeRepositoryId: REPOSITORY_ID.toString(),
      taskId: RUN_ID.toString(),
    });

    expect(answer.error?.message).toBe("Code repository not found");
    expect(mintSpy).not.toHaveBeenCalled();
  });

  test("a project's own Runner that names no run (an older Runner) is still handed its repository's token, scoped to it", async () => {
    identity = PROJECT_RUNNER;

    const answer: Answer = await call(ROUTE, {
      codeRepositoryId: REPOSITORY_ID.toString(),
    });

    expect(answer.error).toBeUndefined();
    expect(answer.json?.["token"]).toBe("ghs_minted_for_one_repository");
    expect(mintSpy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ repositories: ["users-api"] }),
    );
  });
});

describe("the GitHub routes (work)", () => {
  function githubRun(hold: RunHold, taskType: CodeFixTaskType): AIRun {
    return makeRun({
      hold,
      taskType,
      extra: (run: AIRun): void => {
        run.taskContext = {
          github: {
            codeRepositoryId: REPOSITORY_ID.toString(),
            installationId: "4242",
            organizationName: "acme",
            repositoryName: "users-api",
            commandType:
              taskType === CodeFixTaskType.GitHubPullRequestReview
                ? GitHubCommandType.Review
                : GitHubCommandType.Implement,
            instruction: "Please look at this",
            ...(taskType === CodeFixTaskType.GitHubIssueFix
              ? { issueNumber: 12 }
              : { pullRequestNumber: 12 }),
          },
        };
      },
    });
  }

  beforeEach(() => {
    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(githubRepository() as never);
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);
    jest.spyOn(GitHubConversation, "getIssue").mockResolvedValue({
      issueNumber: 12,
      title: "Null check",
      body: "It crashes",
      htmlUrl: "https://github.com/acme/users-api/issues/12",
      labels: [],
      authorLogin: "someone",
    } as never);
    jest
      .spyOn(GitHubConversation, "listIssueComments")
      .mockResolvedValue([] as never);
    jest
      .spyOn(GitHubConversation, "createPullRequestReview")
      .mockResolvedValue(
        "https://github.com/acme/users-api/pull/12#review" as never,
      );
  });

  test("get-github-task-details serves a global Runner the run it holds, the repository without its commands", async () => {
    storedRun = githubRun(HELD_BY_IT, CodeFixTaskType.GitHubIssueFix);

    const answer: Answer = await call("/ai-agent-data/get-github-task-details", {
      taskId: RUN_ID.toString(),
    });

    expect(answer.error).toBeUndefined();

    const repository: JSONObject = answer.json!["repository"] as JSONObject;

    expect(repository["repositoryName"]).toBe("users-api");
    expect(repository["setupCommand"]).toBeNull();
    expect(repository["buildCommand"]).toBeNull();
    expect(repository["testCommand"]).toBeNull();
  });

  test("get-github-task-details serves a project's own Runner the repository with its commands", async () => {
    identity = PROJECT_RUNNER;
    storedRun = githubRun(HELD_BY_ANOTHER, CodeFixTaskType.GitHubIssueFix);

    const answer: Answer = await call("/ai-agent-data/get-github-task-details", {
      taskId: RUN_ID.toString(),
    });

    const repository: JSONObject = answer.json!["repository"] as JSONObject;

    expect(repository["setupCommand"]).toBe("npm ci");
    expect(repository["buildCommand"]).toBe("npm run build");
    expect(repository["testCommand"]).toBe("npm test");
  });

  test.each([HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN])(
    "get-github-task-details serves a global Runner nothing of $name",
    async (hold: RunHold) => {
      storedRun = githubRun(hold, CodeFixTaskType.GitHubIssueFix);

      const answer: Answer = await call(
        "/ai-agent-data/get-github-task-details",
        { taskId: RUN_ID.toString() },
      );

      expect(answer.error?.message).toBe("Task not found");
      expect(GitHubConversation.getIssue).not.toHaveBeenCalled();
    },
  );

  test("post-github-review posts a global Runner's review only on the run it holds", async () => {
    storedRun = githubRun(HELD_BY_IT, CodeFixTaskType.GitHubPullRequestReview);

    const posted: Answer = await call("/ai-agent-data/post-github-review", {
      taskId: RUN_ID.toString(),
      body: "Looks right to me.",
    });

    expect(posted.error).toBeUndefined();
    expect(GitHubConversation.createPullRequestReview).toHaveBeenCalledTimes(1);

    for (const hold of [HELD_BY_ANOTHER, WAITING, ENDED_ITS_OWN]) {
      jest.clearAllMocks();
      storedRun = githubRun(hold, CodeFixTaskType.GitHubPullRequestReview);

      const refused: Answer = await call("/ai-agent-data/post-github-review", {
        taskId: RUN_ID.toString(),
        body: "Looks right to me.",
      });

      expect(refused.error?.message).toBe("Task not found");
      expect(GitHubConversation.createPullRequestReview).not.toHaveBeenCalled();
    }
  });
});
