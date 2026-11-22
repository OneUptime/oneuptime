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
 *     worker to decide;
 *   - a refused request tells its monitor it had no valid secret, and why
 *     (issue #8498): it never reaches the worker, which records the rest.
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
import IncomingRequestSecretActivity from "Common/Server/Utils/Monitor/IncomingRequestSecretActivity";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
  IncomingRequestSecretPolicyValue,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "Common/Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSecretValues from "Common/Server/Utils/Monitor/IncomingRequestSecretValues";
import IncomingRequestSignature from "Common/Server/Utils/Monitor/IncomingRequestSignature";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
} from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { REDACTED } from "Common/Server/Utils/LogRedaction";
import WrongIncomingRequestSecretLimit, {
  WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
} from "Common/Server/Utils/RateLimit/WrongIncomingRequestSecretLimit";
import Response from "Common/Server/Utils/Response";
import { ExpressRouter, RequestHandler } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import {
  IncomingRequestSecretProblem,
  IncomingRequestSignatureScheme,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
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
let advanceIfTracked: jest.Mock;
let recordActivity: jest.Mock;

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
  // The body as it came, as StartServer's JSON parser keeps it.
  rawBody?: string | undefined;
  res?: Record<string, unknown> | undefined;
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
      ...(data.rawBody !== undefined ? { rawBody: data.rawBody } : {}),
    },
    data.res || {},
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
    .mockResolvedValue(undefined) as unknown as jest.Mock;

  recordActivity = jest
    .spyOn(IncomingRequestSecretActivity, "record")
    .mockResolvedValue(undefined) as unknown as jest.Mock;

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

      // It never reaches the worker: its monitor learns of it here.
      expect(recordActivity).toHaveBeenCalledTimes(1);
      expect(recordActivity).toHaveBeenCalledWith({
        monitorId: MONITOR.monitorId,
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      });
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
    expect(recordActivity).toHaveBeenCalledWith({
      monitorId: MONITOR.monitorId,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.WrongSecret,
    });
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

    // The worker records it, with the rest it processes.
    expect(recordActivity).not.toHaveBeenCalled();
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

  /*
   * Queued before it is answered (#10582), so a request sent once this one
   * was answered is evaluated after it; the arrival is recorded once the
   * sender has its answer.
   */
  test("queues the request before it answers, and answers before it records the arrival", async () => {
    await send({ headers: { "x-oneuptime-secret": PROJECT_SECRET } });

    const queued: number =
      addIncomingRequestIngestJob.mock.invocationCallOrder[0]!;
    const responded: number =
      sendEmptySuccessResponse.mock.invocationCallOrder[0]!;
    const recorded: number = advanceIfTracked.mock.invocationCallOrder[0]!;

    expect(queued).toBeLessThan(responded);
    expect(responded).toBeLessThan(recorded);
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

describe("a project with a secret that does not require one yet", () => {
  beforeEach(() => {
    policy = { isRequired: false, secrets: REQUIRED.secrets };
  });

  test("a request without the secret is answered, recorded and queued, as before, and left for the worker to note", async () => {
    const next: jest.Mock = await send({});

    expect(refusalOf(next)).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(advanceIfTracked).toHaveBeenCalledTimes(1);
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);
    expect(recordActivity).not.toHaveBeenCalled();
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
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

/*
 * A secret limited to some monitors (issue #8501): another monitor of the
 * project answers it 401, as it answers a wrong one.
 */
describe("a secret limited to another monitor", () => {
  test("is refused 401 as not one this monitor accepts, and nothing is queued", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          ...REQUIRED.secrets[0]!,
          monitorAccess: MonitorSecretAccess.SpecificMonitors,
          monitorIds: ["c0c0c0c0-0000-4000-8000-0000000000c0"],
          labelIds: [],
        },
      ],
    };

    const next: jest.Mock = await send({
      headers: { "x-oneuptime-secret": PROJECT_SECRET },
    });

    const refusal: Exception | null = refusalOf(next);

    expect(refusal).toBeInstanceOf(NotAuthenticatedException);
    expect(refusal?.message).toBe(
      INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
    );
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith({
      monitorId: MONITOR.monitorId,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.SecretNotForMonitor,
    });
  });
});

/*
 * A client that sends too many different wrong secrets to a monitor
 * (issue #8499) is answered 429, with when to try again.
 */
describe("a client over the wrong-secret limit", () => {
  test("is answered 429 with Retry-After, and nothing is recorded or queued", async () => {
    jest
      .spyOn(WrongIncomingRequestSecretLimit, "checkBeforeComparing")
      .mockResolvedValue({ retryAfterSeconds: 120 });

    const headers: Dictionary<string> = {};

    const next: jest.Mock = await send({
      headers: { "x-oneuptime-secret": PROJECT_SECRET },
      res: {
        setHeader: (name: string, value: string): void => {
          headers[name] = value;
        },
      },
    });

    const refusal: Exception | null = refusalOf(next);

    expect(refusal).toBeInstanceOf(TooManyRequestsException);
    expect(refusal?.code).toBe(429);
    expect(refusal?.message).toBe(WRONG_INCOMING_REQUEST_SECRETS_MESSAGE);
    expect(headers["Retry-After"]).toBe("120");

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect(advanceIfTracked).not.toHaveBeenCalled();
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
  });

  test("the wrong secret that takes it over is answered 429 too", async () => {
    jest
      .spyOn(WrongIncomingRequestSecretLimit, "checkBeforeComparing")
      .mockResolvedValue(null);
    const countWrong: jest.Mock = jest
      .spyOn(WrongIncomingRequestSecretLimit, "countWrong")
      .mockResolvedValue({ retryAfterSeconds: 60 }) as unknown as jest.Mock;

    const next: jest.Mock = await send({
      headers: { "x-oneuptime-secret": "the-eleventh-guess-at-it" },
      res: { setHeader: jest.fn() },
    });

    expect(refusalOf(next)).toBeInstanceOf(TooManyRequestsException);
    expect(countWrong).toHaveBeenCalledTimes(1);
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
  });
});

/*
 * A signed request (issue #8500): the signature checked over the body as it
 * came, the secret that made it presented to the worker, the signature
 * accepted once and masked in what is queued.
 */
describe("a signed request", () => {
  const BODY: string = '{"status":"ok"}';
  const NOW_SECONDS: number = Math.floor(Date.now() / 1000);

  let seen: Set<string>;

  beforeEach(() => {
    seen = new Set<string>();

    jest
      .spyOn(IncomingRequestSecretValues, "getSigningSecrets")
      .mockResolvedValue([{ secretId: SECRET_ID, value: PROJECT_SECRET }]);

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (namespace: string, key: string) => {
        const name: string = `${namespace}-${key}`;

        if (seen.has(name)) {
          return false;
        }

        seen.add(name);
        return true;
      });
  });

  const signature: (data?: {
    secret?: string;
    timestampSeconds?: number;
  }) => string = (data?: {
    secret?: string;
    timestampSeconds?: number;
  }): string => {
    return IncomingRequestSignature.sign({
      scheme: IncomingRequestSignatureScheme.OneUptime,
      secret: data?.secret || PROJECT_SECRET,
      body: BODY,
      timestampSeconds: data?.timestampSeconds ?? NOW_SECONDS,
    });
  };

  test("is answered 200 and queued with the secret that signed it, the signature taken off", async () => {
    const next: jest.Mock = await send({
      headers: {
        "content-type": "application/json",
        "x-oneuptime-signature": signature(),
      },
      rawBody: BODY,
    });

    expect(refusalOf(next)).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);

    const job: {
      presentedSecretHashes: Array<string>;
      requestHeaders: Dictionary<string>;
    } = addIncomingRequestIngestJob.mock.calls[0]![0] as {
      presentedSecretHashes: Array<string>;
      requestHeaders: Dictionary<string>;
    };

    expect(job.presentedSecretHashes).toEqual([
      IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
    ]);
    expect(job.requestHeaders["x-oneuptime-signature"]).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain(PROJECT_SECRET);
  });

  test("a GitHub delivery's signature is masked in what is queued, so nobody can send it again", async () => {
    const next: jest.Mock = await send({
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": IncomingRequestSignature.sign({
          scheme: IncomingRequestSignatureScheme.GitHub,
          secret: PROJECT_SECRET,
          body: BODY,
        }),
      },
      rawBody: BODY,
    });

    expect(refusalOf(next)).toBeNull();

    const queued: Dictionary<string> = (
      addIncomingRequestIngestJob.mock.calls[0]![0] as {
        requestHeaders: Dictionary<string>;
      }
    ).requestHeaders;

    expect(queued["x-hub-signature-256"]).toBe(REDACTED);
    expect(queued["x-github-event"]).toBe("workflow_run");
  });

  test("the same signed request sent again is refused 401 as a replay, and not queued", async () => {
    const headers: Dictionary<string> = {
      "content-type": "application/json",
      "x-oneuptime-signature": signature(),
    };

    expect(refusalOf(await send({ headers, rawBody: BODY }))).toBeNull();

    const replay: Exception | null = refusalOf(
      await send({ headers, rawBody: BODY }),
    );

    expect(replay).toBeInstanceOf(NotAuthenticatedException);
    expect(replay?.message).toBe(INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE);
    expect(addIncomingRequestIngestJob).toHaveBeenCalledTimes(1);
  });

  test("a signature made with a wrong secret is refused 401", async () => {
    const refusal: Exception | null = refusalOf(
      await send({
        headers: {
          "content-type": "application/json",
          "x-oneuptime-signature": signature({
            secret: "not-the-projects-secret-at-all",
          }),
        },
        rawBody: BODY,
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthenticatedException);
    expect(refusal?.message).toBe(
      INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
    );
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
  });

  test("a signature of a body changed on the way is refused 401", async () => {
    const refusal: Exception | null = refusalOf(
      await send({
        headers: {
          "content-type": "application/json",
          "x-oneuptime-signature": signature(),
        },
        rawBody: '{"status":"down"}',
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthenticatedException);
    expect(addIncomingRequestIngestJob).not.toHaveBeenCalled();
  });

  test("a signature more than five minutes old is refused 401, saying so", async () => {
    const refusal: Exception | null = refusalOf(
      await send({
        headers: {
          "content-type": "application/json",
          "x-oneuptime-signature": signature({
            timestampSeconds: NOW_SECONDS - 3600,
          }),
        },
        rawBody: BODY,
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthenticatedException);
    expect(refusal?.message).toBe(INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE);
    expect(recordActivity).toHaveBeenCalledWith({
      monitorId: MONITOR.monitorId,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.ExpiredSignature,
    });
  });
});
