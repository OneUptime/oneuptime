import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import FixVerificationStatus from "../../../Types/AI/FixVerificationStatus";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-agent-data/record-pull-request: how a pull request a code-fix run
 * opened becomes the AIAgentTaskPullRequest row the open-PR cap counts and
 * the PR state sync keeps current.
 *
 * The Runner retries a record whose answer it did not get, and a record that
 * did land may be the one whose answer was lost. So a run records each pull
 * request once: the same pull request again answers with the row it already
 * has, and adds no second row for the cap to count.
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
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

const RECORD_ROUTE: string = "/ai-agent-data/record-pull-request";

const PULL_REQUEST_URL: string = "https://github.com/acme/checkout/pull/77";

// A stand-in for a redis-semaphore mutex.
const MUTEX: SemaphoreMutex = { id: "held" } as unknown as SemaphoreMutex;

interface PullRequestQuery {
  aiRunId: ObjectID;
  codeRepositoryId: ObjectID;
  pullRequestNumber: number;
}

describe("POST /ai-agent-data/record-pull-request", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let checkoutRepositoryId: ObjectID;
  let paymentsRepositoryId: ObjectID;
  let foreignRepositoryId: ObjectID;
  let agentSource: CodeFixAgentSource;
  let agentId: ObjectID;

  // The AIAgentTaskPullRequest table, as far as these tests need one.
  let rows: Array<AIAgentTaskPullRequest>;

  let findRepositorySpy: jest.SpyInstance;
  let findPullRequestSpy: jest.SpyInstance;
  let createPullRequestSpy: jest.SpyInstance;
  let appendEventSpy: jest.SpyInstance;
  let lockSpy: jest.SpyInstance;
  let releaseSpy: jest.SpyInstance;
  let next: jest.Mock;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    checkoutRepositoryId = ObjectID.generate();
    paymentsRepositoryId = ObjectID.generate();
    foreignRepositoryId = ObjectID.generate();
    agentSource = CodeFixAgentSource.Runner;
    agentId = ObjectID.generate();
    rows = [];

    jest
      .spyOn(CodeFixAgentAuth, "checkCredential")
      .mockImplementation(async () => {
        return credentialCheckProving({
          id: agentId,
          projectId: projectId,
          source: agentSource,
        });
      });

    jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (): Promise<AIRun | null> => {
        const run: AIRun = new AIRun();
        run.id = runId;
        run.projectId = projectId;
        return run;
      });

    const repositories: Array<CodeRepository> = [
      repository(checkoutRepositoryId, projectId, "checkout"),
      repository(paymentsRepositoryId, projectId, "payments"),
      repository(foreignRepositoryId, ObjectID.generate(), "billing"),
    ];

    findRepositorySpy = jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockImplementation(
        async (findBy: unknown): Promise<CodeRepository | null> => {
          const id: string = (findBy as { id: ObjectID }).id.toString();

          return (
            repositories.find((candidate: CodeRepository) => {
              return candidate.id?.toString() === id;
            }) || null
          );
        },
      );

    findPullRequestSpy = jest
      .spyOn(AIAgentTaskPullRequestService, "findOneBy")
      .mockImplementation(
        async (findBy: unknown): Promise<AIAgentTaskPullRequest | null> => {
          const query: PullRequestQuery = (
            findBy as { query: PullRequestQuery }
          ).query;

          return (
            rows.find((row: AIAgentTaskPullRequest) => {
              return (
                row.aiRunId?.toString() === query.aiRunId.toString() &&
                row.codeRepositoryId?.toString() ===
                  query.codeRepositoryId.toString() &&
                row.pullRequestNumber === query.pullRequestNumber
              );
            }) || null
          );
        },
      );

    createPullRequestSpy = jest
      .spyOn(AIAgentTaskPullRequestService, "create")
      .mockImplementation(
        async (createBy: unknown): Promise<AIAgentTaskPullRequest> => {
          const row: AIAgentTaskPullRequest = (
            createBy as { data: AIAgentTaskPullRequest }
          ).data;

          row.id = ObjectID.generate();
          rows.push(row);

          return row;
        },
      );

    appendEventSpy = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);

    lockSpy = jest.spyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
    releaseSpy = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function repository(
    id: ObjectID,
    repositoryProjectId: ObjectID,
    repositoryName: string,
  ): CodeRepository {
    const codeRepository: CodeRepository = new CodeRepository();
    codeRepository.id = id;
    codeRepository.projectId = repositoryProjectId;
    codeRepository.organizationName = "acme";
    codeRepository.repositoryName = repositoryName;
    return codeRepository;
  }

  // The body the Runner sends (BackendAPI.recordPullRequest).
  function recordBody(overrides: JSONObject = {}): JSONObject {
    return {
      aiAgentId: agentId.toString(),
      aiAgentKey: "runner-key",
      taskId: runId.toString(),
      codeRepositoryId: checkoutRepositoryId.toString(),
      pullRequestUrl: PULL_REQUEST_URL,
      pullRequestNumber: 77,
      pullRequestId: 3456789012,
      title: "fix: guard the empty cart (#42)",
      description: "Closes #42",
      headRefName: "oneuptime-fix/empty-cart",
      baseRefName: "main",
      runnerVerificationStatus: FixVerificationStatus.Passed,
      runnerVerificationSummary: "npm test passed",
      ...overrides,
    };
  }

  async function record(body: JSONObject): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: body,
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    next = jest.fn();

    await mockRouter
      .match("POST", RECORD_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);
  }

  // The JSON each successful record answered with, in order.
  function answers(): Array<JSONObject> {
    return (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return call[2] as JSONObject;
    });
  }

  function refusal(): Error | undefined {
    const sendError: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;

    return sendError.mock.calls[0]?.[2] as Error | undefined;
  }

  test("records the pull request on the run, in the repository it was opened in", async () => {
    await record(recordBody());

    expect(rows).toHaveLength(1);

    const row: AIAgentTaskPullRequest = rows[0]!;

    expect(row.projectId?.toString()).toBe(projectId.toString());
    expect(row.aiRunId?.toString()).toBe(runId.toString());
    expect(row.codeRepositoryId?.toString()).toBe(
      checkoutRepositoryId.toString(),
    );
    expect(row.pullRequestUrl?.toString()).toBe(PULL_REQUEST_URL);
    expect(row.pullRequestNumber).toBe(77);
    expect(row.pullRequestId).toBe(3456789012);
    expect(row.title).toBe("fix: guard the empty cart (#42)");
    expect(row.description).toBe("Closes #42");
    expect(row.pullRequestState).toBe(PullRequestState.Open);
    expect(row.headRefName).toBe("oneuptime-fix/empty-cart");
    expect(row.baseRefName).toBe("main");
    expect(row.repoOrganizationName).toBe("acme");
    expect(row.repoName).toBe("checkout");
    expect(row.runnerVerificationStatus).toBe(FixVerificationStatus.Passed);
    expect(row.runnerVerificationSummary).toBe("npm test passed");
    // A Runner is not an AIAgent, and aiAgentId is a foreign key into AIAgent.
    expect(row.aiAgentId).toBeUndefined();

    expect(answers()).toEqual([
      { success: true, pullRequestId: row.id!.toString() },
    ]);
    expect(refusal()).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  test("puts the pull request on the run's trail", async () => {
    await record(recordBody());

    expect(appendEventSpy).toHaveBeenCalledTimes(1);
    expect(appendEventSpy.mock.calls[0]![0]).toEqual({
      projectId: projectId,
      aiRunId: runId,
      eventType: AIRunEventType.ActionExecuted,
      toolName: "open_pull_request",
      resultSummary: {
        message: `Opened pull request: fix: guard the empty cart (#42) — ${PULL_REQUEST_URL}`,
      },
    });
  });

  test("an AIAgent identity is recorded as the pull request's agent", async () => {
    agentSource = CodeFixAgentSource.AIAgent;

    await record(recordBody());

    expect(rows[0]!.aiAgentId?.toString()).toBe(agentId.toString());
  });

  /*
   * The retry the Runner makes when the answer to a record that landed was
   * lost: the record is not made twice, and the run's trail does not say the
   * pull request was opened twice.
   */
  test("a pull request the run already recorded answers with its row, and records nothing new", async () => {
    await record(recordBody());
    await record(recordBody());

    expect(createPullRequestSpy).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(appendEventSpy).toHaveBeenCalledTimes(1);

    const recordedId: string = rows[0]!.id!.toString();

    expect(answers()).toEqual([
      { success: true, pullRequestId: recordedId },
      { success: true, pullRequestId: recordedId },
    ]);
  });

  test("looks for the pull request by run, repository and number", async () => {
    await record(recordBody());

    expect(findPullRequestSpy).toHaveBeenCalledTimes(1);

    const query: PullRequestQuery = (
      findPullRequestSpy.mock.calls[0]![0] as { query: PullRequestQuery }
    ).query;

    expect(query.aiRunId.toString()).toBe(runId.toString());
    expect(query.codeRepositoryId.toString()).toBe(
      checkoutRepositoryId.toString(),
    );
    expect(query.pullRequestNumber).toBe(77);
  });

  // A run that fixes an exception in several repositories opens one in each.
  test("the same number in another of the run's repositories is another pull request", async () => {
    await record(recordBody());
    await record(
      recordBody({
        codeRepositoryId: paymentsRepositoryId.toString(),
        pullRequestUrl: "https://github.com/acme/payments/pull/77",
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]!.repoName).toBe("payments");
  });

  test("another run's pull request with the same number is that run's own", async () => {
    rows.push(
      ((): AIAgentTaskPullRequest => {
        const otherRunRow: AIAgentTaskPullRequest =
          new AIAgentTaskPullRequest();
        otherRunRow.id = ObjectID.generate();
        otherRunRow.aiRunId = ObjectID.generate();
        otherRunRow.codeRepositoryId = checkoutRepositoryId;
        otherRunRow.pullRequestNumber = 77;
        return otherRunRow;
      })(),
    );

    await record(recordBody());

    expect(createPullRequestSpy).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
  });

  /*
   * Two records of one pull request can arrive together — a retry while the
   * first is still being written, or the run's status report carrying a
   * record the Runner gave up on. The run's lock is held from the look-up to
   * the write, so the second finds the first's row.
   */
  test("looks and writes under the run's lock, and gives it back", async () => {
    await record(recordBody());

    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(lockSpy.mock.calls[0]![0]).toEqual({
      key: runId.toString(),
      namespace: "CodeFixPullRequestRecord.record",
    });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy.mock.calls[0]![0]).toBe(MUTEX);

    const lockedAt: number = lockSpy.mock.invocationCallOrder[0]!;
    const releasedAt: number = releaseSpy.mock.invocationCallOrder[0]!;

    expect(findPullRequestSpy.mock.invocationCallOrder[0]!).toBeGreaterThan(
      lockedAt,
    );
    expect(createPullRequestSpy.mock.invocationCallOrder[0]!).toBeGreaterThan(
      lockedAt,
    );
    expect(createPullRequestSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releasedAt,
    );
  });

  test("gives the lock back when the run had already recorded the pull request", async () => {
    await record(recordBody());
    await record(recordBody());

    expect(lockSpy).toHaveBeenCalledTimes(2);
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  test("gives the lock back when the write fails", async () => {
    createPullRequestSpy.mockRejectedValue(new Error("connection reset"));

    await record(recordBody());

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(appendEventSpy).not.toHaveBeenCalled();
  });

  // A duplicate row is a far smaller loss than the record itself.
  test("records without the lock when it cannot be had", async () => {
    lockSpy.mockRejectedValue(new Error("Redis client is not connected"));

    await record(recordBody());

    expect(rows).toHaveLength(1);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("a lock that cannot be given back does not fail a record that was made", async () => {
    releaseSpy.mockRejectedValue(new Error("Redis client is not connected"));

    await record(recordBody());

    expect(rows).toHaveLength(1);
    expect(answers()).toHaveLength(1);
    expect(next).not.toHaveBeenCalled();
  });

  // Without a number there is nothing to match a retry against.
  test("a pull request without a number is recorded as it always was", async () => {
    const body: JSONObject = recordBody();
    delete body["pullRequestNumber"];

    await record(body);

    expect(findPullRequestSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pullRequestNumber).toBeUndefined();
  });

  /*
   * The row is what the open-PR cap counts, so a repository of another
   * project would let one project's records skew another's guardrail.
   */
  test("refuses a repository of another project, and records nothing", async () => {
    await record(
      recordBody({ codeRepositoryId: foreignRepositoryId.toString() }),
    );

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(refusal()?.message).toBe("Code repository not found");
    expect(createPullRequestSpy).not.toHaveBeenCalled();
    expect(lockSpy).not.toHaveBeenCalled();
  });

  test("refuses a repository that does not exist", async () => {
    await record(
      recordBody({ codeRepositoryId: ObjectID.generate().toString() }),
    );

    expect(refusal()?.message).toBe("Code repository not found");
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test("refuses a run of another project", async () => {
    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: agentId,
        projectId: ObjectID.generate(),
        source: CodeFixAgentSource.Runner,
      }),
    );

    await record(recordBody());

    expect(refusal()?.message).toBe("Task not found");
    expect(findRepositorySpy).not.toHaveBeenCalled();
    expect(createPullRequestSpy).not.toHaveBeenCalled();
  });

  test.each(["taskId", "codeRepositoryId", "pullRequestUrl", "title"])(
    "refuses a record without %s",
    async (field: string) => {
      const body: JSONObject = recordBody();
      delete body[field];

      await record(body);

      expect(refusal()?.message).toBe(`${field} is required`);
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    },
  );

  test("a verification status this server does not know is left out, and the pull request recorded", async () => {
    await record(recordBody({ runnerVerificationStatus: "Flaky" }));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.runnerVerificationStatus).toBeUndefined();
  });

  test("cuts the title and texts to what their columns hold", async () => {
    await record(
      recordBody({
        title: "t".repeat(150),
        description: "d".repeat(900),
        runnerVerificationSummary: "s".repeat(700),
      }),
    );

    expect(rows[0]!.title).toHaveLength(100);
    expect(rows[0]!.description).toHaveLength(500);
    expect(rows[0]!.runnerVerificationSummary).toHaveLength(500);
  });
});
