import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import DataCircuitBreaker from "../../../Server/Utils/DataObservability/DataCircuitBreaker";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import StatusCode from "../../../Types/API/StatusCode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE,
  DataCircuitBreakerAnswer,
  DataCircuitBreakerRequest,
  DataCircuitBreakerVerdict,
} from "../../../Types/DataObservability/DataCircuitBreaker";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataPipelineCircuitBreakerState,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * THE CIRCUIT BREAKER'S ROUTES (#6548).
 *
 *   - POST /data-observability/circuit-breaker answers a pipeline step that
 *     signs in with a project API key, or a person, who may read data
 *     assets: it is a read, left working while the product is switched
 *     off (the answer then is go - DataCircuitBreaker), and a stop is HTTP
 *     412 only when the step asks for it, so curl -f fails the step;
 *   - POST /data-observability/pipelines/:id/circuit-breaker says how a
 *     pipeline's breaker stands, to the same people and keys, and a
 *     pipeline its caller may not read is not found;
 *   - someone who may not read data assets is refused, before anything is
 *     read.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PIPELINE: ObjectID = new ObjectID("22222222-2222-4222-8222-000000000001");
const API_KEY: ObjectID = new ObjectID("99999999-9999-4999-8999-000000000001");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

function grants(permission: Permission): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT,
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT,
        permissions: [
          {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  } as DatabaseCommonInteractionProps;
}

// A project API key that may read data assets: what a pipeline step signs in with.
const KEY_PROPS: DatabaseCommonInteractionProps = {
  ...grants(Permission.ReadDataAsset),
  apiKeyId: API_KEY,
  userType: UserType.API,
} as DatabaseCommonInteractionProps;

const VIEWER_PROPS: DatabaseCommonInteractionProps = {
  ...grants(Permission.Viewer),
  userId: MEMBER,
  userType: UserType.User,
} as DatabaseCommonInteractionProps;

// A key that may do nothing in Data Observability.
const NO_DATA_KEY_PROPS: DatabaseCommonInteractionProps = {
  ...grants(Permission.ReadIncident),
  apiKeyId: API_KEY,
  userType: UserType.API,
} as DatabaseCommonInteractionProps;

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

function stackOf(path: string): Array<{ handle: RouteHandler }> {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["post"] === true
    );
  });

  return layer?.route?.stack || [];
}

function stopAnswer(): DataCircuitBreakerAnswer {
  return {
    verdict: DataCircuitBreakerVerdict.Stop,
    reasons: [],
    tables: [],
    notFound: [],
    stopsOnLateTables: false,
    pipeline: null,
    isRecorded: false,
    isSwitchedOff: false,
    checkedAt: "2026-11-19T12:00:00.000Z",
    answer: "Stop: the pipeline should not run.",
  };
}

interface Call {
  sent: JSONObject | null;
  statusCode: number | null;
  error: unknown;
}

async function call(data: {
  path: string;
  props: DatabaseCommonInteractionProps;
  body?: JSONObject;
  params?: Record<string, string>;
}): Promise<Call> {
  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);
  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  const stack: Array<{ handle: RouteHandler }> = stackOf(data.path);

  expect(stack.length).toBeGreaterThan(0);

  await stack[stack.length - 1]!.handle(
    {
      body: data.body || {},
      params: data.params || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const options: { statusCode?: StatusCode } | undefined = sent.mock
    .calls[0]?.[3] as { statusCode?: StatusCode } | undefined;

  return {
    sent: (sent.mock.calls[0]?.[2] as JSONObject | undefined) || null,
    statusCode: options?.statusCode ? options.statusCode.toNumber() : null,
    error: next.mock.calls[0]?.[0],
  };
}

let check: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  check = jest
    .spyOn(DataCircuitBreaker, "check")
    .mockResolvedValue(stopAnswer() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /data-observability/circuit-breaker", () => {
  test("a pipeline step's API key is answered, with the request read as the rule reads it and its own props", async () => {
    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: KEY_PROPS,
      body: { pipeline: "airflow://prod/orders_daily", dryRun: true },
    });

    expect(result.error).toBeUndefined();
    expect(result.sent).toMatchObject({ verdict: "stop" });
    // A stop is still a 200 unless the step asked otherwise.
    expect(result.statusCode).toBeNull();

    const asked: {
      projectId: ObjectID;
      request: DataCircuitBreakerRequest;
      props: DatabaseCommonInteractionProps;
    } = check.mock.calls[0]![0] as never;

    expect(asked.projectId.toString()).toBe(PROJECT.toString());
    expect(asked.props).toBe(KEY_PROPS);
    expect(asked.request).toEqual({
      pipeline: "airflow://prod/orders_daily",
      tables: [],
      stopsOnLateTables: null,
      isDryRun: true,
      failWithStatusCode: false,
    });
  });

  test("with failWithStatusCode, a stop answers HTTP 412", async () => {
    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: KEY_PROPS,
      body: { pipeline: "orders_daily", failWithStatusCode: true },
    });

    expect(result.statusCode).toBe(DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE);
    expect(result.sent).toMatchObject({ verdict: "stop" });
  });

  test("with failWithStatusCode, a go is a plain 200", async () => {
    check.mockResolvedValue({
      ...stopAnswer(),
      verdict: DataCircuitBreakerVerdict.Go,
    } as never);

    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: KEY_PROPS,
      body: { pipeline: "orders_daily", failWithStatusCode: true },
    });

    expect(result.statusCode).toBeNull();
  });

  test("a person who may read data assets is answered too", async () => {
    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: VIEWER_PROPS,
      body: { tables: ["public.orders"] },
    });

    expect(result.error).toBeUndefined();
    expect(check).toHaveBeenCalledTimes(1);
  });

  test("a key that may not read data assets is refused, before anything is read", async () => {
    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: NO_DATA_KEY_PROPS,
      body: { pipeline: "orders_daily" },
    });

    expect(result.error).toBeDefined();
    expect(result.sent).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  test("a request that asks nothing is refused with what to send", async () => {
    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
      props: KEY_PROPS,
      body: {},
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect((result.error as Error).message).toBe(
      "Name the pipeline that is about to run, or the tables it reads.",
    );
    expect(check).not.toHaveBeenCalled();
  });

  test("it is a read: nothing refuses it while the product is switched off", () => {
    const stack: Array<{ handle: RouteHandler }> = stackOf(
      DATA_OBSERVABILITY_API_ROUTES.circuitBreaker,
    );

    expect(
      stack.some((layer: { handle: RouteHandler }): boolean => {
        return ServerProductRoutes.isRefusal(layer.handle);
      }),
    ).toBe(false);
  });
});

describe("POST /data-observability/pipelines/:id/circuit-breaker", () => {
  const STATE: DataPipelineCircuitBreakerState = {
    dataPipelineId: PIPELINE.toString(),
    stopsOnLateTables: false,
    checkedAt: null,
    stoppedAt: null,
    reasons: [],
  };

  test("says how the pipeline's breaker stands, read for its caller", async () => {
    const readState: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataCircuitBreaker, "readState")
      .mockResolvedValue(STATE as never);

    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.pipelineCircuitBreaker(":id"),
      props: KEY_PROPS,
      params: { id: PIPELINE.toString() },
    });

    expect(result.error).toBeUndefined();
    expect(result.sent).toEqual(STATE);

    const asked: {
      dataPipelineId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = readState.mock.calls[0]![0] as never;

    expect(asked.dataPipelineId.toString()).toBe(PIPELINE.toString());
    expect(asked.props).toBe(KEY_PROPS);
  });

  test("a pipeline its caller may not read is not found", async () => {
    jest
      .spyOn(DataCircuitBreaker, "readState")
      .mockResolvedValue(null as never);

    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.pipelineCircuitBreaker(":id"),
      props: VIEWER_PROPS,
      params: { id: PIPELINE.toString() },
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect((result.error as Error).message).toBe("Pipeline not found.");
  });

  test("a pipeline named by anything but an ID is not found, and nothing is read", async () => {
    const readState: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataCircuitBreaker,
      "readState",
    );

    const result: Call = await call({
      path: DATA_OBSERVABILITY_API_ROUTES.pipelineCircuitBreaker(":id"),
      props: VIEWER_PROPS,
      params: { id: "orders_daily" },
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readState).not.toHaveBeenCalled();
  });
});
