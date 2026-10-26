import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskContext, {
  GitHubTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import GitHubCommandType from "../../../Types/CodeRepository/GitHubCommand";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * POST /ai-agent-task/update-task-status, for the report that closes a run.
 *
 * Recording a pull request can fail after GitHub has opened it, and the run
 * still finishes Completed. A Runner then reports the pull requests it opened
 * with that status, and they are kept on the run's GitHub context so the
 * thread the run came from can link them (GitHubRunReply). Two things matter
 * here:
 *
 *   - They are written by the SAME update that makes the run Completed. The
 *     outcome sweeper answers the thread as soon as the run is terminal, so a
 *     second write could land after the reply had already said no pull
 *     request was recorded.
 *   - A Runner that sends none — every Runner before this one — gets exactly
 *     the update it always got.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

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

const UPDATE_STATUS_ROUTE: string = "/ai-agent-task/update-task-status";

const OPENED_URL: string = "https://github.com/acme/checkout/pull/77";

// A stand-in for a redis-semaphore mutex.
const MUTEX: SemaphoreMutex = { id: "held" } as unknown as SemaphoreMutex;

interface PullRequestQuery {
  aiRunId?: ObjectID;
  codeRepositoryId?: ObjectID;
  pullRequestNumber?: number;
  pullRequestState?: PullRequestState;
}

// What the CAS was asked to write, as AIAgentTaskAPI passes it.
interface TransitionCall {
  aiRunId: ObjectID;
  fromStatus: AIRunStatus;
  set: {
    status: AIRunStatus;
    errorMessage?: string;
    taskContext?: CodeFixTaskContext;
  };
}

interface FindRunCall {
  id: ObjectID;
  select: Record<string, boolean>;
}

describe("POST /ai-agent-task/update-task-status", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let storedContext: CodeFixTaskContext | undefined;

  let findRunSpy: jest.SpyInstance;
  let transitionSpy: jest.SpyInstance;
  let appendEventSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let updateOneBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentTaskAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    storedContext = { github: githubContext() };

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: ObjectID.generate(),
        projectId: projectId,
        source: CodeFixAgentSource.Runner,
      }),
    );

    // The run as the database holds it, answering only what was selected.
    findRunSpy = jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (findBy: unknown): Promise<AIRun | null> => {
        const select: Record<string, boolean> = (findBy as FindRunCall).select;

        const run: AIRun = new AIRun();
        run.id = runId;
        run.projectId = projectId;
        run.status = AIRunStatus.Running;

        if (select["taskContext"] && storedContext) {
          run.taskContext = storedContext;
        }

        return run;
      });

    transitionSpy = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    appendEventSpy = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);

    updateOneByIdSpy = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    updateOneBySpy = jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function githubContext(
    overrides: Partial<GitHubTaskContext> = {},
  ): GitHubTaskContext {
    return {
      codeRepositoryId: "6650f0b1a1b2c3d4e5f60718",
      installationId: "12345678",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.Implement,
      instruction: "implement this",
      issueNumber: 42,
      triggerCommentId: 991,
      acknowledgementCommentId: 555,
      ...overrides,
    };
  }

  async function report(body: JSONObject): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "runner-key",
        taskId: runId.toString(),
        ...body,
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("POST", UPDATE_STATUS_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
  }

  function transition(): TransitionCall {
    expect(transitionSpy).toHaveBeenCalledTimes(1);

    return transitionSpy.mock.calls[0]![0] as TransitionCall;
  }

  function selectedColumns(): Record<string, boolean> {
    expect(findRunSpy).toHaveBeenCalledTimes(1);

    return (findRunSpy.mock.calls[0]![0] as FindRunCall).select;
  }

  function succeeded(): boolean {
    const sendJson: jest.Mock =
      Response.sendJsonObjectResponse as unknown as jest.Mock;
    const sendError: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;

    return (
      sendJson.mock.calls.length === 1 && sendError.mock.calls.length === 0
    );
  }

  test("a Completed report keeps the pull requests on the run's GitHub context", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(transition().fromStatus).toBe(AIRunStatus.Running);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set.taskContext).toEqual({
      github: { ...githubContext(), openedPullRequestUrls: [OPENED_URL] },
    });
  });

  /*
   * One UPDATE, conditional on the run still Running: the run is never
   * terminal without its pull requests, and a run another actor finalized
   * first is not written at all.
   */
  test("writes them with the status, never in a write of their own", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(transition().set.taskContext).toBeDefined();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(updateOneBySpy).not.toHaveBeenCalled();
  });

  // TypeORM replaces a jsonb column, so the rest of the context goes back in.
  test("keeps every other key of the run's context", async () => {
    storedContext = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      github: githubContext(),
    };

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(transition().set.taskContext?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(transition().set.taskContext?.github?.acknowledgementCommentId).toBe(
      555,
    );
  });

  test("a Runner that sends no pull requests gets the update it always got", async () => {
    await report({ status: AIAgentTaskStatus.Completed });

    expect(succeeded()).toBe(true);
    // The run's project, state and who claimed it (deniesAccessToRun).
    expect(selectedColumns()).toEqual({
      _id: true,
      projectId: true,
      aiAgentId: true,
      status: true,
    });
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("an empty list is the same as none", async () => {
    await report({ status: AIAgentTaskStatus.Completed, pullRequestUrls: [] });

    expect(selectedColumns()).not.toHaveProperty("taskContext");
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("a run that did not come from GitHub keeps its context", async () => {
    storedContext = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" };

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("another repository's pull request is not kept", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: ["https://github.com/acme/billing/pull/5"],
    });

    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("a value that is not a list is ignored, and the run still completes", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: OPENED_URL,
    });

    expect(succeeded()).toBe(true);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  // Only a run that finished Completed opened anything worth linking.
  test.each([AIAgentTaskStatus.NoFixFound, AIAgentTaskStatus.Error])(
    "a report of %s does not keep pull requests",
    async (status: AIAgentTaskStatus) => {
      await report({
        status: status,
        statusMessage: "No change was worth proposing",
        pullRequestUrls: [OPENED_URL],
      });

      expect(selectedColumns()).not.toHaveProperty("taskContext");
      expect(transition().set).not.toHaveProperty("taskContext");
      expect(transition().set.errorMessage).toBe(
        "No change was worth proposing",
      );
    },
  );

  test("a run another actor already finalized gets no RunCompleted event", async () => {
    transitionSpy.mockResolvedValue(0);

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(appendEventSpy).not.toHaveBeenCalled();
  });

  /*
   * A pull request the Runner opened but could not record on
   * /ai-agent-data/record-pull-request goes with the Completed status, with
   * the record it failed to make. Without a row the open-PR cap never counts
   * it, the PR state sync never tracks it, and the run's pages never list it
   * — so the report records it, scoped and checked exactly as
   * record-pull-request would have.
   */
  describe("a pull request the run opened but could not record", () => {
    let checkoutRepositoryId: ObjectID;
    let foreignRepositoryId: ObjectID;

    // The AIAgentTaskPullRequest table, as far as these tests need one.
    let rows: Array<AIAgentTaskPullRequest>;

    let findRepositorySpy: jest.SpyInstance;
    let createPullRequestSpy: jest.SpyInstance;

    beforeEach(() => {
      checkoutRepositoryId = new ObjectID(githubContext().codeRepositoryId);
      foreignRepositoryId = ObjectID.generate();
      rows = [];

      const repositories: Array<CodeRepository> = [
        repository(checkoutRepositoryId, projectId, "checkout"),
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

      jest
        .spyOn(AIAgentTaskPullRequestService, "findOneBy")
        .mockImplementation(
          async (findBy: unknown): Promise<AIAgentTaskPullRequest | null> => {
            return (
              rowsMatching((findBy as { query: PullRequestQuery }).query)[0] ||
              null
            );
          },
        );

      jest
        .spyOn(AIAgentTaskPullRequestService, "countBy")
        .mockImplementation(
          async (countBy: unknown): Promise<PositiveNumber> => {
            return new PositiveNumber(
              rowsMatching(
                (countBy as { query: PullRequestQuery }).query,
              ).length,
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

      jest.spyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
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

    function rowsMatching(
      query: PullRequestQuery,
    ): Array<AIAgentTaskPullRequest> {
      return rows.filter((row: AIAgentTaskPullRequest) => {
        return (
          (query.aiRunId === undefined ||
            row.aiRunId?.toString() === query.aiRunId.toString()) &&
          (query.codeRepositoryId === undefined ||
            row.codeRepositoryId?.toString() ===
              query.codeRepositoryId.toString()) &&
          (query.pullRequestNumber === undefined ||
            row.pullRequestNumber === query.pullRequestNumber) &&
          (query.pullRequestState === undefined ||
            row.pullRequestState === query.pullRequestState)
        );
      });
    }

    // The record the Runner could not make, as its status report carries it.
    function unrecorded(overrides: JSONObject = {}): JSONObject {
      return {
        codeRepositoryId: checkoutRepositoryId.toString(),
        pullRequestUrl: OPENED_URL,
        pullRequestNumber: 77,
        pullRequestId: 3456789012,
        title: "fix: guard the empty cart (#42)",
        description: "Closes #42",
        headRefName: "oneuptime/issue-42",
        baseRefName: "main",
        runnerVerificationStatus: "Passed",
        runnerVerificationSummary: "npm test passed",
        ...overrides,
      };
    }

    test("a Completed report records it on the run", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [OPENED_URL],
        unrecordedPullRequests: [unrecorded()],
      });

      expect(succeeded()).toBe(true);
      expect(transition().set.status).toBe(AIRunStatus.Completed);
      expect(rows).toHaveLength(1);

      const row: AIAgentTaskPullRequest = rows[0]!;

      expect(row.projectId?.toString()).toBe(projectId.toString());
      expect(row.aiRunId?.toString()).toBe(runId.toString());
      expect(row.pullRequestUrl?.toString()).toBe(OPENED_URL);
      expect(row.pullRequestId).toBe(3456789012);
      expect(row.title).toBe("fix: guard the empty cart (#42)");
      expect(row.baseRefName).toBe("main");
      expect(row.runnerVerificationSummary).toBe("npm test passed");
    });

    /*
     * What "a real record" has to mean: the AIAgent:SyncPullRequestStates
     * worker reads Open rows and skips one without a repository, a number,
     * or the owner and name to ask GitHub about (and reads CI on the head
     * branch); the open-PR cap counts Open rows by repository.
     */
    test("records a row the PR state sync tracks and the open-PR cap counts", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [unrecorded()],
      });

      const row: AIAgentTaskPullRequest = rows[0]!;

      expect(row.pullRequestState).toBe(PullRequestState.Open);
      expect(row.codeRepositoryId?.toString()).toBe(
        checkoutRepositoryId.toString(),
      );
      expect(row.pullRequestNumber).toBe(77);
      expect(row.repoOrganizationName).toBe("acme");
      expect(row.repoName).toBe("checkout");
      expect(row.headRefName).toBe("oneuptime/issue-42");

      const decision: OpenPullRequestCapDecision =
        await OpenPullRequestCap.checkForRepository({
          codeRepositoryId: checkoutRepositoryId,
          configuredLimit: 1,
        });

      expect(decision.openCount).toBe(1);
      expect(decision.allowed).toBe(false);
    });

    // The GitHub reply reads the run's pull requests the moment it is terminal.
    test("records it before the run is terminal", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [unrecorded()],
      });

      expect(createPullRequestSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        transitionSpy.mock.invocationCallOrder[0]!,
      );
    });

    // The pull request is open on GitHub however the run ended.
    test("records it even when another actor already finalized the run", async () => {
      transitionSpy.mockResolvedValue(0);

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [unrecorded()],
      });

      expect(succeeded()).toBe(true);
      expect(rows).toHaveLength(1);
    });

    /*
     * The Runner gives up on a record whose answer it did not get, and that
     * record may have landed.
     */
    test("a pull request the run did record is not recorded again", async () => {
      const recordedRow: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      recordedRow.id = ObjectID.generate();
      recordedRow.aiRunId = runId;
      recordedRow.codeRepositoryId = checkoutRepositoryId;
      recordedRow.pullRequestNumber = 77;
      recordedRow.pullRequestState = PullRequestState.Open;
      rows.push(recordedRow);

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [unrecorded()],
      });

      expect(succeeded()).toBe(true);
      expect(createPullRequestSpy).not.toHaveBeenCalled();
      expect(rows).toEqual([recordedRow]);
    });

    test("records each pull request the report carries", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [
          unrecorded(),
          unrecorded({
            pullRequestUrl: "https://github.com/acme/checkout/pull/78",
            pullRequestNumber: 78,
          }),
        ],
      });

      expect(
        rows.map((row: AIAgentTaskPullRequest) => {
          return row.pullRequestNumber;
        }),
      ).toEqual([77, 78]);
    });

    // The row is what the open-PR cap counts, scoped to the run's project.
    test("a repository outside the run's project is not recorded, and the run still completes", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [
          unrecorded({ codeRepositoryId: foreignRepositoryId.toString() }),
        ],
      });

      expect(succeeded()).toBe(true);
      expect(transition().set.status).toBe(AIRunStatus.Completed);
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    });

    test("is recorded against the run the report is for, whatever an entry says", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [
          unrecorded({ taskId: ObjectID.generate().toString() }),
        ],
      });

      expect(rows[0]!.aiRunId?.toString()).toBe(runId.toString());
    });

    test("a pull request that cannot be recorded does not keep the run from completing", async () => {
      createPullRequestSpy.mockRejectedValue(new Error("connection reset"));

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [unrecorded()],
      });

      expect(succeeded()).toBe(true);
      expect(transition().set.status).toBe(AIRunStatus.Completed);
      expect(appendEventSpy).toHaveBeenCalledTimes(1);
      expect(appendEventSpy.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ eventType: AIRunEventType.RunCompleted }),
      );
    });

    /*
     * Without its number there is no telling a record that failed from one
     * whose answer was lost, so it is not recorded twice on a guess.
     */
    test("an entry without a pull request number is not recorded", async () => {
      const entry: JSONObject = unrecorded();
      delete entry["pullRequestNumber"];

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [entry],
      });

      expect(succeeded()).toBe(true);
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    });

    test("entries that are not records are skipped, and the rest recorded", async () => {
      const withoutTitle: JSONObject = unrecorded({ pullRequestNumber: 78 });
      delete withoutTitle["title"];

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [
          null,
          OPENED_URL,
          [unrecorded()],
          withoutTitle,
          unrecorded({ pullRequestNumber: "77" }),
          unrecorded({ pullRequestNumber: 79 }),
        ] as unknown as JSONObject[],
      });

      expect(succeeded()).toBe(true);
      expect(
        rows.map((row: AIAgentTaskPullRequest) => {
          return row.pullRequestNumber;
        }),
      ).toEqual([79]);
    });

    test("a value that is not a list is ignored, and the run still completes", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: unrecorded(),
      });

      expect(succeeded()).toBe(true);
      expect(transition().set.status).toBe(AIRunStatus.Completed);
      expect(findRepositorySpy).not.toHaveBeenCalled();
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    });

    // A run opens one pull request per repository it fixed.
    test("reads no more than ten", async () => {
      const entries: Array<JSONObject> = [];

      for (let number: number = 1; number <= 12; number++) {
        entries.push(
          unrecorded({
            pullRequestUrl: `https://github.com/acme/checkout/pull/${number}`,
            pullRequestNumber: number,
          }),
        );
      }

      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: entries,
      });

      expect(rows).toHaveLength(10);
    });

    // Only a run that finished Completed reports pull requests it opened.
    test.each([AIAgentTaskStatus.NoFixFound, AIAgentTaskStatus.Error])(
      "a report of %s records nothing",
      async (status: AIAgentTaskStatus) => {
        await report({
          status: status,
          statusMessage: "No change was worth proposing",
          unrecordedPullRequests: [unrecorded()],
        });

        expect(succeeded()).toBe(true);
        expect(findRepositorySpy).not.toHaveBeenCalled();
        expect(createPullRequestSpy).not.toHaveBeenCalled();
      },
    );

    test("a Runner that sends none records nothing", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [OPENED_URL],
      });

      expect(succeeded()).toBe(true);
      expect(findRepositorySpy).not.toHaveBeenCalled();
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    });

    test("an empty list is the same as none", async () => {
      await report({
        status: AIAgentTaskStatus.Completed,
        unrecordedPullRequests: [],
      });

      expect(findRepositorySpy).not.toHaveBeenCalled();
      expect(createPullRequestSpy).not.toHaveBeenCalled();
    });
  });
});
