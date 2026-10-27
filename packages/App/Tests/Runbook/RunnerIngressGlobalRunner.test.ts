import RunnerService from "Common/Server/Services/RunnerService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import CodeRepositoryRunnerChoice from "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import RunbookVariableService from "Common/Server/Services/RunbookVariableService";
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
 *   - its heartbeat tells it it is global, that it runs JavaScript steps
 *     and takes code fixes, and that it never runs AI commands, whatever
 *     the row says;
 *   - its claim is served from the global lane only
 *     (claimNextGlobalJob - never the per-Runner claim), for the types
 *     global Runners run, narrowed further by what it asks for;
 *   - everything a claimed step is handed comes from the step's OWN
 *     project: the runbook variables it names - plain ones, and the secrets
 *     that project lets global Runners use - and its run's inputs. A
 *     variable the step names that it may not have fails the step with its
 *     name, never its value; a step that still names a runbook credential
 *     (they were removed) is failed, saying how to fix it.
 *
 * And a project's own Runner is served as before, its secrets held to its
 * own project and to the Runners each secret lists.
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

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";
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
const RUNBOOK_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000f1",
);

function matchRoute(uri: string): MockRoute {
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
    "await axios.post('https://hooks.example.com', { token: '{{global.variables.API_TOKEN}}' });";
  job.timeoutInMs = 30_000;
  job.status = RunnerJobStatus.Claimed;
  job.runsOnGlobalRunner = true;
  job.assignedAgentId = GLOBAL_RUNNER_ID;
  Object.assign(job, overrides);
  return job;
}

// A secret runbook variable, as the claim reads it.
function secret(
  name: string,
  value: string,
  access: { globalRunners?: boolean; runners?: Array<ObjectID> } = {},
): RunbookVariable {
  const row: RunbookVariable = new RunbookVariable();
  row.name = name;
  row.isSecret = true;
  row.secretValue = value;
  row.isAvailableToGlobalRunners = access.globalRunners ?? true;
  row.runners = (access.runners || []).map((id: ObjectID): Runner => {
    const runner: Runner = new Runner();
    runner._id = id.toString();
    return runner;
  });
  return row;
}

// A plain one: any Runner that takes the step gets it.
function plain(name: string, value: string): RunbookVariable {
  const row: RunbookVariable = new RunbookVariable();
  row.name = name;
  row.isSecret = false;
  row.value = value;
  return row;
}

type VariableQuery = {
  projectId: ObjectID;
  // A runbook's id for its own variables; IS NULL for the global ones.
  runbookId: unknown;
  name: unknown;
};

// Whether a query reads the global variables: those of no runbook.
function readsGlobalVariables(query: VariableQuery): boolean {
  const getSql: unknown = (query.runbookId as { getSql?: unknown })?.getSql;

  return (
    typeof getSql === "function" &&
    (getSql as (alias: string) => string)("runbookId") === "(runbookId IS NULL)"
  );
}

function variableQueries(spy: jest.SpyInstance): Array<VariableQuery> {
  return spy.mock.calls.map((call: Array<unknown>): VariableQuery => {
    return (call[0] as { query: VariableQuery }).query;
  });
}

describe("the Runner ingress, for a global Runner", () => {
  let claimGlobalSpy: jest.SpyInstance;
  let claimOwnSpy: jest.SpyInstance;
  let submitSpy: jest.SpyInstance;
  let executionSpy: jest.SpyInstance;
  let variablesSpy: jest.SpyInstance;
  // The project's global variables, and the runbook's own.
  let globalRows: Array<RunbookVariable>;
  let localRows: Array<RunbookVariable>;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  let pickedSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(RunnerService, "heartbeat").mockResolvedValue(undefined);
    // Whether a code repository picks the Runner: none does here.
    pickedSpy = jest
      .spyOn(CodeRepositoryRunnerChoice, "doesRunnerWorkInARepository")
      .mockResolvedValue(false);
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
        execution.runbookId = RUNBOOK_ID;
        execution.inputs = { host: "web-1" };
        execution.triggerType = RunbookTriggerType.Webhook;
        return execution;
      });

    globalRows = [secret("API_TOKEN", "tok-123")];
    localRows = [];

    variablesSpy = jest
      .spyOn(RunbookVariableService, "findBy")
      .mockImplementation(
        async (args: unknown): Promise<Array<RunbookVariable>> => {
          const query: VariableQuery = (args as { query: VariableQuery }).query;
          return readsGlobalVariables(query) ? globalRows : localRows;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /heartbeat", () => {
    test("tells a global Runner it is one, that it runs JavaScript steps, and that it takes code fixes", async () => {
      await callRoute({ uri: HEARTBEAT_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        isGlobalRunner: true,
        globalStepTypes: [RunbookStepType.JavaScript],
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      });
    });

    test("grants a global Runner code fixes whether or not a repository names it, and never AI commands, whatever its row says", async () => {
      for (const picked of [true, false]) {
        pickedSpy.mockResolvedValue(picked);

        await callRoute({
          uri: HEARTBEAT_ROUTE,
          agent: globalRunner({
            canRunAiCommands: true,
          }),
        });

        // It takes the repositories on the Global Runner: no pick is asked about.
        expect(pickedSpy).not.toHaveBeenCalled();

        expect(
          (lastJsonResponse()["capabilities"] as JSONObject)[
            "canRunCodeFixTasks"
          ],
        ).toBe(true);
        expect(
          (lastJsonResponse()["capabilities"] as JSONObject)[
            "canRunAiCommands"
          ],
        ).toBe(false);
      }
    });

    test("a paused global Runner (Runs Runbooks off) still takes code fixes", async () => {
      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: globalRunner({ canRunRunbooks: false }),
      });

      expect(
        (lastJsonResponse()["capabilities"] as JSONObject)[
          "canRunCodeFixTasks"
        ],
      ).toBe(true);
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

      // Read from the step's own project, its global variables only.
      const queries: Array<VariableQuery> = variableQueries(variablesSpy);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.projectId.toString()).toBe(STEP_PROJECT_ID.toString());
      expect(readsGlobalVariables(queries[0]!)).toBe(true);

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["jobId"]).toBe(JOB_ID);
      expect(job["runsOnGlobalRunner"]).toBe(true);
      expect(job["stepType"]).toBe(RunbookStepType.JavaScript);
      expect(job["script"]).toBe(
        "await axios.post('https://hooks.example.com', { token: 'tok-123' });",
      );
      // The secrets handed over, so the Runner hides them in what it prints.
      expect(job["secretValues"]).toEqual(["tok-123"]);
      expect(job).not.toHaveProperty("credential");
      expect(submitSpy).not.toHaveBeenCalled();
    });

    test("a plain variable is handed over whatever its secret switches, and is not hidden", async () => {
      globalRows = [plain("HOOK_URL", "https://hooks.example.com/run")];
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script: "await axios.post('{{global.variables.HOOK_URL}}');",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["script"]).toBe(
        "await axios.post('https://hooks.example.com/run');",
      );
      expect(job).not.toHaveProperty("secretValues");
    });

    test("a step written with the old {{runbookSecrets.NAME}} reads the global variable of that name", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script: "const token = '{{runbookSecrets.API_TOKEN}}';",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect((lastJsonResponse()["job"] as JSONObject)["script"]).toBe(
        "const token = 'tok-123';",
      );
    });

    test("a runbook's own variable is read from the runbook of the step's run, in the step's project", async () => {
      localRows = [plain("NAMESPACE", "checkout")];
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script: "const ns = '{{local.variables.NAMESPACE}}';",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      const queries: Array<VariableQuery> = variableQueries(variablesSpy);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.projectId.toString()).toBe(STEP_PROJECT_ID.toString());
      expect(readsGlobalVariables(queries[0]!)).toBe(false);
      expect(String(queries[0]!.runbookId)).toBe(RUNBOOK_ID.toString());
      expect((lastJsonResponse()["job"] as JSONObject)["script"]).toBe(
        "const ns = 'checkout';",
      );
    });

    test("a runbook's own variable of a run of another project is never read", async () => {
      executionSpy.mockImplementation(async (): Promise<RunbookExecution> => {
        const execution: RunbookExecution = new RunbookExecution();
        execution.projectId = RUNNER_PROJECT_ID;
        execution.runbookId = RUNBOOK_ID;
        return execution;
      });
      localRows = [plain("NAMESPACE", "someone-elses")];
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script: "const ns = '{{local.variables.NAMESPACE}}';",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(variablesSpy).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(
        'This step names variables it cannot use, so it was not run: "NAMESPACE" is a runbook\'s own variable, and this step is not part of a runbook run.',
      );
    });

    test("hands over the run's inputs from the step's own project", async () => {
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["inputs"]).toEqual({ host: "web-1" });
      expect(job["trigger"]).toBe(RunbookTriggerType.Webhook);
      expect(
        (executionSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
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
      globalRows = [
        secret("API_TOKEN", "tok-123"),
        secret("DB_PASSWORD", "db-pass-456", { globalRunners: false }),
      ];
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          script:
            "const a = '{{global.variables.API_TOKEN}}'; const b = '{{ global.variables.DB_PASSWORD }}';",
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
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
        'This step names variables it cannot use, so it was not run: global Runners may not use the secret "DB_PASSWORD" (turn on "Global Runners can use it" for it, or pick one of your own Runners for the step).',
      );
      // No value is ever in the message.
      expect(result.errorMessage).not.toContain("tok-123");
      expect(result.errorMessage).not.toContain("db-pass-456");
    });

    test("a secret with no value counts as one it may not use", async () => {
      globalRows = [secret("API_TOKEN", "")];
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(
        'This step names variables it cannot use, so it was not run: the secret "API_TOKEN" has no value (replace its value).',
      );
    });

    test("a variable that is not there fails the step, saying where to add it", async () => {
      globalRows = [];
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(
        'This step names variables it cannot use, so it was not run: there is no global variable named "API_TOKEN" (Runbooks → Settings → Global Variables).',
      );
    });

    test("a secret for a project's own Runners only is never handed to a global Runner, even when it lists the global Runner", async () => {
      globalRows = [
        secret("API_TOKEN", "tok-123", {
          globalRunners: false,
          runners: [GLOBAL_RUNNER_ID],
        }),
      ];
      claimGlobalSpy.mockResolvedValue(claimedGlobalJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toContain('global Runners may not use the secret "API_TOKEN"');
    });

    test("a step with no variable placeholder is handed over without reading any", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({ script: "return 1 + 1;" }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect((lastJsonResponse()["job"] as JSONObject)["jobId"]).toBe(JOB_ID);
      expect((lastJsonResponse()["job"] as JSONObject)["script"]).toBe(
        "return 1 + 1;",
      );
      expect(variablesSpy).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    /*
     * A global Runner was never handed a credential. Runbook credentials
     * were removed since: a step that still names one is failed for every
     * Runner, a global one too, saying how to fix the step.
     */
    test("a step carrying a credential is failed, saying how to fix the step", async () => {
      claimGlobalSpy.mockResolvedValue(
        claimedGlobalJob({
          payload: { credentialId: "b1000000-0000-4000-8000-0000000000e1" },
        }),
      );

      await callRoute({ uri: CLAIM_ROUTE, agent: globalRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(variablesSpy).not.toHaveBeenCalled();
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.REMOVED_CREDENTIAL_STEP_REFUSAL);
      expect(RunnerIngressAPI.REMOVED_CREDENTIAL_STEP_REFUSAL).toContain(
        "Turn into a script step",
      );
    });
  });

  describe("negative control: a project's own Runner", () => {
    function ownJob(): RunnerJob {
      return claimedGlobalJob({
        projectId: RUNNER_PROJECT_ID,
        runsOnGlobalRunner: false,
        targetAgentId: PROJECT_RUNNER_ID,
      });
    }

    test("claims its own lane, and its secrets are held to its own project", async () => {
      globalRows = [
        secret("API_TOKEN", "tok-123", {
          globalRunners: false,
          runners: [PROJECT_RUNNER_ID],
        }),
      ];
      claimOwnSpy.mockResolvedValue(ownJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: projectRunner() });

      expect(claimGlobalSpy).not.toHaveBeenCalled();

      const queries: Array<VariableQuery> = variableQueries(variablesSpy);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.projectId.toString()).toBe(
        RUNNER_PROJECT_ID.toString(),
      );

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
      expect(job["script"]).toContain("token: 'tok-123'");
      expect(job["secretValues"]).toEqual(["tok-123"]);
    });

    test("a secret that does not list the Runner is not handed to it, global switch or not", async () => {
      globalRows = [secret("API_TOKEN", "tok-123", { globalRunners: true })];
      claimOwnSpy.mockResolvedValue(ownJob());

      await callRoute({ uri: CLAIM_ROUTE, agent: projectRunner() });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(
        'This step names variables it cannot use, so it was not run: this Runner may not use the secret "API_TOKEN" (add it to the Runners of that variable, or pick one of its Runners for the step).',
      );
    });
  });
});
