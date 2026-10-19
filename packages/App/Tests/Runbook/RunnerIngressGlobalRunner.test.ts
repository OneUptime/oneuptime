import RunnerService from "Common/Server/Services/RunnerService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
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
 * Contract under test - what the Runner ingress does for a global Runner,
 * one the OneUptime server runs for every project:
 *
 *   - its heartbeat tells it it is global and that it runs runbook steps
 *     only (code fixes and AI commands off whatever the row says);
 *   - its claim is served from the global lane only
 *     (claimNextGlobalJob - never the per-Runner claim), for the types
 *     global Runners run, narrowed further by what it asks for;
 *   - everything a claimed step is handed comes from the step's OWN
 *     project: the secrets that project lets global Runners use, and its
 *     run's inputs. A secret the step names that it may not have fails the
 *     step with its name, never its value; a credential is never handed
 *     over.
 *
 * And a project's own Runner is served as before, its secrets held to its
 * own project.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

type RegisterRouteFunction = (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void;

const registerRoute: RegisterRouteFunction = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      handlerFunction: handlerFunction || middleware,
    });
  };
};

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, jest.Mock> => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

/*
 * The secrets util loads the isolated-vm sandbox, which is not installed for
 * this suite; what it is asked for is the contract here. Which names a
 * script uses is read by the real SecretNames.
 */
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: {
      loadForAgent: jest.fn(),
      loadForGlobalRunnerJob: jest.fn(),
      populateInScript: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Runbook/Utils/Credentials", () => {
  return {
    __esModule: true,
    default: {
      resolveForJob: jest.fn(),
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";
import RunbookSecretsUtil from "../../FeatureSet/Runbook/Utils/Secrets";
import RunbookCredentialsUtil from "../../FeatureSet/Runbook/Utils/Credentials";
import { RunnerExpressRequest } from "../../FeatureSet/Runbook/Types/Request";

const HEARTBEAT_ROUTE: string = "/heartbeat";
const CLAIM_ROUTE: string = "/claim-next-job";

const GLOBAL_RUNNER_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000a1",
);
const PROJECT_RUNNER_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000a2",
);
const RUNNER_PROJECT_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000b1",
);
const STEP_PROJECT_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000b2",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000c1",
);
const JOB_ID: string = "b1000000-0000-4000-8000-0000000000d1";

function matchRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((candidate) => {
    return candidate.method === "POST" && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

async function callRoute(data: {
  uri: string;
  agent: Runner;
  body?: JSONObject | undefined;
}): Promise<{ thrownToNext: unknown }> {
  const req: RunnerExpressRequest = {
    params: {} as Dictionary<string>,
    query: {},
    body: data.body || {},
    headers: {},
    runner: data.agent,
  } as unknown as RunnerExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    set: jest.fn(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute(data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return { thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

function lastJsonResponse(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![2] as JSONObject;
}

function globalRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: GLOBAL_RUNNER_ID,
    _id: GLOBAL_RUNNER_ID.toString(),
    name: "global-runner-eu",
    isGlobalRunner: true,
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: false,
    ...overrides,
  } as unknown as Runner;
}

function projectRunner(): Runner {
  return {
    id: PROJECT_RUNNER_ID,
    _id: PROJECT_RUNNER_ID.toString(),
    projectId: RUNNER_PROJECT_ID,
    name: "office-runner",
    isGlobalRunner: false,
    canRunRunbooks: true,
  } as unknown as Runner;
}

function claimedGlobalJob(overrides: Record<string, unknown> = {}): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job._id = JOB_ID;
  job.projectId = STEP_PROJECT_ID;
  job.runbookExecutionId = EXECUTION_ID;
  job.origin = RunnerJobOrigin.Runbook;
  job.stepId = "step-1";
  job.stepType = RunbookStepType.JavaScript;
  job.script =
    "await axios.post('https://hooks.example.com', { token: '{{runbookSecrets.API_TOKEN}}' });";
  job.timeoutInMs = 30_000;
  job.status = RunnerJobStatus.Claimed;
  job.runsOnGlobalRunner = true;
  job.assignedAgentId = GLOBAL_RUNNER_ID;
  Object.assign(job, overrides);
  return job;
}

function secret(name: string, value: string): RunbookSecret {
  const row: RunbookSecret = new RunbookSecret();
  row.name = name;
  row.secretValue = value;
  return row;
}

describe("the Runner ingress, for a global Runner", () => {
  let claimGlobalSpy: jest.SpyInstance;
  let claimOwnSpy: jest.SpyInstance;
  let submitSpy: jest.SpyInstance;
  let executionSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(RunnerService, "heartbeat").mockResolvedValue(undefined);
    claimGlobalSpy = jest
      .spyOn(RunnerJobService, "claimNextGlobalJob")
      .mockResolvedValue(null);
    claimOwnSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);
    submitSpy = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);

    executionSpy = jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockImplementation(async (): Promise<RunbookExecution> => {
        const execution: RunbookExecution = new RunbookExecution();
        execution.projectId = STEP_PROJECT_ID;
        execution.inputs = { host: "web-1" };
        execution.triggerType = RunbookTriggerType.Webhook;
        return execution;
      });

    (
      RunbookSecretsUtil.loadForGlobalRunnerJob as unknown as jest.Mock
    ).mockResolvedValue([secret("API_TOKEN", "tok-123")]);
    (
      RunbookSecretsUtil.populateInScript as unknown as jest.Mock
    ).mockImplementation((data: unknown): string => {
      return `${(data as { script: string }).script} /* filled */`;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /heartbeat", () => {
    test("tells a global Runner it is one, and that it runs runbook steps only", async () => {
      await callRoute({ uri: HEARTBEAT_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        isGlobalRunner: true,
        globalStepTypes: [RunbookStepType.JavaScript],
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      });
    });

    test("never grants a global Runner code fixes or AI commands, whatever its row says", async () => {
      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: globalRunner({
          canRunCodeFixTasks: true,
          canRunAiCommands: true,
        }),
      });

      expect(
        (lastJsonResponse()["capabilities"] as JSONObject)[
          "canRunCodeFixTasks"
        ],
      ).toBe(false);
      expect(
        (lastJsonResponse()["capabilities"] as JSONObject)["canRunAiCommands"],
      ).toBe(false);
    });

    test("a paused global Runner (Runs Runbooks off) is told so", async () => {
      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: globalRunner({ canRunRunbooks: false }),
      });

      expect(
        (lastJsonResponse()["capabilities"] as JSONObject)["canRunRunbooks"],
      ).toBe(false);
    });

    test("negative control: a project's own Runner's heartbeat is answered as before", async () => {
      await callRoute({ uri: HEARTBEAT_ROUTE, agent: projectRunner() });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      });
      expect(lastJsonResponse()).not.toHaveProperty("isGlobalRunner");
    });
  });

  describe("POST /claim-next-job", () => {
    test("is served from the global lane only, with its own id, for JavaScript steps", async () => {
      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(claimOwnSpy).not.toHaveBeenCalled();
      expect(claimGlobalSpy).toHaveBeenCalledTimes(1);

      const args: {
        agentId: ObjectID;
        allowedStepTypes: Array<RunbookStepType>;
      } = claimGlobalSpy.mock.calls[0]![0] as {
        agentId: ObjectID;
        allowedStepTypes: Array<RunbookStepType>;
      };

      expect(args.agentId.toString()).toBe(GLOBAL_RUNNER_ID.toString());
      expect(args.allowedStepTypes).toEqual([RunbookStepType.JavaScript]);
      expect(lastJsonResponse()).toEqual({ job: null });
    });

    test("what a global Runner asks for only narrows what it is served", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: globalRunner(),
        body: {
          stepTypes: [RunbookStepType.Bash, RunbookStepType.JavaScript],
        },
      });

      expect(
        (
          claimGlobalSpy.mock.calls[0]![0] as {
            allowedStepTypes: Array<RunbookStepType>;
          }
        ).allowedStepTypes,
      ).toEqual([RunbookStepType.JavaScript]);
    });

    test("a global Runner asking for Bash only is served nothing, and nothing is claimed", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: globalRunner(),
        body: { stepTypes: [RunbookStepType.Bash, RunbookStepType.SSH] },
      });

      expect(claimGlobalSpy).toHaveBeenCalledTimes(0);
      expect(claimOwnSpy).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
    });

    test("a paused global Runner takes nothing", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: globalRunner({ canRunRunbooks: false }),
      });

      expect(claimGlobalSpy).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
    });

    test("hands a claimed step over with the secrets of the step's OWN project that global Runners may use", async () => {
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.loadForGlobalRunnerJob).toHaveBeenCalledTimes(
        1,
      );
      expect(
        (
          (RunbookSecretsUtil.loadForGlobalRunnerJob as unknown as jest.Mock)
            .mock.calls[0]![0] as { projectId: ObjectID }
        ).projectId.toString(),
      ).toBe(STEP_PROJECT_ID.toString());

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["jobId"]).toBe(JOB_ID);
      expect(job["runsOnGlobalRunner"]).toBe(true);
      expect(job["stepType"]).toBe(RunbookStepType.JavaScript);
      expect(job["script"]).toContain("/* filled */");
      expect(job).not.toHaveProperty("credential");
      expect(submitSpy).not.toHaveBeenCalled();
    });

    test("hands over the run's inputs from the step's own project", async () => {
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["inputs"]).toEqual({ host: "web-1" });
      expect(job["trigger"]).toBe(RunbookTriggerType.Webhook);
      expect(
        (
          executionSpy.mock.calls[0]![0] as { id: ObjectID }
        ).id.toString(),
      ).toBe(EXECUTION_ID.toString());
    });

    test("never hands over the inputs of a run of another project", async () => {
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());
      executionSpy.mockImplementation(async (): Promise<RunbookExecution> => {
        const execution: RunbookExecution = new RunbookExecution();
        execution.projectId = RUNNER_PROJECT_ID;
        execution.inputs = { password: "someone-elses" };
        return execution;
      });

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job).not.toHaveProperty("inputs");
    });

    test("a step naming a secret global Runners may not use is failed with its name, never run", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script:
            "const a = '{{runbookSecrets.API_TOKEN}}'; const b = '{{ runbookSecrets.DB_PASSWORD }}';",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(RunbookSecretsUtil.populateInScript).not.toHaveBeenCalled();
      expect(submitSpy).toHaveBeenCalledTimes(1);

      const result: {
        jobId: ObjectID;
        agentId: ObjectID;
        success: boolean;
        errorMessage: string;
      } = submitSpy.mock.calls[0]![0] as {
        jobId: ObjectID;
        agentId: ObjectID;
        success: boolean;
        errorMessage: string;
      };

      expect(result.success).toBe(false);
      expect(result.agentId.toString()).toBe(GLOBAL_RUNNER_ID.toString());
      expect(result.errorMessage).toBe(
        'This step uses the runbook secret "DB_PASSWORD", which global Runners may not use, so it was not run. Turn on "Global Runners can use this secret" for it under Runbooks → Settings → Secrets, or pick one of your own Runners for the step.',
      );
      // The value of the secret it may use is never in the message.
      expect(result.errorMessage).not.toContain("tok-123");
    });

    test("a secret with no value counts as one it may not use", async () => {
      (
        RunbookSecretsUtil.loadForGlobalRunnerJob as unknown as jest.Mock
      ).mockResolvedValue([secret("API_TOKEN", "")]);
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toContain('"API_TOKEN"');
    });

    test("a step with no secret placeholder is handed over without asking for secrets it cannot use", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({ script: "return 1 + 1;" }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect((lastJsonResponse()["job"] as JSONObject)["jobId"]).toBe(JOB_ID);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    test("a step carrying a credential is failed, and the credential is never resolved", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          payload: { credentialId: "b1000000-0000-4000-8000-0000000000e1" },
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.GLOBAL_RUNNER_CREDENTIAL_REFUSAL);
    });
  });

  describe("negative control: a project's own Runner", () => {
    test("claims its own lane, and its secrets are held to its own project", async () => {
      const job: RunnerJob = claimedGlobalJob({
        projectId: RUNNER_PROJECT_ID,
        runsOnGlobalRunner: false,
        targetAgentId: PROJECT_RUNNER_ID,
      });
      claimOwnSpy.mockResolvedValue(job);
      (RunbookSecretsUtil.loadForAgent as unknown as jest.Mock).mockResolvedValue(
        [secret("API_TOKEN", "tok-123")],
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: projectRunner() });

      expect(claimGlobalSpy).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.loadForGlobalRunnerJob).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.loadForAgent).toHaveBeenCalledWith({
        agentId: PROJECT_RUNNER_ID,
        projectId: RUNNER_PROJECT_ID,
      });
    });
  });
});

describe("describeSecretsNotForGlobalRunners", () => {
  test("names one secret", () => {
    expect(
      RunnerIngressAPI.describeSecretsNotForGlobalRunners(["DB_PASSWORD"]),
    ).toBe(
      'This step uses the runbook secret "DB_PASSWORD", which global Runners may not use, so it was not run. Turn on "Global Runners can use this secret" for it under Runbooks → Settings → Secrets, or pick one of your own Runners for the step.',
    );
  });

  test("names several, and counts the rest past five", () => {
    expect(
      RunnerIngressAPI.describeSecretsNotForGlobalRunners([
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
      ]),
    ).toBe(
      'This step uses the runbook secrets "A", "B", "C", "D", "E" and 2 more, which global Runners may not use, so it was not run. Turn on "Global Runners can use this secret" for them under Runbooks → Settings → Secrets, or pick one of your own Runners for the step.',
    );
  });

  test("cuts a long name", () => {
    const message: string = RunnerIngressAPI.describeSecretsNotForGlobalRunners(
      ["N".repeat(500)],
    );

    expect(message).toContain(`"${"N".repeat(80)}…"`);
    expect(message.length).toBeLessThan(400);
  });
});
