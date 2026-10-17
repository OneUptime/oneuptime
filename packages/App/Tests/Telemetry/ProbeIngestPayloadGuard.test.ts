import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Regression tests for the probeMonitorResponse presence guards on
 * POST /probe/response/ingest and
 * POST /probe/response/monitor-test-ingest/:testId.
 *
 * Both handlers used to run JSONFunctions.deserialize over the ENTIRE probe
 * payload — response bodies, screenshots, hundreds of KB — only to feed a
 * truthiness guard that could never fire: deserialize(undefined) returns {},
 * which is truthy. The raw req.body is what gets queued and the worker
 * deserializes it again, so the handler's deserialize was pure CPU waste on
 * every single probe report. The guards now check the RAW body value (the
 * same pattern ProcessProbeIngest uses), which also means a missing payload
 * finally gets the 400 the guard always intended instead of a 200 plus a
 * doomed queue job.
 *
 * What is queued is the result as the probe sent it - the very object, not a
 * copy - beside the probe that sent it, as the probe-auth middleware
 * authenticated it (req.probe). The request body is not queued: it carries
 * the probe's key, and its probeId is read only by the middleware. The
 * result's own probeId is held to the sender (ProbeIngestReportsAsItself).
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

// The queue module pulls in BullMQ at import time; mock it out entirely.
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
 * out; on the real server it runs before the handler.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

const queueService: { addProbeIngestJob: jest.Mock } =
  TelemetryQueueService as unknown as { addProbeIngestJob: jest.Mock };

const responseUtil: {
  sendEmptySuccessResponse: jest.Mock;
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendEmptySuccessResponse: jest.Mock;
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

/*
 * The handlers must never deserialize — the payload rides to the queue raw
 * and the worker deserializes it there. Spying (not mocking) keeps the real
 * implementation for anything else that legitimately calls it.
 */
const deserializeSpy: jest.Mock = jest.spyOn(
  JSONFunctions,
  "deserialize",
) as unknown as jest.Mock;

const mockResponse: ExpressResponse = {} as ExpressResponse;

// The probe the probe-auth middleware authenticated for every request here.
const PROBE_ID: ObjectID = ObjectID.generate();

function makeRequest(data: {
  body?: JSONObject | undefined;
  params?: Record<string, string> | undefined;
}): ExpressRequest {
  return {
    body: data.body || {},
    params: data.params || {},
    // What ProbeAuthorization.isAuthorizedServiceMiddleware sets.
    probe: { id: PROBE_ID },
  } as unknown as ExpressRequest;
}

type CallEndpointFunction = (
  path: string,
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

const callEndpoint: CallEndpointFunction = async (
  path: string,
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter.match("post", path).handlerFunction(req, mockResponse, next);
  return { next };
};

/*
 * A payload shaped like the wire format the probe actually sends: still in
 * SERIALIZED form ({ _type: ... } wrappers) plus bulky fields, because the
 * whole point is that the handler must forward it untouched, not decode it.
 */
function makeProbeMonitorResponsePayload(): JSONObject {
  return {
    _type: "ProbeMonitorResponse",
    monitorId: { _type: "ObjectID", value: ObjectID.generate().toString() },
    // A probe repeats its own id in every result it sends.
    probeId: { _type: "ObjectID", value: PROBE_ID.toString() },
    responseBody: "x".repeat(2048),
    screenshots: { "home-page": "data:image/png;base64,AAAA" },
    monitoredAt: { _type: "DateTime", value: "2026-08-18T00:00:00.000Z" },
  };
}

function expectBadDataError(message: string): void {
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
  const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as BadDataException).message).toBe(message);
}

describe("POST /probe/response/ingest", () => {
  const path: string = "/probe/response/ingest";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("is registered with the probe-auth middleware", () => {
    expect(mockRouter.match("post", path).middleware).toBe(
      ProbeAuthorization.isAuthorizedServiceMiddleware,
    );
  });

  /*
   * THE guard pin: the old code deserialized undefined into {} (truthy), so
   * a body with no probeMonitorResponse sailed past the guard, got a 200,
   * and enqueued a job the worker was doomed to reject.
   */
  test("missing probeMonitorResponse: 400 error and nothing enqueued", async () => {
    const { next } = await callEndpoint(
      path,
      makeRequest({ body: { probeId: "some-probe" } }),
    );

    expectBadDataError("ProbeMonitorResponse not found");
    expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("valid payload: processing response and the RAW result enqueued untouched, beside its probe", async () => {
    const body: JSONObject = {
      probeMonitorResponse: makeProbeMonitorResponsePayload(),
      probeId: PROBE_ID.toString(),
      probeKey: "the-probe-key",
    };
    const resultSnapshot: string = JSON.stringify(body["probeMonitorResponse"]);
    const req: ExpressRequest = makeRequest({ body });

    const { next } = await callEndpoint(path, req);

    expect(next).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      req,
      mockResponse,
      { result: "processing" },
    );

    expect(queueService.addProbeIngestJob).toHaveBeenCalledTimes(1);
    const jobArg: JSONObject = queueService.addProbeIngestJob.mock
      .calls[0]![0] as JSONObject;
    // The very same object — no copy, no re-shaping.
    expect(jobArg["probeMonitorResponse"]).toBe(
      req.body["probeMonitorResponse"],
    );
    expect(jobArg["jobType"]).toBe("probe-response");
    // ...and byte-identical to what the probe sent (still serialized form).
    expect(JSON.stringify(jobArg["probeMonitorResponse"])).toBe(
      resultSnapshot,
    );
    // The probe that sent it, as it authenticated; the body (and key) stay behind.
    expect((jobArg["probeId"] as ObjectID).toString()).toBe(
      PROBE_ID.toString(),
    );
    expect(JSON.stringify(jobArg)).not.toContain("the-probe-key");
  });

  test("never deserializes the payload — the worker owns that", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
      }),
    );

    expect(deserializeSpy).not.toHaveBeenCalled();
  });

  test("responds BEFORE enqueueing, so probe latency never waits on Redis", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
      }),
    );

    const respondOrder: number =
      responseUtil.sendJsonObjectResponse.mock.invocationCallOrder[0]!;
    const enqueueOrder: number =
      queueService.addProbeIngestJob.mock.invocationCallOrder[0]!;
    expect(respondOrder).toBeLessThan(enqueueOrder);
  });

  test("passes queue failures to the error handler", async () => {
    const boom: Error = new Error("redis down");
    queueService.addProbeIngestJob.mockRejectedValueOnce(boom as never);

    const { next } = await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
      }),
    );

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("POST /probe/response/monitor-test-ingest/:testId", () => {
  const path: string = "/probe/response/monitor-test-ingest/:testId";
  const testId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("is registered with the probe-auth middleware", () => {
    expect(mockRouter.match("post", path).middleware).toBe(
      ProbeAuthorization.isAuthorizedServiceMiddleware,
    );
  });

  test("missing probeMonitorResponse: 400 error and nothing enqueued", async () => {
    const { next } = await callEndpoint(
      path,
      makeRequest({
        body: { probeId: "some-probe" },
        params: { testId: testId.toString() },
      }),
    );

    expectBadDataError("ProbeMonitorResponse not found");
    expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  /*
   * The old guard checked `!new ObjectID(...)` — an object, always truthy,
   * so a request with no testId param was waved through and enqueued.
   */
  test("missing testId param: 400 error and nothing enqueued", async () => {
    const { next } = await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
        params: {},
      }),
    );

    expectBadDataError("TestId not found");
    expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("valid payload: empty success and the RAW result enqueued with the testId, beside its probe", async () => {
    const body: JSONObject = {
      probeMonitorResponse: makeProbeMonitorResponsePayload(),
      probeKey: "the-probe-key",
    };
    const resultSnapshot: string = JSON.stringify(body["probeMonitorResponse"]);
    const req: ExpressRequest = makeRequest({
      body,
      params: { testId: testId.toString() },
    });

    const { next } = await callEndpoint(path, req);

    expect(next).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledWith(
      req,
      mockResponse,
    );

    expect(queueService.addProbeIngestJob).toHaveBeenCalledTimes(1);
    const jobArg: JSONObject = queueService.addProbeIngestJob.mock
      .calls[0]![0] as JSONObject;
    expect(jobArg["probeMonitorResponse"]).toBe(
      req.body["probeMonitorResponse"],
    );
    expect(jobArg["jobType"]).toBe("monitor-test");
    expect(jobArg["testId"]).toBe(testId.toString());
    expect(JSON.stringify(jobArg["probeMonitorResponse"])).toBe(
      resultSnapshot,
    );
    expect((jobArg["probeId"] as ObjectID).toString()).toBe(
      PROBE_ID.toString(),
    );
    expect(JSON.stringify(jobArg)).not.toContain("the-probe-key");
  });

  test("never deserializes the payload — the worker owns that", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
        params: { testId: testId.toString() },
      }),
    );

    expect(deserializeSpy).not.toHaveBeenCalled();
  });

  test("responds BEFORE enqueueing, so probe latency never waits on Redis", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: { probeMonitorResponse: makeProbeMonitorResponsePayload() },
        params: { testId: testId.toString() },
      }),
    );

    const respondOrder: number =
      responseUtil.sendEmptySuccessResponse.mock.invocationCallOrder[0]!;
    const enqueueOrder: number =
      queueService.addProbeIngestJob.mock.invocationCallOrder[0]!;
    expect(respondOrder).toBeLessThan(enqueueOrder);
  });
});
