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
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "Common/Types/Runbook/RunbookStep";
import { getKubectlScriptForLegacyKubernetesStep } from "Common/Types/Runbook/RunbookLegacySteps";
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
 *   - a kubectl step moved from a Kubernetes action, whose job still
 *     carries the action it kept (queued before runbook credentials were
 *     removed): such a Runner is told to update - it was handed the action
 *     and its credential - and a newer one the script and the kubeconfig;
 *   - a step written with a runbook credential and no script is failed,
 *     saying how to fix the step, and nothing is read for it;
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

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";
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

  /*
   * A step written with a credential was served with it, resolved for this
   * Runner. Runbook credentials were removed: one written through the API
   * and never moved to variables is failed, saying how to fix the step.
   */
  test("a step written with a credential is failed, saying how to fix it, and nothing is read", async () => {
    claimSpy.mockResolvedValue(
      claimedJob({
        stepType: RunbookStepType.SSH,
        payload: {
          credentialId: ObjectID.generate().toString(),
          command: "uptime",
        },
      }),
    );

    await callRoute({ uri: CLAIM_ROUTE });

    expect(lastJsonResponse()).toEqual({ job: null });
    expect(submitSpy.mock.calls[0]![0]).toEqual({
      jobId: new ObjectID(JOB_ID),
      agentId: RUNNER_ID,
      success: false,
      errorMessage: RunnerIngressAPI.REMOVED_CREDENTIAL_STEP_REFUSAL,
    });
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    expect(RunbookExecutionService.findOneById).not.toHaveBeenCalled();
  });

  /*
   * A step that names the machine's host keys: the Runner is handed them as
   * fingerprints, and signs in only when the machine presents one of them.
   * A Runner that does not say it checks them ("ssh-host-key") would sign
   * in without checking, so it is never handed the step.
   */
  describe("that names the machine's host keys", () => {
    // A throwaway host key; its fingerprint is the one ssh-keygen -l printed.
    const ED25519_KEY: string =
      "AAAAC3NzaC1lZDI1NTE5AAAAIFtux8m1u+wimvaBoFQoXsFnlH+H+VfhMAHNjDNrl2Q0";
    const ED25519_FINGERPRINT: string =
      "SHA256:gwsSZuUZNvG/8pOZ2G715I2GTVbDlhL4EKu6z7WLKNM";
    const RSA_FINGERPRINT: string =
      "SHA256:RbcFlZhe2wka/JUlPW5q7w6NacLcWWpI8xpwc4rkGgw";

    test("a Runner that checks them is handed them as fingerprints, a key's with its type", async () => {
      claimSpy.mockResolvedValue(
        sshJob({
          hostKey: `10.0.4.21 ssh-ed25519 ${ED25519_KEY}\n${RSA_FINGERPRINT}`,
        }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        body: { features: ["kubectl-script", "ssh-host-key"] },
      });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["credential"]).toEqual({
        credentialType: "SSH",
        hostname: "10.0.4.21",
        port: 22,
        username: "deploy",
        privateKey: PRIVATE_KEY,
        hostKeys: [
          { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
          { fingerprint: RSA_FINGERPRINT },
        ],
      });
      // The machine's keys are no secret: nothing more to hide.
      expect(job["secretValues"]).toEqual([PRIVATE_KEY]);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    test("a Runner too old to check them is not handed the step: it fails, saying to update the Runner, and nothing is read", async () => {
      claimSpy.mockResolvedValue(sshJob({ hostKey: ED25519_FINGERPRINT }));

      await callRoute({
        uri: CLAIM_ROUTE,
        body: { features: ["kubectl-script"] },
      });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(submitSpy.mock.calls[0]![0]).toEqual({
        jobId: new ObjectID(JOB_ID),
        agentId: RUNNER_ID,
        success: false,
        errorMessage: RunnerIngressAPI.SSH_HOST_KEY_NEEDS_NEWER_RUNNER,
      });
      expect(RunnerIngressAPI.SSH_HOST_KEY_NEEDS_NEWER_RUNNER).toBe(
        "This SSH step checks the machine's host key, and this Runner is too old to check one, so it was not run. Update the Runner to your server's version (pull its image again and restart it), then run the runbook again.",
      );
      expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
      expect(JSON.stringify(submitSpy.mock.calls)).not.toContain("OPENSSH");
    });

    test("a Runner older than features is not handed it either", async () => {
      claimSpy.mockResolvedValue(sshJob({ hostKey: ED25519_FINGERPRINT }));

      await callRoute({ uri: CLAIM_ROUTE, body: {} });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.SSH_HOST_KEY_NEEDS_NEWER_RUNNER);
    });

    test("a step that names none is handed to an older Runner as before, with no host keys", async () => {
      claimSpy.mockResolvedValue(sshJob());

      await callRoute({ uri: CLAIM_ROUTE, body: {} });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["credential"]).not.toHaveProperty("hostKeys");
      expect(submitSpy).not.toHaveBeenCalled();
    });

    test("a line that is not a key fails the step, saying what to put there, and nothing secret is handed over", async () => {
      claimSpy.mockResolvedValue(
        sshJob({ hostKey: `${ED25519_FINGERPRINT}\nthe usual one` }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        body: { features: ["kubectl-script", "ssh-host-key"] },
      });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(
        "This SSH step's Host key has a line that is neither a SHA256 fingerprint nor a public key, so it was not run. Open the step and put the machine's SHA256 fingerprint, or its public key as ssh-keyscan prints it, one per line.",
      );
      expect(JSON.stringify(submitSpy.mock.calls)).not.toContain("OPENSSH");
    });
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
 * A kubectl step the data migration moved from a Kubernetes action kept
 * that action and its credential (RunbookLegacySteps), and its job carried
 * them beside the script (as "legacyStep"), for a Runner older than kubectl
 * scripts - which was handed the action and the credential. Runbook
 * credentials were removed, and that fallback with them: a job queued
 * before still carries the action, and is served as every kubectl step is.
 * A job written with a credential and no script is failed, saying how to
 * fix the step.
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

  // The job the Worker sent for a moved step before the removal.
  function movedJob(legacy: JSONObject, legacyStep?: JSONObject): RunnerJob {
    return claimedJob({
      stepType: RunbookStepType.Kubernetes,
      payload: {
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
        legacyStep: legacyStep || { ...legacy },
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

  test.each([
    ["no features at all", {}],
    ["features it does not have", { features: ["something-newer"] }],
    ["features that are not a list", { features: "kubectl-script" }],
  ])(
    "a Runner older than kubectl scripts (a claim with %s) is told to update, never handed the action or a credential",
    async (_label: string, body: JSONObject) => {
      claimSpy.mockResolvedValue(movedJob(RESTART));

      await callRoute({ uri: CLAIM_ROUTE, body });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER);
      expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
      expect(JSON.stringify(lastJsonResponse())).not.toContain(
        LEGACY_CREDENTIAL_ID,
      );
    },
  );

  test.each([
    ["a restart", RESTART],
    ["a scale to zero", SCALE],
  ])(
    "%s: a Runner that runs kubectl scripts is handed the script and the kubeconfig, never the action or the credential",
    async (_label: string, legacy: JSONObject) => {
      claimSpy.mockResolvedValue(movedJob(legacy));

      await callRoute({
        uri: CLAIM_ROUTE,
        body: { features: ["kubectl-script"] },
      });

      const job: JSONObject = lastJsonResponse()["job"] as JSONObject;

      expect(job["payload"]).toEqual({
        script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
      });
      expect(job["credential"]).toEqual({
        credentialType: "Kubeconfig",
        kubeconfig: KUBECONFIG,
      });
      expect(job["secretValues"]).toEqual([KUBECONFIG]);
      expect(job["inputs"]).toEqual({});
      expect(JSON.stringify(job)).not.toContain(LEGACY_CREDENTIAL_ID);
      expect(JSON.stringify(job)).not.toContain("legacyStep");
      expect(submitSpy).not.toHaveBeenCalled();
    },
  );

  test("whatever a job's legacy step carries is never handed over", async () => {
    claimSpy.mockResolvedValue(
      movedJob(RESTART, {
        ...RESTART,
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        token: "smuggled",
      }),
    );

    await callRoute({
      uri: CLAIM_ROUTE,
      body: { features: ["kubectl-script"] },
    });

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job["payload"]).toEqual({
      script: getKubectlScriptForLegacyKubernetesStep(RESTART as never),
    });
    expect(JSON.stringify(job)).not.toContain("smuggled");
  });

  test.each([
    ["a restart", RESTART],
    ["a scale to zero", SCALE],
  ])(
    "%s, as it was written before kubectl scripts (a credential, no script), is failed for every Runner, saying how to fix the step",
    async (_label: string, legacy: JSONObject) => {
      for (const body of [{}, { features: ["kubectl-script"] }]) {
        submitSpy.mockClear();
        claimSpy.mockResolvedValue(legacyJob(legacy));

        await callRoute({ uri: CLAIM_ROUTE, body });

        expect(lastJsonResponse()).toEqual({ job: null });
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(
          (submitSpy.mock.calls[0]![0] as { errorMessage: string })
            .errorMessage,
        ).toBe(RunnerIngressAPI.REMOVED_CREDENTIAL_STEP_REFUSAL);
      }

      expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    },
  );

  test("a step written as a script, or changed since it was moved, carries no action: an older Runner is told to update", async () => {
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
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
  });

  test("a kubernetes-agent Runner is still served kubectl only, and never handed a secret", async () => {
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
    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();

    const job: JSONObject = lastJsonResponse()["job"] as JSONObject;
    expect(job).not.toHaveProperty("credential");
    expect(job).not.toHaveProperty("secretValues");
  });

  test("an AI-composed command that names a runbook credential is failed, whatever the Runner's features", async () => {
    for (const body of [{}, { features: ["kubectl-script"] }]) {
      submitSpy.mockClear();
      claimSpy.mockResolvedValue(
        claimedJob({
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.SSH,
          payload: {
            credentialId: ObjectID.generate().toString(),
            command: "uptime",
          },
        }),
      );

      await callRoute({
        uri: CLAIM_ROUTE,
        body,
        runner: { canRunAiCommands: true },
      });

      expect(lastJsonResponse()).toEqual({ job: null });
      expect(
        (submitSpy.mock.calls[0]![0] as { errorMessage: string }).errorMessage,
      ).toBe(RunnerIngressAPI.REMOVED_CREDENTIAL_COMMAND_REFUSAL);
    }

    expect(RunbookVariableService.findBy).not.toHaveBeenCalled();
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
