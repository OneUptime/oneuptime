import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiagnosticService from "Common/Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import { JSONObject } from "Common/Types/JSON";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import {
  SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_REPETITIONS,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_PAUSE_BETWEEN_REQUESTS_IN_MS,
  SNMP_WALK_PROBE_UPGRADE_MESSAGE,
  SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
  SNMP_WALK_TIME_BUDGET_IN_MS,
  SnmpWalkFailureKind,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
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

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
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

import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDeviceDiagnostic";

/*
 * The server's half of an SNMP walk (issue #5184) at the probe-ingest
 * endpoints:
 *
 *   - a claimed walk is handed out with the device's credentials, resolved
 *     the way a poll of the device resolves them, and the walk's bounds -
 *     and only to a probe that declares it can walk ("snmpWalk"). An older
 *     probe never sees the credentials: its walks are settled at once with
 *     a sentence saying to update it;
 *   - a walk that cannot run any more - its device lost its credentials,
 *     the credential profile could not be read, the device is gone - is
 *     settled with the reason, and the rest of the batch still goes out;
 *   - the walk result a probe posts is checked and trimmed before it is
 *     stored.
 */

const diagnosticService: {
  claimPendingForProbe: jest.Mock;
  findBy: jest.Mock;
  recordReport: jest.Mock;
} = NetworkDeviceDiagnosticService as unknown as {
  claimPendingForProbe: jest.Mock;
  findBy: jest.Mock;
  recordReport: jest.Mock;
};

const deviceService: { findBy: jest.Mock } =
  NetworkDeviceService as unknown as { findBy: jest.Mock };

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const LIST_URI: string = "/probe/network-device-diagnostic/list";
const INGEST_URI: string = "/probe/network-device-diagnostic/response/ingest";

const PROBE_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000001",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000002",
);
const WALK_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000001");
const PING_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000002");
const SECOND_WALK_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000003",
);

const WALKING_PROBE: Array<string> = [
  "networkDevicePing",
  "snmpTables",
  "snmpWalk",
];

const mockResponse: ExpressResponse = {} as ExpressResponse;

function makeRequest(body: JSONObject): ExpressRequest {
  return {
    body: body,
    probe: new Probe(PROBE_ID),
  } as unknown as ExpressRequest;
}

async function call(uri: string, req: ExpressRequest): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter.match("post", uri).handlerFunction(req, mockResponse, next);
  return next;
}

function walkRow(data: {
  id?: ObjectID;
  deviceId?: ObjectID;
  rootOid?: string;
  afterOid?: string;
}): NetworkDeviceDiagnostic {
  const row: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic(
    data.id || WALK_ID,
  );
  row.projectId = PROJECT_ID;
  row.networkDeviceId = data.deviceId || DEVICE_ID;
  row.diagnosticType = NetworkDeviceDiagnosticType.SnmpWalk;
  row.hostname = "10.0.0.5";
  row.snmpWalkRootOid = data.rootOid || "1.3.6.1.2.1.2";

  if (data.afterOid) {
    row.snmpWalkAfterOid = data.afterOid;
  }

  return row;
}

function pingRow(): NetworkDeviceDiagnostic {
  const row: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic(PING_ID);
  row.projectId = PROJECT_ID;
  row.networkDeviceId = DEVICE_ID;
  row.diagnosticType = NetworkDeviceDiagnosticType.Ping;
  row.hostname = "10.0.0.5";
  return row;
}

/*
 * Columns to set on a test device; undefined clears one (an SNMPv3 device
 * has no community string).
 */
type DeviceOverrides = {
  [Column in keyof NetworkDevice]?: NetworkDevice[Column] | undefined;
};

function device(overrides: DeviceOverrides = {}): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice(DEVICE_ID);
  item.projectId = PROJECT_ID;
  item.hostname = "10.0.0.5";
  item.snmpVersion = "V2c";
  item.snmpCommunityString = "s3cret";
  item.snmpPort = 1161;
  Object.assign(item, overrides);
  return item;
}

function claim(rows: Array<NetworkDeviceDiagnostic>): void {
  diagnosticService.claimPendingForProbe.mockResolvedValue(
    rows.map((row: NetworkDeviceDiagnostic) => {
      return row.id!;
    }) as never,
  );
  diagnosticService.findBy.mockResolvedValue(rows as never);
}

function respondedJobs(): Array<NetworkDeviceDiagnosticJob> {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const payload: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return payload["diagnostics"] as unknown as Array<NetworkDeviceDiagnosticJob>;
}

function settledReports(): Array<NetworkDeviceDiagnosticReport> {
  return diagnosticService.recordReport.mock.calls.map(
    (args: Array<unknown>) => {
      return (args[0] as { report: NetworkDeviceDiagnosticReport }).report;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  diagnosticService.claimPendingForProbe.mockResolvedValue([] as never);
  diagnosticService.findBy.mockResolvedValue([] as never);
  diagnosticService.recordReport.mockResolvedValue(true as never);
  deviceService.findBy.mockResolvedValue([device()] as never);
});

describe("handing out a walk", () => {
  test("a walking probe gets the walk with the device's credentials and the walk's bounds", async () => {
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([
      {
        id: WALK_ID.toString(),
        projectId: PROJECT_ID.toString(),
        networkDeviceId: DEVICE_ID.toString(),
        diagnosticType: NetworkDeviceDiagnosticType.SnmpWalk,
        hostname: "10.0.0.5",
        timeoutInMs: SNMP_WALK_TIME_BUDGET_IN_MS,
        snmpMonitor: expect.objectContaining({
          snmpVersion: SnmpVersion.V2c,
          hostname: "10.0.0.5",
          port: 1161,
          communityString: "s3cret",
          oids: [],
          monitorInterfaces: false,
          timeout: SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
        }),
        snmpWalk: {
          rootOid: "1.3.6.1.2.1.2",
          maxOids: SNMP_WALK_MAX_OIDS,
          timeBudgetInMs: SNMP_WALK_TIME_BUDGET_IN_MS,
          requestTimeoutInMs: SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
          maxRepetitions: SNMP_WALK_MAX_REPETITIONS,
          pauseBetweenRequestsInMs: SNMP_WALK_PAUSE_BETWEEN_REQUESTS_IN_MS,
        },
      },
    ]);
    expect(diagnosticService.recordReport).not.toHaveBeenCalled();
  });

  test("the claimed rows are read with where each walk starts", async () => {
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    const select: JSONObject = (
      diagnosticService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;
    expect(select["snmpWalkRootOid"]).toBe(true);
    expect(select["snmpWalkAfterOid"]).toBe(true);
  });

  test("the devices are read as root, once for the batch, with the credential columns a poll uses", async () => {
    claim([
      walkRow({}),
      walkRow({ id: SECOND_WALK_ID, rootOid: "1.3.6.1.2.1.1" }),
    ]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(deviceService.findBy).toHaveBeenCalledTimes(1);
    const args: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect(args["select"]).toEqual(NetworkDeviceHydrationUtil.snmpConfigSelect);
    expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    expect(respondedJobs()).toHaveLength(2);
  });

  test("a continued walk carries the OID it continues after", async () => {
    claim([walkRow({ afterOid: "1.3.6.1.2.1.2.2.1.10.12" })]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()[0]!.snmpWalk).toMatchObject({
      rootOid: "1.3.6.1.2.1.2",
      afterOid: "1.3.6.1.2.1.2.2.1.10.12",
    });
  });

  test("an SNMPv3 device's walk carries its v3 user, not a community", async () => {
    deviceService.findBy.mockResolvedValue([
      device({
        snmpVersion: "V3",
        snmpCommunityString: undefined,
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "AuthPriv",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-key",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-key",
      }),
    ] as never);
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    const job: NetworkDeviceDiagnosticJob = respondedJobs()[0]!;
    expect(job.snmpMonitor?.snmpVersion).toBe(SnmpVersion.V3);
    expect(job.snmpMonitor?.snmpV3Auth?.username).toBe("monitoring");
    expect(job.snmpMonitor?.communityString).toBeUndefined();
  });

  test("a walk keeps its place in the batch, oldest first, among pings", async () => {
    claim([pingRow(), walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    const jobs: Array<NetworkDeviceDiagnosticJob> = respondedJobs();
    expect(
      jobs.map((job: NetworkDeviceDiagnosticJob) => {
        return job.diagnosticType;
      }),
    ).toEqual([
      NetworkDeviceDiagnosticType.Ping,
      NetworkDeviceDiagnosticType.SnmpWalk,
    ]);
    // A ping is handed out exactly as before: no credentials ride along.
    expect(jobs[0]).not.toHaveProperty("snmpMonitor");
    expect(jobs[0]!.timeoutInMs).toBe(
      NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
    );
  });

  test("a batch with no walk never reads a device", async () => {
    claim([pingRow()]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(deviceService.findBy).not.toHaveBeenCalled();
  });
});

describe("the capability gate", () => {
  test.each([
    ["no capabilities at all", undefined],
    ["the ones before walking", ["networkDevicePing", "snmpTables"]],
    ["something that is not a list", "snmpWalk"],
  ])(
    "a probe declaring %s gets no walk, and no credentials: the walk is settled saying to update it",
    async (_label: string, capabilities: unknown) => {
      claim([walkRow({}), pingRow()]);

      await call(
        LIST_URI,
        makeRequest(
          capabilities === undefined
            ? {}
            : { probeCapabilities: capabilities as Array<string> },
        ),
      );

      const jobs: Array<NetworkDeviceDiagnosticJob> = respondedJobs();
      expect(
        jobs.map((job: NetworkDeviceDiagnosticJob) => {
          return job.diagnosticType;
        }),
      ).toEqual([NetworkDeviceDiagnosticType.Ping]);
      expect(deviceService.findBy).not.toHaveBeenCalled();
      expect(JSON.stringify(jobs)).not.toContain("s3cret");

      expect(settledReports()).toEqual([
        {
          networkDeviceDiagnosticId: WALK_ID.toString(),
          status: NetworkDeviceDiagnosticStatus.Failed,
          statusMessage: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
        },
      ]);
    },
  );
});

describe("a walk that cannot run any more", () => {
  test("a device that has lost its credentials since the walk was asked for", async () => {
    deviceService.findBy.mockResolvedValue([
      device({ snmpCommunityString: "" }),
    ] as never);
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([]);
    expect(settledReports()[0]!.statusMessage).toBe(
      SNMP_WALK_NO_CREDENTIALS_MESSAGE,
    );
  });

  test("a credential profile that could not be read this time", async () => {
    jest
      .spyOn(NetworkDeviceHydrationUtil, "resolveSnmpCredentials")
      .mockResolvedValue({
        byDeviceId: new Map(),
        unresolvedDeviceIds: new Set([DEVICE_ID.toString()]),
      });
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([]);
    expect(settledReports()[0]!.statusMessage).toBe(
      SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
    );
  });

  test("a device that no longer exists", async () => {
    deviceService.findBy.mockResolvedValue([] as never);
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([]);
    expect(settledReports()[0]!.status).toBe(
      NetworkDeviceDiagnosticStatus.Failed,
    );
  });

  /*
   * The devices are read as root, so the device's project is checked
   * against the row's: another project's credentials must never be put
   * on this probe's wire.
   */
  test("a device of another project never lends it its credentials", async () => {
    deviceService.findBy.mockResolvedValue([
      device({ projectId: OTHER_PROJECT_ID }),
    ] as never);
    claim([walkRow({})]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([]);
    expect(settledReports()).toHaveLength(1);
  });

  test("a stored start that is not an OID", async () => {
    claim([walkRow({ rootOid: "IF-MIB::ifTable" })]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(respondedJobs()).toEqual([]);
    expect(settledReports()[0]!.statusMessage).toContain("numeric OID");
  });

  test("a device read that fails settles the walks and still hands out the rest of the batch", async () => {
    deviceService.findBy.mockRejectedValue(new Error("database is down"));
    claim([pingRow(), walkRow({})]);

    const next: NextFunction = await call(
      LIST_URI,
      makeRequest({ probeCapabilities: WALKING_PROBE }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(
      respondedJobs().map((job: NetworkDeviceDiagnosticJob) => {
        return job.diagnosticType;
      }),
    ).toEqual([NetworkDeviceDiagnosticType.Ping]);
    expect(settledReports()[0]!.statusMessage).toBe(
      SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
    );
  });

  test("only the walk that cannot run is settled; the other device's walk goes out", async () => {
    deviceService.findBy.mockResolvedValue([
      device(),
      Object.assign(device({ snmpCommunityString: "" }), {
        _id: OTHER_DEVICE_ID.toString(),
      }),
    ] as never);
    claim([
      walkRow({}),
      walkRow({ id: SECOND_WALK_ID, deviceId: OTHER_DEVICE_ID }),
    ]);

    await call(LIST_URI, makeRequest({ probeCapabilities: WALKING_PROBE }));

    expect(
      respondedJobs().map((job: NetworkDeviceDiagnosticJob) => {
        return job.id;
      }),
    ).toEqual([WALK_ID.toString()]);
    expect(settledReports()).toEqual([
      {
        networkDeviceDiagnosticId: SECOND_WALK_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: SNMP_WALK_NO_CREDENTIALS_MESSAGE,
      },
    ]);
  });
});

describe("receiving a walk's result", () => {
  function ingestBody(snmpWalkResult: unknown): JSONObject {
    return {
      networkDeviceDiagnosticId: WALK_ID.toString(),
      status: NetworkDeviceDiagnosticStatus.Completed,
      snmpWalkResult: snmpWalkResult as JSONObject,
    };
  }

  test("stores what the probe read", async () => {
    await call(
      INGEST_URI,
      makeRequest(
        ingestBody({
          rootOid: "1.3.6.1.2.1.1",
          rows: [
            {
              oid: "1.3.6.1.2.1.1.5.0",
              type: SnmpDataType.OctetString,
              value: "edge-sw-01",
            },
          ],
          stopReason: SnmpWalkStopReason.Complete,
          snmpVersion: SnmpVersion.V2c,
          requestCount: 2,
          durationInMs: 12,
        }),
      ),
    );

    const recorded: {
      probeId: ObjectID;
      report: NetworkDeviceDiagnosticReport;
    } = diagnosticService.recordReport.mock.calls[0]![0] as {
      probeId: ObjectID;
      report: NetworkDeviceDiagnosticReport;
    };

    expect(recorded.probeId.toString()).toBe(PROBE_ID.toString());
    expect(recorded.report.snmpWalkResult).toEqual({
      rootOid: "1.3.6.1.2.1.1",
      rows: [
        {
          oid: "1.3.6.1.2.1.1.5.0",
          type: SnmpDataType.OctetString,
          value: "edge-sw-01",
        },
      ],
      stopReason: SnmpWalkStopReason.Complete,
      snmpVersion: SnmpVersion.V2c,
      requestCount: 2,
      durationInMs: 12,
    });
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  test("checks and trims what it stores", async () => {
    await call(
      INGEST_URI,
      makeRequest(
        ingestBody({
          rootOid: "1.3.6.1",
          rows: [
            { oid: "not an oid", type: "Integer", value: 1 },
            {
              oid: "1.3.6.1.2.1.1.1.0",
              type: "SomethingNew",
              value: `a${String.fromCharCode(0)}b`,
            },
          ],
          stopReason: "gave up",
          failure: { kind: "solar flare", message: "?" },
          requestCount: -3,
          durationInMs: "slow",
        }),
      ),
    );

    const report: NetworkDeviceDiagnosticReport = (
      diagnosticService.recordReport.mock.calls[0]![0] as {
        report: NetworkDeviceDiagnosticReport;
      }
    ).report;

    expect(report.snmpWalkResult).toEqual({
      rootOid: "1.3.6.1",
      rows: [
        {
          oid: "1.3.6.1.2.1.1.1.0",
          type: SnmpDataType.Unknown,
          value: "61 00 62",
          isHex: true,
        },
      ],
      stopReason: SnmpWalkStopReason.Failed,
      failure: { kind: SnmpWalkFailureKind.Unknown, message: "?" },
      requestCount: 0,
      durationInMs: 0,
    });
  });

  test.each([
    ["a list", []],
    ["a string", "rows"],
    ["a number", 3],
  ])(
    "refuses a walk result that is %s",
    async (_label: string, value: unknown) => {
      await call(INGEST_URI, makeRequest(ingestBody(value)));

      expect(diagnosticService.recordReport).not.toHaveBeenCalled();
      const error: BadDataException = responseUtil.sendErrorResponse.mock
        .calls[0]![2] as BadDataException;
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("snmpWalkResult must be an object");
    },
  );

  test("a report with no walk result stores none", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        networkDeviceDiagnosticId: WALK_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: "no credentials",
        snmpWalkResult: null,
      }),
    );

    const report: NetworkDeviceDiagnosticReport = (
      diagnosticService.recordReport.mock.calls[0]![0] as {
        report: NetworkDeviceDiagnosticReport;
      }
    ).report;
    expect(report.snmpWalkResult).toBeUndefined();
    expect(report.statusMessage).toBe("no credentials");
  });
});
