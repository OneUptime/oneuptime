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
 * (fire-and-forget); the handler must do NO database work at all.
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
} = ProbeService as unknown as {
  findOneBy: jest.Mock;
  updateLastAlive: jest.Mock;
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
