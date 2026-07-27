import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST } from "Common/Types/Kubernetes/KubernetesCostIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";

/*
 * Capture the route's terminal handler. The route registers with TWO
 * middlewares before the handler, so the shared mockRouter helper (which
 * assumes exactly one) would capture the wrong function — record the
 * last argument instead.
 */
const mockRegisteredHandlers: Record<
  string,
  (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>
> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<unknown>) => {
            mockRegisteredHandlers[uri] = handlers[
              handlers.length - 1
            ] as (typeof mockRegisteredHandlers)[string];
          },
          get: () => {
            // Route file registers no GETs.
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: jest.fn(),
      isDisabled: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addKubernetesCostIngestJob: jest.fn(),
      },
    };
  },
);

import Response from "Common/Server/Utils/Response";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
// Importing the router module registers the route on the mocked router.
import "../../FeatureSet/Telemetry/API/KubernetesCostIngest";

type MockedFn = jest.Mock;

const addJobMock: MockedFn =
  TelemetryQueueService.addKubernetesCostIngestJob as unknown as MockedFn;
const sendEmptySuccessMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();

async function invokeRoute(body: unknown): Promise<{
  nextError: Error | undefined;
}> {
  const handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = mockRegisteredHandlers["/kubernetes-cost/ingest"]!;

  let nextError: Error | undefined = undefined;
  const next: NextFunction = ((err?: Error): void => {
    nextError = err;
  }) as NextFunction;

  await handler(
    { body, projectId: PROJECT_ID } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next,
  );

  return { nextError };
}

describe("POST /kubernetes-cost/ingest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addJobMock.mockResolvedValue(undefined as never);
  });

  test("registers the route", () => {
    expect(mockRegisteredHandlers["/kubernetes-cost/ingest"]).toBeDefined();
  });

  test("rejects a missing body", async () => {
    const { nextError } = await invokeRoute(undefined);

    expect(nextError).toBeInstanceOf(BadRequestException);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("rejects a missing clusterName", async () => {
    const { nextError } = await invokeRoute({ allocations: [] });

    expect(nextError).toBeInstanceOf(BadRequestException);
    expect((nextError as Error).message).toMatch(/clusterName/);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only clusterName", async () => {
    const { nextError } = await invokeRoute({
      clusterName: "   ",
      allocations: [],
    });

    expect(nextError).toBeInstanceOf(BadRequestException);
  });

  test("rejects non-array allocations", async () => {
    const { nextError } = await invokeRoute({
      clusterName: "prod",
      allocations: {},
    });

    expect(nextError).toBeInstanceOf(BadRequestException);
    expect((nextError as Error).message).toMatch(/allocations/);
  });

  test("rejects payloads over the per-request row cap", async () => {
    const allocations: Array<JSONObject> = new Array(
      MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST + 1,
    ).fill({});

    const { nextError } = await invokeRoute({
      clusterName: "prod",
      allocations,
    });

    expect(nextError).toBeInstanceOf(BadRequestException);
    expect((nextError as Error).message).toMatch(/at most/);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("answers success for empty allocations without enqueuing", async () => {
    const { nextError } = await invokeRoute({
      clusterName: "prod",
      allocations: [],
    });

    expect(nextError).toBeUndefined();
    expect(sendEmptySuccessMock).toHaveBeenCalledTimes(1);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("enqueues a valid payload with the authenticated project id", async () => {
    const body: JSONObject = {
      clusterName: "prod",
      currency: "USD",
      allocations: [
        {
          windowStart: "2026-07-24T10:00:00Z",
          windowEnd: "2026-07-24T11:00:00Z",
          totalCost: 1,
        },
      ],
    };

    const { nextError } = await invokeRoute(body);

    expect(nextError).toBeUndefined();
    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(addJobMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      costPayload: body,
    });
    expect(sendEmptySuccessMock).toHaveBeenCalledTimes(1);
  });

  test("propagates enqueue failures to the error handler", async () => {
    addJobMock.mockRejectedValue(new Error("redis down") as never);

    const { nextError } = await invokeRoute({
      clusterName: "prod",
      allocations: [{ windowStart: "x", windowEnd: "y" }],
    });

    expect(nextError).toBeInstanceOf(Error);
    expect((nextError as Error).message).toBe("redis down");
    expect(sendEmptySuccessMock).not.toHaveBeenCalled();
  });
});
