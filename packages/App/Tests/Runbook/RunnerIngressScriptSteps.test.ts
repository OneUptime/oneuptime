import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookVariableService from "Common/Server/Services/RunbookVariableService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
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
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "Common/Types/Runbook/RunbookStep";
import {
  LEGACY_KUBERNETES_STEP_JOB_KEY,
  getKubectlScriptForLegacyKubernetesStep,
  getLegacyKubernetesStepForOlderRunner,
} from "Common/Types/Runbook/RunbookLegacySteps";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
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
 * What a project's Runner is handed for a step that takes a script, and
 * what is stored of what it sends back.
 *
 *   - an SSH step: its machine and script filled in, the key or password it
 *     signs in with as the credential - for the Runner the secret lists only
 *     - and the secrets handed over named, so the Runner hides them;
 *   - a kubectl step: its script, and its kubeconfig as the credential; a
 *     Runner older than kubectl scripts (its claim names no
 *     "kubectl-script") is not handed one: the step fails, saying to update
 *     the Runner, rather than running an action it never had;
 *   - a kubectl step moved from a Kubernetes action, which kept the action:
 *     such a Runner is handed the action and its credential, exactly as
 *     before the move, and nothing of the script's; a newer one the script;
 *   - the result the Runner sends is stored with every secret the step was
 *     handed hidden, whatever the Runner did.
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
import RunbookCredentialsUtil from "../../FeatureSet/Runbook/Utils/Credentials";
import { RunnerExpressRequest } from "../../FeatureSet/Runbook/Types/Request";

const CLAIM_ROUTE: string = "/claim-next-job";
const RESULT_ROUTE: string = "/job/:jobId/result";

const RUNNER_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000a1",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000b1",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000c1",
);
const JOB_ID: string = "c1000000-0000-4000-8000-0000000000d1";

const PRIVATE_KEY: string =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==\n-----END OPENSSH PRIVATE KEY-----";
const KUBECONFIG: string =
  "apiVersion: v1\nkind: Config\nusers:\n- name: ci\n  user:\n    token: kube-token-0123456789abcdef0123456789";

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
  body?: JSONObject | undefined;
  params?: Dictionary<string>;
  // What the Runner row says beside its id and project.
  runner?: Record<string, unknown> | undefined;
}): Promise<{ thrownToNext: unknown }> {
  const req: RunnerExpressRequest = {
    params: data.params || ({} as Dictionary<string>),
    query: {},
    body: data.body || {},
    headers: {},
    runner: {
      id: RUNNER_ID,
      _id: RUNNER_ID.toString(),
      projectId: PROJECT_ID,
      name: "prod-bastion",
      isGlobalRunner: false,
      canRunRunbooks: true,
      ...(data.runner || {}),
    } as unknown as Runner,
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

function claimedJob(fields: Record<string, unknown>): RunnerJob {
  return Object.assign(new RunnerJob(), {
    _id: JOB_ID,
    projectId: PROJECT_ID,
    runbookExecutionId: EXECUTION_ID,
    origin: RunnerJobOrigin.Runbook,
    stepId: "step-1",
    script: "",
    timeoutInMs: 30_000,
    status: RunnerJobStatus.Claimed,
    assignedAgentId: RUNNER_ID,
    ...fields,
  });
}

function secret(
  name: string,
  value: string,
  runners: Array<ObjectID>,
): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    name,
    isSecret: true,
    secretValue: value,
    isAvailableToGlobalRunners: false,
    runners: runners.map((id: ObjectID): Runner => {
      return Object.assign(new Runner(), { _id: id.toString() });
    }),
  });
}

let rows: Array<RunbookVariable>;
let claimSpy: jest.SpyInstance;
let submitSpy: jest.SpyInstance;

beforeAll(() => {
  mockRoutes.length = 0;
  new RunnerIngressAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  rows = [
    Object.assign(new RunbookVariable(), {
      name: "DB_HOST",
      isSecret: false,
      value: "10.0.4.21",
    }),
    secret("DB_KEY", PRIVATE_KEY, [RUNNER_ID]),
    secret("PROD_KUBECONFIG", KUBECONFIG, [RUNNER_ID]),
  ];

  jest
    .spyOn(RunbookVariableService, "findBy")
    .mockImplementation(async (): Promise<never> => {
      return rows as never;
    });

  claimSpy = jest
    .spyOn(RunnerJobService, "claimNextJob")
    .mockResolvedValue(null);
  submitSpy = jest
    .spyOn(RunnerJobService, "submitResult")
    .mockResolvedValue(true);

  jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockImplementation(async (): Promise<RunbookExecution> => {
      return Object.assign(new RunbookExecution(), {
        projectId: PROJECT_ID,
        inputs: {},
      });
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's Runner claims an SSH step that takes a script", () => {
  function sshJob(payload: JSONObject = {}): RunnerJob {
    return claimedJob({
      stepType: RunbookStepType.SSH,
      payload: {
        host: "{{global.variables.DB_HOST}}",
        username: "deploy",
        port: 22,
        signIn: "{{global.variables.DB_KEY}}",
        script: "uptime",
        ...payload,
      },
    });
  }

  test("is handed the machine, the script and the key it signs in with", async () => {
    claimSpy.mockResolvedValue(sshJob());

    await callRoute({ uri: CLAIM_ROUTE });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

    expect(job["stepType"]).toBe(RunbookStepType.SSH);
    expect(job["payload"]).toEqual({
      host: "10.0.4.21",
      username: "deploy",
      port: 22,
      script: "uptime",
      command: "uptime",
    });
    expect(job["credential"]).toEqual({
      credentialType: "SSH",
      hostname: "10.0.4.21",
      port: 22,
      username: "deploy",
      privateKey: PRIVATE_KEY,
    });
    expect(job["secretValues"]).toEqual([PRIVATE_KEY]);
    // A credential of the old kind is never looked up for it.
    expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    // Its script runs on another machine: no run inputs.
    expect(job).not.toHaveProperty("inputs");
    expect(submitSpy).not.toHaveBeenCalled();
  });

  test("a key the Runner is not one of the Runners of fails the step, and nothing secret is handed over", async () => {
    rows[1] = secret("DB_KEY", PRIVATE_KEY, [ObjectID.generate()]);
    claimSpy.mockResolvedValue(sshJob());

    await callRoute({ uri: CLAIM_ROUTE });

    expect(lastJsonResponse()).toEqual({ job: null });

    const result: { success: boolean; errorMessage: string } = submitSpy.mock
      .calls[0]![0] as { success: boolean; errorMessage: string };
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      'This step names variables it cannot use, so it was not run: this Runner may not use the secret "DB_KEY" (add it to the Runners of that variable, or pick one of its Runners for the step).',
    );
    expect(JSON.stringify(submitSpy.mock.calls)).not.toContain("OPENSSH");
  });

  test("a step written with a credential is served as it always was", async () => {
    const credentialId: string = ObjectID.generate().toString();
    claimSpy.mockResolvedValue(
      claimedJob({
        stepType: RunbookStepType.SSH,
        payload: { credentialId, command: "uptime" },
      }),
    );
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue({ hostname: "h", username: "u", password: "p" });

    await callRoute({ uri: CLAIM_ROUTE });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["payload"]).toEqual({ credentialId, command: "uptime" });
    expect(job["credential"]).toEqual({
      hostname: "h",
      username: "u",
      password: "p",
    });
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
  });
});

describe("a project's Runner claims a kubectl step that takes a script", () => {
  function kubectlJob(payload: JSONObject = {}): RunnerJob {
    return claimedJob({
      stepType: RunbookStepType.Kubernetes,
      payload: {
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        script: "kubectl get pods",
        ...payload,
      },
    });
  }

  test("is handed the script and the kubeconfig, when it says it runs kubectl scripts", async () => {
    claimSpy.mockResolvedValue(kubectlJob());

    await callRoute({
      uri: CLAIM_ROUTE,
      body: { features: ["kubectl-script"] },
    });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

    expect(job["payload"]).toEqual({ script: "kubectl get pods" });
    expect(job["credential"]).toEqual({
      credentialType: "Kubeconfig",
      kubeconfig: KUBECONFIG,
    });
    expect(job["secretValues"]).toEqual([KUBECONFIG]);
    // It runs with bash on the Runner, as a Bash step does: the run's inputs too.
    expect(job["inputs"]).toEqual({});
  });

  test("a Runner older than kubectl scripts is not handed one: the step fails, saying to update it", async () => {
    claimSpy.mockResolvedValue(kubectlJob());

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    expect(lastJsonResponse()).toEqual({ job: null });
    expect(
      (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
    ).toBe(RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER);
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
  });

  test("on the Runner's own access, no credential is handed over", async () => {
    claimSpy.mockResolvedValue(kubectlJob({ kubeconfig: "" }));

    await callRoute({
      uri: CLAIM_ROUTE,
      body: { features: ["kubectl-script"] },
    });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job).not.toHaveProperty("credential");
    expect(job).not.toHaveProperty("secretValues");
  });
});

/*
 * A kubectl step the data migration moved from a Kubernetes action keeps
 * that action and its credential (RunbookLegacySteps), and its job carries
 * them beside the script (StepExecutors). A Runner older than kubectl
 * scripts - its claim names no "kubectl-script" - is handed the step as it
 * was written, exactly as before the move, and nothing more; a newer Runner
 * is handed the script and the kubeconfig, as for every kubectl step.
 */
describe("a kubectl step moved from a Kubernetes action", () => {
  const LEGACY_CREDENTIAL_ID: string = "c1000000-0000-4000-8000-0000000000e1";

  const RESTART: JSONObject = {
    credentialId: LEGACY_CREDENTIAL_ID,
    action: KubernetesAction.RestartWorkload,
    workloadKind: KubernetesWorkloadKind.Deployment,
    namespace: "web",
    workloadName: "api",
  };

  const SCALE: JSONObject = {
    credentialId: LEGACY_CREDENTIAL_ID,
    action: KubernetesAction.ScaleWorkload,
    workloadKind: KubernetesWorkloadKind.StatefulSet,
    namespace: "jobs",
    workloadName: "workers",
    replicas: 0,
  };

  // What the server resolves the credential to, for a Runner assigned to it.
  const KUBERNETES_CREDENTIAL: JSONObject = {
    credentialType: RunbookCredentialType.Kubernetes,
    apiServerUrl: "https://prod.example.com:6443",
    token: "sa-token-0123456789abcdef",
    caCertificate:
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  };

  // The job the Worker sends for a moved step (StepExecutors.runKubernetesStep).
  function movedJob(legacy: JSONObject, payload: JSONObject = {}): RunnerJob {
    const legacyStep: JSONObject | null = getLegacyKubernetesStepForOlderRunner(
      {
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
        ...legacy,
      },
    );

    expect(legacyStep).not.toBeNull();

    return claimedJob({
      stepType: RunbookStepType.Kubernetes,
      payload: {
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
        [LEGACY_KUBERNETES_STEP_JOB_KEY]: legacyStep,
        ...payload,
      },
    });
  }

  // The job the Worker sent for the same step before it was moved.
  function legacyJob(legacy: JSONObject): RunnerJob {
    return claimedJob({
      stepType: RunbookStepType.Kubernetes,
      payload: { ...legacy },
    });
  }

  beforeEach(() => {
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue(KUBERNETES_CREDENTIAL);
  });

  test.each([
    ["a restart", RESTART],
    ["a scale to zero", SCALE],
  ])(
    "%s: a Runner older than kubectl scripts is handed the action and its credential, exactly as before the move",
    async (_label: string, legacy: JSONObject) => {
      // Before the move: the step written with a credential.
      claimSpy.mockResolvedValue(legacyJob(legacy));
      await callRoute({ uri: CLAIM_ROUTE, body: {} });
      const before: JSONObject = lastJsonResponse()["job"] as JSONObject;

      // After it: the same Runner takes the moved step.
      claimSpy.mockResolvedValue(movedJob(legacy));
      await callRoute({ uri: CLAIM_ROUTE, body: {} });
      const after: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(after).toEqual(before);
      expect(after).toEqual({
        jobId: JOB_ID,
        runbookExecutionId: EXECUTION_ID.toString(),
        origin: RunnerJobOrigin.Runbook,
        stepId: "step-1",
        stepType: RunbookStepType.Kubernetes,
        script: "",
        timeoutInMs: 30_000,
        payload: legacy,
        credential: KUBERNETES_CREDENTIAL,
      });
      expect(submitSpy).not.toHaveBeenCalled();
    },
  );

  test("the credential is resolved for this Runner, in its project, and only as a Kubernetes credential", async () => {
    claimSpy.mockResolvedValue(movedJob(RESTART));

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledTimes(1);
    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledWith({
      credentialId: LEGACY_CREDENTIAL_ID,
      agentId: RUNNER_ID,
      projectId: PROJECT_ID,
      credentialType: RunbookCredentialType.Kubernetes,
    });
  });

  test("nothing of the script's is handed to it: no script, no kubeconfig, no variable read, no secret, no run inputs", async () => {
    claimSpy.mockResolvedValue(movedJob(RESTART));

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    const response: string = JSON.stringify(lastJsonResponse());

    // No variable is read for it, so no value of one can be handed over.
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    expect(RunbookExecutionService.findOneById).not.toHaveBeenCalled();
    expect(response).not.toContain("kube-token");
    expect(response).not.toContain("PROD_KUBECONFIG");
    expect(response).not.toContain("kubectl patch");
    expect(response).not.toContain(LEGACY_KUBERNETES_STEP_JOB_KEY);

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job).not.toHaveProperty("secretValues");
    expect(job).not.toHaveProperty("inputs");
    expect(job).not.toHaveProperty("trigger");
  });

  test("whatever else a job's legacy step carries is not handed over", async () => {
    claimSpy.mockResolvedValue(
      movedJob(RESTART, {
        [LEGACY_KUBERNETES_STEP_JOB_KEY]: {
          ...RESTART,
          kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
          token: "smuggled",
        },
      }),
    );

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["payload"]).toEqual(RESTART);
    expect(JSON.stringify(job)).not.toContain("smuggled");
  });

  test.each([
    ["no features at all", {}],
    ["features it does not have", { features: ["something-newer"] }],
    ["features that are not a list", { features: "kubectl-script" }],
  ])(
    "a claim with %s is an older Runner's",
    async (_label: string, body: JSONObject) => {
      claimSpy.mockResolvedValue(movedJob(RESTART));

      await callRoute({ uri: CLAIM_ROUTE, body });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
      expect(job["payload"]).toEqual(RESTART);
      expect(job["credential"]).toEqual(KUBERNETES_CREDENTIAL);
    },
  );

  test("a credential this Runner may not have fails the step with the reason, and nothing is handed over", async () => {
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue(null);
    claimSpy.mockResolvedValue(movedJob(RESTART));

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    expect(lastJsonResponse()).toEqual({ job: null });
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]![0]).toEqual({
      jobId: new ObjectID(JOB_ID),
      agentId: RUNNER_ID,
      success: false,
      errorMessage: RunnerIngressAPI.CREDENTIAL_NOT_AVAILABLE,
    });
  });

  test("a Runner that runs kubectl scripts is handed the script and the kubeconfig, never the action or the credential", async () => {
    claimSpy.mockResolvedValue(movedJob(SCALE));

    await callRoute({
      uri: CLAIM_ROUTE,
      body: { features: ["kubectl-script"] },
    });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

    expect(job["payload"]).toEqual({
      script: getKubectlScriptForLegacyKubernetesStep(SCALE as never),
    });
    expect(job["credential"]).toEqual({
      credentialType: "Kubeconfig",
      kubeconfig: KUBECONFIG,
    });
    expect(job["secretValues"]).toEqual([KUBECONFIG]);
    expect(job["inputs"]).toEqual({});
    expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    expect(JSON.stringify(job)).not.toContain(LEGACY_CREDENTIAL_ID);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  test("a step written as a script, or changed since it was moved, carries no action: an older Runner is told to update", async () => {
    // Its job carries no legacy step (StepExecutors leaves it out).
    claimSpy.mockResolvedValue(
      claimedJob({
        stepType: RunbookStepType.Kubernetes,
        payload: {
          kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
          script: "kubectl rollout restart deployment/api --namespace web",
        },
      }),
    );

    await callRoute({ uri: CLAIM_ROUTE, body: {} });

    expect(lastJsonResponse()).toEqual({ job: null });
    expect(
      (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
    ).toBe(RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER);
    expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
  });

  test.each([
    ["no credential", { ...RESTART, credentialId: "" }],
    ["no workload", { ...RESTART, workloadName: "" }],
  ])(
    "a legacy step with %s is no step to hand over: an older Runner is told to update",
    async (_label: string, legacyStep: JSONObject) => {
      claimSpy.mockResolvedValue(
        movedJob(RESTART, { [LEGACY_KUBERNETES_STEP_JOB_KEY]: legacyStep }),
      );

      await callRoute({ uri: CLAIM_ROUTE, body: {} });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER);
      expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    },
  );

  test("a kubernetes-agent Runner is still served kubectl only, and never handed the action's credential", async () => {
    claimSpy.mockResolvedValue(movedJob(RESTART));

    await callRoute({
      uri: CLAIM_ROUTE,
      body: {},
      runner: { name: "kubernetes-agent/prod", canRunAiCommands: true },
    });

    // It asks for kubectl only, so a Kubernetes step is never claimed for it ...
    expect(
      (claimSpy.mock.calls[0]![0] as { allowedStepTypes: Array<string> })
        .allowedStepTypes,
    ).toEqual([RunbookStepType.Kubectl]);

    // ... and one that reached it anyway carries no credential and no secret.
    expect(RunbookCredentialsUtil.resolveForJob).not.toHaveBeenCalled();
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job).not.toHaveProperty("credential");
    expect(job).not.toHaveProperty("secretValues");
  });

  test("an AI-composed command is served as before, whatever the Runner's features", async () => {
    const credentialId: string = ObjectID.generate().toString();
    (
      RunbookCredentialsUtil.resolveForJob as unknown as jest.Mock
    ).mockResolvedValue({ hostname: "h", username: "u", password: "p" });
    claimSpy.mockResolvedValue(
      claimedJob({
        origin: RunnerJobOrigin.AiRemediation,
        stepType: RunbookStepType.SSH,
        payload: { credentialId, command: "uptime" },
      }),
    );

    await callRoute({
      uri: CLAIM_ROUTE,
      body: {},
      runner: { canRunAiCommands: true },
    });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(job["payload"]).toEqual({ credentialId, command: "uptime" });
    expect(job["credential"]).toEqual({
      hostname: "h",
      username: "u",
      password: "p",
    });
    // The credential path it always took: no kind asked for, no variable read.
    expect(RunbookCredentialsUtil.resolveForJob).toHaveBeenCalledWith({
      credentialId,
      agentId: RUNNER_ID,
      projectId: PROJECT_ID,
    });
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    expect(job).not.toHaveProperty("secretValues");
  });
});

describe("what is stored of a result", () => {
  let queries: Array<{ sql: string; params: Array<unknown> }>;

  beforeEach(() => {
    submitSpy.mockRestore();
    queries = [];

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest
        .fn()
        .mockImplementation(
          async (sql: string, params: Array<unknown>): Promise<unknown> => {
            queries.push({ sql, params });
            return [[{ _id: JOB_ID }], 1];
          },
        ),
    } as never);

    jest.spyOn(RunnerJobService, "findOneBy").mockResolvedValue(
      claimedJob({
        stepType: RunbookStepType.SSH,
        payload: {
          host: "10.0.4.21",
          username: "deploy",
          signIn: "{{global.variables.DB_KEY}}",
          script: "cat ~/.ssh/id_ed25519",
        },
      }) as never,
    );
  });

  test("the secrets the step was handed are hidden, whatever the Runner sent", async () => {
    await callRoute({
      uri: RESULT_ROUTE,
      params: { jobId: JOB_ID },
      body: {
        success: true,
        exitCode: 0,
        output: `here it is:\n${PRIVATE_KEY}`,
      },
    });

    expect(lastJsonResponse()).toEqual({ accepted: true });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params[1]).toBe(`here it is:\n${REDACTED_SECRET_TEXT}`);
    expect(JSON.stringify(queries)).not.toContain("OPENSSH");

    // Read for this Runner's own job only.
    const read: { query: Record<string, unknown> } = (
      RunnerJobService.findOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as { query: Record<string, unknown> };
    expect(String(read.query["assignedAgentId"])).toBe(RUNNER_ID.toString());
  });

  test("a result with no text reads nothing", async () => {
    await callRoute({
      uri: RESULT_ROUTE,
      params: { jobId: JOB_ID },
      body: { success: true, exitCode: 0 },
    });

    expect(RunnerJobService.findOneBy).not.toHaveBeenCalled();
    expect(lastJsonResponse()).toEqual({ accepted: true });
  });
});
