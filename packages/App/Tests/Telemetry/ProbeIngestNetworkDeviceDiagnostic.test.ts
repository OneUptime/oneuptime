import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiagnosticService from "Common/Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import Probe from "Common/Models/DatabaseModels/Probe";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS,
  NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_TIMEOUT_IN_MS,
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

jest.mock("Common/Server/Services/NetworkDeviceDiagnosticService", () => {
  return {
    __esModule: true,
    default: {
      claimPendingForProbe: jest.fn(),
      findBy: jest.fn(),
      recordReport: jest.fn(),
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
 * Importing the router module registers its routes on the mocked router so
 * each handler can be invoked directly. The probe-auth middleware is mocked
 * out; tests attach `req.probe` themselves, exactly what the middleware
 * does after validating probeId + probeKey.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDeviceDiagnostic";

const diagnosticService: {
  claimPendingForProbe: jest.Mock;
  findBy: jest.Mock;
  recordReport: jest.Mock;
} = NetworkDeviceDiagnosticService as unknown as {
  claimPendingForProbe: jest.Mock;
  findBy: jest.Mock;
  recordReport: jest.Mock;
};

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const loggerMock: { warn: jest.Mock; error: jest.Mock } = logger as unknown as {
  warn: jest.Mock;
  error: jest.Mock;
};

const LIST_URI: string = "/probe/network-device-diagnostic/list";
const INGEST_URI: string = "/probe/network-device-diagnostic/response/ingest";

function makeRequest(data: {
  probeId?: ObjectID | undefined;
  body?: JSONObject | undefined;
}): ExpressRequest {
  const req: JSONObject = {
    body: data.body || {},
  };

  if (data.probeId) {
    req["probe"] = new Probe(data.probeId);
  }

  return req as unknown as ExpressRequest;
}

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

function endpointCaller(uri: string): CallEndpointFunction {
  return async (req: ExpressRequest): Promise<{ next: NextFunction }> => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;
    await mockRouter
      .match("post", uri)
      .handlerFunction(req, mockResponse, next);
    return { next };
  };
}

const callListEndpoint: CallEndpointFunction = endpointCaller(LIST_URI);
const callIngestEndpoint: CallEndpointFunction = endpointCaller(INGEST_URI);

function makeDiagnostic(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  networkDeviceId?: ObjectID | undefined;
  diagnosticType?: string | undefined;
  hostname?: string | undefined;
}): NetworkDeviceDiagnostic {
  const row: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic(data.id);

  if (data.projectId) {
    row.projectId = data.projectId;
  }
  if (data.networkDeviceId) {
    row.networkDeviceId = data.networkDeviceId;
  }
  if (data.diagnosticType !== undefined) {
    row.diagnosticType = data.diagnosticType;
  }
  if (data.hostname !== undefined) {
    row.hostname = data.hostname;
  }

  return row;
}

function respondedJobs(): Array<NetworkDeviceDiagnosticJob> {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const payload: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return payload["diagnostics"] as unknown as Array<NetworkDeviceDiagnosticJob>;
}

function expectBadDataResponse(messageFragment?: string | undefined): void {
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
    expect.anything(),
    mockResponse,
    expect.any(BadDataException),
  );
  expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();

  if (messageFragment) {
    const error: BadDataException = responseUtil.sendErrorResponse.mock
      .calls[0]![2] as BadDataException;
    expect(error.message).toContain(messageFragment);
  }
}

function recordedReport(): {
  probeId: ObjectID;
  report: NetworkDeviceDiagnosticReport;
} {
  expect(diagnosticService.recordReport).toHaveBeenCalledTimes(1);
  return diagnosticService.recordReport.mock.calls[0]![0] as {
    probeId: ObjectID;
    report: NetworkDeviceDiagnosticReport;
  };
}

/*
 * Both routes are reachable only by an authenticated probe. The middleware
 * is what turns probeId + probeKey into `req.probe`; a route registered
 * without it would read an empty probe and refuse everything — or worse,
 * trust a probe id from the body.
 */
describe("route registration", () => {
  test.each([LIST_URI, INGEST_URI])(
    "POST %s sits behind the probe-auth middleware",
    (uri: string) => {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "post",
        uri,
      );

      expect(route.middlewares).toEqual([
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      ]);
    },
  );
});

describe("POST /probe/network-device-diagnostic/list", () => {
  const probeId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const networkDeviceId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
    diagnosticService.claimPendingForProbe.mockResolvedValue([] as never);
    diagnosticService.findBy.mockResolvedValue([] as never);
    diagnosticService.recordReport.mockResolvedValue(true as never);
  });

  test("rejects a request with no authenticated probe", async () => {
    await callListEndpoint(makeRequest({}));

    expect(diagnosticService.claimPendingForProbe).not.toHaveBeenCalled();
    expect(diagnosticService.findBy).not.toHaveBeenCalled();
    expectBadDataResponse("Probe not found");
  });

  test("claims for the requesting probe with the default limit, and an empty claim responds {diagnostics: []} without fetching", async () => {
    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).not.toHaveBeenCalled();

    expect(diagnosticService.claimPendingForProbe).toHaveBeenCalledTimes(1);
    const claimArgs: JSONObject = diagnosticService.claimPendingForProbe.mock
      .calls[0]![0] as JSONObject;
    expect((claimArgs["probeId"] as ObjectID).toString()).toBe(
      probeId.toString(),
    );
    expect(claimArgs["limit"]).toBe(NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT);

    expect(diagnosticService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { diagnostics: [] },
    );
  });

  /*
   * The cap bounds a burst; it does not police the probe. A probe asking
   * for more than the cap is capped, one asking for less is honoured, and
   * nonsense falls back to the default rather than to an error.
   */
  describe("the body limit", () => {
    function claimedLimit(): number {
      const claimArgs: JSONObject = diagnosticService.claimPendingForProbe.mock
        .calls[0]![0] as JSONObject;
      return claimArgs["limit"] as number;
    }

    test("a limit above the cap is capped", async () => {
      await callListEndpoint(
        makeRequest({
          probeId,
          body: { limit: NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT * 10 },
        }),
      );

      expect(claimedLimit()).toBe(NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT);
    });

    test("a limit below the cap is honoured", async () => {
      await callListEndpoint(makeRequest({ probeId, body: { limit: 3 } }));

      expect(claimedLimit()).toBe(3);
    });

    const fallbackCases: Array<[string, unknown]> = [
      ["zero", 0],
      ["negative", -4],
      ["a string", "lots"],
      ["a non-finite number", Number.POSITIVE_INFINITY],
    ];

    test.each(fallbackCases)(
      "%s falls back to the default",
      async (_label: string, limit: unknown) => {
        await callListEndpoint(
          makeRequest({
            probeId,
            body: { limit: limit as string },
          }),
        );

        expect(claimedLimit()).toBe(NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT);
      },
    );
  });

  test("fetches exactly the claimed rows, as root, oldest first, with the columns a job needs", async () => {
    const firstId: ObjectID = ObjectID.generate();
    const secondId: ObjectID = ObjectID.generate();
    diagnosticService.claimPendingForProbe.mockResolvedValue([
      firstId,
      secondId,
    ] as never);

    const anySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      QueryHelper,
      "any",
    );

    try {
      await callListEndpoint(makeRequest({ probeId, body: { limit: 7 } }));

      expect(anySpy).toHaveBeenCalledWith([
        firstId.toString(),
        secondId.toString(),
      ]);

      expect(diagnosticService.findBy).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = diagnosticService.findBy.mock
        .calls[0]![0] as JSONObject;
      const select: JSONObject = findArgs["select"] as JSONObject;

      for (const column of [
        "_id",
        "projectId",
        "networkDeviceId",
        "diagnosticType",
        "hostname",
      ]) {
        expect(select[column]).toBe(true);
      }

      expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
      expect(findArgs["limit"]).toBe(7);
      expect(findArgs["skip"]).toBe(0);
      expect(findArgs["sort"]).toEqual({ createdAt: SortOrder.Ascending });
    } finally {
      anySpy.mockRestore();
    }
  });

  test("a Ping row becomes a job carrying the ping timeout and packet count", async () => {
    const diagnosticId: ObjectID = ObjectID.generate();
    diagnosticService.claimPendingForProbe.mockResolvedValue([
      diagnosticId,
    ] as never);
    diagnosticService.findBy.mockResolvedValue([
      makeDiagnostic({
        id: diagnosticId,
        projectId: projectId,
        networkDeviceId: networkDeviceId,
        diagnosticType: NetworkDeviceDiagnosticType.Ping,
        hostname: "10.0.0.5",
      }),
    ] as never);

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).not.toHaveBeenCalled();
    expect(respondedJobs()).toEqual([
      {
        id: diagnosticId.toString(),
        projectId: projectId.toString(),
        networkDeviceId: networkDeviceId.toString(),
        diagnosticType: NetworkDeviceDiagnosticType.Ping,
        hostname: "10.0.0.5",
        timeoutInMs: NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
        packetCount: NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
      },
    ]);
    expect(respondedJobs()[0]).not.toHaveProperty("maxHops");
    expect(diagnosticService.recordReport).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  test("a Traceroute row becomes a job carrying the trace timeout and hop limit", async () => {
    const diagnosticId: ObjectID = ObjectID.generate();
    diagnosticService.claimPendingForProbe.mockResolvedValue([
      diagnosticId,
    ] as never);
    diagnosticService.findBy.mockResolvedValue([
      makeDiagnostic({
        id: diagnosticId,
        projectId: projectId,
        networkDeviceId: networkDeviceId,
        diagnosticType: NetworkDeviceDiagnosticType.Traceroute,
        hostname: "core-sw1.example.com",
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(respondedJobs()).toEqual([
      {
        id: diagnosticId.toString(),
        projectId: projectId.toString(),
        networkDeviceId: networkDeviceId.toString(),
        diagnosticType: NetworkDeviceDiagnosticType.Traceroute,
        hostname: "core-sw1.example.com",
        timeoutInMs: NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_TIMEOUT_IN_MS,
        maxHops: NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS,
      },
    ]);
    expect(respondedJobs()[0]).not.toHaveProperty("packetCount");
  });

  test("the hostname is handed out trimmed", async () => {
    const diagnosticId: ObjectID = ObjectID.generate();
    diagnosticService.claimPendingForProbe.mockResolvedValue([
      diagnosticId,
    ] as never);
    diagnosticService.findBy.mockResolvedValue([
      makeDiagnostic({
        id: diagnosticId,
        projectId: projectId,
        networkDeviceId: networkDeviceId,
        diagnosticType: NetworkDeviceDiagnosticType.Ping,
        hostname: "  10.0.0.5 ",
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(respondedJobs()[0]!.hostname).toBe("10.0.0.5");
  });

  /*
   * Claiming already moved the row to In Progress. A row the probe can
   * never run is settled as Failed here — with a reason the dashboard shows
   * — instead of leaving the operator on a spinner until the timeout, and
   * the rest of the batch still goes out.
   */
  describe("a claimed row the probe cannot run", () => {
    const hostnameCases: Array<[string, string | undefined, string]> = [
      ["no hostname", undefined, "hostname"],
      ["a blank hostname", "   ", "hostname"],
    ];

    test.each(hostnameCases)(
      "with %s is marked Failed and skipped; the good row is still handed out",
      async (
        _label: string,
        hostname: string | undefined,
        reasonFragment: string,
      ) => {
        const badId: ObjectID = ObjectID.generate();
        const goodId: ObjectID = ObjectID.generate();
        diagnosticService.claimPendingForProbe.mockResolvedValue([
          badId,
          goodId,
        ] as never);
        diagnosticService.findBy.mockResolvedValue([
          makeDiagnostic({
            id: badId,
            projectId: projectId,
            networkDeviceId: networkDeviceId,
            diagnosticType: NetworkDeviceDiagnosticType.Ping,
            hostname: hostname,
          }),
          makeDiagnostic({
            id: goodId,
            projectId: projectId,
            networkDeviceId: networkDeviceId,
            diagnosticType: NetworkDeviceDiagnosticType.Ping,
            hostname: "10.0.0.6",
          }),
        ] as never);

        const { next } = await callListEndpoint(makeRequest({ probeId }));

        expect(next).not.toHaveBeenCalled();

        const jobs: Array<NetworkDeviceDiagnosticJob> = respondedJobs();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.id).toBe(goodId.toString());

        const { probeId: reportedBy, report } = recordedReport();
        expect(reportedBy.toString()).toBe(probeId.toString());
        expect(report.networkDeviceDiagnosticId).toBe(badId.toString());
        expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
        expect(report.statusMessage).toContain(reasonFragment);
        expect(report.pingResult).toBeUndefined();
        expect(report.traceRouteResult).toBeUndefined();

        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
        expect(loggerMock.warn.mock.calls[0]![0] as string).toContain(
          badId.toString(),
        );
      },
    );

    test("with an unknown diagnostic type is marked Failed naming the type and the valid ones", async () => {
      const badId: ObjectID = ObjectID.generate();
      diagnosticService.claimPendingForProbe.mockResolvedValue([
        badId,
      ] as never);
      diagnosticService.findBy.mockResolvedValue([
        makeDiagnostic({
          id: badId,
          projectId: projectId,
          networkDeviceId: networkDeviceId,
          diagnosticType: "PortScan",
          hostname: "10.0.0.5",
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(respondedJobs()).toEqual([]);

      const { report } = recordedReport();
      expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
      expect(report.statusMessage).toContain("PortScan");
      expect(report.statusMessage).toContain("Ping");
      expect(report.statusMessage).toContain("Traceroute");
    });

    /*
     * Case-sensitive on purpose: the column holds the enum value exactly
     * and the probe branches on it, so "ping" is not a Ping.
     */
    test("a type that differs only in case is not a valid type", async () => {
      const badId: ObjectID = ObjectID.generate();
      diagnosticService.claimPendingForProbe.mockResolvedValue([
        badId,
      ] as never);
      diagnosticService.findBy.mockResolvedValue([
        makeDiagnostic({
          id: badId,
          projectId: projectId,
          networkDeviceId: networkDeviceId,
          diagnosticType: "ping",
          hostname: "10.0.0.5",
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(respondedJobs()).toEqual([]);
      expect(recordedReport().report.status).toBe(
        NetworkDeviceDiagnosticStatus.Failed,
      );
    });

    /*
     * The whole batch was claimed in one transaction. If marking one bad
     * row Failed threw out of the handler, every good row in the batch
     * would sit In Progress until retention — so the failure is logged and
     * the batch still goes out.
     */
    test("a failure to record the Failed status is logged and does not sink the batch", async () => {
      const badId: ObjectID = ObjectID.generate();
      const goodId: ObjectID = ObjectID.generate();
      diagnosticService.claimPendingForProbe.mockResolvedValue([
        badId,
        goodId,
      ] as never);
      diagnosticService.findBy.mockResolvedValue([
        makeDiagnostic({
          id: badId,
          projectId: projectId,
          networkDeviceId: networkDeviceId,
          diagnosticType: NetworkDeviceDiagnosticType.Ping,
        }),
        makeDiagnostic({
          id: goodId,
          projectId: projectId,
          networkDeviceId: networkDeviceId,
          diagnosticType: NetworkDeviceDiagnosticType.Traceroute,
          hostname: "10.0.0.6",
        }),
      ] as never);
      diagnosticService.recordReport.mockRejectedValue(
        new Error("db down") as never,
      );

      const { next } = await callListEndpoint(makeRequest({ probeId }));

      expect(next).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalled();

      const jobs: Array<NetworkDeviceDiagnosticJob> = respondedJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toBe(goodId.toString());
    });
  });

  test("passes claim failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    diagnosticService.claimPendingForProbe.mockRejectedValue(boom as never);

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).toHaveBeenCalledWith(boom);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("POST /probe/network-device-diagnostic/response/ingest", () => {
  const probeId: ObjectID = ObjectID.generate();
  const diagnosticId: ObjectID = ObjectID.generate();

  const pingResult: JSONObject = {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      isOnline: true,
      responseTimeInMs: 2,
      avgRttMs: 2.1,
      packetLossPercent: 0,
    },
  };

  const traceRouteResult: JSONObject = {
    timestamp: "2026-09-15T10:00:00.000Z",
    traceRoute: {
      destination: "10.0.0.5",
      hops: [{ hop: 1, host: "10.0.0.1", rttMs: 1.2 }],
      reachedDestination: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    diagnosticService.recordReport.mockResolvedValue(true as never);
  });

  test("rejects a request with no authenticated probe", async () => {
    await callIngestEndpoint(
      makeRequest({
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    expect(diagnosticService.recordReport).not.toHaveBeenCalled();
    expectBadDataResponse("Probe not found");
  });

  const idCases: Array<[string, unknown]> = [
    ["missing", undefined],
    ["blank", "   "],
    ["not a string", 42],
  ];

  test.each(idCases)(
    "rejects a %s networkDeviceDiagnosticId",
    async (_label: string, id: unknown) => {
      await callIngestEndpoint(
        makeRequest({
          probeId,
          body: {
            networkDeviceDiagnosticId: id as string,
            status: NetworkDeviceDiagnosticStatus.Completed,
            pingResult: pingResult,
          },
        }),
      );

      expect(diagnosticService.recordReport).not.toHaveBeenCalled();
      expectBadDataResponse("networkDeviceDiagnosticId");
    },
  );

  /*
   * The id is bound as a uuid parameter. A malformed one would come back
   * from the driver as a 500; the probe should be told what it sent.
   */
  test("rejects an id that is not a UUID before touching the service", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: "not-a-uuid",
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    expect(diagnosticService.recordReport).not.toHaveBeenCalled();
    expectBadDataResponse("not a valid id");
  });

  const statusCases: Array<[string, unknown]> = [
    ["missing", undefined],
    ["Pending", NetworkDeviceDiagnosticStatus.Pending],
    ["In Progress", NetworkDeviceDiagnosticStatus.InProgress],
    ["lower-case completed", "completed"],
    ["not a string", 42],
  ];

  test.each(statusCases)(
    "rejects a %s status",
    async (_label: string, status: unknown) => {
      await callIngestEndpoint(
        makeRequest({
          probeId,
          body: {
            networkDeviceDiagnosticId: diagnosticId.toString(),
            status: status as string,
            pingResult: pingResult,
          },
        }),
      );

      expect(diagnosticService.recordReport).not.toHaveBeenCalled();
      expectBadDataResponse("status must be");
    },
  );

  const resultShapeCases: Array<[string, string, unknown]> = [
    ["pingResult", "a string", "10ms"],
    ["pingResult", "an array", [1, 2]],
    ["pingResult", "a number", 7],
    ["traceRouteResult", "a string", "hop hop"],
    ["traceRouteResult", "an array", []],
    ["traceRouteResult", "a boolean", true],
  ];

  test.each(resultShapeCases)(
    "rejects a %s that is %s",
    async (field: string, _label: string, value: unknown) => {
      await callIngestEndpoint(
        makeRequest({
          probeId,
          body: {
            networkDeviceDiagnosticId: diagnosticId.toString(),
            status: NetworkDeviceDiagnosticStatus.Completed,
            [field]: value as string,
          },
        }),
      );

      expect(diagnosticService.recordReport).not.toHaveBeenCalled();
      expectBadDataResponse(field);
    },
  );

  test("rejects a statusMessage that is not a string", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Failed,
          statusMessage: { text: "nope" },
        },
      }),
    );

    expect(diagnosticService.recordReport).not.toHaveBeenCalled();
    expectBadDataResponse("statusMessage");
  });

  test("a Completed ping report is recorded for the authenticated probe and answered ok", async () => {
    const { next } = await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    expect(next).not.toHaveBeenCalled();

    const { probeId: reportedBy, report } = recordedReport();
    expect(reportedBy.toString()).toBe(probeId.toString());
    expect(report).toEqual({
      networkDeviceDiagnosticId: diagnosticId.toString(),
      status: NetworkDeviceDiagnosticStatus.Completed,
      statusMessage: undefined,
      pingResult: pingResult,
      traceRouteResult: undefined,
    });

    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  test("a Completed traceroute report carries the trace through untouched", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          traceRouteResult: traceRouteResult,
        },
      }),
    );

    const { report } = recordedReport();
    expect(report.traceRouteResult).toEqual(traceRouteResult);
    expect(report.pingResult).toBeUndefined();
  });

  test("a Failed report carries its message and no result", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Failed,
          statusMessage: "traceroute is not installed on this probe",
        },
      }),
    );

    const { report } = recordedReport();
    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(report.statusMessage).toBe(
      "traceroute is not installed on this probe",
    );
    expect(report.pingResult).toBeUndefined();
    expect(report.traceRouteResult).toBeUndefined();
  });

  /*
   * JSON has no undefined. A probe that serializes an empty result slot as
   * null means "no result", which is what the service stores for a missing
   * one — so null is accepted as absent, not refused as a non-object.
   */
  test("null results and a null statusMessage read as absent", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          statusMessage: null,
          pingResult: pingResult,
          traceRouteResult: null,
        },
      }),
    );

    const { report } = recordedReport();
    expect(report.statusMessage).toBeUndefined();
    expect(report.pingResult).toEqual(pingResult);
    expect(report.traceRouteResult).toBeUndefined();
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  });

  /*
   * The security property of this endpoint: the probe id is stamped from
   * the AUTHENTICATED request, never read from the body, so a probe can
   * only ever settle diagnostics that were handed to it.
   */
  test("a body-supplied probeId is ignored in favor of the authenticated probe", async () => {
    const spoofedProbeId: ObjectID = ObjectID.generate();

    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          probeId: spoofedProbeId.toString(),
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    const { probeId: reportedBy } = recordedReport();
    expect(reportedBy.toString()).toBe(probeId.toString());
    expect(reportedBy.toString()).not.toBe(spoofedProbeId.toString());
  });

  /*
   * The service returns false when no row matched: an unknown id, another
   * probe's row, or one already Completed. That is a 400 the probe can
   * see, not a silent 200 that would hide a misdirected report.
   */
  test("a report the service does not apply is answered with a 400, not ok", async () => {
    diagnosticService.recordReport.mockResolvedValue(false as never);

    const { next } = await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    expect(next).not.toHaveBeenCalled();
    expectBadDataResponse("Diagnostic not found for this probe");
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    diagnosticService.recordReport.mockRejectedValue(boom as never);

    const { next } = await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceDiagnosticId: diagnosticId.toString(),
          status: NetworkDeviceDiagnosticStatus.Completed,
          pingResult: pingResult,
        },
      }),
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * A router that is written but never mounted serves nobody. The Telemetry
 * feature set mounts probe-ingest routers inside init(), which this suite
 * cannot run (it boots gRPC and MQTT), so the mounting is pinned against
 * the source — the same technique the Dashboard wiring tests use.
 * Comments are stripped first so a prose mention cannot satisfy the check.
 */
describe("Telemetry feature-set wiring", () => {
  const TELEMETRY_INDEX: string = fs
    .readFileSync(
      path.join(__dirname, "..", "..", "FeatureSet", "Telemetry", "Index.ts"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

  test("imports the diagnostic router", () => {
    expect(TELEMETRY_INDEX).toContain(
      'import ProbeIngestNetworkDeviceDiagnosticAPI from "./API/ProbeIngest/NetworkDeviceDiagnostic";',
    );
  });

  test("mounts it under the probe-ingest prefixes", () => {
    expect(TELEMETRY_INDEX).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestNetworkDeviceDiagnosticAPI);",
    );
  });
});
