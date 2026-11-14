/*
 * The probe scheduling limit over HTTP (#7920): real connections, the real
 * Express app, the real JSON parser and the real response writer.
 *
 * The middleware keeps a request's slot until its answer has gone and gives
 * it back when the probe hangs up, by listening to the response's own
 * "finish" and "close" - which only a real connection emits as production
 * does. And the busy answers have to arrive as each probe reads them: a
 * probe that declares retryWhenBusy gets a 429 with Retry-After, an older
 * probe the list endpoint's empty batch, which the probe's HTTP client
 * reads (HTTPResponse) as the empty list it hands BaseModel.fromJSONArray.
 *
 *   - with a small limit of its own: a request waits for the slot an
 *     answered request gives back; a probe that hangs up while it waits never
 *     reaches the handler and frees its place; one that hangs up while its
 *     request runs gives the slot back; a refused request is answered busy;
 *   - the real /monitor/list, /probe/network-device/list and
 *     /monitor/pending-count routers, mounted where the app mounts them, with
 *     the services stood in for: they claim when there is room, and when the
 *     limit refuses them they claim nothing and answer each probe as it
 *     reads.
 */
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import { KeyedConcurrencyLimits } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Probe from "Common/Models/DatabaseModels/Probe";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeSchedulingMiddleware from "../../FeatureSet/Telemetry/Middleware/ProbeScheduling";
import MonitorRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
import NetworkDevicePollRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// What ProbeAuthorization sets once a probe's id and key check out.
jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: (
        req: { body: { probeId?: string }; probe?: unknown },
        _res: unknown,
        next: () => void,
      ): void => {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const ProbeModel: new (id: unknown) => unknown =
          require("Common/Models/DatabaseModels/Probe").default;
        const ObjectIDType: new (id: string) => unknown =
          require("Common/Types/ObjectID").default;
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        req.probe = new ProbeModel(new ObjectIDType(String(req.body.probeId)));
        next();
      },
    },
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      claimMonitorProbesForProbing: jest.fn(),
      countMonitorProbesDueForProbing: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  return {
    __esModule: true,
    default: {
      claimMonitorTestsForProbing: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      claimDevicesForPolling: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceOidTemplateService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

// The queue module pulls in BullMQ at import time.
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addNetworkDeviceWalkJob: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/Monitor", () => {
  return {
    __esModule: true,
    default: {},
  };
});

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const cache: { getString: AnyMock; setString: AnyMock } =
  GlobalCache as unknown as { getString: AnyMock; setString: AnyMock };

const monitorProbeService: {
  claimMonitorProbesForProbing: AnyMock;
  countMonitorProbesDueForProbing: AnyMock;
} = MonitorProbeService as unknown as {
  claimMonitorProbesForProbing: AnyMock;
  countMonitorProbesDueForProbing: AnyMock;
};

const deviceService: { claimDevicesForPolling: AnyMock } =
  NetworkDeviceService as unknown as { claimDevicesForPolling: AnyMock };

const PROBE_ID: string = "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

const OLDER_PROBE: Array<string> = [ProbeCapability.NetworkDevicePing];
const RETRYING_PROBE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.RetryWhenBusy,
];

interface RunningServer {
  server: http.Server;
  origin: string;
}

async function listen(app: ExpressApplication): Promise<RunningServer> {
  const server: http.Server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function close(running: RunningServer | null): Promise<void> {
  if (!running) {
    return;
  }
  running.server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    running.server.close(() => {
      resolve();
    });
  });
}

interface Answer {
  status: number;
  retryAfter: string | null;
  body: JSONObject | JSONArray;
}

// A probe's POST, as its HTTP client sends it.
async function post(
  origin: string,
  path: string,
  body: JSONObject,
  signal?: AbortSignal,
): Promise<Answer> {
  const response: globalThis.Response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  return {
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    body: (await response.json()) as JSONObject | JSONArray,
  };
}

async function eventually(condition: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("The condition did not come true within 10 s.");
    }
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

describe("the probe scheduling limit over a real connection", () => {
  let running: RunningServer | null = null;
  let limiter: ProbeSchedulingLimiter;
  // The requests the handler is holding, by label, until the test answers.
  let held: Map<string, () => void>;
  let reachedHandler: Array<string>;

  async function start(limits: Partial<KeyedConcurrencyLimits>): Promise<{
    origin: string;
  }> {
    limiter = new ProbeSchedulingLimiter({
      ...probeSchedulingLimits(1),
      maxWaitMs: 10_000,
      ...limits,
    });
    held = new Map<string, () => void>();
    reachedHandler = [];

    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.post(
      "/work",
      (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
        (req as unknown as { probe: Probe }).probe = new Probe(
          new ObjectID(PROBE_ID),
        );
        next();
      },
      ProbeSchedulingMiddleware.limit(
        (_req: ExpressRequest, res: ExpressResponse): void => {
          res.status(200).send({ devices: [] });
        },
        limiter,
      ),
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        const label: string = String(req.body["label"]);
        reachedHandler.push(label);
        await new Promise<void>((resolve: () => void) => {
          held.set(label, resolve);
        });
        if (!res.writableEnded) {
          res.status(200).send({ devices: [{ handled: label }] });
        }
      },
    );

    running = await listen(app);
    return { origin: running.origin };
  }

  afterEach(async () => {
    for (const answer of held.values()) {
      answer();
    }
    await close(running);
    running = null;
  });

  test("a request waits for the slot an answered request gives back", async () => {
    const { origin } = await start({});

    const first: Promise<Answer> = post(origin, "/work", { label: "first" });
    await eventually((): boolean => {
      return held.has("first");
    });

    const second: Promise<Answer> = post(origin, "/work", { label: "second" });
    await eventually((): boolean => {
      return limiter.waitingCount() === 1;
    });
    expect(reachedHandler).toEqual(["first"]);

    held.get("first")!();
    expect((await first).body).toEqual({ devices: [{ handled: "first" }] });

    await eventually((): boolean => {
      return held.has("second");
    });
    expect(limiter.runningCount()).toBe(1);
    held.get("second")!();
    expect((await second).body).toEqual({ devices: [{ handled: "second" }] });

    await eventually((): boolean => {
      return limiter.runningCount() === 0;
    });
  });

  test("a probe that hangs up while it waits never reaches the handler, and frees its place", async () => {
    const { origin } = await start({ maxWaiting: 1 });

    const first: Promise<Answer> = post(origin, "/work", { label: "first" });
    await eventually((): boolean => {
      return held.has("first");
    });

    const controller: AbortController = new AbortController();
    const gone: Promise<unknown> = post(
      origin,
      "/work",
      { label: "gone" },
      controller.signal,
    ).catch((error: unknown): unknown => {
      return error;
    });
    await eventually((): boolean => {
      return limiter.waitingCount() === 1;
    });

    controller.abort();
    await gone;
    await eventually((): boolean => {
      return limiter.waitingCount() === 0;
    });

    // Its place in the queue is free again: the next request queues.
    const next: Promise<Answer> = post(origin, "/work", { label: "next" });
    await eventually((): boolean => {
      return limiter.waitingCount() === 1;
    });

    held.get("first")!();
    await first;
    await eventually((): boolean => {
      return held.has("next");
    });
    held.get("next")!();
    await next;

    expect(reachedHandler).toEqual(["first", "next"]);
  });

  test("a probe that hangs up while its request runs gives the slot back", async () => {
    const { origin } = await start({});

    const controller: AbortController = new AbortController();
    const gone: Promise<unknown> = post(
      origin,
      "/work",
      { label: "gone" },
      controller.signal,
    ).catch((error: unknown): unknown => {
      return error;
    });
    await eventually((): boolean => {
      return held.has("gone");
    });
    expect(limiter.runningCount()).toBe(1);

    controller.abort();
    await gone;
    await eventually((): boolean => {
      return limiter.runningCount() === 0;
    });

    // The slot is free: the next request runs at once.
    const next: Promise<Answer> = post(origin, "/work", { label: "next" });
    await eventually((): boolean => {
      return held.has("next");
    });
    held.get("next")!();
    expect((await next).status).toBe(200);
  });

  test("refused: a probe that declares retryWhenBusy gets a 429 with Retry-After, an older probe the empty batch", async () => {
    const { origin } = await start({ maxWaiting: 0 });

    const first: Promise<Answer> = post(origin, "/work", { label: "first" });
    await eventually((): boolean => {
      return held.has("first");
    });

    const retrying: Answer = await post(origin, "/work", {
      label: "retrying",
      probeCapabilities: RETRYING_PROBE,
    });
    expect(retrying.status).toBe(429);
    expect(retrying.retryAfter).toBe(
      String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
    );
    expect(retrying.body).toEqual({ message: PROBE_SCHEDULING_BUSY_MESSAGE });

    const older: Answer = await post(origin, "/work", {
      label: "older",
      probeCapabilities: OLDER_PROBE,
    });
    expect(older.status).toBe(200);
    expect(older.body).toEqual({ devices: [] });

    expect(reachedHandler).toEqual(["first"]);
    held.get("first")!();
    await first;
  });
});

describe("the real probe scheduling routers over HTTP", () => {
  let running: RunningServer | null = null;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/probe-ingest", MonitorRouter);
    app.use("/probe-ingest", NetworkDevicePollRouter);
    running = await listen(app);
  });

  afterAll(async () => {
    await close(running);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    monitorProbeService.claimMonitorProbesForProbing.mockResolvedValue(
      [] as never,
    );
    deviceService.claimDevicesForPolling.mockResolvedValue([] as never);
    cache.getString.mockResolvedValue(null as never);
    cache.setString.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function busy(): void {
    jest
      .spyOn(ProbeSchedulingLimiterInstance, "acquire")
      .mockRejectedValue(new ProbeSchedulingBusyError() as never);
    jest
      .spyOn(ProbeSchedulingLimiterInstance, "run")
      .mockRejectedValue(new ProbeSchedulingBusyError() as never);
  }

  test("with room, /monitor/list claims for the probe and answers", async () => {
    const answer: Answer = await post(
      running!.origin,
      "/probe-ingest/monitor/list",
      { probeId: PROBE_ID, probeCapabilities: RETRYING_PROBE, limit: 10 },
    );

    expect(answer.status).toBe(200);
    expect(
      monitorProbeService.claimMonitorProbesForProbing,
    ).toHaveBeenCalledTimes(1);
    // Its slot went back with its answer.
    await eventually((): boolean => {
      return ProbeSchedulingLimiterInstance.runningCount() === 0;
    });
  });

  test("busy, /monitor/list claims nothing: an older probe reads an empty list, a retrying probe gets a 429", async () => {
    busy();

    const older: Answer = await post(
      running!.origin,
      "/probe-ingest/monitor/list",
      { probeId: PROBE_ID, probeCapabilities: OLDER_PROBE, limit: 10 },
    );
    expect(older.status).toBe(200);
    // What the older probe's HTTP client hands BaseModel.fromJSONArray.
    expect(
      new HTTPResponse<JSONArray>(older.status, older.body, {}).data,
    ).toEqual([]);

    const retrying: Answer = await post(
      running!.origin,
      "/probe-ingest/monitor/list",
      { probeId: PROBE_ID, probeCapabilities: RETRYING_PROBE, limit: 10 },
    );
    expect(retrying.status).toBe(429);
    expect(retrying.retryAfter).toBe(
      String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
    );

    expect(
      monitorProbeService.claimMonitorProbesForProbing,
    ).not.toHaveBeenCalled();
  });

  test("busy, /probe/network-device/list claims nothing: an older probe reads no devices, a retrying probe gets a 429", async () => {
    busy();

    const older: Answer = await post(
      running!.origin,
      "/probe-ingest/probe/network-device/list",
      { probeId: PROBE_ID, probeCapabilities: OLDER_PROBE },
    );
    expect(older.status).toBe(200);
    expect(older.body).toEqual({ devices: [] });

    const retrying: Answer = await post(
      running!.origin,
      "/probe-ingest/probe/network-device/list",
      { probeId: PROBE_ID, probeCapabilities: RETRYING_PROBE },
    );
    expect(retrying.status).toBe(429);

    expect(deviceService.claimDevicesForPolling).not.toHaveBeenCalled();
  });

  test("busy, /monitor/pending-count answers the last count, and with none a 429 - never 0", async () => {
    busy();
    cache.getString.mockResolvedValue("17" as never);

    const withLast: Answer = await post(
      running!.origin,
      "/probe-ingest/monitor/pending-count",
      { probeId: PROBE_ID },
    );
    expect(withLast.status).toBe(200);
    expect(withLast.body).toEqual({ count: 17 });

    cache.getString.mockResolvedValue(null as never);

    const withoutLast: Answer = await post(
      running!.origin,
      "/probe-ingest/monitor/pending-count",
      { probeId: PROBE_ID },
    );
    expect(withoutLast.status).toBe(429);
    expect(withoutLast.retryAfter).toBe(
      String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
    );
    expect(
      monitorProbeService.countMonitorProbesDueForProbing,
    ).not.toHaveBeenCalled();
  });
});
