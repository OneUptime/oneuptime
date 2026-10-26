import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../Types/AI/CodeFixTaskType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../Types/Runner/CodeRepositoryRunner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * WHO CLAIMS, AND WHAT IT COUNTS.
 *
 * A repository picks the Runner AI works in it on, so the code-fix claim
 * and the queue depth a Runner autoscales on are read for WHO asks
 * (CodeFixAgentAuth.getCodeWorker): a project's Runner takes the runs of
 * the repositories that pick it, a global Runner (a Runner with no project)
 * those of repositories that pick none in every project that uses global
 * Runners, and an AI agent of a project's own those of its project's
 * repositories that pick none. Both routes hand the same facts on, so a
 * Runner never scales up for runs it would never be handed.
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
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const CLAIM_ROUTE: string = "/ai-agent-task/get-pending-task";
const COUNT_ROUTE: string = "/ai-agent-task/get-pending-task-count";

const PROJECT_ID: ObjectID = new ObjectID(
  "8d3e4f5a-1111-4222-8333-944455556666",
);
const IDENTITY_ID: ObjectID = new ObjectID(
  "8d3e4f5a-2222-4222-8333-944455556666",
);

interface Identity {
  label: string;
  source: CodeFixAgentSource;
  projectId?: ObjectID | undefined;
  worker: CodeWorker;
}

const IDENTITIES: Array<Identity> = [
  {
    label: "a project's Runner",
    source: CodeFixAgentSource.Runner,
    projectId: PROJECT_ID,
    worker: { kind: CodeWorkerKind.ProjectRunner, id: IDENTITY_ID },
  },
  {
    label: "a global Runner",
    source: CodeFixAgentSource.Runner,
    worker: { kind: CodeWorkerKind.GlobalRunner, id: IDENTITY_ID },
  },
  /*
   * CodeFixAgentAuth proves no AI agent without a project any more; were one
   * ever let through, it is served as a global Runner, never as an agent of
   * every project.
   */
  {
    label: "an AI agent with no project, were one ever let through",
    source: CodeFixAgentSource.AIAgent,
    worker: { kind: CodeWorkerKind.GlobalRunner, id: IDENTITY_ID },
  },
  {
    label: "an AI agent of the project's own",
    source: CodeFixAgentSource.AIAgent,
    projectId: PROJECT_ID,
    worker: { kind: CodeWorkerKind.ProjectAgent, id: IDENTITY_ID },
  },
];

function proving(identity: Identity): void {
  jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
    credentialCheckProving({
      id: IDENTITY_ID,
      ...(identity.projectId ? { projectId: identity.projectId } : {}),
      source: identity.source,
    }),
  );
}

async function call(route: string, body: JSONObject = {}): Promise<void> {
  const next: jest.Mock = jest.fn();

  await mockRouter.match("POST", route).handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: {
        aiAgentId: IDENTITY_ID.toString(),
        aiAgentKey: "agent-key",
        ...body,
      },
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  expect(next).not.toHaveBeenCalled();
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

// The worker a route handed on, as kind and id.
function workerOf(worker: CodeWorker): { kind: CodeWorkerKind; id: string } {
  return { kind: worker.kind, id: worker.id.toString() };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentTaskAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-agent-task/get-pending-task", () => {
  test.each(IDENTITIES)(
    "$label claims as itself, in its own project",
    async (identity: Identity) => {
      proving(identity);
      const claim: jest.SpyInstance = jest
        .spyOn(AIRunService, "claimNextQueuedCodeFixRun")
        .mockResolvedValue(null);

      await call(CLAIM_ROUTE);

      expect(claim).toHaveBeenCalledTimes(1);

      const facts: {
        worker: CodeWorker;
        projectId?: ObjectID;
        aiAgentId: ObjectID;
      } = claim.mock.calls[0]![0] as {
        worker: CodeWorker;
        projectId?: ObjectID;
        aiAgentId: ObjectID;
      };

      expect(workerOf(facts.worker)).toEqual(workerOf(identity.worker));
      expect(facts.projectId?.toString()).toBe(identity.projectId?.toString());
      expect(facts.aiAgentId.toString()).toBe(IDENTITY_ID.toString());
      expect(answered()["task"]).toBeNull();
    },
  );
});

describe("POST /ai-agent-task/get-pending-task-count", () => {
  test.each(IDENTITIES)(
    "$label counts what it may claim, as the claim reads it",
    async (identity: Identity) => {
      proving(identity);
      const count: jest.SpyInstance = jest
        .spyOn(AIRunService, "countClaimableCodeFixRuns")
        .mockResolvedValue(4);

      await call(COUNT_ROUTE);

      expect(count).toHaveBeenCalledTimes(1);

      const facts: {
        worker: CodeWorker;
        projectId?: ObjectID;
        claimableTaskTypes: Array<CodeFixTaskType>;
      } = count.mock.calls[0]![0] as {
        worker: CodeWorker;
        projectId?: ObjectID;
        claimableTaskTypes: Array<CodeFixTaskType>;
      };

      expect(workerOf(facts.worker)).toEqual(workerOf(identity.worker));
      expect(facts.projectId?.toString()).toBe(identity.projectId?.toString());
      /*
       * A request that names no recipes counts every recipe a Runner may be
       * handed, as always - never one the server runs itself.
       */
      expect(facts.claimableTaskTypes).toEqual(
        CodeFixTaskTypeHelper.getRunnerTaskTypes(),
      );
      expect(facts.claimableTaskTypes).not.toContain(
        CodeFixTaskType.GitHubPullRequestProductionReview,
      );

      // The count, as the route has always sent it.
      const sent: unknown = answered()["count"];
      expect(sent).toBeInstanceOf(PositiveNumber);
      expect((sent as PositiveNumber).toNumber()).toBe(4);
    },
  );

  test("a Runner that names its recipes counts only those", async () => {
    proving(IDENTITIES[0]!);
    const count: jest.SpyInstance = jest
      .spyOn(AIRunService, "countClaimableCodeFixRuns")
      .mockResolvedValue(0);

    await call(COUNT_ROUTE, {
      supportedTaskTypes: [
        CodeFixTaskType.FixException,
        CodeFixTaskType.CodeRequest,
      ],
    });

    expect(
      (count.mock.calls[0]![0] as { claimableTaskTypes: Array<string> })
        .claimableTaskTypes,
    ).toEqual([CodeFixTaskType.FixException, CodeFixTaskType.CodeRequest]);
  });

  test("the old count over the whole queue is not asked", async () => {
    proving(IDENTITIES[0]!);
    jest.spyOn(AIRunService, "countClaimableCodeFixRuns").mockResolvedValue(0);
    const wholeQueue: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    await call(COUNT_ROUTE);

    expect(wholeQueue).not.toHaveBeenCalled();
  });
});
