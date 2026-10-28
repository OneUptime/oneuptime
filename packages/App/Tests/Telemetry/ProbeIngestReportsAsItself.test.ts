import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Probe from "Common/Models/DatabaseModels/Probe";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE } from "Common/Server/Utils/Probe/ProbeReportIdentity";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every probe ingest route knows which probe a request is from by the probe
 * the probe-auth middleware authenticated (req.probe) - never by an id in
 * the body.
 *
 *   - A check result, or a monitor test's result, is queued as the
 *     authenticated probe's. One that names another probe is refused with a
 *     400 before anything is answered or queued; one that names none is
 *     written down as the sender's.
 *   - The request body is never queued whole: it carries the probe's key.
 *   - A trap, a syslog batch, a flow batch, an offline report and the
 *     KEDA queue-size count are all the authenticated probe's, whatever the
 *     body's own probeId says.
 *
 * The middleware itself is mocked (ProbeAuthorizationMiddleware.test.ts and
 * ProbeIngestReportsAsItselfPostgres.test.ts run the real one); each request
 * here carries the req.probe it sets. In production the body's top-level
 * probeId IS the one the middleware authenticated; the tests below give it
 * another value only to show no route reads it.
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

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: jest.fn(),
      isDisabled: jest.fn(() => {
        return false;
      }),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: jest.fn(() => {
        return Promise.resolve();
      }),
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

jest.mock(
  "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService",
  () => {
    return {
      __esModule: true,
      default: {
        processSyslogMessages: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher", () => {
  return {
    __esModule: true,
    default: {
      getProbe: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/NetworkFlow/NetworkFlowIngest", () => {
  // The DNS names a probe sends are read as the route reads them (issue #5340).
  const actual: { default: { readAddressNames: unknown } } = jest.requireActual(
    "Common/Server/Utils/NetworkFlow/NetworkFlowIngest",
  ) as { default: { readAddressNames: unknown } };

  return {
    __esModule: true,
    default: {
      buildRows: jest.fn(),
      readAddressNames: actual.default.readAddressNames,
    },
  };
});

jest.mock("Common/Server/Services/NetworkFlowService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(),
    },
  };
});

/*
 * Importing the router modules registers their routes on the mocked router
 * so each handler can be invoked directly.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import "../../FeatureSet/Telemetry/API/ProbeIngest/Syslog";
import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkFlow";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import ProbeSyslogIngestService from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkFlowDeviceMatcher from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import NetworkFlowIngest from "Common/Server/Utils/NetworkFlow/NetworkFlowIngest";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const queueService: {
  addProbeIngestJob: AnyMock;
  addSnmpTrapIngestJob: AnyMock;
} = TelemetryQueueService as unknown as {
  addProbeIngestJob: AnyMock;
  addSnmpTrapIngestJob: AnyMock;
};

const responseUtil: {
  sendEmptySuccessResponse: AnyMock;
  sendErrorResponse: AnyMock;
  sendJsonObjectResponse: AnyMock;
} = Response as unknown as {
  sendEmptySuccessResponse: AnyMock;
  sendErrorResponse: AnyMock;
  sendJsonObjectResponse: AnyMock;
};

const loggerMock: { warn: AnyMock } = logger as unknown as { warn: AnyMock };

const probeService: { findOneBy: AnyMock } = ProbeService as unknown as {
  findOneBy: AnyMock;
};

const projectService: { getOwners: AnyMock } = ProjectService as unknown as {
  getOwners: AnyMock;
};

const monitorProbeService: { countBy: AnyMock } =
  MonitorProbeService as unknown as { countBy: AnyMock };

const syslogService: { processSyslogMessages: AnyMock } =
  ProbeSyslogIngestService as unknown as { processSyslogMessages: AnyMock };

const flowMatcher: { getProbe: AnyMock } =
  NetworkFlowDeviceMatcher as unknown as { getProbe: AnyMock };

const flowIngest: { buildRows: AnyMock } = NetworkFlowIngest as unknown as {
  buildRows: AnyMock;
};

const mockResponse: ExpressResponse = {} as ExpressResponse;

// The probe the middleware authenticated, and another probe.
const SENDER: ObjectID = new ObjectID("1f7e3c2a-9b4d-4e6f-8a0c-2d4b6f8a0c11");
const OTHER: ObjectID = new ObjectID("7a2c4e6f-8b1d-4c3e-9f5a-1b3d5f7a9c22");
const PROBE_KEY: string = "probe-key-that-must-not-be-queued";

function asJson(id: ObjectID): JSONObject {
  return JSON.parse(JSON.stringify(id)) as JSONObject;
}

function makeRequest(data: {
  body?: JSONObject | undefined;
  params?: Record<string, string> | undefined;
  probe?: ObjectID | null | undefined;
}): ExpressRequest {
  const request: Record<string, unknown> = {
    body: data.body || {},
    params: data.params || {},
  };

  // What ProbeAuthorization.isAuthorizedServiceMiddleware sets.
  if (data.probe !== null) {
    const probe: Probe = new Probe();
    probe.id = data.probe || SENDER;
    request["probe"] = probe;
  }

  return request as unknown as ExpressRequest;
}

// The body the probe sends: its credentials beside what it reports.
function probeBody(extra: JSONObject): JSONObject {
  return {
    probeId: SENDER.toString(),
    probeKey: PROBE_KEY,
    probeCapabilities: ["networkDevicePing", "snmpTables"],
    ...extra,
  };
}

// A check result as a probe puts it on the wire.
function checkResult(namedProbe?: unknown): JSONObject {
  const result: JSONObject = {
    _type: "ProbeMonitorResponse",
    monitorId: asJson(ObjectID.generate()),
    monitorStepId: asJson(ObjectID.generate()),
    isOnline: false,
    failureCause: "Connection refused",
    responseTimeInMs: 99999,
  };

  if (namedProbe !== undefined) {
    result["probeId"] = namedProbe as JSONObject;
  }

  return result;
}

async function callEndpoint(
  path: string,
  req: ExpressRequest,
): Promise<{ next: NextFunction }> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter.match("post", path).handlerFunction(req, mockResponse, next);
  return { next };
}

function expectRefused(message: string): void {
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
  const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as BadDataException).message).toBe(message);
}

function queuedJob(): JSONObject {
  expect(queueService.addProbeIngestJob).toHaveBeenCalledTimes(1);
  return queueService.addProbeIngestJob.mock.calls[0]![0] as JSONObject;
}

// The id a queued result names, as it will be read back from Redis.
function namedInQueuedResult(job: JSONObject): unknown {
  return (
    JSON.parse(JSON.stringify(job["probeMonitorResponse"])) as JSONObject
  )["probeId"];
}

const RESULT_ROUTES: Array<{
  name: string;
  path: string;
  params: Record<string, string>;
  jobType: string;
  answered: () => AnyMock;
}> = [
  {
    name: "a check result",
    path: "/probe/response/ingest",
    params: {},
    jobType: "probe-response",
    answered: () => {
      return responseUtil.sendJsonObjectResponse;
    },
  },
  {
    name: "a monitor test's result",
    path: "/probe/response/monitor-test-ingest/:testId",
    params: { testId: "5c1e3a7d-2f4b-4d6e-8a9c-0b2d4f6a8c33" },
    jobType: "monitor-test",
    answered: () => {
      return responseUtil.sendEmptySuccessResponse;
    },
  },
];

for (const route of RESULT_ROUTES) {
  describe(`POST ${route.path}: ${route.name} is the sender's own`, () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("is queued beside the probe that sent it, the result untouched", async () => {
      const result: JSONObject = checkResult(asJson(SENDER));
      const snapshot: string = JSON.stringify(result);

      const { next } = await callEndpoint(
        route.path,
        makeRequest({
          body: probeBody({ probeMonitorResponse: result }),
          params: route.params,
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
      expect(route.answered()).toHaveBeenCalledTimes(1);

      const job: JSONObject = queuedJob();

      expect(job["jobType"]).toBe(route.jobType);
      expect((job["probeId"] as ObjectID).toString()).toBe(SENDER.toString());
      expect(job["probeMonitorResponse"]).toBe(result);
      expect(JSON.stringify(job["probeMonitorResponse"])).toBe(snapshot);
    });

    test("never queues the request body, or the probe's key in it", async () => {
      await callEndpoint(
        route.path,
        makeRequest({
          body: probeBody({ probeMonitorResponse: checkResult(SENDER) }),
          params: route.params,
        }),
      );

      const job: JSONObject = queuedJob();
      const queued: string = JSON.stringify(job);

      expect(queued).not.toContain(PROBE_KEY);
      expect(queued).not.toContain("probeCapabilities");
      expect(Object.keys(job).sort()).toEqual(
        route.jobType === "monitor-test"
          ? ["jobType", "probeId", "probeMonitorResponse", "testId"]
          : ["jobType", "probeId", "probeMonitorResponse"],
      );
    });

    test("a result that names no probe is written down as the sender's", async () => {
      const result: JSONObject = checkResult();

      await callEndpoint(
        route.path,
        makeRequest({
          body: probeBody({ probeMonitorResponse: result }),
          params: route.params,
        }),
      );

      expect(namedInQueuedResult(queuedJob())).toEqual(asJson(SENDER));
    });

    test("the sender's id is accepted in any form and case, and queued lower-cased", async () => {
      for (const named of [
        SENDER.toString(),
        SENDER.toString().toUpperCase(),
        asJson(SENDER),
        { _type: "ObjectID", value: SENDER.toString().toUpperCase() },
      ]) {
        jest.clearAllMocks();

        await callEndpoint(
          route.path,
          makeRequest({
            body: probeBody({ probeMonitorResponse: checkResult(named) }),
            params: route.params,
          }),
        );

        expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
        expect(namedInQueuedResult(queuedJob())).toEqual(asJson(SENDER));
      }
    });

    test("a result that names another probe is refused: 400, nothing answered or queued", async () => {
      for (const named of [
        asJson(OTHER),
        OTHER.toString(),
        OTHER.toString().toUpperCase(),
        OTHER,
      ]) {
        jest.clearAllMocks();

        const { next } = await callEndpoint(
          route.path,
          makeRequest({
            body: probeBody({ probeMonitorResponse: checkResult(named) }),
            params: route.params,
          }),
        );

        expectRefused(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);
        expect(next).not.toHaveBeenCalled();
        expect(route.answered()).not.toHaveBeenCalled();
        expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
        // Said in the server's log too, naming the probe that tried.
        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
        expect(String(loggerMock.warn.mock.calls[0]![0])).toContain(
          SENDER.toString(),
        );
      }
    });

    test("a result whose probe cannot be read is refused like another probe's", async () => {
      for (const named of [
        42,
        [SENDER.toString()],
        { id: SENDER.toString() },
        { _type: "ObjectID" },
      ]) {
        jest.clearAllMocks();

        await callEndpoint(
          route.path,
          makeRequest({
            body: probeBody({ probeMonitorResponse: checkResult(named) }),
            params: route.params,
          }),
        );

        expectRefused(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);
        expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
      }
    });

    test("the body's own probeId is never read: the authenticated probe is", async () => {
      await callEndpoint(
        route.path,
        makeRequest({
          body: {
            ...probeBody({ probeMonitorResponse: checkResult() }),
            probeId: OTHER.toString(),
          },
          params: route.params,
        }),
      );

      const job: JSONObject = queuedJob();

      expect((job["probeId"] as ObjectID).toString()).toBe(SENDER.toString());
      expect(namedInQueuedResult(job)).toEqual(asJson(SENDER));
    });

    test("a request no probe authenticated is refused before anything is read", async () => {
      await callEndpoint(
        route.path,
        makeRequest({
          body: probeBody({ probeMonitorResponse: checkResult(SENDER) }),
          params: route.params,
          probe: null,
        }),
      );

      expectRefused("Probe not found");
      expect(route.answered()).not.toHaveBeenCalled();
      expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
    });

    test("a result that is not an object is no result", async () => {
      const notResults: Array<unknown> = ["a result", 42, [checkResult()]];

      for (const probeMonitorResponse of notResults) {
        jest.clearAllMocks();

        await callEndpoint(
          route.path,
          makeRequest({
            body: probeBody({
              probeMonitorResponse: probeMonitorResponse as JSONObject,
            }),
            params: route.params,
          }),
        );

        expectRefused("ProbeMonitorResponse not found");
        expect(queueService.addProbeIngestJob).not.toHaveBeenCalled();
      }
    });
  });
}

describe("POST /probe/snmp-trap: a trap is the receiving probe's", () => {
  const path: string = "/probe/snmp-trap";
  const snmpTrap: JSONObject = {
    sourceIpAddress: "10.0.0.7",
    trapOid: "1.3.6.1.6.3.1.1.5.3",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("is queued with the authenticated probe and the trap alone", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: { ...probeBody({ snmpTrap }), probeId: OTHER.toString() },
      }),
    );

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(queueService.addSnmpTrapIngestJob).toHaveBeenCalledTimes(1);

    const job: JSONObject = queueService.addSnmpTrapIngestJob.mock
      .calls[0]![0] as JSONObject;

    expect((job["probeId"] as ObjectID).toString()).toBe(SENDER.toString());
    expect(job["snmpTrap"]).toBe(snmpTrap);
    expect(JSON.stringify(job)).not.toContain(PROBE_KEY);
  });

  test("a request no probe authenticated is refused", async () => {
    await callEndpoint(
      path,
      makeRequest({ body: probeBody({ snmpTrap }), probe: null }),
    );

    expectRefused("Probe not found");
    expect(queueService.addSnmpTrapIngestJob).not.toHaveBeenCalled();
  });

  test("a request with no trap is still refused", async () => {
    await callEndpoint(path, makeRequest({ body: probeBody({}) }));

    expectRefused("snmpTrap not found in request body");
    expect(queueService.addSnmpTrapIngestJob).not.toHaveBeenCalled();
  });
});

describe("POST /probe/status-report/offline: the report is about the probe that sent it", () => {
  const path: string = "/probe/status-report/offline";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("the probe looked up, and its project's owners, are the sender's", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const probe: Probe = new Probe();
    probe.id = SENDER;
    probe.projectId = projectId;
    probe.name = "Office probe";

    probeService.findOneBy.mockResolvedValue(probe as never);
    projectService.getOwners.mockResolvedValue([] as never);

    await callEndpoint(
      path,
      makeRequest({
        body: {
          ...probeBody({
            statusReport: { isWebsiteCheckOffline: true, hostname: "office" },
          }),
          probeId: OTHER.toString(),
        },
      }),
    );

    expect(probeService.findOneBy).toHaveBeenCalledTimes(1);
    expect(
      (
        probeService.findOneBy.mock.calls[0]![0] as {
          query: { _id: string };
        }
      ).query._id,
    ).toBe(SENDER.toString());
    expect(projectService.getOwners).toHaveBeenCalledWith(projectId);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("a request no probe authenticated is refused", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: probeBody({ statusReport: { isWebsiteCheckOffline: true } }),
        probe: null,
      }),
    );

    expectRefused("Probe not found");
    expect(probeService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("POST /metrics/queue-size: the count is the sending probe's", () => {
  const path: string = "/metrics/queue-size";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("counts the authenticated probe's monitors, whatever the body says", async () => {
    monitorProbeService.countBy.mockResolvedValue({
      toNumber: () => {
        return 3;
      },
    } as never);

    await callEndpoint(
      path,
      makeRequest({ body: { ...probeBody({}), probeId: OTHER.toString() } }),
    );

    expect(monitorProbeService.countBy).toHaveBeenCalledTimes(1);
    expect(
      (
        monitorProbeService.countBy.mock.calls[0]![0] as {
          query: { probeId: ObjectID };
        }
      ).query.probeId.toString(),
    ).toBe(SENDER.toString());
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { queueSize: 3 },
    );
  });

  test("a request no probe authenticated is refused", async () => {
    await callEndpoint(path, makeRequest({ body: probeBody({}), probe: null }));

    expectRefused("Probe ID not found");
    expect(monitorProbeService.countBy).not.toHaveBeenCalled();
  });
});

describe("POST /probe/syslog: the messages are the receiving probe's", () => {
  const path: string = "/probe/syslog";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("are processed as the authenticated probe's, whatever the body says", async () => {
    syslogService.processSyslogMessages.mockResolvedValue(undefined as never);

    await callEndpoint(
      path,
      makeRequest({
        body: {
          ...probeBody({ syslogMessages: [{ message: "<13>link down" }] }),
          probeId: OTHER.toString(),
        },
      }),
    );

    expect(syslogService.processSyslogMessages).toHaveBeenCalledTimes(1);
    expect(
      (
        syslogService.processSyslogMessages.mock.calls[0]![0] as ObjectID
      ).toString(),
    ).toBe(SENDER.toString());
  });

  test("a request no probe authenticated is refused", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: probeBody({ syslogMessages: [{ message: "<13>link down" }] }),
        probe: null,
      }),
    );

    expectRefused("Probe ID not found on syslog request");
    expect(syslogService.processSyslogMessages).not.toHaveBeenCalled();
  });
});

describe("POST /probe/network-flow: the flows are the receiving probe's", () => {
  const path: string = "/probe/network-flow";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("are matched as the authenticated probe's, whatever the body says", async () => {
    // No such probe here: the batch is dropped after the lookup.
    flowMatcher.getProbe.mockResolvedValue(null as never);

    await callEndpoint(
      path,
      makeRequest({
        body: {
          ...probeBody({ flowRecords: [{ srcAddr: "10.0.0.1" }] }),
          probeId: OTHER.toString(),
        },
      }),
    );

    expect(flowMatcher.getProbe).toHaveBeenCalledTimes(1);
    expect(
      (flowMatcher.getProbe.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(SENDER.toString());
  });

  test("a request no probe authenticated is refused", async () => {
    await callEndpoint(
      path,
      makeRequest({
        body: probeBody({ flowRecords: [{ srcAddr: "10.0.0.1" }] }),
        probe: null,
      }),
    );

    expectRefused("Probe ID not found on network flow request");
    expect(flowMatcher.getProbe).not.toHaveBeenCalled();
  });

  test("the DNS names the probe sent go with the flows, checked; a name that is not one is dropped, never the batch", async () => {
    flowMatcher.getProbe.mockResolvedValue({
      id: SENDER,
      projectId: null,
    } as never);
    flowIngest.buildRows.mockResolvedValue({
      rows: [],
      droppedUnmatched: 0,
      malformed: 0,
      unmatchedKept: 0,
    } as never);

    await callEndpoint(
      path,
      makeRequest({
        body: probeBody({
          flowRecords: [{ srcAddr: "10.0.0.1" }],
          addressNames: {
            "10.0.0.5": "fs01.corp.example",
            "2001:DB8::5": "v6.corp.example",
            "not-an-address": "x.corp.example",
            "10.0.0.6": "<b>markup</b>",
          },
        }),
      }),
    );

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(flowIngest.buildRows).toHaveBeenCalledTimes(1);
    const built: { addressNames: Map<string, string> } = flowIngest.buildRows
      .mock.calls[0]![0] as never;
    expect(Array.from(built.addressNames.entries())).toEqual([
      ["10.0.0.5", "fs01.corp.example"],
      ["2001:db8::5", "v6.corp.example"],
    ]);
  });

  test("a probe older than the lookups sends no names: the flows are taken as before", async () => {
    flowMatcher.getProbe.mockResolvedValue({
      id: SENDER,
      projectId: null,
    } as never);
    flowIngest.buildRows.mockResolvedValue({
      rows: [],
      droppedUnmatched: 0,
      malformed: 0,
      unmatchedKept: 0,
    } as never);

    await callEndpoint(
      path,
      makeRequest({
        body: probeBody({ flowRecords: [{ srcAddr: "10.0.0.1" }] }),
      }),
    );

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    const built: { addressNames: Map<string, string> } = flowIngest.buildRows
      .mock.calls[0]![0] as never;
    expect(built.addressNames.size).toBe(0);
  });
});
