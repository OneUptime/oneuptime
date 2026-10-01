import logger from "Common/Server/Utils/Logger";
import ResourceAiAgentService, {
  ResourceAiAgentRegistrationRefusedException,
  ResourceAiAgentRegistrationResult,
} from "Common/Server/Services/ResourceAiAgentService";
import ResourceAiAgentJobService from "Common/Server/Services/ResourceAiAgentJobService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAgentRegistrationRefusalReason,
  ResourceCommandJobPayload,
  TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS,
  isTransientResourceAiAgentRegistrationRefusal,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
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
 * Contract under test — the resource AI agent's API,
 * /resource-ai-agent-ingest. The agent binary (agents/ResourceAIAgent) is
 * built against exactly these shapes (Types/ResourceAiAgent/ResourceAiAccess):
 *
 *   /register              ingestion key (TelemetryIngest, surface
 *                          resource-ai-agent) → 200 { agentId, agentKey,
 *                          resourceId, resourceName } | 403 { message,
 *                          reason, retryAfterSeconds? } + Retry-After when
 *                          transient
 *   every other route      { agentId, agentKey } (body or x-agent-* headers)
 *                          → 401 { message } when not valid
 *   /heartbeat             200 { status: "ok" }
 *   /claim-next-job        200 { job: null } | { job: { jobId, origin,
 *                          stepId, stepType, timeoutInMs, leaseExpiresAt,
 *                          payload: ResourceCommandJobPayload } } — a job
 *                          carrying a credential, for another resource, or
 *                          without a runnable command is failed, never served
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
import ResourceAiAgentIngressAPI from "../../FeatureSet/Runbook/API/ResourceAiAgentIngress";
import ResourceAiAgentAuthorization from "../../FeatureSet/Runbook/Middleware/ResourceAiAgentAuthorization";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
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

interface WireResponse {
  statusCode: number | undefined;
  headers: Dictionary<string>;
  body: JSONObject | undefined;
  thrownToNext: unknown;
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
 * next through next(), and next(error) stops the chain.
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

function makeAgent(overrides: Record<string, unknown> = {}): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.resourceType = AiResourceType.DockerHost;
  agent.resourceId = RESOURCE_ID;
  agent.resourceIdentifier = "web-1";
  agent.connectionStatus = "connected";
  agent.posture = {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
  };
  Object.assign(agent, overrides);
  return agent;
}

function makeJob(
  overrides: Record<string, unknown> = {},
  payload: JSONObject = {},
): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job.id = JOB_ID;
  job.projectId = PROJECT_ID;
  job.origin = RunnerJobOrigin.AiInvestigation;
  job.resourceType = AiResourceType.DockerHost;
  job.resourceId = RESOURCE_ID;
  job.stepId = "resource-1";
  job.stepType = RunbookStepType.ResourceCommand;
  job.targetResourceAiAgentId = AGENT_ID;
  job.assignedAgentId = AGENT_ID;
  job.timeoutInMs = 30000;
  job.leaseExpiresAt = new Date("2026-09-28T10:00:30.000Z");
  job.payload = {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID.toString(),
    resourceIdentifier: "web-1",
    program: "docker",
    args: ["ps", "-a"],
    displayCommand: "docker ps -a",
    tier: "Read",
    ...payload,
  };
  Object.assign(job, overrides);
  return job;
}

let authenticate: jest.SpyInstance;

beforeAll(() => {
  mockRoutes.length = 0;
  new ResourceAiAgentIngressAPI();
});

beforeEach(() => {
  for (const level of ["warn", "info", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  authenticate = jest
    .spyOn(ResourceAiAgentService, "authenticate")
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

  test("/register is guarded by the ingestion key, on the resource AI agent surface", () => {
    const forSurface: jest.SpyInstance = jest.spyOn(
      TelemetryIngest,
      "forSurface",
    );
    const routesBefore: number = mockRoutes.length;

    new ResourceAiAgentIngressAPI();

    expect(forSurface).toHaveBeenCalledTimes(1);
    expect(forSurface).toHaveBeenCalledWith(
      TelemetryIngestSurface.ResourceAiAgent,
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
        ResourceAiAgentAuthorization.isAuthorizedAgent,
      );
    },
  );
});

describe("POST /register", () => {
  let registerSpy: jest.SpyInstance;

  const REGISTRATION: ResourceAiAgentRegistrationResult = {
    agentId: AGENT_ID,
    agentKey: AGENT_KEY,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "Web server one",
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
      .spyOn(ResourceAiAgentService, "register")
      .mockResolvedValue(REGISTRATION);
  });

  test("200 with exactly { agentId, agentKey, resourceId, resourceName }", async () => {
    const wire: WireResponse = await registerCall({
      resourceType: "DockerHost",
      resourceIdentifier: "web-1",
    });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
      resourceId: RESOURCE_ID.toString(),
      resourceName: "Web server one",
    });
  });

  test("hands the service the project, the body and the ingestion key that admitted the request", async () => {
    const posture: JSONObject = {
      resourceType: "DockerHost",
      resourceIdentifier: "web-1",
      allowWrites: true,
      writeTargets: ["web-*"],
      protectedTargets: [],
      reachable: true,
    };

    await registerCall({
      resourceType: "docker",
      resourceIdentifier: "web-1",
      resourceId: RESOURCE_ID.toString(),
      agentVersion: "14.1.0",
      previousAgentKey: "cd".repeat(32),
      posture,
      unknownField: "ignored",
    });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      resourceType: "docker",
      resourceIdentifier: "web-1",
      resourceId: RESOURCE_ID.toString(),
      agentVersion: "14.1.0",
      previousAgentKey: "cd".repeat(32),
      posture,
      ingestionKeyId: INGESTION_KEY_ID,
    });
  });

  test("a version, previous key or resource id that is not a non-empty string is left out", async () => {
    await registerCall({
      resourceType: "docker",
      resourceIdentifier: "web-1",
      resourceId: 42 as never,
      agentVersion: 14 as never,
      previousAgentKey: "",
    });

    const passed: Record<string, unknown> = registerSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(passed["resourceId"]).toBeUndefined();
    expect(passed["agentVersion"]).toBeUndefined();
    expect(passed["previousAgentKey"]).toBeUndefined();
  });

  test("a request without a resolved key policy still registers, without a key id", async () => {
    await call("/register", {
      body: { resourceType: "docker", resourceIdentifier: "web-1" },
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
      body: { resourceType: "docker", resourceIdentifier: "web-1" },
      skipFirstHandler: true,
    });

    expect(wire.thrownToNext).toBeInstanceOf(BadDataException);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  test("a transient refusal: 403, the reason, and when to retry in the body and as Retry-After", async () => {
    registerSpy.mockRejectedValue(
      new ResourceAiAgentRegistrationRefusedException({
        reason: "previous_instance_online",
        retryAfterSeconds: 20,
        message: "Another Docker AI agent is online.",
      }),
    );

    const wire: WireResponse = await registerCall({
      resourceType: "docker",
      resourceIdentifier: "web-1",
    });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(403);
    expect(wire.body).toEqual({
      message: "Another Docker AI agent is online.",
      reason: "previous_instance_online",
      retryAfterSeconds: 20,
    });
    expect(wire.headers["Retry-After"]).toBe("20");
  });

  test("a refusal that needs an operator: 403 with the reason, no retry hint", async () => {
    registerSpy.mockRejectedValue(
      new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_not_found",
        message: "DATABASE_SERVER_ID is not a database in this project.",
      }),
    );

    const wire: WireResponse = await registerCall({
      resourceType: "database",
      resourceIdentifier: RESOURCE_ID.toString(),
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body).toEqual({
      message: "DATABASE_SERVER_ID is not a database in this project.",
      reason: "resource_not_found",
    });
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("every refusal reason reaches the wire, and only the transient ones carry a retry hint", async () => {
    const reasons: Array<ResourceAiAgentRegistrationRefusalReason> = [
      "resource_type_invalid",
      "resource_identifier_invalid",
      "resource_not_found",
      "previous_instance_online",
      "agent_cap_reached",
    ];

    for (const reason of reasons) {
      const transient: boolean =
        isTransientResourceAiAgentRegistrationRefusal(reason);

      registerSpy.mockRejectedValueOnce(
        new ResourceAiAgentRegistrationRefusedException({
          reason,
          message: reason,
          ...(transient ? { retryAfterSeconds: 20 } : {}),
        }),
      );

      const wire: WireResponse = await registerCall({
        resourceType: "docker",
        resourceIdentifier: "web-1",
      });

      expect(wire.statusCode).toBe(403);
      expect(wire.body!["reason"]).toBe(reason);
      expect(wire.body!["retryAfterSeconds"] !== undefined).toBe(transient);
      expect(wire.headers["Retry-After"] !== undefined).toBe(transient);
    }

    expect([...TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS]).toEqual([
      "previous_instance_online",
    ]);
  });

  test("any other error goes to the error handler, not the refusal body", async () => {
    registerSpy.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await registerCall({
      resourceType: "docker",
      resourceIdentifier: "web-1",
    });

    expect(wire.thrownToNext).toBeInstanceOf(Error);
    expect(wire.statusCode).toBeUndefined();
  });
});

/*
 * The real service behind the route, with only its database reads stubbed:
 * the reason the service decides is the reason the agent reads.
 */
describe("POST /register end to end through the service", () => {
  test("an unknown resource type: 403 resource_type_invalid, no retry hint", async () => {
    const wire: WireResponse = await call("/register", {
      body: { resourceType: "mainframe", resourceIdentifier: "web-1" },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("resource_type_invalid");
    expect(wire.headers).not.toHaveProperty("Retry-After");
  });

  test("an empty identity: 403 resource_identifier_invalid", async () => {
    const wire: WireResponse = await call("/register", {
      body: { resourceType: "docker", resourceIdentifier: "  " },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("resource_identifier_invalid");
  });

  test("another agent of the resource is online: 403 previous_instance_online, Retry-After 20", async () => {
    const found: Record<string, unknown> = { _id: RESOURCE_ID.toString() };
    Object.defineProperty(found, "id", { value: RESOURCE_ID });
    jest
      .spyOn(DockerHostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue(found as never);
    const row: Record<string, unknown> = {
      _id: RESOURCE_ID.toString(),
      projectId: PROJECT_ID,
      name: "web-1",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
    };
    Object.defineProperty(row, "id", { value: RESOURCE_ID });
    jest.spyOn(DockerHostService, "findOneBy").mockResolvedValue(row as never);

    const online: ResourceAiAgent = makeAgent({
      keyHash: "cd".repeat(32),
      lastAliveAt: new Date(),
    });
    jest.spyOn(ResourceAiAgentService, "findOneBy").mockResolvedValue(online);
    jest
      .spyOn(ResourceAiAgentService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);
    const create: jest.SpyInstance = jest.spyOn(
      ResourceAiAgentService,
      "create",
    );

    const wire: WireResponse = await call("/register", {
      body: {
        resourceType: "docker",
        resourceIdentifier: "web-1",
        posture: { allowWrites: false },
      },
      projectId: PROJECT_ID,
      skipFirstHandler: true,
    });

    expect(wire.statusCode).toBe(403);
    expect(wire.body!["reason"]).toBe("previous_instance_online");
    expect(wire.body!["retryAfterSeconds"]).toBe(20);
    expect(wire.headers["Retry-After"]).toBe("20");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("authentication (ResourceAiAgentAuthorization)", () => {
  beforeEach(() => {
    jest
      .spyOn(ResourceAiAgentService, "heartbeat")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ResourceAiAgentService, "markDisconnected")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ResourceAiAgentJobService, "claimNextJob")
      .mockResolvedValue(null);
    jest.spyOn(RunnerJobService, "heartbeatJob").mockResolvedValue(true);
    jest.spyOn(RunnerJobService, "submitResult").mockResolvedValue(true);
    jest.spyOn(RunnerJobService, "findOneBy").mockResolvedValue(null);
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
        message: ResourceAiAgentAuthorization.MISSING_CREDENTIALS_MESSAGE,
      });
      expect(authenticate).not.toHaveBeenCalled();
      expect(
        (wire.req as unknown as Record<string, unknown>)["resourceAiAgent"],
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
        message: ResourceAiAgentAuthorization.INVALID_CREDENTIALS_MESSAGE,
      });
      expect(RunnerJobService.heartbeatJob).not.toHaveBeenCalled();
      expect(RunnerJobService.submitResult).not.toHaveBeenCalled();
      expect(ResourceAiAgentJobService.claimNextJob).not.toHaveBeenCalled();
      expect(ResourceAiAgentService.heartbeat).not.toHaveBeenCalled();
      expect(ResourceAiAgentService.markDisconnected).not.toHaveBeenCalled();
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

  test("accepts the id and key as x-agent-id / x-agent-key headers; the body wins over them", async () => {
    const wire: WireResponse = await call("/heartbeat", {
      body: {},
      headers: { "x-agent-id": AGENT_ID.toString(), "x-agent-key": AGENT_KEY },
    });

    expect(wire.statusCode).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({
      agentId: AGENT_ID.toString(),
      agentKey: AGENT_KEY,
    });

    authenticate.mockClear();

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
    const agent: ResourceAiAgent = makeAgent();
    authenticate.mockResolvedValue(agent);

    const wire: WireResponse = await call("/heartbeat", authenticated());

    expect(
      (wire.req as unknown as Record<string, unknown>)["resourceAiAgent"],
    ).toBe(agent);
  });

  test("a failing lookup is a server error, not a 401 (the agent retries instead of re-registering)", async () => {
    authenticate.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await call("/heartbeat", authenticated());

    expect(wire.statusCode).toBeUndefined();
    expect(wire.thrownToNext).toBeInstanceOf(Error);
  });

  test("the messages name the resource AI agent", () => {
    expect(ResourceAiAgentAuthorization.INVALID_CREDENTIALS_MESSAGE).toContain(
      "resource AI agent",
    );
    expect(ResourceAiAgentAuthorization.INVALID_CREDENTIALS_MESSAGE).toContain(
      "Register again",
    );
  });
});

describe("POST /heartbeat", () => {
  let heartbeat: jest.SpyInstance;

  beforeEach(() => {
    heartbeat = jest
      .spyOn(ResourceAiAgentService, "heartbeat")
      .mockResolvedValue(undefined);
  });

  test('200 { status: "ok" }, handing the service the authenticated agent, its version and posture', async () => {
    const agent: ResourceAiAgent = makeAgent();
    authenticate.mockResolvedValue(agent);
    const posture: JSONObject = { allowWrites: true, writeTargets: ["web-*"] };

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

  test("a failing write — or a retired agent whose resource is gone — goes to the error handler", async () => {
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
      .spyOn(ResourceAiAgentJobService, "claimNextJob")
      .mockResolvedValue(null);
    submitResult = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);
  });

  function claim(): Promise<WireResponse> {
    return call("/claim-next-job", authenticated());
  }

  async function claimedJob(): Promise<JSONObject> {
    const wire: WireResponse = await claim();
    return wire.body!["job"] as JSONObject;
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
        body: { resourceAiAgentId: OTHER_RESOURCE_ID.toString() },
      }),
    );

    expect(claimNextJob).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceAiAgentId: AGENT_ID,
    });
  });

  test("a job: exactly the contract's shape, the payload rebuilt from ResourceCommandJobPayload's fields", async () => {
    claimNextJob.mockResolvedValue(
      makeJob({}, { script: "rm -rf /", note: "x", runbookExecutionId: "y" }),
    );

    const wire: WireResponse = await claim();

    const payload: ResourceCommandJobPayload = {
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID.toString(),
      resourceIdentifier: "web-1",
      program: "docker",
      args: ["ps", "-a"],
      displayCommand: "docker ps -a",
      tier: "Read" as never,
    };

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({
      job: {
        jobId: JOB_ID.toString(),
        origin: "AiInvestigation",
        stepId: "resource-1",
        stepType: "ResourceCommand",
        timeoutInMs: 30000,
        leaseExpiresAt: "2026-09-28T10:00:30.000Z",
        payload,
      },
    });
    expect(submitResult).not.toHaveBeenCalled();
  });

  test("a remediation job is served with its origin and tier", async () => {
    claimNextJob.mockResolvedValue(
      makeJob(
        { origin: RunnerJobOrigin.AiRemediation },
        {
          args: ["restart", "web-1"],
          displayCommand: "docker restart web-1",
          tier: "SafeWrite",
        },
      ),
    );

    const job: JSONObject = await claimedJob();

    expect(job["origin"]).toBe("AiRemediation");
    expect((job["payload"] as JSONObject)["tier"]).toBe("SafeWrite");
    expect((job["payload"] as JSONObject)["args"]).toEqual([
      "restart",
      "web-1",
    ]);
  });

  test("a command without arguments (uptime on a host) is served with an empty argv", async () => {
    authenticate.mockResolvedValue(
      makeAgent({
        resourceType: AiResourceType.Host,
        resourceIdentifier: "node-7",
      }),
    );
    claimNextJob.mockResolvedValue(
      makeJob(
        { resourceType: AiResourceType.Host },
        {
          resourceType: AiResourceType.Host,
          resourceIdentifier: "node-7",
          program: "uptime",
          args: [],
          displayCommand: "uptime",
        },
      ),
    );

    const payload: JSONObject = (await claimedJob())["payload"] as JSONObject;

    expect(payload["program"]).toBe("uptime");
    expect(payload["args"]).toEqual([]);
  });

  test("a job without a display command gets one rendered from its argv", async () => {
    const job: RunnerJob = makeJob({}, { args: ["logs", "my app"] });
    delete (job.payload as JSONObject)["displayCommand"];
    claimNextJob.mockResolvedValue(job);

    const payload: JSONObject = (await claimedJob())["payload"] as JSONObject;

    expect(payload["displayCommand"]).toBe("docker logs 'my app'");
  });

  test("never a credential, a script or a runbook execution", async () => {
    claimNextJob.mockResolvedValue(makeJob());

    const job: JSONObject = await claimedJob();

    expect(job).not.toHaveProperty("credential");
    expect(job).not.toHaveProperty("script");
    expect(job).not.toHaveProperty("runbookExecutionId");
    expect(Object.keys(job["payload"] as JSONObject).sort()).toEqual(
      [
        "args",
        "displayCommand",
        "program",
        "resourceId",
        "resourceIdentifier",
        "resourceType",
        "tier",
      ].sort(),
    );
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

    test.each(ResourceAiAgentIngressAPI.CREDENTIAL_PAYLOAD_FIELDS)(
      "a job carrying %s",
      async (field: string) => {
        await expectFailed(
          makeJob({}, { [field]: "88888888-8888-4888-8888-888888888888" }),
          ResourceAiAgentIngressAPI.CREDENTIAL_REFUSAL,
        );
      },
    );

    test("a job carrying a credential in any form", async () => {
      await expectFailed(
        makeJob({}, { credentialId: { id: "x" } as never }),
        ResourceAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      );
    });

    test("a job whose payload is for another resource", async () => {
      await expectFailed(
        makeJob({}, { resourceId: OTHER_RESOURCE_ID.toString() }),
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job whose payload is for another kind of resource", async () => {
      await expectFailed(
        makeJob({}, { resourceType: AiResourceType.PodmanHost }),
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job whose row is for another resource", async () => {
      await expectFailed(
        makeJob({ resourceId: OTHER_RESOURCE_ID }),
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job whose row is for another kind of resource", async () => {
      await expectFailed(
        makeJob({ resourceType: AiResourceType.Host }),
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job whose row names a Kubernetes cluster", async () => {
      await expectFailed(
        makeJob({ kubernetesClusterId: OTHER_RESOURCE_ID }),
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job that does not say which resource it is for", async () => {
      const job: RunnerJob = makeJob();
      delete (job.payload as JSONObject)["resourceId"];

      await expectFailed(
        job,
        ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      );
    });

    test("a job without the resource's identity", async () => {
      await expectFailed(
        makeJob({}, { resourceIdentifier: "  " }),
        ResourceAiAgentIngressAPI.MISSING_RESOURCE_IDENTIFIER_REFUSAL,
      );
    });

    test("a job naming another identity than the one the agent registered with", async () => {
      await expectFailed(
        makeJob({}, { resourceIdentifier: "web-2" }),
        ResourceAiAgentIngressAPI.RESOURCE_IDENTIFIER_MISMATCH_REFUSAL,
      );
    });

    test.each([
      ["no program", { program: undefined }],
      ["a blank program", { program: "  " }],
      ["no args", { args: undefined }],
      ["a string instead of args", { args: "ps -a" }],
      ["a non-string arg", { args: ["ps", 7] }],
    ])("a job with %s", async (_label: string, payload: JSONObject) => {
      await expectFailed(
        makeJob({}, payload),
        ResourceAiAgentIngressAPI.MISSING_COMMAND_REFUSAL,
      );
    });

    test("a job whose program this resource type does not run", async () => {
      await expectFailed(
        makeJob({}, { program: "kubectl", args: ["get", "pods"] }),
        ResourceAiAgentIngressAPI.PROGRAM_REFUSAL,
      );
    });

    test.each([
      ["no tier", undefined],
      ["the Denied tier", "Denied"],
      ["an unknown tier", "Mostly harmless"],
      ["a lower-case tier", "read"],
    ])("a job with %s", async (_label: string, tier: unknown) => {
      await expectFailed(
        makeJob({}, { tier: tier as never }),
        ResourceAiAgentIngressAPI.TIER_REFUSAL,
      );
    });

    test("the credential refusal comes first", async () => {
      await expectFailed(
        makeJob(
          { resourceId: OTHER_RESOURCE_ID },
          { password: "hunter2", args: [], tier: "Denied" },
        ),
        ResourceAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      );
    });
  });

  test("the resource ids and identities are compared case-insensitively", () => {
    const job: RunnerJob = makeJob(
      {},
      {
        resourceId: RESOURCE_ID.toString().toUpperCase(),
        resourceIdentifier: " WEB-1 ",
      },
    );

    expect(
      ResourceAiAgentIngressAPI.getClaimRefusal({ job, agent: makeAgent() }),
    ).toBeNull();
  });

  test("an agent row without a resource never gets a job", () => {
    const withoutId: ResourceAiAgent = makeAgent();
    delete (withoutId as unknown as Record<string, unknown>)["resourceId"];
    const withoutType: ResourceAiAgent = makeAgent({ resourceType: "Nope" });

    for (const agent of [withoutId, withoutType]) {
      expect(
        ResourceAiAgentIngressAPI.getClaimRefusal({ job: makeJob(), agent }),
      ).toBe(ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL);
    }
  });

  test("an agent row without a recorded identity accepts any non-blank identity (the agent re-checks its own)", () => {
    const agent: ResourceAiAgent = makeAgent();
    delete (agent as unknown as Record<string, unknown>)["resourceIdentifier"];

    expect(
      ResourceAiAgentIngressAPI.getClaimRefusal({
        job: makeJob({}, { resourceIdentifier: "anything" }),
        agent,
      }),
    ).toBeNull();
  });

  test("a row without resource columns is judged by its payload", () => {
    const job: RunnerJob = makeJob();
    delete (job as unknown as Record<string, unknown>)["resourceType"];
    delete (job as unknown as Record<string, unknown>)["resourceId"];

    expect(
      ResourceAiAgentIngressAPI.getClaimRefusal({ job, agent: makeAgent() }),
    ).toBeNull();
  });

  test("an empty or null credential field is no credential", () => {
    for (const value of ["", null]) {
      expect(
        ResourceAiAgentIngressAPI.getClaimRefusal({
          job: makeJob({}, { credentialId: value, password: value }),
          agent: makeAgent(),
        }),
      ).toBeNull();
    }
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "a %s agent is served a command of each of its programs, and refused another type's",
    (resourceType: AiResourceType) => {
      const agent: ResourceAiAgent = makeAgent({ resourceType });

      for (const program of AI_RESOURCE_TYPE_INFO[resourceType].programs) {
        expect(
          ResourceAiAgentIngressAPI.getClaimRefusal({
            job: makeJob({ resourceType }, { resourceType, program }),
            agent,
          }),
        ).toBeNull();
      }

      const foreign: string | undefined = [
        "docker",
        "pvesh",
        "govc",
        "ceph",
        "db",
        "systemctl",
      ].find((program: string) => {
        return !AI_RESOURCE_TYPE_INFO[resourceType].programs.includes(program);
      });

      expect(
        ResourceAiAgentIngressAPI.getClaimRefusal({
          job: makeJob({ resourceType }, { resourceType, program: foreign }),
          agent,
        }),
      ).toBe(ResourceAiAgentIngressAPI.PROGRAM_REFUSAL);
    },
  );

  test("the refusal copy is short and names the resource AI agent", () => {
    for (const message of [
      ResourceAiAgentIngressAPI.CREDENTIAL_REFUSAL,
      ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL,
      ResourceAiAgentIngressAPI.MISSING_RESOURCE_IDENTIFIER_REFUSAL,
      ResourceAiAgentIngressAPI.RESOURCE_IDENTIFIER_MISMATCH_REFUSAL,
      ResourceAiAgentIngressAPI.MISSING_COMMAND_REFUSAL,
      ResourceAiAgentIngressAPI.PROGRAM_REFUSAL,
      ResourceAiAgentIngressAPI.TIER_REFUSAL,
    ]) {
      expect(message).toContain("resource AI agent");
      expect(message.length).toBeLessThan(200);
    }
  });

  test("the server refuses at least every credential field the agent refuses", () => {
    for (const field of [
      "credential",
      "credentialId",
      "kubernetesCredential",
      "kubernetesCredentialId",
      "kubernetesClusterId",
      "apiServerUrl",
      "token",
      "apiToken",
      "apiKey",
      "password",
      "secret",
      "privateKey",
      "caCertificate",
      "kubeconfig",
      "keyring",
      "connectionString",
    ]) {
      expect(ResourceAiAgentIngressAPI.CREDENTIAL_PAYLOAD_FIELDS).toContain(
        field,
      );
    }
  });

  test("an agent row without a project is an error, and nothing is claimed", async () => {
    const agent: ResourceAiAgent = makeAgent();
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
  let jobLookup: jest.SpyInstance;

  beforeEach(() => {
    submitResult = jest
      .spyOn(RunnerJobService, "submitResult")
      .mockResolvedValue(true);
    jobLookup = jest
      .spyOn(RunnerJobService, "findOneBy")
      .mockResolvedValue(
        makeJob({}, { program: "docker", args: ["inspect", "web-1"] }),
      );
  });

  function result(body: JSONObject): Promise<WireResponse> {
    return call(
      "/job/:jobId/result",
      authenticated({ params: { jobId: JOB_ID.toString() }, body }),
    );
  }

  test("hands RunnerJobService the result under the agent's id, with the job's resource type and program for redaction: 200 { accepted }", async () => {
    const wire: WireResponse = await result({
      success: true,
      output: "[stdout]\nweb-1 Up 3 hours",
      exitCode: 0,
      errorMessage: "",
    });

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ accepted: true });
    expect(submitResult).toHaveBeenCalledWith({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "[stdout]\nweb-1 Up 3 hours",
      exitCode: 0,
      errorMessage: "",
      resourceCommand: {
        resourceType: AiResourceType.DockerHost,
        program: "docker",
      },
    });
  });

  test("the program is read from the job this agent holds, by id, as root", async () => {
    await result({ success: true });

    const lookup: Record<string, any> = jobLookup.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(lookup["query"]["_id"]).toBe(JOB_ID.toString());
    expect(String(lookup["query"]["assignedAgentId"])).toBe(
      AGENT_ID.toString(),
    );
    expect(lookup["select"]).toEqual({ payload: true });
    expect(lookup["props"]).toEqual({ isRoot: true });
  });

  test("a job the agent no longer holds still gets the agent's resource type (generic rules), and is not accepted", async () => {
    jobLookup.mockResolvedValue(null);
    submitResult.mockResolvedValue(false);

    const wire: WireResponse = await result({ success: false });

    expect(wire.body).toEqual({ accepted: false });
    expect(
      (submitResult.mock.calls[0]![0] as Record<string, unknown>)[
        "resourceCommand"
      ],
    ).toEqual({ resourceType: AiResourceType.DockerHost, program: "" });
  });

  test("an agent row without a resource type sends no resource command, and reads no job", async () => {
    authenticate.mockResolvedValue(makeAgent({ resourceType: "Nope" }));

    await result({ success: true, output: "x" });

    expect(jobLookup).not.toHaveBeenCalled();
    expect(
      submitResult.mock.calls[0]![0] as Record<string, unknown>,
    ).not.toHaveProperty("resourceCommand");
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
      resourceCommand: {
        resourceType: AiResourceType.DockerHost,
        program: "docker",
      },
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

  test("a failing job lookup goes to the error handler (the agent retries the result)", async () => {
    jobLookup.mockRejectedValue(new Error("database is down"));

    const wire: WireResponse = await result({ success: true });

    expect(wire.thrownToNext).toBeInstanceOf(Error);
    expect(submitResult).not.toHaveBeenCalled();
  });
});

describe("POST /disconnect", () => {
  test('signs the authenticated agent off: 200 { status: "ok" }', async () => {
    const markDisconnected: jest.SpyInstance = jest
      .spyOn(ResourceAiAgentService, "markDisconnected")
      .mockResolvedValue(undefined);

    const wire: WireResponse = await call("/disconnect", authenticated());

    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ status: "ok" });
    expect(markDisconnected).toHaveBeenCalledWith({
      resourceAiAgentId: AGENT_ID,
    });
  });
});

describe("toWireJob", () => {
  test("a lease that is somehow missing is null rather than a bad date", () => {
    const job: RunnerJob = makeJob();
    delete (job as unknown as Record<string, unknown>)["leaseExpiresAt"];

    expect(ResourceAiAgentIngressAPI.toWireJob(job)["leaseExpiresAt"]).toBe(
      null,
    );
  });

  test("the argv is a copy: the served job cannot alias the stored payload", () => {
    const job: RunnerJob = makeJob();

    const wire: JSONObject = ResourceAiAgentIngressAPI.toWireJob(job);

    expect((wire["payload"] as JSONObject)["args"]).toEqual(["ps", "-a"]);
    expect((wire["payload"] as JSONObject)["args"]).not.toBe(
      (job.payload as JSONObject)["args"],
    );
  });
});
