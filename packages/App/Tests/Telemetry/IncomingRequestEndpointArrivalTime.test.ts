/*
 * The Incoming Request endpoint records WHEN a heartbeat arrived, at the
 * moment it arrives.
 *
 * It queues the request for a Telemetry worker and answers 2xx. Liveness used
 * to be stamped only by that worker, so a queue backlog longer than a
 * monitor's window read as a dead sender while the sender was being answered
 * 2xx (2026-10-04/05). The endpoint now advances the monitor's arrival
 * marker in IncomingRequestReceivedAtStore and hands the same arrival time
 * to the job, so neither the heartbeat cron nor the worker depends on how
 * far behind the queue is.
 *
 * The route's own handler is driven directly off the router's stack with
 * stub req/res objects; the store and the queue are mocked at their module
 * boundary.
 */

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addIncomingRequestIngestJob: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  return {
    __esModule: true,
    default: {
      advanceIfTracked: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
      // The route hands on the headers it was sent through this, as it is.
      withoutClusterKeyHeaders: (headers: Record<string, unknown>) => {
        return { ...headers };
      },
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
      trace: jest.fn(),
    },
  };
});

/*
 * A project's incoming request secret requirement (IncomingRequestSecretGate)
 * is not what this suite is about: every request counts, as it did before
 * projects could require a secret. IncomingRequestSecretEndpoint.test.ts and
 * IncomingRequestSecretWorker.test.ts cover the requirement.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideAtEdge: async (): Promise<{ mayRecordArrival: boolean }> => {
        return { mayRecordArrival: true };
      },
      decideInWorker: async (data: {
        requestHeaders?: Record<string, string> | undefined;
      }): Promise<{
        verdict: string;
        isRefused: boolean;
        requestHeaders: Record<string, string>;
      }> => {
        return {
          verdict: "NotRequired",
          isRefused: false,
          requestHeaders: data.requestHeaders || {},
        };
      },
    },
  };
});

import IncomingRequestAPI, {
  INCOMING_REQUEST_NOT_QUEUED_MESSAGE,
} from "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import Response from "Common/Server/Utils/Response";
import { ExpressRouter, RequestHandler } from "Common/Server/Utils/Express";
import OneUptimeDate from "Common/Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const ARRIVED_AT: Date = new Date("2026-10-05T12:19:00.000Z");

const addIncomingRequestIngestJob: jest.Mock =
  TelemetryQueueService.addIncomingRequestIngestJob as unknown as jest.Mock;
const advanceIfTracked: jest.Mock =
  IncomingRequestReceivedAtStore.advanceIfTracked as unknown as jest.Mock;
const sendEmptySuccessResponse: jest.Mock =
  Response.sendEmptySuccessResponse as unknown as jest.Mock;

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

// The route's own handler: the last one in its stack.
function handlerFor(
  router: ExpressRouter,
  method: string,
  path: string,
): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path &&
      Boolean(candidate.route.methods[method.toLowerCase()])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method} ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

/*
 * The route wrapper starts the handler without awaiting it, so let every
 * pending promise in the chain settle before asserting.
 */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

async function send(data: {
  method: "GET" | "POST";
  secretKey?: string | undefined;
}): Promise<jest.Mock> {
  const handler: RequestHandler = handlerFor(
    IncomingRequestAPI,
    data.method,
    "/incoming-request/:secretkey",
  );

  const next: jest.Mock = jest.fn() as unknown as jest.Mock;

  await (handler as unknown as (...args: Array<unknown>) => unknown)(
    {
      method: data.method,
      params: data.secretKey === undefined ? {} : { secretkey: data.secretKey },
      headers: { "user-agent": "curl/8.12.1" },
      body: {},
    },
    {},
    next,
  );

  await settle();

  return next;
}

describe("Incoming Request endpoint records the arrival time", () => {
  let clock: Date;

  beforeEach(() => {
    jest.clearAllMocks();

    clock = new Date(ARRIVED_AT);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(clock);
    });

    advanceIfTracked.mockResolvedValue(undefined as never);
    addIncomingRequestIngestJob.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  for (const method of ["POST", "GET"] as const) {
    test(`${method}: advances the monitor's arrival marker with the secret key and the arrival time`, async () => {
      const next: jest.Mock = await send({ method, secretKey: SECRET_KEY });

      expect(next).not.toHaveBeenCalled();
      expect(advanceIfTracked).toHaveBeenCalledTimes(1);

      const input: { secretKey: string; receivedAt: Date } = advanceIfTracked
        .mock.calls[0]![0] as { secretKey: string; receivedAt: Date };

      expect(input.secretKey).toBe(SECRET_KEY);
      expect(input.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
    });

    test(`${method}: hands the same arrival time to the queued job`, async () => {
      await send({ method, secretKey: SECRET_KEY });

      expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);

      const jobInput: {
        secretKey: string;
        requestMethod: string;
        receivedAt: Date;
      } = addIncomingRequestIngestJob.mock.calls[0]![0] as {
        secretKey: string;
        requestMethod: string;
        receivedAt: Date;
      };

      expect(jobInput.secretKey).toBe(SECRET_KEY);
      expect(jobInput.requestMethod).toBe(method);
      expect(jobInput.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
    });
  }

  /*
   * The time is taken when the request arrives, not after the marker write
   * or the enqueue - a slow Redis must not make a heartbeat look later (or,
   * worse, let the job and the marker disagree).
   */
  test("the arrival time is taken before anything is awaited", async () => {
    advanceIfTracked.mockImplementation((() => {
      clock = new Date(ARRIVED_AT.getTime() + 4000);
      return Promise.resolve(undefined);
    }) as any);

    await send({ method: "POST", secretKey: SECRET_KEY });

    const markerInput: { receivedAt: Date } = advanceIfTracked.mock
      .calls[0]![0] as { receivedAt: Date };
    const jobInput: { receivedAt: Date } = addIncomingRequestIngestJob.mock
      .calls[0]![0] as { receivedAt: Date };

    expect(markerInput.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
    expect(jobInput.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
  });

  /*
   * Queued before it is answered (#10582): a request the sender sends once
   * this one was answered is queued after it, and its monitor evaluates the
   * two in that order. The arrival is recorded once the sender has its
   * answer, at the time the request arrived.
   */
  test("queues the request first, then answers, then records the arrival", async () => {
    await send({ method: "POST", secretKey: SECRET_KEY });

    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);

    const queued: number =
      addIncomingRequestIngestJob.mock.invocationCallOrder[0]!;
    const responded: number =
      sendEmptySuccessResponse.mock.invocationCallOrder[0]!;
    const recorded: number = advanceIfTracked.mock.invocationCallOrder[0]!;

    expect(queued).toBeLessThan(responded);
    expect(responded).toBeLessThan(recorded);
  });

  test("answers only once the request is queued", async () => {
    let finishQueueing: () => void = (): void => {};

    addIncomingRequestIngestJob.mockImplementationOnce((() => {
      return new Promise<void>((resolve: () => void) => {
        finishQueueing = resolve;
      });
    }) as never);

    const sent: Promise<jest.Mock> = send({
      method: "POST",
      secretKey: SECRET_KEY,
    });

    await settle();
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);
    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();

    finishQueueing();
    await sent;
    await settle();

    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  /*
   * One that cannot be queued is refused with 503, for the sender to send
   * again, rather than answered 200 and lost. It is not recorded as an
   * arrival either: the sender's next try is.
   */
  test("a request that cannot be queued is refused with 503, not answered 200", async () => {
    addIncomingRequestIngestJob.mockRejectedValueOnce(
      new Error("Redis is not connected") as never,
    );

    const next: jest.Mock = await send({
      method: "POST",
      secretKey: SECRET_KEY,
    });

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect(advanceIfTracked).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    const refusal: ServiceUnavailableException = next.mock
      .calls[0]![0] as ServiceUnavailableException;

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal.code).toBe(503);
    expect(refusal.message).toBe(INCOMING_REQUEST_NOT_QUEUED_MESSAGE);
  });

  test("a request without a secret key records nothing and queues nothing", async () => {
    const next: jest.Mock = await send({ method: "POST" });

    expect(next).toHaveBeenCalledTimes(1);
    expect(advanceIfTracked).not.toHaveBeenCalled();
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
  });
});
