import logger from "Common/Server/Utils/Logger";
import KubernetesAiAgentService, {
  KubernetesAiAgentRegistrationRefusedException,
  KubernetesAiAgentRegistrationResult,
} from "Common/Server/Services/KubernetesAiAgentService";
import KubernetesAiAgentJobService from "Common/Server/Services/KubernetesAiAgentJobService";
import KubernetesClusterAiAccessService from "Common/Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import KubernetesAiAgent from "Common/Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAiAgentRegistrationRefusalReason,
  KubernetesAiRemediationMode,
  TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS,
  isTransientKubernetesAiAgentRegistrationRefusal,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
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
 * Contract under test — the Kubernetes AI agent's API,
 * /kubernetes-ai-agent-ingest (DESIGN §5.1, Appendix W). The agent binary
 * (agents/KubernetesAIAgent) is built against exactly these shapes:
 *
 *   /register              ingestion key (TelemetryIngest, surface
 *                          kubernetes-ai-agent) → 200 { agentId, agentKey,
 *                          clusterId } | 403 { message, reason,
 *                          retryAfterSeconds? } + Retry-After when transient
 *   every other route      { agentId, agentKey } (body or x-agent-* headers)
 *                          → 401 { message } when not valid
 *   /heartbeat             200 { status: "ok" }
 *   /claim-next-job        200 { job: null } | { job: { jobId, origin,
 *                          stepId, stepType, timeoutInMs, leaseExpiresAt,
 *                          payload: { args, displayCommand?, tier?,
 *                          kubernetesClusterId, clusterIdentifier } } } — a
 *                          job naming a credential or another cluster is
 *                          failed, never served
 *   /job/:jobId/heartbeat  200 { status: "ok" } | 404 { message }
 *   /job/:jobId/result     200 { accepted }
 *   /disconnect            200 { status: "ok" }
 *
 * The real middleware, router and Response serializer run; the services
 * behind them are stubbed, so what the test reads is what goes on the wire.
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
import KubernetesAiAgentIngressAPI from "../../FeatureSet/Runbook/API/KubernetesAiAgentIngress";
import KubernetesAiAgentAuthorization from "../../FeatureSet/Runbook/Middleware/KubernetesAiAgentAuthorization";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const JOB_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const INGESTION_KEY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const AGENT_KEY: string = "ab".repeat(32);

const AUTHENTICATED_ROUTES: Array<string> = [
  "/heartbeat",
  "/claim-next-job",
  "/job/:jobId/heartbeat",
  "/job/:jobId/result",
  "/disconnect",
];

// What went over the wire, and whether a handler passed an error on.
interface WireResponse {
  statusCode: number | undefined;
  headers: Dictionary<string>;
  body: JSONObject | undefined;
  thrownToNext: unknown;
  // The request as the last handler saw it.
  req: ExpressRequest;
}

interface CallOptions {
  body?: JSONObject | undefined;
  headers?: Dictionary<string> | undefined;
  params?: Dictionary<string> | undefined;
  projectId?: ObjectID | undefined;
  ingestionKeyPolicy?: JSONObject | undefined;
  // Skip the route's first handler (the ingestion-key guard on /register).
  skipFirstHandler?: boolean | undefined;
}

function findRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute) => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

/*
 * Runs the route's handlers the way Express does: each one proceeds to the
 * next through next(), and next(error) stops the chain (the app's error
 * handler would answer with the exception's status).
 */
async function call(
  uri: string,
  options: CallOptions = {},
): Promise<WireResponse> {
  const route: MockRoute = findRoute(uri);
  const handlers: Array<RouterFunction> = options.skipFirstHandler
    ? route.handlers.slice(1)
    : route.handlers;

  const req: ExpressRequest = {
    params: options.params || {},
    query: {},
    headers: options.headers || {},
    body: options.body,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.ingestionKeyPolicy
      ? { ingestionKeyPolicy: options.ingestionKeyPolicy }
      : {}),
  } as unknown as ExpressRequest;

  const wire: WireResponse = {
    statusCode: undefined,
    headers: {},
    body: undefined,
    thrownToNext: undefined,
    req,
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
  res["set"] = jest.fn().mockImplementation((name: unknown, value: unknown) => {
    wire.headers[String(name)] = String(value);
    return res;
  });

  for (const handler of handlers) {
    let proceeded: boolean = false;

    await handler(
      req,
      res as unknown as ExpressResponse,
      ((error?: unknown): void => {
        if (error !== undefined) {
          wire.thrownToNext = error;
          return;
        }

        proceeded = true;
      }) as NextFunction,
    );

    if (!proceeded) {
      break;
    }
  }

  return wire;
}

function authenticated(options: CallOptions = {}): CallOptions {
  return {
    ...options,
    body: {
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
      ...options.body,
    },
  };
}

function makeAgent(
  overrides: Partial<KubernetesAiAgent> = {},
): KubernetesAiAgent {
  const agent: KubernetesAiAgent = new KubernetesAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.kubernetesClusterId = CLUSTER_ID;
  agent.connectionStatus = "connected";
  agent.posture = {
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: false,
  };
  Object.assign(agent, overrides);
  return agent;
}

function makeJob(
  overrides: Partial<RunnerJob> = {},
  payload: JSONObject = {},
): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job.id = JOB_ID;
  job.projectId = PROJECT_ID;
  job.origin = RunnerJobOrigin.AiInvestigation;
  job.kubernetesClusterId = CLUSTER_ID;
  job.stepId = "kubectl-1";
  job.stepType = RunbookStepType.Kubectl;
  job.targetKubernetesAiAgentId = AGENT_ID;
  job.assignedAgentId = AGENT_ID;
  job.timeoutInMs = 30000;
  job.leaseExpiresAt = new Date("2026-09-28T10:00:30.000Z");
  job.payload = {
    args: ["get", "pods", "-n", "web"],
    displayCommand: "kubectl get pods -n web",
    tier: "Read",
    kubernetesClusterId: CLUSTER_ID.toString(),
    clusterIdentifier: "prod-us",
    ...payload,
  };
  Object.assign(job, overrides);
  return job;
}

let authenticate: jest.SpyInstance;

beforeAll(() => {
  mockRoutes.length = 0;
  new KubernetesAiAgentIngressAPI();
});

beforeEach(() => {
  for (const level of ["warn", "info", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  authenticate = jest
    .spyOn(KubernetesAiAgentService, "authenticate")
    .mockResolvedValue(makeAgent());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("six POST routes, and nothing else", () => {
    expect(
      mockRoutes
        .map((route: MockRoute) => {
          return `${route.method} ${route.uri}`;
        })
        .sort(),
    ).toEqual(
      [
        "POST /register",
        "POST /heartbeat",
        "POST /claim-next-job",
        "POST /job/:jobId/heartbeat",
        "POST /job/:jobId/result",
        "POST /disconnect",
      ].sort(),
    );
  });

  test("/register is guarded by the ingestion key, on the Kubernetes AI agent surface", () => {
    const forSurface: jest.SpyInstance = jest.spyOn(
      TelemetryIngest,
      "forSurface",
    );
    const routesBefore: number = mockRoutes.length;

    new KubernetesAiAgentIngressAPI();

    expect(forSurface).toHaveBeenCalledTimes(1);
    expect(forSurface).toHaveBeenCalledWith(
      TelemetryIngestSurface.KubernetesAiAgent,
    );

    const register: MockRoute = mockRoutes
      .slice(routesBefore)
      .find((route: MockRoute) => {
        return route.uri === "/register";
      })!;

    expect(register.handlers).toHaveLength(2);
    expect(register.handlers[0]).toBe(forSurface.mock.results[0]!.value);

    mockRoutes.splice(routesBefore);
  });

  test.each(AUTHENTICATED_ROUTES)(
    "%s is authenticated by the agent's id and key first",
    (uri: string) => {
      const route: MockRoute = findRoute(uri);

      expect(route.handlers).toHaveLength(2);
      expect(route.handlers[0]).toBe(
        KubernetesAiAgentAuthorization.isAuthorizedAgent,
      );
    },
  );
});

describe("POST /register", () => {
  let registerSpy: jest.SpyInstance;

  const REGISTRATION: KubernetesAiAgentRegistrationResult = {
    agentId: AGENT_ID,
    agentKey: AGENT_KEY,
    clusterId: CLUSTER_ID,
    admission: "created",
  };

  function registerCall(body: JSONObject): Promise<WireResponse> {
    return call("/register", {
      body,
      projectId: PROJECT_ID,
      ingestionKeyPolicy: { ingestionKeyId: INGESTION_KEY_ID } as never,
      skipFirstHandler: true,
    });
  }

  beforeEach(() => {
    registerSpy = jest
      .spyOn(KubernetesAiAgentService, "register")
      .mockResolvedValue(REGISTRATION);
  });

  test("200 with exactly { agentId, agentKey, clusterId }", async () => {
    const wire: WireResponse = await registerCall({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
      clusterId: CLUSTER_ID.toString(),
    });
  });

  test("hands the service the project, the body and the ingestion key that admitted the request", async () => {
    const posture: JSONObject = {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: true,
      allowNodeOperations: false,
      writeNamespaces: ["web"],
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.33.1",
      agentChartVersion: "14.1.0",
    };

    await registerCall({
      clusterName: "prod-us",
      agentVersion: "14.1.0",
      previousAgentKey: "cd".repeat(32),
      posture,
      unknownField: "ignored",
    });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      clusterName: "prod-us",
      agentVersion: "14.1.0",
      previousAgentKey: "cd".repeat(32),
      posture,
      ingestionKeyId: INGESTION_KEY_ID,
    });
  });

  test("a version or previous key that is not a non-empty string is left out", async () => {
    await registerCall({
      clusterName: "prod-us",
      agentVersion: 14 as never,
      previousAgentKey: "",
    });

    const passed: Record<string, unknown> = registerSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(passed["agentVersion"]).toBeUndefined();
    expect(passed["previousAgentKey"]).toBeUndefined();
  });

  test("a request without a resolved key policy still registers, without a key id", async () => {
    await call("/register", {
      body: { clusterName: "prod-us" },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(
      (registerSpy.mock.calls[0]![0] as Record<string, unknown>)[
        "ingestionKeyId"
      ],
    ).toBeUndefined();
  });

  test("no project on the request is an error, and nothing is registered", async () => {
    const wire: WireResponse = await call("/register", {
      body: { clusterName: "prod-us" },
      skipFirstHandler: true,
    });

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  test("a transient refusal: 403, the reason, and when to retry in the body and as Retry-After", async () => {
    registerSpy.mockRejectedValue(
      new KubernetesAiAgentRegistrationRefusedException({
        reason: "previous_instance_online",
        retryAfterSeconds: 20,
        message: "Another Kubernetes AI agent is online.",
      }),
    );

    const wire: WireResponse = await registerCall({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(403);
    expect(wire.body).toEqual({
      message: "Another Kubernetes AI agent is online.",
      reason: "previous_instance_online",
      retryAfterSeconds: 20,
    });
    expect(wire.headers["Retry-After"]).toBe("20");
  });

  test("a refusal that needs an operator: 403 with the reason, no retry hint", async () => {
    registerSpy.mockRejectedValue(
      new KubernetesAiAgentRegistrationRefusedException({
        reason: "agent_cap_reached",
        message: "This project already has 250 Kubernetes AI agents.",
      }),
    );

    const wire: WireResponse = await registerCall({ clusterName: "prod-us" });

    expect(wire.statusCode).toBe(403);
    expect(wire.body).toEqual({
      message: "This project already has 250 Kubernetes AI agents.",
      reason: "agent_cap_reached",
    });
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("every refusal reason reaches the wire, and only the transient ones carry a retry hint", async () => {
    const reasons: Array<KubernetesAiAgentRegistrationRefusalReason> = [
      "previous_instance_online",
      "legacy_runner_online",
      "cluster_name_invalid",
      "agent_cap_reached",
    ];

    for (const reason of reasons) {
      const transient: boolean =
        isTransientKubernetesAiAgentRegistrationRefusal(reason);

      registerSpy.mockRejectedValueOnce(
        new KubernetesAiAgentRegistrationRefusedException({
          reason,
          message: reason,
          ...(transient ? { retryAfterSeconds: 20 } : {}),
        }),
      );

      const wire: WireResponse = await registerCall({ clusterName: "prod-us" });

      expect(wire.statusCode).toBe(403);
      expect(wire.body!["reason"]).toBe(reason);
      expect(wire.body!["retryAfterSeconds"] !== undefined).toBe(transient);
      expect(wire.headers["Retry-After"] !== undefined).toBe(transient);
    }

    expect(
      [...TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS].sort(),
    ).toEqual(["legacy_runner_online", "previous_instance_online"]);
  });

  test("any other error goes to the error handler, not the refusal body", async () => {
    registerSpy.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await registerCall({ clusterName: "prod-us" });

    expect(wire.thrownToNext).toBeInstanceOf(Error);
    expect(wire.statusCode).toBeUndefined();
  });
});

/*
 * The real service behind the route, with only its database reads stubbed:
 * the reason the service decides is the reason the agent reads.
 */
describe("POST /register end to end through the service", () => {
  function makeCluster(): KubernetesCluster {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.id = CLUSTER_ID;
    cluster.projectId = PROJECT_ID;
    cluster.clusterIdentifier = "prod-us";
    cluster.isAiInvestigationEnabled = true;
    cluster.aiRemediationMode = KubernetesAiRemediationMode.Disabled;
    return cluster;
  }

  test("an empty cluster name: 403 cluster_name_invalid, no retry hint", async () => {
    const wire: WireResponse = await call("/register", {
      body: { clusterName: "   " },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("cluster_name_invalid");
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("the previous in-cluster Runner is online: 403 legacy_runner_online, Retry-After 20", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(makeCluster());
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(makeCluster());

    const legacy: Runner = new Runner();
    legacy.id = new ObjectID("44444444-4444-4444-8444-444444444444");
    legacy.lastAlive = new Date();
    legacy.connectionStatus = RunnerConnectionStatus.Connected;

    jest
      .spyOn(KubernetesClusterAiAccessService, "getLegacyAgentRunnerForCluster")
      .mockResolvedValue(legacy);
    jest
      .spyOn(KubernetesClusterAiAccessService, "isRunnerOnline")
      .mockReturnValue(true);
    const create: jest.SpyInstance = jest.spyOn(
      KubernetesAiAgentService,
      "create",
    );

    const wire: WireResponse = await call("/register", {
      body: { clusterName: "prod-us", posture: { allowWrites: false } },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("legacy_runner_online");
    expect(wire.body!["retryAfterSeconds"]).toBe(20);
    expect(wire.headers["Retry-After"]).toBe("20");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("authentication (KubernetesAiAgentAuthorization)", () => {
  function stubHandlers(): void {
    jest
      .spyOn(KubernetesAiAgentService, "heartbeat")
      .mockResolvedValue(undefined);
    jest
      .spyOn(KubernetesAiAgentService, "markDisconnected")
      .mockResolvedValue(undefined);
    jest
      .spyOn(KubernetesAiAgentJobService, "claimNextJob")
      .mockResolvedValue(null);
    jest.spyOn(RunnerJobService, "heartbeatJob").mockResolvedValue(true);
    jest.spyOn(RunnerJobService, "submitResult").mockResolvedValue(true);
  }

  beforeEach(() => {
    stubHandlers();
  });

  test.each(AUTHENTICATED_ROUTES)(
    "%s: no id or key is a 401, and the handler never runs",
    async (uri: string) => {
      const wire: WireResponse = await call(uri, {
        body: {},
        params: { jobId: JOB_ID.toString() },
      });

      expect(wire.statusCode).toBe(401);
      expect(wire.body).toEqual({
        message: KubernetesAiAgentAuthorization.MISSING_CREDENTIALS_MESSAGE,
      });
      expect(authenticate).not.toHaveBeenCalled();
      expect(
        (wire.req as unknown as Record<string, unknown>)["kubernetesAiAgent"],
      ).toBeUndefined();
    },
  );

  test.each(AUTHENTICATED_ROUTES)(
    "%s: an id/key pair that is not valid (unknown, wrong, reset, rotated) is a 401 with a JSON message",
    async (uri: string) => {
      authenticate.mockResolvedValue(null);

      const wire: WireResponse = await call(
        uri,
        authenticated({ params: { jobId: JOB_ID.toString() } }),
      );

      expect(wire.statusCode).toBe(401);
      expect(wire.body).toEqual({
        message: KubernetesAiAgentAuthorization.INVALID_CREDENTIALS_MESSAGE,
      });
      expect(RunnerJobService.heartbeatJob).not.toHaveBeenCalled();
      expect(RunnerJobService.submitResult).not.toHaveBeenCalled();
      expect(KubernetesAiAgentJobService.claimNextJob).not.toHaveBeenCalled();
      expect(KubernetesAiAgentService.heartbeat).not.toHaveBeenCalled();
      expect(KubernetesAiAgentService.markDisconnected).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["a numeric id", { agentId: 42, agentKey: AGENT_KEY }],
    ["a numeric key", { agentId: AGENT_ID.toString(), agentKey: 42 }],
    ["an object id", { agentId: { id: "x" }, agentKey: AGENT_KEY }],
    ["an empty key", { agentId: AGENT_ID.toString(), agentKey: "" }],
  ])("%s is a 401", async (_label: string, body: JSONObject) => {
    const wire: WireResponse = await call("/heartbeat", { body });

    expect(wire.statusCode).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  test("checks exactly the presented id and key", async () => {
    await call("/heartbeat", authenticated());

    expect(authenticate).toHaveBeenCalledWith({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
    });
  });

  test("accepts the id and key as x-agent-id / x-agent-key headers", async () => {
    const wire: WireResponse = await call("/heartbeat", {
      body: {},
      headers: { "x-agent-id": AGENT_ID.toString(), "x-agent-key": AGENT_KEY },
    });

    expect(wire.statusCode).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
    });
  });

  test("the body wins over the headers", async () => {
    await call("/heartbeat", {
      body: { agentId: AGENT_ID.toString(), agentKey: AGENT_KEY },
      headers: {
        "x-agent-id": "00000000-0000-4000-8000-000000000000",
        "x-agent-key": "other",
      },
    });

    expect(authenticate).toHaveBeenCalledWith({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
    });
  });

  test("puts the authenticated agent on the request", async () => {
    const agent: KubernetesAiAgent = makeAgent();
    authenticate.mockResolvedValue(agent);

    const wire: WireResponse = await call("/heartbeat", authenticated());

    expect(
      (wire.req as unknown as Record<string, unknown>)["kubernetesAiAgent"],
    ).toBe(agent);
  });

  test("a failing lookup is a server error, not a 401 (the agent retries instead of re-registering)", async () => {
    authenticate.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await call("/heartbeat", authenticated());

    expect(wire.statusCode).toBeUndefined();
    expect(wire.thrownToNext).toBeInstanceOf(Error);
  });
});

describe("POST /heartbeat", () => {
  let heartbeat: jest.SpyInstance;

  beforeEach(() => {
    heartbeat = jest
      .spyOn(KubernetesAiAgentService, "heartbeat")
      .mockResolvedValue(undefined);
  });

  test('200 { status: "ok" }, handing the service the authenticated agent, its version and posture', async () => {
    const agent: KubernetesAiAgent = makeAgent();
    authenticate.mockResolvedValue(agent);
    const posture: JSONObject = { allowWrites: true, writeNamespaces: ["web"] };

    const wire: WireResponse = await call(
      "/heartbeat",
      authenticated({ body: { agentVersion: "14.1.0", posture } }),
    );

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(heartbeat).toHaveBeenCalledWith({
      agent,
      agentVersion: "14.1.0",
      posture,
    });
  });

  test("a version that is not a string is left out", async () => {
    await call("/heartbeat", authenticated({ body: { agentVersion: 14 } }));

    expect(
      (heartbeat.mock.calls[0]![0] as Record<string, unknown>)["agentVersion"],
    ).toBeUndefined();
  });

  test("a failing write goes to the error handler", async () => {
    heartbeat.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await call("/heartbeat", authenticated());

    expect(wire.thrownToNext).toBeInstanceOf(Error);
    expect(wire.statusCode).toBeUndefined();
  });
});

describe("POST /claim-next-job", () => {
  let claimNextJob: jest.SpyInstance;
  let submitResult: jest.SpyInstance;

  beforeEach(() => {
    claimNextJob = jest
      .spyOn(KubernetesAiAgentJobService, "claimNextJob")
      .mockResolvedValue(null);
    submitResult = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);
  });

  async function claimedJob(): Promise<JSONObject> {
    const wire: WireResponse = await claim();
    return wire.body!["job"] as JSONObject;
  }

  function claim(): Promise<WireResponse> {
    return call("/claim-next-job", authenticated());
  }

  test("no work: 200 { job: null }", async () => {
    const wire: WireResponse = await claim();

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ job: null });
  });

  test("claims for the authenticated agent, in its project — never for an id from the body", async () => {
    await call(
      "/claim-next-job",
      authenticated({
        body: { kubernetesAiAgentId: OTHER_CLUSTER_ID.toString() },
      }),
    );

    expect(claimNextJob).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      kubernetesAiAgentId: AGENT_ID,
    });
  });

  test("a job: exactly the contract's shape, the payload rebuilt from the contract's fields", async () => {
    claimNextJob.mockResolvedValue(
      makeJob({}, { script: "rm -rf /", secret: "s3cr3t", note: "x" }),
    );

    const wire: WireResponse = await claim();

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({
      job: {
        jobId: JOB_ID.toString(),
        origin: "AiInvestigation",
        stepId: "kubectl-1",
        stepType: "Kubectl",
        timeoutInMs: 30000,
        leaseExpiresAt: "2026-09-28T10:00:30.000Z",
        payload: {
          args: ["get", "pods", "-n", "web"],
          displayCommand: "kubectl get pods -n web",
          tier: "Read",
          kubernetesClusterId: CLUSTER_ID.toString(),
          clusterIdentifier: "prod-us",
        },
      },
    });
    expect(submitResult).not.toHaveBeenCalled();
  });

  test("a remediation job is served with its origin", async () => {
    claimNextJob.mockResolvedValue(
      makeJob({ origin: RunnerJobOrigin.AiRemediation }, { tier: "SafeWrite" }),
    );

    const job: JSONObject = await claimedJob();

    expect(job["origin"]).toBe("AiRemediation");
    expect((job["payload"] as JSONObject)["tier"]).toBe("SafeWrite");
  });

  test("the optional payload fields are left out when the job has none", async () => {
    const job: RunnerJob = makeJob();
    delete (job.payload as JSONObject)["displayCommand"];
    delete (job.payload as JSONObject)["tier"];
    claimNextJob.mockResolvedValue(job);

    const payload: JSONObject = (await claimedJob())["payload"] as JSONObject;

    expect(Object.keys(payload).sort()).toEqual(
      ["args", "clusterIdentifier", "kubernetesClusterId"].sort(),
    );
  });

  test("never a credential, a script or a runbook execution", async () => {
    claimNextJob.mockResolvedValue(makeJob());

    const job: JSONObject = await claimedJob();

    expect(job).not.toHaveProperty("credential");
    expect(job).not.toHaveProperty("script");
    expect(job).not.toHaveProperty("runbookExecutionId");
  });

  describe("the claim-time guard: failed, never served", () => {
    async function expectFailed(
      job: RunnerJob,
      message: string,
    ): Promise<void> {
      claimNextJob.mockResolvedValue(job);

      const wire: WireResponse = await claim();

      expect(wire.statusCode).toBe(200);
      expect(wire.body).toEqual({ job: null });
      expect(submitResult).toHaveBeenCalledTimes(1);
      expect(submitResult).toHaveBeenCalledWith({
        jobId: JOB_ID,
        agentId: AGENT_ID,
        success: false,
        errorMessage: message,
      });
    }

    test("a job naming a credential", async () => {
      await expectFailed(
        makeJob({}, { credentialId: "88888888-8888-4888-8888-888888888888" }),
        KubernetesAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      );
    });

    test("a job naming a credential in any form", async () => {
      await expectFailed(
        makeJob({}, { credentialId: { id: "x" } as never }),
        KubernetesAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      );
    });

    test("a job whose payload is for another cluster", async () => {
      await expectFailed(
        makeJob({}, { kubernetesClusterId: OTHER_CLUSTER_ID.toString() }),
        KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL,
      );
    });

    test("a job whose row is for another cluster", async () => {
      await expectFailed(
        makeJob({ kubernetesClusterId: OTHER_CLUSTER_ID }),
        KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL,
      );
    });

    test("a job that does not say which cluster it is for", async () => {
      const job: RunnerJob = makeJob();
      delete (job.payload as JSONObject)["kubernetesClusterId"];

      await expectFailed(
        job,
        KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL,
      );
    });

    test("a job without the cluster's name", async () => {
      await expectFailed(
        makeJob({}, { clusterIdentifier: "  " }),
        KubernetesAiAgentIngressAPI.MISSING_CLUSTER_IDENTIFIER_REFUSAL,
      );
    });

    test.each([
      ["no args", undefined],
      ["empty args", []],
      ["a string instead of args", "get pods"],
      ["a non-string arg", ["get", 7]],
    ])("a job with %s", async (_label: string, args: unknown) => {
      await expectFailed(
        makeJob({}, { args: args as never }),
        KubernetesAiAgentIngressAPI.MISSING_ARGS_REFUSAL,
      );
    });

    test("the credential refusal comes first", async () => {
      await expectFailed(
        makeJob(
          { kubernetesClusterId: OTHER_CLUSTER_ID },
          { credentialId: "88888888-8888-4888-8888-888888888888", args: [] },
        ),
        KubernetesAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      );
    });
  });

  test("the cluster ids are compared case-insensitively", () => {
    const job: RunnerJob = makeJob(
      {},
      { kubernetesClusterId: CLUSTER_ID.toString().toUpperCase() },
    );

    expect(
      KubernetesAiAgentIngressAPI.getClaimRefusal({ job, agent: makeAgent() }),
    ).toBeNull();
  });

  test("an agent row without a cluster never gets a job", () => {
    const agent: KubernetesAiAgent = makeAgent();
    delete (agent as unknown as Record<string, unknown>)["kubernetesClusterId"];

    expect(
      KubernetesAiAgentIngressAPI.getClaimRefusal({ job: makeJob(), agent }),
    ).toBe(KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL);
  });

  test("an empty credentialId is no credential", () => {
    expect(
      KubernetesAiAgentIngressAPI.getClaimRefusal({
        job: makeJob({}, { credentialId: "" }),
        agent: makeAgent(),
      }),
    ).toBeNull();
    expect(
      KubernetesAiAgentIngressAPI.getClaimRefusal({
        job: makeJob({}, { credentialId: null }),
        agent: makeAgent(),
      }),
    ).toBeNull();
  });

  test("the refusal copy is short and names the agent", () => {
    for (const message of [
      KubernetesAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL,
      KubernetesAiAgentIngressAPI.MISSING_CLUSTER_IDENTIFIER_REFUSAL,
      KubernetesAiAgentIngressAPI.MISSING_ARGS_REFUSAL,
    ]) {
      expect(message).toContain("Kubernetes AI agent");
      expect(message.length).toBeLessThan(200);
    }
  });

  test("an agent row without a project is an error, and nothing is claimed", async () => {
    const agent: KubernetesAiAgent = makeAgent();
    delete (agent as unknown as Record<string, unknown>)["projectId"];
    authenticate.mockResolvedValue(agent);

    const wire: WireResponse = await claim();

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(claimNextJob).not.toHaveBeenCalled();
  });
});

describe("POST /job/:jobId/heartbeat", () => {
  let heartbeatJob: jest.SpyInstance;

  beforeEach(() => {
    heartbeatJob = jest
      .spyOn(RunnerJobService, "heartbeatJob")
      .mockResolvedValue(true);
  });

  test('the lease is still the agent\'s: 200 { status: "ok" }', async () => {
    const wire: WireResponse = await call(
      "/job/:jobId/heartbeat",
      authenticated({ params: { jobId: JOB_ID.toString() } }),
    );

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(heartbeatJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: AGENT_ID,
    });
  });

  test("the lease moved on or the job ended: 404, so the agent stops", async () => {
    heartbeatJob.mockResolvedValue(false);

    const wire: WireResponse = await call(
      "/job/:jobId/heartbeat",
      authenticated({ params: { jobId: JOB_ID.toString() } }),
    );

    expect(wire.thrownToNext).toBeInstanceOf(NotFoundException);
    expect((wire.thrownToNext as NotFoundException).code).toBe(404);
  });

  test("a job id that is not a UUID is a 400, and nothing is touched", async () => {
    const wire: WireResponse = await call(
      "/job/:jobId/heartbeat",
      authenticated({ params: { jobId: "not-a-job" } }),
    );

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(heartbeatJob).not.toHaveBeenCalled();
  });
});

describe("POST /job/:jobId/result", () => {
  let submitResult: jest.SpyInstance;

  beforeEach(() => {
    submitResult = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);
  });

  function result(body: JSONObject): Promise<WireResponse> {
    return call(
      "/job/:jobId/result",
      authenticated({ params: { jobId: JOB_ID.toString() }, body }),
    );
  }

  test("hands RunnerJobService the result under the agent's id: 200 { accepted }", async () => {
    const wire: WireResponse = await result({
      success: true,
      output: "[stdout]\npod/web-1 Running",
      exitCode: 0,
      errorMessage: "",
    });

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ accepted: true });
    expect(submitResult).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "[stdout]\npod/web-1 Running",
      exitCode: 0,
      errorMessage: "",
    });
  });

  test("a result from an agent that lost the lease is not accepted", async () => {
    submitResult.mockResolvedValue(false);

    const wire: WireResponse = await result({ success: false });

    expect(wire.body).toEqual({ accepted: false });
  });

  test("only a literal true is success; malformed fields are left out", async () => {
    await result({
      success: "true",
      output: 42,
      exitCode: "1",
      errorMessage: { m: 1 },
    } as never);

    expect(submitResult).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
    });
  });

  test("a non-finite exit code is left out", async () => {
    await result({ success: false, exitCode: Number.NaN } as never);

    expect(
      (submitResult.mock.calls[0]![0] as Record<string, unknown>)["exitCode"],
    ).toBeUndefined();
  });

  test("a job id that is not a UUID is a 400", async () => {
    const wire: WireResponse = await call(
      "/job/:jobId/result",
      authenticated({ params: { jobId: "1 OR 1=1" }, body: { success: true } }),
    );

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(submitResult).not.toHaveBeenCalled();
  });
});

describe("POST /disconnect", () => {
  test('signs the authenticated agent off: 200 { status: "ok" }', async () => {
    const markDisconnected: jest.SpyInstance = jest
      .spyOn(KubernetesAiAgentService, "markDisconnected")
      .mockResolvedValue(undefined);

    const wire: WireResponse = await call("/disconnect", authenticated());

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(markDisconnected).toHaveBeenCalledWith({
      kubernetesAiAgentId: AGENT_ID,
    });
  });
});

describe("toWireJob", () => {
  test("a lease that is somehow missing is null rather than a bad date", () => {
    const job: RunnerJob = makeJob();
    delete (job as unknown as Record<string, unknown>)["leaseExpiresAt"];

    expect(KubernetesAiAgentIngressAPI.toWireJob(job)["leaseExpiresAt"]).toBe(
      null,
    );
  });
});
