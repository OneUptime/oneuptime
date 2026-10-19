import AIAgentCodeTaskAPI from "../../../Server/API/AIAgentCodeTaskAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeTaskAgentBrief from "../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskGate from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import { CodeTaskAgentDetails } from "../../../Types/AI/CodeTask";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a Runner is told when it takes a request from Code. The Runner names
 * only the run; the repository, the branch and the text all come from the
 * run's own record, and a run of another project - or of no request - reads
 * exactly like no run at all, so a key cannot probe for them. A repository
 * whose GitHub installation was unbound while the turn waited is refused.
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
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = "/ai-agent-data/get-code-task-details";

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const RUN_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");

let agentProjectId: ObjectID | undefined;
let storedRun: AIRun | null;
let storedRepository: CodeRepository | null;
let reachable: boolean;

function run(): AIRun {
  const value: AIRun = new AIRun();
  value._id = RUN_ID.toString();
  value.projectId = PROJECT_ID;
  value.runType = AIRunType.CodeFix;
  value.codeFixTaskType = CodeFixTaskType.CodeRequest;
  value.codeRepositoryId = REPOSITORY_ID;
  value.taskContext = { request: { message: "Add retries", context: [] } };
  return value;
}

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = PROJECT_ID;
  value.name = "users-api";
  return value;
}

async function ask(body: JSONObject): Promise<{
  error: Error | undefined;
  details: JSONObject | undefined;
}> {
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(
      { body } as ExpressRequest,
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
    details: answers.length > 0 ? (answers[0]![2] as JSONObject) : undefined,
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentCodeTaskAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  agentProjectId = PROJECT_ID;
  storedRun = run();
  storedRepository = repository();
  reachable = true;

  jest
    .spyOn(CodeFixAgentAuth, "resolveAgentIdentity")
    .mockImplementation(async (data: JSONObject) => {
      if (data["aiAgentKey"] !== "the-key") {
        return null;
      }
      return {
        id: ObjectID.generate(),
        projectId: agentProjectId,
        source: CodeFixAgentSource.AIAgent,
      };
    });
  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    return storedRun;
  });
  jest
    .spyOn(CodeRepositoryService, "findOneById")
    .mockImplementation(async () => {
      return storedRepository;
    });
  jest
    .spyOn(CodeTaskGate, "isRepositoryReachable")
    .mockImplementation(async () => {
      return reachable;
    });
  jest
    .spyOn(CodeTaskAgentBrief, "build")
    .mockResolvedValue({
      taskId: RUN_ID.toString(),
    } as unknown as CodeTaskAgentDetails);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const BODY: JSONObject = {
  aiAgentId: "agent",
  aiAgentKey: "the-key",
  taskId: RUN_ID.toString(),
};

describe("POST /ai-agent-data/get-code-task-details", () => {
  test("a Runner of the project gets the turn's brief, built from the run's own record", async () => {
    const { error, details } = await ask(BODY);

    expect(error).toBeUndefined();
    expect(details).toEqual({ taskId: RUN_ID.toString() });

    const built: { run: AIRun; repository: CodeRepository } = (
      CodeTaskAgentBrief.build as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect(built.run.id?.toString()).toBe(RUN_ID.toString());
    expect(built.repository.id?.toString()).toBe(REPOSITORY_ID.toString());
  });

  test("a shared Runner (no project of its own) gets it too", async () => {
    agentProjectId = undefined;

    expect((await ask(BODY)).details).toBeDefined();
  });

  test("a bad key is refused", async () => {
    const { error } = await ask({ ...BODY, aiAgentKey: "wrong" });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe("Invalid AI Agent ID or AI Agent Key");
    expect(AIRunService.findOneById).not.toHaveBeenCalled();
  });

  test("another project's run reads exactly like no run", async () => {
    agentProjectId = OTHER_PROJECT_ID;
    const otherProject: { error: Error | undefined } = await ask(BODY);

    agentProjectId = PROJECT_ID;
    storedRun = null;
    jest.clearAllMocks();
    const missing: { error: Error | undefined } = await ask(BODY);

    expect(otherProject.error?.message).toBe("Task not found");
    expect(missing.error?.message).toBe("Task not found");
    expect(CodeTaskAgentBrief.build).not.toHaveBeenCalled();
  });

  test("a run that is not a request from Code has no brief", async () => {
    storedRun!.codeFixTaskType = CodeFixTaskType.FixException;

    expect((await ask(BODY)).error?.message).toBe(
      "This task is not a request from Code.",
    );

    storedRun = run();
    storedRun.taskContext = {};
    jest.clearAllMocks();

    expect((await ask(BODY)).error?.message).toBe(
      "This task is not a request from Code.",
    );
  });

  test("a chat run, or a malformed id, is no task", async () => {
    storedRun!.runType = AIRunType.Chat;

    expect((await ask(BODY)).error?.message).toBe("Task not found");

    jest.clearAllMocks();

    expect((await ask({ ...BODY, taskId: "../../etc" })).error?.message).toBe(
      "Task not found",
    );
    expect((await ask({ ...BODY, taskId: "" })).error).toBeDefined();
  });

  test("a repository that is gone, or now in another project, is refused", async () => {
    storedRepository = null;

    expect((await ask(BODY)).error?.message).toContain(
      "no longer connected to the project",
    );

    storedRepository = repository();
    storedRepository.projectId = OTHER_PROJECT_ID;
    jest.clearAllMocks();

    expect((await ask(BODY)).error?.message).toContain(
      "no longer connected to the project",
    );
    expect(CodeTaskAgentBrief.build).not.toHaveBeenCalled();
  });

  test("a repository whose GitHub installation was unbound while it waited is refused", async () => {
    reachable = false;

    const { error } = await ask(BODY);

    expect(error?.message).toContain(
      "GitHub App installation is no longer connected",
    );
    expect(CodeTaskAgentBrief.build).not.toHaveBeenCalled();
  });
});
