import logger from "Common/Server/Utils/Logger";
import KubernetesClusterAiAccessService, {
  KubernetesAgentRegistrationRefusedException,
  getKubernetesAgentRunnerNameForCluster,
} from "Common/Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import RunnerService from "Common/Server/Services/RunnerService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "Common/Models/DatabaseModels/Runner";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAgentRegistrationRefusalReason,
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  isTransientKubernetesAgentRegistrationRefusal,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
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
 * Contract under test — what POST /runner-ingest/register-kubernetes-agent
 * puts on the wire when it refuses a registration.
 *
 * The Runner retries a refused registration forever, and used to read every
 * 403 as "the previous instance is still online, no action needed". Two of
 * the three refusals never clear on their own, so every 403 from this route
 * says WHICH refusal it is:
 *
 *   - status 403 and a JSON body { message, reason }, reason being one of
 *     KubernetesAgentRegistrationRefusalReason;
 *   - previous_instance_online (the only one that clears on its own) also
 *     carries retryAfterSeconds — when the previous instance's last
 *     heartbeat ages out of the alive window, never less than 1 — and the
 *     same value as a Retry-After header;
 *   - the two refusals that need an operator carry neither, and lead with
 *     the instruction.
 *
 * Driven end to end from the real service (its database reads stubbed) to
 * the real Response serializer, so the reason the service decides is the
 * reason the Runner reads. And the registration hands the service the
 * Runner's whole posture — write namespaces, pod namespace and node
 * operations included — not just three fields of it.
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

function mockRegisterRoute(
  method: string,
): (uri: string, ...handlers: Array<RouterFunction>) => void {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      handlerFunction: handlers[handlers.length - 1]!,
    });
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

// VMUtil -> isolated-vm, a native binding not installed for this suite.
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: { loadForAgent: jest.fn(), populateInScript: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Runbook/Utils/Credentials", () => {
  return {
    __esModule: true,
    default: { resolveForJob: jest.fn() },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";

const REGISTER_ROUTE: string = "/register-kubernetes-agent";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const REFUSAL_REASONS: Array<KubernetesAgentRegistrationRefusalReason> = [
  "previous_instance_online",
  "runner_holds_more_than_defaults",
  "runner_belongs_to_another_cluster",
];

// What went over the wire: the status, the headers set and the body sent.
interface WireResponse {
  statusCode: number | undefined;
  headers: Dictionary<string>;
  body: JSONObject | undefined;
  thrownToNext: unknown;
}

async function register(body: JSONObject): Promise<WireResponse> {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === REGISTER_ROUTE;
  });

  if (!route) {
    throw new Error(`Route POST ${REGISTER_ROUTE} was never registered`);
  }

  const wire: WireResponse = {
    statusCode: undefined,
    headers: {},
    body: undefined,
    thrownToNext: undefined,
  };

  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body,
    projectId: PROJECT_ID,
  } as unknown as ExpressRequest;

  const res: Record<string, unknown> = {};
  res["status"] = jest.fn().mockImplementation((code: unknown) => {
    wire.statusCode = code as number;
    return res;
  });
  res["send"] = jest.fn().mockImplementation((sent: unknown) => {
    wire.body = sent as JSONObject;
    return res;
  });
  res["set"] = jest.fn().mockImplementation((name: unknown, value: unknown) => {
    wire.headers[String(name)] = String(value);
    return res;
  });

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  wire.thrownToNext = next.mock.calls[0] ? next.mock.calls[0][0] : undefined;

  return wire;
}

function cluster(): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(600),
    aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(600),
  } as unknown as KubernetesCluster;
}

function agentRunner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: getKubernetesAgentRunnerNameForCluster("prod-us"),
    key: "current-key",
    lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    canRunAiCommands: true,
    hostInfo: {
      kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
    },
    ...overrides,
  } as unknown as Runner;
}

describe("POST /register-kubernetes-agent refusals on the wire", () => {
  let runnerLookup: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    for (const level of ["warn", "info", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }

    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(cluster());
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(cluster());
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(agentRunner());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("previous_instance_online: 403, the reason, and when to retry in the body and as Retry-After", async () => {
    runnerLookup.mockResolvedValue(
      agentRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(2) }),
    );

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("previous_instance_online");
    expect(String(wire.body!["message"])).toContain("is online");

    // Admitted once the last heartbeat is 5 minutes old: about 3 minutes away.
    const retryAfterSeconds: number = wire.body!["retryAfterSeconds"] as number;
    expect(Number.isInteger(retryAfterSeconds)).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(170);
    expect(retryAfterSeconds).toBeLessThanOrEqual(181);
    expect(wire.headers["Retry-After"]).toBe(String(retryAfterSeconds));
  });

  /*
   * Liveness is compared to the second, so this is as close to the end of
   * the window as a request can still be refused reliably; the floor of 1s
   * itself is pinned on getPreviousInstanceRetryAfterSeconds.
   */
  test("previous_instance_online's hint shrinks as the window closes, and is never below a second", async () => {
    // Heartbeated 4m58s ago: admitted in about two seconds.
    runnerLookup.mockResolvedValue(
      agentRunner({
        lastAlive: new Date(Date.now() - (5 * 60 * 1000 - 2000)),
      }),
    );

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.body!["reason"]).toBe("previous_instance_online");
    const retryAfterSeconds: number = wire.body!["retryAfterSeconds"] as number;
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(3);
    expect(wire.headers["Retry-After"]).toBe(String(retryAfterSeconds));
  });

  test("runner_holds_more_than_defaults: 403 with the reason and the instruction first, and no retry hint", async () => {
    runnerLookup.mockResolvedValue(agentRunner({ canRunRunbooks: true }));

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("runner_holds_more_than_defaults");
    expect(String(wire.body!["message"])).toMatch(
      /^Under Project Settings → Runners, on Runner "kubernetes-agent\/prod-us": turn off "Runs Runbooks"/,
    );
    expect(wire.body).not.toHaveProperty("retryAfterSeconds");
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("runner_belongs_to_another_cluster: 403 with the reason and no retry hint", async () => {
    runnerLookup.mockResolvedValue(
      agentRunner({
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
        },
      }),
    );

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("runner_belongs_to_another_cluster");
    expect(String(wire.body!["message"])).toMatch(/^Rename or delete Runner/);
    expect(wire.body).not.toHaveProperty("retryAfterSeconds");
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("every refusal names a reason the Runner knows, and only the online one is transient", async () => {
    const scenarios: Array<Runner> = [
      agentRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(1) }),
      agentRunner({ canRunCodeFixTasks: true }),
      agentRunner({
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "staging" },
        },
      }),
    ];
    const seen: Array<string> = [];

    for (const runner of scenarios) {
      runnerLookup.mockResolvedValue(runner);

      const wire: WireResponse = await register({ clusterName: "prod-us" });
      const reason: string = String(wire.body!["reason"]);

      expect(wire.statusCode).toBe(403);
      expect(REFUSAL_REASONS).toContain(reason);
      expect(isTransientKubernetesAgentRegistrationRefusal(reason)).toBe(
        wire.body!["retryAfterSeconds"] !== undefined,
      );
      seen.push(reason);
    }

    expect(seen.sort()).toEqual([...REFUSAL_REASONS].sort());
  });

  /*
   * Negative controls: only a registration refusal is answered this way.
   * Any other error still goes to the error handler (which sends
   * `{ message }` with the exception's own status), and an admitted
   * registration still answers 200.
   */
  test("negative control: any other error still reaches the error handler", async () => {
    jest
      .spyOn(KubernetesClusterAiAccessService, "registerKubernetesAgentRunner")
      .mockRejectedValue(new ForbiddenException("some other refusal"));

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeInstanceOf(ForbiddenException);
    expect(wire.thrownToNext).not.toBeInstanceOf(
      KubernetesAgentRegistrationRefusedException,
    );
    expect(wire.statusCode).toBeUndefined();
  });

  test("negative control: an admitted registration answers 200 with the Runner identity", async () => {
    jest
      .spyOn(KubernetesClusterAiAccessService, "registerKubernetesAgentRunner")
      .mockResolvedValue({
        runnerId: RUNNER_ID,
        runnerKey: "new-key",
        clusterId: CLUSTER_ID,
        isBoundToCluster: true,
        isFirstBind: false,
        bindingState: "already_bound",
      });

    const wire: WireResponse = await register({ clusterName: "prod-us" });

    expect(wire.statusCode).toBe(200);
    expect(wire.body!["runnerKey"]).toBe("new-key");
    expect(wire.body).not.toHaveProperty("reason");
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });
});

describe("POST /register-kubernetes-agent hands the service the Runner's whole posture", () => {
  let registerSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    registerSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "registerKubernetesAgentRunner")
      .mockResolvedValue({
        runnerId: RUNNER_ID,
        runnerKey: "new-key",
        clusterId: CLUSTER_ID,
        isBoundToCluster: true,
        isFirstBind: true,
        bindingState: "first_bind",
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function postedPosture(): KubernetesRunnerPosture {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    return (
      registerSpy.mock.calls[0]![0] as { posture: KubernetesRunnerPosture }
    ).posture;
  }

  /*
   * Round one kept only allowWrites, kubectlVersion and agentChartVersion,
   * so after every registration the stored posture said the write scope
   * was unknown until the first heartbeat.
   */
  test("carries the write namespaces, the pod's namespace and the node-operations switch", async () => {
    await register({
      clusterName: "prod-us",
      allowWrites: true,
      kubectlVersion: "v1.31.4",
      agentChartVersion: "0.9.0",
      writeNamespaces: ["web", "api"],
      podNamespace: "oneuptime-agent",
      allowNodeOperations: false,
    });

    expect(postedPosture()).toEqual({
      allowWrites: true,
      kubectlVersion: "v1.31.4",
      agentChartVersion: "0.9.0",
      writeNamespaces: ["web", "api"],
      podNamespace: "oneuptime-agent",
      allowNodeOperations: false,
    });
  });

  test("reads them the way a heartbeat's are read: malformed entries dropped", async () => {
    await register({
      clusterName: "prod-us",
      allowWrites: "true" as never,
      writeNamespaces: ["web", "", 42, null] as never,
      podNamespace: 7 as never,
      allowNodeOperations: "false" as never,
    });

    const posture: KubernetesRunnerPosture = postedPosture();
    expect(posture.allowWrites).toBe(false);
    expect(posture.writeNamespaces).toEqual(["web"]);
    expect(posture.podNamespace).toBeUndefined();
    expect(posture.allowNodeOperations).toBeUndefined();
  });

  test("negative control: a Runner that does not report them leaves them unknown", async () => {
    await register({ clusterName: "prod-us", allowWrites: true });

    const posture: KubernetesRunnerPosture = postedPosture();
    expect(posture.allowWrites).toBe(true);
    expect(posture.writeNamespaces).toBeUndefined();
    expect(posture.podNamespace).toBeUndefined();
    expect(posture.allowNodeOperations).toBeUndefined();
  });

  test("never lets the body claim a cluster or in-cluster posture: the service sets those itself", async () => {
    await register({
      clusterName: "prod-us",
      clusterIdentifier: "someone-else",
      inCluster: false,
    });

    const posture: KubernetesRunnerPosture = postedPosture();
    expect(posture).not.toHaveProperty("clusterIdentifier");
    expect(posture).not.toHaveProperty("inCluster");
  });
});
