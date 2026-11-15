/*
 * The Incoming Request endpoint and a project's incoming request secret
 * requirement (issue #7526).
 *
 * A project owner or admin can make every Incoming Request monitor in the
 * project refuse requests without one of the project's secrets. The endpoint
 * is where a sender learns it: it checks the secret before it answers.
 *
 *   - a request without the secret, or with a wrong one, is answered 401 with
 *     what to send - never the 200 every request used to get - and nothing
 *     about it is recorded or queued: it never counts as a heartbeat;
 *   - a request with the secret is answered 200, recorded and queued, as
 *     before - and so is every request to a project that requires none;
 *   - X-OneUptime-Secret never reaches the queue: only the SHA-256 of what was
 *     presented travels with the job;
 *   - a request the endpoint cannot place in a project (a made-up key, a new
 *     monitor's first request) is answered 200 and queued, unrecorded, for the
 *     worker to decide.
 *
 * The route's own handler is driven directly, with the real gate
 * (IncomingRequestSecretGate) and request parsing; the project's policy, the
 * key cache, the arrival store, the queue and the response are stubbed.
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
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
      trace: jest.fn(),
    },
  };
});

import IncomingRequestAPI from "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  IncomingRequestSecretPolicyValue,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "Common/Server/Utils/Monitor/IncomingRequestSecretRequest";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
} from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import Response from "Common/Server/Utils/Response";
import { ExpressRouter, RequestHandler } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import ObjectID from "Common/Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const PROJECT_SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";

const MONITOR: MonitorOfSecretKey = {
  monitorId: new ObjectID("b0b0b0b0-0000-4000-8000-0000000000b0"),
  projectId: new ObjectID("aaaaaaaa-0000-4000-8000-00000000000a"),
};

const REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: true,
  secrets: [
    {
      secretId: SECRET_ID,
      secretHash: IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
    },
  ],
};

const addIncomingRequestIngestJob: jest.Mock =
  TelemetryQueueService.addIncomingRequestIngestJob as unknown as jest.Mock;
const sendEmptySuccessResponse: jest.Mock =
  Response.sendEmptySuccessResponse as unknown as jest.Mock;

let policy: IncomingRequestSecretPolicyValue;
let keptMonitor: MonitorOfSecretKey | null;
let advanceIfTracked: jest.SpiedFunction<
  typeof IncomingRequestReceivedAtStore.advanceIfTracked
>;

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

function handlerFor(router: ExpressRouter, method: string): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === "/incoming-request/:secretkey" &&
      Boolean(candidate.route.methods[method.toLowerCase()])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method} /incoming-request/:secretkey is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

// The route wrapper starts the handler without awaiting it.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

async function send(data: {
  method?: "GET" | "POST";
  headers?: Dictionary<string>;
}): Promise<jest.Mock> {
  const method: string = data.method || "POST";
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;

  await (
    handlerFor(IncomingRequestAPI, method) as unknown as (
      ...args: Array<unknown>
    ) => unknown
  )(
    {
      method,
      params: { secretkey: SECRET_KEY },
      headers: { "user-agent": "curl/8.12.1", ...(data.headers || {}) },
      body: { status: "ok" },
    },
    {},
    next,
  );

  await settle();

  return next;
}

// What the request was refused with, or null when it was not.
function refusalOf(next: jest.Mock): Exception | null {
  if (next.mock.calls.length === 0) {
    return null;
  }

  return next.mock.calls[0]![0] as Exception;
}

beforeEach(() => {
  jest.clearAllMocks();

  policy = REQUIRED;
  keptMonitor = MONITOR;

  jest
    .spyOn(IncomingRequestSecretPolicy, "getPolicy")
    .mockImplementation(async () => {
      return policy;
    });

  jest
    .spyOn(MonitorSecretKeyCache, "getMonitor")
    .mockImplementation(async () => {
      return keptMonitor;
    });

  jest
    .spyOn(IncomingRequestReceivedAtStore, "isTracked")
    .mockResolvedValue(false);

  advanceIfTracked = jest
    .spyOn(IncomingRequestReceivedAtStore, "advanceIfTracked")
    .mockResolvedValue(undefined);

  addIncomingRequestIngestJob.mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project that requires an incoming request secret", () => {
  test.each(["POST", "GET"] as const)(
    "%s without a secret: 401 with what to send, nothing recorded or queued",
    async (method: "POST" | "GET") => {
      const next: jest.Mock = await send({ method });

      const refusal: Exception | null = refusalOf(next);

      expect(refusal).toBeInstanceOf(NotAuthenticatedException);
      expect(refusal?.code).toBe(401);
      expect(refusal?.message).toBe(INCOMING_REQUEST_SECRET_MISSING_MESSAGE);

      expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
      expect(advanceIfTracked).not.toHaveBeenCalled();
      expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
    },
  );

  test("a wrong secret: 401, saying it is not the project's", async () => {
    const next: jest.Mock = await send({
      headers: { "x-oneuptime-secret": "a-guess-at-the-secret" },
    });

    expect(refusalOf(next)?.message).toBe(
      INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
    );
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
    expect(advanceIfTracked).not.toHaveBeenCalled();
  });

  test("the secret in X-OneUptime-Secret: 200, recorded and queued without it", async () => {
    const next: jest.Mock = await send({
      headers: { "x-oneuptime-secret": PROJECT_SECRET },
    });

    expect(refusalOf(next)).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(advanceIfTracked).toHaveBeenCalledTimes(1);
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);

    const job: {
      requestHeaders: Dictionary<string>;
      presentedSecretHashes: Array<string>;
    } = addIncomingRequestIngestJob.mock.calls[0]![0] as {
      requestHeaders: Dictionary<string>;
      presentedSecretHashes: Array<string>;
    };

    expect(job.requestHeaders).toEqual({ "user-agent": "curl/8.12.1" });
    expect(job.presentedSecretHashes).toEqual([
      IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
    ]);
    expect(JSON.stringify(job)).not.toContain(PROJECT_SECRET);
  });

  test("the secret as a Bearer token: 200, and the sender's header queued as it came", async () => {
    const next: jest.Mock = await send({
      headers: { authorization: `Bearer ${PROJECT_SECRET}` },
    });

    expect(refusalOf(next)).toBeNull();
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);

    const job: {
      requestHeaders: Dictionary<string>;
      presentedSecretHashes: Array<string>;
    } = addIncomingRequestIngestJob.mock.calls[0]![0] as {
      requestHeaders: Dictionary<string>;
      presentedSecretHashes: Array<string>;
    };

    // The worker masks it before anything is kept (IncomingRequestSecretWorker).
    expect(job.requestHeaders["authorization"]).toBe(
      `Bearer ${PROJECT_SECRET}`,
    );
    expect(job.presentedSecretHashes).toEqual([
      IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
    ]);
  });

  test("answers before it records the arrival, and records it before it queues", async () => {
    await send({ headers: { "x-oneuptime-secret": PROJECT_SECRET } });

    const responded: number =
      sendEmptySuccessResponse.mock.invocationCallOrder[0]!;
    const recorded: number = advanceIfTracked.mock.invocationCallOrder[0]!;
    const queued: number =
      addIncomingRequestIngestJob.mock.invocationCallOrder[0]!;

    expect(responded).toBeLessThan(recorded);
    expect(recorded).toBeLessThan(queued);
  });
});

describe("a project that requires no secret", () => {
  beforeEach(() => {
    policy = { isRequired: false, secrets: [] };
  });

  test("every request is answered, recorded and queued, as before", async () => {
    const next: jest.Mock = await send({});

    expect(refusalOf(next)).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(advanceIfTracked).toHaveBeenCalledTimes(1);
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);
  });

  test("an X-OneUptime-Secret it sends anyway is still never queued", async () => {
    await send({ headers: { "X-OneUptime-Secret": PROJECT_SECRET } });

    const job: { requestHeaders: Dictionary<string> } =
      addIncomingRequestIngestJob.mock.calls[0]![0] as {
        requestHeaders: Dictionary<string>;
      };

    expect(Object.keys(job.requestHeaders)).toEqual(["user-agent"]);
  });
});

describe("a request the endpoint cannot place in a project", () => {
  beforeEach(() => {
    keptMonitor = null;
  });

  test("is answered and queued, unrecorded, for the worker to decide", async () => {
    const next: jest.Mock = await send({});

    expect(refusalOf(next)).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(advanceIfTracked).not.toHaveBeenCalled();
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);
    expect(IncomingRequestSecretPolicy.getPolicy).not.toHaveBeenCalled();
  });
});
