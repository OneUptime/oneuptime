import { mockRouter } from "Common/Tests/Server/API/Helpers";
import ProbeService from "Common/Server/Services/ProbeService";
import Response from "Common/Server/Utils/Response";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Regression tests for POST /alive.
 *
 * The /alive heartbeat is what keeps a probe from being flagged
 * Disconnected, so its latency budget is the whole point: the handler used
 * to run a second, AWAITED ProbeService.updateLastAlive on top of the one
 * the auth middleware already schedules. That await chained the heartbeat's
 * response time to Postgres write latency — a briefly-starved pool made
 * /alive hang past the probe client's timeout and healthy probes were
 * marked Disconnected. The middleware now owns the stamp
 * (fire-and-forget); the handler must AWAIT no database work at all. The
 * one write it schedules - the probe's interface addresses (#10429) - is
 * fire-and-forget too, and pinned below.
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
    // The route module imports this named export for log attribution.
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateLastAlive: jest.fn(),
      recordInterfaceAddresses: jest.fn(),
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

/*
 * The queue module pulls in BullMQ at import time; the /alive handler must
 * never touch it.
 */
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProbeIngestJob: jest.fn(),
        addSnmpTrapIngestJob: jest.fn(),
        getQueueStats: jest.fn(),
        getQueueSize: jest.fn(),
        getFailedJobs: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getOwners: jest.fn(),
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

/*
 * Importing the router module registers its routes on the mocked router so
 * each handler can be invoked directly. The probe-auth middleware is mocked
 * out; on the real server it runs before the handler and owns the lastAlive
 * stamp.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";

const probeService: {
  findOneBy: jest.Mock;
  updateLastAlive: jest.Mock;
  recordInterfaceAddresses: jest.Mock;
} = ProbeService as unknown as {
  findOneBy: jest.Mock;
  updateLastAlive: jest.Mock;
  recordInterfaceAddresses: jest.Mock;
};

const responseUtil: {
  sendEmptySuccessResponse: jest.Mock;
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendEmptySuccessResponse: jest.Mock;
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallAliveEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

const callAliveEndpoint: CallAliveEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/alive")
    .handlerFunction(req, mockResponse, next);
  return { next };
};

describe("POST /alive", () => {
  const probeId: ObjectID = ObjectID.generate();

  function makeRequest(): ExpressRequest {
    // The wire shape the probe sends; the handler must not need any of it.
    return {
      body: {
        probeId: probeId.toString(),
        probeKey: "test-probe-key",
      },
    } as unknown as ExpressRequest;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * THE regression pin: the handler responds immediately and does ZERO
   * database work. A re-introduced (awaited) updateLastAlive here would
   * re-couple heartbeat latency to Postgres write latency — the exact
   * coupling that let a slow database mark healthy probes Disconnected
   * while they were successfully running their checks.
   */
  test("responds with empty success and never calls updateLastAlive itself", async () => {
    const { next } = await callAliveEndpoint(makeRequest());

    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
    );

    // The auth middleware owns the lastAlive stamp; the handler owns nothing.
    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    expect(probeService.findOneBy).not.toHaveBeenCalled();

    expect(next).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  });

  /*
   * The stamp only rides along because the auth middleware runs on this
   * route: /alive registered WITHOUT it would authenticate nobody and stamp
   * nothing, silently letting every probe go stale.
   */
  test("is registered with the probe-auth middleware", () => {
    expect(mockRouter.match("post", "/alive").middleware).toBe(
      ProbeAuthorization.isAuthorizedServiceMiddleware,
    );
  });

  test("does not call next with an error on the happy path", async () => {
    const { next } = await callAliveEndpoint(makeRequest());

    expect(next).not.toHaveBeenCalled();
  });
});

/*
 * A heartbeat lists the addresses on the probe's own network interfaces
 * (#10429), and OneUptime keeps them on the probe so Security Events knows
 * the probe's polls and checks in the project's flows. Kept as the liveness
 * stamp is: scheduled, never awaited, so a slow database never holds the
 * heartbeat.
 */
describe("POST /alive keeps the probe's interface addresses", () => {
  const probeId: ObjectID = ObjectID.generate();

  function makeRequest(body: Record<string, unknown>): ExpressRequest {
    return {
      body: {
        probeId: probeId.toString(),
        probeKey: "test-probe-key",
        ...body,
      },
      // Set by the probe-auth middleware: whose request it is.
      probe: { id: probeId },
    } as unknown as ExpressRequest;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    probeService.recordInterfaceAddresses.mockImplementation(() => {
      return Promise.resolve(true);
    });
  });

  test("keeps what the heartbeat lists, read as OneUptime keeps it, for the probe that sent it", async () => {
    await callAliveEndpoint(
      makeRequest({
        probeInterfaceAddresses: [
          "10.0.0.5/24",
          "fe80::1/64",
          "127.0.0.1",
          "2001:db8::5",
        ],
      }),
    );

    expect(probeService.recordInterfaceAddresses).toHaveBeenCalledTimes(1);
    expect(probeService.recordInterfaceAddresses).toHaveBeenCalledWith({
      probeId,
      addresses: ["10.0.0.5", "2001:db8::5"],
    });
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("answers without waiting for the write", async () => {
    probeService.recordInterfaceAddresses.mockImplementation(() => {
      return new Promise<never>(() => {
        // A database that never answers.
      });
    });

    const { next } = await callAliveEndpoint(
      makeRequest({ probeInterfaceAddresses: ["10.0.0.5"] }),
    );

    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test("a write that fails is logged, and the heartbeat still succeeds", async () => {
    probeService.recordInterfaceAddresses.mockImplementation(() => {
      return Promise.reject(new Error("pool exhausted"));
    });

    const { next } = await callAliveEndpoint(
      makeRequest({ probeInterfaceAddresses: ["10.0.0.5"] }),
    );

    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test("an empty list is kept: the probe has no address worth keeping", async () => {
    await callAliveEndpoint(makeRequest({ probeInterfaceAddresses: [] }));

    expect(probeService.recordInterfaceAddresses).toHaveBeenCalledWith({
      probeId,
      addresses: [],
    });
  });

  test("a heartbeat that lists nothing - an older probe's - leaves what is kept", async () => {
    await callAliveEndpoint(makeRequest({}));
    await callAliveEndpoint(
      makeRequest({ probeInterfaceAddresses: "10.0.0.5" }),
    );

    expect(probeService.recordInterfaceAddresses).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(2);
  });

  test("a request the middleware did not make a probe's keeps nothing", async () => {
    await callAliveEndpoint({
      body: { probeInterfaceAddresses: ["10.0.0.5"] },
    } as unknown as ExpressRequest);

    expect(probeService.recordInterfaceAddresses).not.toHaveBeenCalled();
  });
});
