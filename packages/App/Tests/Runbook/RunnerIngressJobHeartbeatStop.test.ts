import ProjectService from "Common/Server/Services/ProjectService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test - what a Runner's job heartbeat
 * (POST /runner-ingest/job/:jobId/heartbeat) answers while the Runner holds
 * the job:
 *
 *   200 { status: "ok" }                      the lease is renewed
 *   200 { status: "ok", stop: true, reason }  the lease is renewed, and the
 *                                             Runner must not start the
 *                                             step: Enable AI was turned off
 *                                             since it claimed this AI
 *                                             command
 *   404                                       the job is no longer its own
 *
 * Enable AI is read again on every heartbeat (AiCommandKillSwitch
 * .getStopReason, through RunnerJobService.getStopReasonOfHeldJob), for the
 * job this Runner holds and in this Runner's own project. A runbook's own
 * steps and Test access are never stopped, and neither is anything a global
 * Runner holds: it has no project, and holds only a runbook's own
 * JavaScript steps.
 *
 * The real router, handler and Response serializer run; the services behind
 * them are stubbed, so what the test reads is what goes on the wire.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface MockRoute {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
}

const mockRoutes: Array<MockRoute> = [];

function mockRegisterRoute(
  method: string,
): (uri: string, ...handlers: Array<RouterFunction>) => void {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    mockRoutes.push({ method: method.toUpperCase(), uri, handlers });
  };
}

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, unknown> => {
        return {
          get: jest.fn().mockImplementation(mockRegisterRoute("get")),
          post: jest.fn().mockImplementation(mockRegisterRoute("post")),
          put: jest.fn().mockImplementation(mockRegisterRoute("put")),
          delete: jest.fn().mockImplementation(mockRegisterRoute("delete")),
        };
      },
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";
import RunnerAuthorization from "../../FeatureSet/Runbook/Middleware/RunnerAuthorization";
import AiCommandKillSwitch, {
  AI_COMMANDS_OFF_STOP_MESSAGE,
} from "Common/Server/Utils/AI/AiCommandKillSwitch";

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000a1",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000b1",
);
const GLOBAL_RUNNER_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000b2",
);
const JOB_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-0000000000d1");
const RUN_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-0000000000e1");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000e2",
);

const JOB_HEARTBEAT_ROUTE: string = "/job/:jobId/heartbeat";

// What went over the wire, and whether the handler passed an error on.
interface WireResponse {
  statusCode: number | undefined;
  body: JSONObject | undefined;
  thrownToNext: unknown;
}

function findRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

/*
 * The route's handler, past the Runner's authorization (its own suites pin
 * that), with the Runner it would have put on the request.
 */
async function heartbeat(data: {
  runner: Runner;
  jobId?: string | undefined;
}): Promise<WireResponse> {
  const route: MockRoute = findRoute(JOB_HEARTBEAT_ROUTE);
  const handler: RouterFunction = route.handlers[route.handlers.length - 1]!;

  const req: ExpressRequest = {
    params: (data.jobId === undefined
      ? { jobId: JOB_ID.toString() }
      : data.jobId
        ? { jobId: data.jobId }
        : {}) as Dictionary<string>,
    query: {},
    headers: {},
    body: {},
    runner: data.runner,
  } as unknown as ExpressRequest;

  const wire: WireResponse = {
    statusCode: undefined,
    body: undefined,
    thrownToNext: undefined,
  };

  const res: Record<string, unknown> = {};
  res["status"] = jest.fn().mockImplementation((code: unknown) => {
    wire.statusCode = code as number;
    return res;
  });
  res["send"] = jest.fn().mockImplementation((sent: unknown) => {
    wire.body = sent as JSONObject;
    return res;
  });
  res["set"] = jest.fn().mockImplementation(() => {
    return res;
  });

  await handler(
    req,
    res as unknown as ExpressResponse,
    ((error?: unknown): void => {
      wire.thrownToNext = error;
    }) as NextFunction,
  );

  return wire;
}

function projectRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "office-runner",
    isGlobalRunner: false,
    canRunRunbooks: true,
    canRunAiCommands: true,
  } as unknown as Runner;
}

function globalRunner(): Runner {
  return {
    id: GLOBAL_RUNNER_ID,
    _id: GLOBAL_RUNNER_ID.toString(),
    name: "global-runner-eu",
    isGlobalRunner: true,
    canRunRunbooks: true,
    canRunAiCommands: false,
  } as unknown as Runner;
}

function heldJob(overrides: Partial<RunnerJob> = {}): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job.id = JOB_ID;
  job.projectId = PROJECT_ID;
  job.origin = RunnerJobOrigin.AiRemediation;
  job.autoRemediationSuggestionId = SUGGESTION_ID;
  job.stepId = "ai-command-1";
  job.stepType = RunbookStepType.Bash;
  job.assignedAgentId = RUNNER_ID;
  Object.assign(job, overrides);
  return job;
}

function projectRow(enableAi: boolean): Project {
  const row: Project = new Project();
  row.id = PROJECT_ID;
  row.enableAi = enableAi;
  return row;
}

const STOPPED: JSONObject = {
  status: "ok",
  stop: true,
  reason: AI_COMMANDS_OFF_STOP_MESSAGE,
};

let heartbeatJob: jest.SpyInstance;
let jobLookup: jest.SpyInstance;
let isAiOff: jest.SpyInstance;

beforeAll(() => {
  mockRoutes.length = 0;
  new RunnerIngressAPI();
});

beforeEach(() => {
  for (const level of ["warn", "info", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  heartbeatJob = jest
    .spyOn(RunnerJobService, "heartbeatJob")
    .mockResolvedValue(true);
  jobLookup = jest
    .spyOn(RunnerJobService, "findOneBy")
    .mockResolvedValue(heldJob());
  // Enable AI is on unless a test turns it off.
  isAiOff = jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is behind the Runner's own authorization", () => {
    const route: MockRoute = findRoute(JOB_HEARTBEAT_ROUTE);

    expect(route.handlers[0]).toBe(RunnerAuthorization.isAuthorizedAgent);
    expect(route.handlers).toHaveLength(2);
  });
});

describe("a project's own Runner", () => {
  test('Enable AI on: the lease is renewed and the job goes on, 200 { status: "ok" }', async () => {
    const wire: WireResponse = await heartbeat({ runner: projectRunner() });

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(heartbeatJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: RUNNER_ID,
    });
  });

  test("the lease moved on or the job ended: 404, and nothing else is read", async () => {
    heartbeatJob.mockResolvedValue(false);

    const wire: WireResponse = await heartbeat({ runner: projectRunner() });

    expect(wire.thrownToNext).toBeInstanceOf(NotFoundException);
    expect(wire.body).toBeUndefined();
    expect(jobLookup).not.toHaveBeenCalled();
    expect(isAiOff).not.toHaveBeenCalled();
  });

  test("a heartbeat without a job id is a 400, and nothing is touched", async () => {
    const wire: WireResponse = await heartbeat({
      runner: projectRunner(),
      jobId: "",
    });

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(heartbeatJob).not.toHaveBeenCalled();
  });

  /*
   * Enable AI turned off after the Runner claimed the job: it is told to
   * stop - the heartbeat it sends right before a step starts keeps the step
   * from starting. The lease is still renewed, so it reports what it did.
   */
  describe("with Enable AI turned off since the claim", () => {
    beforeEach(() => {
      isAiOff.mockResolvedValue(true);
    });

    test("an AI fix's command is told to stop, with the reason, and its lease still renewed", async () => {
      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.statusCode).toBe(200);
      expect(wire.body).toEqual(STOPPED);
      expect(heartbeatJob).toHaveBeenCalledTimes(1);
      expect(heartbeatJob).toHaveBeenCalledWith({
        jobId: JOB_ID,
        agentId: RUNNER_ID,
      });
      // The job this Runner holds, by id, as root.
      expect(jobLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { _id: JOB_ID.toString(), assignedAgentId: RUNNER_ID },
          props: { isRoot: true },
        }),
      );
      // The Runner's own project, which the claim held the job to.
      expect((isAiOff.mock.calls[0]![0] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("the lease is renewed before Enable AI is read", async () => {
      await heartbeat({ runner: projectRunner() });

      expect(heartbeatJob.mock.invocationCallOrder[0]!).toBeLessThan(
        jobLookup.mock.invocationCallOrder[0]!,
      );
    });

    test("an investigation's kubectl read is told to stop too", async () => {
      jobLookup.mockResolvedValue(
        heldJob({
          origin: RunnerJobOrigin.AiInvestigation,
          aiRunId: RUN_ID,
          stepType: RunbookStepType.Kubectl,
        }),
      );

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual(STOPPED);
    });

    test("Test access is not: a person checks the Runner's access with it before turning AI on", async () => {
      const testAccess: RunnerJob = heldJob({
        origin: RunnerJobOrigin.AiInvestigation,
        stepType: RunbookStepType.Kubectl,
      });
      delete (testAccess as unknown as Record<string, unknown>)[
        "autoRemediationSuggestionId"
      ];
      jobLookup.mockResolvedValue(testAccess);

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual({ status: "ok" });
      expect(isAiOff).not.toHaveBeenCalled();
    });

    test("a runbook's own step is not: Enable AI does not hold runbooks people wrote", async () => {
      const step: RunnerJob = heldJob({ origin: RunnerJobOrigin.Runbook });
      delete (step as unknown as Record<string, unknown>)[
        "autoRemediationSuggestionId"
      ];
      jobLookup.mockResolvedValue(step);

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual({ status: "ok" });
      expect(isAiOff).not.toHaveBeenCalled();
    });

    test("a job the Runner no longer holds says nothing more than the lease does", async () => {
      jobLookup.mockResolvedValue(null);

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual({ status: "ok" });
    });

    test("a lease that moved on is still a 404, stop or not", async () => {
      heartbeatJob.mockResolvedValue(false);

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.thrownToNext).toBeInstanceOf(NotFoundException);
      expect(jobLookup).not.toHaveBeenCalled();
    });
  });

  /*
   * Through the switch's own read of the project, not a stub of it: Enable
   * AI off on the project's row, and a project that is gone, both stop the
   * job; Enable AI on lets it go on.
   */
  describe("Enable AI as the project's row says it", () => {
    let projectLookup: jest.SpyInstance;

    beforeEach(() => {
      isAiOff.mockRestore();
      projectLookup = jest.spyOn(ProjectService, "findOneById");
    });

    test("turned off: stop", async () => {
      projectLookup.mockResolvedValue(projectRow(false));

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual(STOPPED);
      expect(
        (
          (projectLookup.mock.calls[0]![0] as Record<string, unknown>)[
            "id"
          ] as ObjectID
        ).toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("the project is gone: stop, there is nobody left to act for", async () => {
      projectLookup.mockResolvedValue(null);

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual(STOPPED);
    });

    test("on: the job goes on", async () => {
      projectLookup.mockResolvedValue(projectRow(true));

      const wire: WireResponse = await heartbeat({ runner: projectRunner() });

      expect(wire.body).toEqual({ status: "ok" });
    });
  });
});

describe("a global Runner", () => {
  beforeEach(() => {
    isAiOff.mockResolvedValue(true);
    jobLookup.mockResolvedValue(
      heldJob({
        origin: RunnerJobOrigin.Runbook,
        stepType: RunbookStepType.JavaScript,
        assignedAgentId: GLOBAL_RUNNER_ID,
      }),
    );
  });

  test("is never told to stop, and nothing is read for it: it holds only a runbook's own JavaScript steps", async () => {
    const wire: WireResponse = await heartbeat({ runner: globalRunner() });

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(jobLookup).not.toHaveBeenCalled();
    expect(isAiOff).not.toHaveBeenCalled();
  });

  test("its lease is renewed under its own id", async () => {
    await heartbeat({ runner: globalRunner() });

    expect(heartbeatJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: GLOBAL_RUNNER_ID,
    });
  });

  test("a lease that moved on is a 404, as for any Runner", async () => {
    heartbeatJob.mockResolvedValue(false);

    const wire: WireResponse = await heartbeat({ runner: globalRunner() });

    expect(wire.thrownToNext).toBeInstanceOf(NotFoundException);
  });
});
