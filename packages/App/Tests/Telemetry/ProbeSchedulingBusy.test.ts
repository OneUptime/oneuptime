import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import { KeyedConcurrencyRelease } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import ProbeSchedulingMiddleware, {
  EmptySchedulingAnswer,
  ProbeSchedulingMiddlewareFunction,
} from "../../FeatureSet/Telemetry/Middleware/ProbeScheduling";
import { EventEmitter } from "events";
import type { Mock } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The probes' scheduling endpoints under the per-process probe scheduling
 * limit (#7920): a request runs once a slot is free and keeps it until its
 * answer has gone; a refused one claims nothing and is answered busy - a 429
 * with Retry-After to a probe that declares retryWhenBusy, the endpoint's
 * empty batch to an older probe (which reads that quietly, where a 429
 * would reach its error log). The pending count, refused or late, is the
 * probe's last count - never 0 - and with none to give, a 429.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
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
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
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

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

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

// Importing the routers registers their routes on the mocked router.
import "../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const responseUtil: {
  sendJsonObjectResponse: AnyMock;
  sendEntityArrayResponse: AnyMock;
  sendErrorResponse: AnyMock;
} = Response as unknown as {
  sendJsonObjectResponse: AnyMock;
  sendEntityArrayResponse: AnyMock;
  sendErrorResponse: AnyMock;
};

const cache: { getString: AnyMock; setString: AnyMock } =
  GlobalCache as unknown as { getString: AnyMock; setString: AnyMock };

const monitorProbeService: {
  claimMonitorProbesForProbing: AnyMock;
  countMonitorProbesDueForProbing: AnyMock;
} = MonitorProbeService as unknown as {
  claimMonitorProbesForProbing: AnyMock;
  countMonitorProbesDueForProbing: AnyMock;
};

const monitorTestService: { claimMonitorTestsForProbing: AnyMock } =
  MonitorTestService as unknown as { claimMonitorTestsForProbing: AnyMock };

const deviceService: { claimDevicesForPolling: AnyMock } =
  NetworkDeviceService as unknown as { claimDevicesForPolling: AnyMock };

const PROBE_ID: ObjectID = new ObjectID("1f7e3c2a-9b4d-4e6f-8a0c-2d4b6f8a0c11");

// An HTTP response: answers once, then says it finished and closed.
class FakeResponse extends EventEmitter {
  public statusCode: number = 200;
  public headers: Record<string, string> = {};
  public body: unknown = undefined;
  public writableFinished: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  public send(body: unknown): this {
    this.body = body;
    this.finish();
    return this;
  }

  public finish(): void {
    this.writableFinished = true;
    this.emit("finish");
    this.emit("close");
  }

  // The client hangs up before an answer.
  public hangUp(): void {
    this.emit("close");
  }
}

function asExpress(res: FakeResponse): ExpressResponse {
  return res as unknown as ExpressResponse;
}

function makeRequest(data: {
  capabilities?: Array<string> | undefined;
  withProbe?: boolean | undefined;
}): ExpressRequest {
  const request: JSONObject = {
    body: {
      probeCapabilities: data.capabilities || [
        ProbeCapability.NetworkDevicePing,
      ],
    },
  };

  if (data.withProbe !== false) {
    request["probe"] = new Probe(PROBE_ID);
  }

  return request as unknown as ExpressRequest;
}

const OLDER_PROBE: Array<string> = [ProbeCapability.NetworkDevicePing];
const RETRYING_PROBE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.RetryWhenBusy,
];

async function settle(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void): void => {
      process.nextTick(resolve);
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  cache.getString.mockResolvedValue(null as never);
  cache.setString.mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProbeSchedulingMiddleware", () => {
  let limiter: ProbeSchedulingLimiter;
  let emptyAnswer: Mock<EmptySchedulingAnswer>;
  let limit: ProbeSchedulingMiddlewareFunction;

  beforeEach(() => {
    limiter = new ProbeSchedulingLimiter({
      ...probeSchedulingLimits(1),
      maxWaiting: 1,
    });
    emptyAnswer = jest.fn<EmptySchedulingAnswer>(
      (_req: ExpressRequest, res: ExpressResponse): void => {
        res.send({ devices: [] });
      },
    );
    limit = ProbeSchedulingMiddleware.limit(emptyAnswer, limiter);
  });

  test("a request with a slot goes on to the handler and keeps the slot until its answer has gone", async () => {
    const res: FakeResponse = new FakeResponse();
    const next: AnyMock = jest.fn() as unknown as AnyMock;

    await limit(makeRequest({}), asExpress(res), next as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(limiter.runningCount(PROBE_ID.toString())).toBe(1);

    res.send([]);
    expect(limiter.runningCount()).toBe(0);
  });

  test("the slot is given back when the probe hangs up before the answer", async () => {
    const res: FakeResponse = new FakeResponse();
    await limit(makeRequest({}), asExpress(res), jest.fn() as NextFunction);
    expect(limiter.runningCount()).toBe(1);

    res.hangUp();
    expect(limiter.runningCount()).toBe(0);
  });

  test("a request that waits gets the slot an answered request gives back", async () => {
    const first: FakeResponse = new FakeResponse();
    await limit(makeRequest({}), asExpress(first), jest.fn() as NextFunction);

    const second: FakeResponse = new FakeResponse();
    const next: AnyMock = jest.fn() as unknown as AnyMock;
    const waiting: Promise<void> = limit(
      makeRequest({}),
      asExpress(second),
      next as NextFunction,
    );
    await settle();
    expect(next).not.toHaveBeenCalled();
    expect(limiter.waitingCount()).toBe(1);

    first.send([]);
    await waiting;
    expect(next).toHaveBeenCalledWith();
    second.send([]);
    expect(limiter.runningCount()).toBe(0);
  });

  test("refused, a probe that declares retryWhenBusy gets a 429 with Retry-After; nothing reaches the handler", async () => {
    const held: KeyedConcurrencyRelease = await limiter.acquire("other");
    const queued: KeyedConcurrencyRelease | void = await Promise.race([
      limiter.acquire("other-2"),
      settle(),
    ]);
    expect(queued).toBeUndefined();

    const res: FakeResponse = new FakeResponse();
    const next: AnyMock = jest.fn() as unknown as AnyMock;
    await limit(
      makeRequest({ capabilities: RETRYING_PROBE }),
      asExpress(res),
      next as NextFunction,
    );

    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe(
      String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
    );
    expect(res.body).toEqual({ message: PROBE_SCHEDULING_BUSY_MESSAGE });
    expect(next).not.toHaveBeenCalled();
    expect(emptyAnswer).not.toHaveBeenCalled();
    held();
  });

  test("refused, an older probe gets the endpoint's empty batch", async () => {
    const held: KeyedConcurrencyRelease = await limiter.acquire("other");
    void limiter.acquire("other-2");
    await settle();

    const res: FakeResponse = new FakeResponse();
    const next: AnyMock = jest.fn() as unknown as AnyMock;
    await limit(
      makeRequest({ capabilities: OLDER_PROBE }),
      asExpress(res),
      next as NextFunction,
    );

    expect(emptyAnswer).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ devices: [] });
    expect(next).not.toHaveBeenCalled();
    held();
  });

  test("a request with no probe goes on to the handler, which answers it as before", async () => {
    const next: AnyMock = jest.fn() as unknown as AnyMock;
    await limit(
      makeRequest({ withProbe: false }),
      asExpress(new FakeResponse()),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledWith();
    expect(limiter.runningCount()).toBe(0);
  });

  test("a probe that hangs up while it waits is never answered, and its request never runs", async () => {
    const held: KeyedConcurrencyRelease = await limiter.acquire("other");
    const res: FakeResponse = new FakeResponse();
    const next: AnyMock = jest.fn() as unknown as AnyMock;
    const waiting: Promise<void> = limit(
      makeRequest({}),
      asExpress(res),
      next as NextFunction,
    );
    await settle();

    res.hangUp();
    await waiting;
    held();
    await settle();

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
    expect(limiter.runningCount()).toBe(0);
  });

  test("a probe declares retryWhenBusy only with the capability in its body", () => {
    expect(
      ProbeSchedulingMiddleware.probeRetriesWhenBusy(
        makeRequest({ capabilities: RETRYING_PROBE }),
      ),
    ).toBe(true);
    expect(
      ProbeSchedulingMiddleware.probeRetriesWhenBusy(
        makeRequest({ capabilities: OLDER_PROBE }),
      ),
    ).toBe(false);
    expect(
      ProbeSchedulingMiddleware.probeRetriesWhenBusy({
        body: { probeCapabilities: "retryWhenBusy" },
      } as unknown as ExpressRequest),
    ).toBe(false);
  });
});

describe("the probe scheduling endpoints when the server is busy", () => {
  function busyLimit(): void {
    jest
      .spyOn(ProbeSchedulingLimiterInstance, "acquire")
      .mockRejectedValue(new ProbeSchedulingBusyError());
  }

  const LIST_ROUTES: Array<{
    uri: string;
    claim: () => AnyMock;
    expectEmptyBatch: (res: FakeResponse) => void;
  }> = [
    {
      uri: "/monitor/list",
      claim: (): AnyMock => {
        return monitorProbeService.claimMonitorProbesForProbing;
      },
      expectEmptyBatch: (res: FakeResponse): void => {
        expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
          expect.anything(),
          res,
          [],
          new PositiveNumber(0),
          Monitor,
        );
      },
    },
    {
      uri: "/monitor-test/list",
      claim: (): AnyMock => {
        return monitorTestService.claimMonitorTestsForProbing;
      },
      expectEmptyBatch: (res: FakeResponse): void => {
        expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
          expect.anything(),
          res,
          [],
          new PositiveNumber(0),
          MonitorTest,
        );
      },
    },
    {
      uri: "/probe/network-device/list",
      claim: (): AnyMock => {
        return deviceService.claimDevicesForPolling;
      },
      expectEmptyBatch: (res: FakeResponse): void => {
        expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
          expect.anything(),
          res,
          { devices: [] },
        );
      },
    },
  ];

  for (const route of LIST_ROUTES) {
    describe(`POST ${route.uri}`, () => {
      test("runs under the probe scheduling limit, after the probe is authenticated", () => {
        const middlewares: Array<unknown> = mockRouter.match(
          "post",
          route.uri,
        ).middlewares;
        expect(middlewares).toHaveLength(2);
        expect(middlewares[0]).toBe(
          ProbeAuthorization.isAuthorizedServiceMiddleware,
        );
      });

      test("an older probe gets the empty batch, and nothing is claimed", async () => {
        busyLimit();
        const res: FakeResponse = new FakeResponse();
        const next: AnyMock = jest.fn() as unknown as AnyMock;

        await (
          mockRouter.match("post", route.uri)
            .middlewares[1] as ProbeSchedulingMiddlewareFunction
        )(
          makeRequest({ capabilities: OLDER_PROBE }),
          asExpress(res),
          next as NextFunction,
        );

        route.expectEmptyBatch(res);
        expect(next).not.toHaveBeenCalled();
        expect(route.claim()).not.toHaveBeenCalled();
      });

      test("a probe that declares retryWhenBusy gets a 429, and nothing is claimed", async () => {
        busyLimit();
        const res: FakeResponse = new FakeResponse();
        const next: AnyMock = jest.fn() as unknown as AnyMock;

        await (
          mockRouter.match("post", route.uri)
            .middlewares[1] as ProbeSchedulingMiddlewareFunction
        )(
          makeRequest({ capabilities: RETRYING_PROBE }),
          asExpress(res),
          next as NextFunction,
        );

        expect(res.statusCode).toBe(429);
        expect(res.headers["Retry-After"]).toBe(
          String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
        );
        expect(responseUtil.sendEntityArrayResponse).not.toHaveBeenCalled();
        expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(route.claim()).not.toHaveBeenCalled();
      });
    });
  }

  describe("POST /monitor/pending-count", () => {
    async function readPendingCount(res: FakeResponse): Promise<AnyMock> {
      const next: AnyMock = jest.fn() as unknown as AnyMock;
      await mockRouter
        .match("post", "/monitor/pending-count")
        .handlerFunction(makeRequest({}), asExpress(res), next);
      return next;
    }

    test("answers the probe's count, and keeps it for busy reads", async () => {
      monitorProbeService.countMonitorProbesDueForProbing.mockResolvedValue(
        23 as never,
      );
      const res: FakeResponse = new FakeResponse();

      const next: AnyMock = await readPendingCount(res);

      expect(next).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        res,
        { count: 23 },
      );
      expect(
        monitorProbeService.countMonitorProbesDueForProbing.mock.calls[0]![0],
      ).toMatchObject({ probeId: PROBE_ID });
      expect(cache.setString).toHaveBeenCalledWith(
        "probe-pending-count",
        PROBE_ID.toString(),
        "23",
        expect.anything(),
      );
    });

    test("busy, with a last count: the last count, never 0", async () => {
      jest
        .spyOn(ProbeSchedulingLimiterInstance, "run")
        .mockRejectedValue(new ProbeSchedulingBusyError());
      cache.getString.mockResolvedValue("17" as never);
      const res: FakeResponse = new FakeResponse();

      await readPendingCount(res);

      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
        expect.anything(),
        res,
        { count: 17 },
      );
      expect(
        monitorProbeService.countMonitorProbesDueForProbing,
      ).not.toHaveBeenCalled();
    });

    test("busy, with no last count: a 429 the autoscaler reads as no reading, never a count of 0", async () => {
      jest
        .spyOn(ProbeSchedulingLimiterInstance, "run")
        .mockRejectedValue(new ProbeSchedulingBusyError());
      const res: FakeResponse = new FakeResponse();

      const next: AnyMock = await readPendingCount(res);

      expect(res.statusCode).toBe(429);
      expect(res.headers["Retry-After"]).toBe(
        String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
      );
      expect(res.body).toEqual({ message: PROBE_SCHEDULING_BUSY_MESSAGE });
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    test("a count that fails, with no last count, goes to the error handler as before", async () => {
      const failure: Error = new Error("connection terminated");
      monitorProbeService.countMonitorProbesDueForProbing.mockRejectedValue(
        failure as never,
      );

      const next: AnyMock = await readPendingCount(new FakeResponse());

      expect(next).toHaveBeenCalledWith(failure);
    });
  });
});
