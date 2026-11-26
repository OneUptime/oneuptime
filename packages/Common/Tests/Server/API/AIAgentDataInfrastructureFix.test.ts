import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskContext, {
  InfrastructureFixTaskContext,
  getInfrastructureFixFolder,
  getInfrastructureFixTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

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
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    redirect: jest.fn(),
  };
});

/*
 * THE TASK DETAILS OF A GROUP'S ONE PULL REQUEST (FixInfrastructureCode,
 * #10370): the Runner is handed the request Data Security's builder wrote,
 * the cause and the stores it fixes - captured when it was asked - and the
 * repository a person confirmed, starting in the folder of the files that
 * declare the stores. Never a repository resolved now, and nothing to work
 * from without its context.
 */

const DETAILS_ROUTE: string = "/ai-agent-data/get-instrumentation-task-details";

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return sendJson.mock.calls[0]?.[2] as JSONObject | undefined;
}

function thrownError(): Error | undefined {
  const sendError: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  return sendError.mock.calls[0]?.[2] as Error | undefined;
}

const FIX: InfrastructureFixTaskContext = {
  groupId: "10370000-0000-4000-8000-0000000000a1",
  checkId: "access-not-logged",
  title: "Fix nobody would know who read it in the static-site module",
  cause: "the static-site module",
  request: "Change the module's setting so every store passes.",
  codeKind: "Terraform",
  paths: ["modules/static-site/main.tf", "modules/static-site/variables.tf"],
  stores: [
    {
      name: "site-1-assets",
      kind: "AWS S3 Bucket",
      region: "eu-west-1",
      issueId: "10370000-0000-4000-8000-0000000000b1",
    },
  ],
  storeCount: 40,
};

describe("an infrastructure fix's task details", () => {
  let projectId: ObjectID;
  let taskId: ObjectID;
  let workerId: ObjectID;
  let repositoryId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    taskId = ObjectID.generate();
    workerId = ObjectID.generate();
    repositoryId = ObjectID.generate();

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: workerId,
        projectId,
        source: CodeFixAgentSource.AIAgent,
      }),
    );
    jest
      .spyOn(CodeFixAgentAuth, "deniesAccessToProject")
      .mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function run(taskContext: CodeFixTaskContext | undefined): AIRun {
    return {
      id: taskId,
      projectId,
      runType: AIRunType.CodeFix,
      status: AIRunStatus.Running,
      aiAgentId: workerId,
      codeFixTaskType: CodeFixTaskType.FixInfrastructureCode,
      codeRepositoryId: repositoryId,
      taskContext,
    } as unknown as AIRun;
  }

  async function callRoute(): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "agent-key",
        taskId: taskId.toString(),
      },
      headers: {},
    } as unknown as ExpressRequest;

    await mockRouter
      .match("POST", DETAILS_ROUTE)
      .handlerFunction(
        req,
        {} as ExpressResponse,
        jest.fn() as unknown as NextFunction,
      );
  }

  test("hands the Runner the stored request and stores, in the repository a person confirmed, from the code's folder", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(run({ infrastructureFix: FIX }));
    const repositoryRead: SpyInstance<typeof CodeRepositoryService.findOneBy> =
      jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue({
        id: repositoryId,
        name: "infra",
        organizationName: "acme",
        repositoryName: "infra",
        mainBranchName: "main",
      } as unknown as CodeRepository);
    const resolved: SpyInstance<
      typeof CodeRepositoryService.resolveRepositoryForException
    > = jest.spyOn(CodeRepositoryService, "resolveRepositoryForException");

    await callRoute();

    expect(thrownError()).toBeUndefined();

    const answer: JSONObject = jsonResponse()!;

    expect(answer).toEqual(
      expect.objectContaining({
        subjectType: "infrastructure",
        subjectTitle: FIX.title,
        analysisMarkdown: FIX.request,
        infrastructureFix: expect.objectContaining({
          groupId: FIX.groupId,
          storeCount: 40,
        }),
      }),
    );
    expect(answer["repositories"]).toEqual([
      expect.objectContaining({
        id: repositoryId.toString(),
        servicePathInRepository: "modules/static-site",
        resolutionMethod: "only-repository",
      }),
    ]);
    // The run's own repository, in its own project: never one resolved now.
    expect(repositoryRead.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({
        _id: repositoryId.toString(),
        projectId,
      }),
    );
    expect(resolved).not.toHaveBeenCalled();
  });

  test("says the repository is gone when it is, and hands no other", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(run({ infrastructureFix: FIX }));
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue(null);

    await callRoute();

    expect(jsonResponse()).toEqual(
      expect.objectContaining({
        repositories: [],
        resolutionError: expect.stringContaining("no longer connected"),
      }),
    );
  });

  test("fails closed with no stored request: nothing to work from", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run({}));

    await callRoute();

    expect(jsonResponse()).toBeUndefined();
    expect(thrownError()).toBeInstanceOf(BadDataException);
  });
});

describe("reading an infrastructure fix's context", () => {
  test("keeps what it holds, bounded, and refuses one with no group, request or store", () => {
    expect(getInfrastructureFixTaskContext(FIX)).toEqual(
      expect.objectContaining({
        groupId: FIX.groupId,
        request: FIX.request,
        storeCount: 40,
        paths: FIX.paths,
      }),
    );
    expect(getInfrastructureFixTaskContext(null)).toBeNull();
    expect(getInfrastructureFixTaskContext({ ...FIX, groupId: "" })).toBeNull();
    expect(
      getInfrastructureFixTaskContext({ ...FIX, request: " " }),
    ).toBeNull();
    expect(getInfrastructureFixTaskContext({ ...FIX, stores: [] })).toBeNull();
    // A store with no name or issue is not a store of the fix.
    expect(
      getInfrastructureFixTaskContext({
        ...FIX,
        stores: [{ name: "", issueId: "10370000-0000-4000-8000-0000000000b1" }],
      }),
    ).toBeNull();
    // A count below the stores listed reads as the stores listed.
    expect(
      getInfrastructureFixTaskContext({ ...FIX, storeCount: 0 })?.storeCount,
    ).toBe(1);
  });

  test("starts in the deepest folder every file that declares the stores shares", () => {
    expect(getInfrastructureFixFolder(FIX.paths)).toBe("modules/static-site");
    expect(
      getInfrastructureFixFolder([
        "modules/static-site/main.tf",
        "envs/prod/sites.tf",
      ]),
    ).toBeNull();
    expect(getInfrastructureFixFolder(["main.tf"])).toBeNull();
    expect(getInfrastructureFixFolder(undefined)).toBeNull();
  });
});
