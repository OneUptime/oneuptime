import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
      sendEntityArrayResponse: jest.fn(),
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

jest.mock("Common/Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
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

/*
 * Importing the router module registers its routes on the mocked router so
 * each handler can be invoked directly. The probe-auth middleware is mocked
 * out; tests attach `req.probe` themselves, exactly what the middleware
 * does after validating probeId + probeKey.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

type MockedService = {
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  updateOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
};

const scanService: MockedService =
  NetworkDeviceDiscoveryScanService as unknown as MockedService;
const deviceService: { findBy: jest.Mock } =
  NetworkDeviceService as unknown as { findBy: jest.Mock };
const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendEntityArrayResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendEntityArrayResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

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

type CallListEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

const callListEndpoint: CallListEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/probe/discovery-scan/list")
    .handlerFunction(req, mockResponse, next);
  return { next };
};

type CallResultEndpointFunction = CallListEndpointFunction;

const callResultEndpoint: CallResultEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/probe/discovery-scan/result")
    .handlerFunction(req, mockResponse, next);
  return { next };
};

/*
 * Shared regression assertion: the update payload handed to the service MUST
 * be a plain object, never a model instance. A `new
 * NetworkDeviceDiscoveryScan()` payload carries the non-column base property
 * `isPermissionIf`, which made every update throw `TableColumnMetadata not
 * found for isPermissionIf column` — the bug that left every scan stuck in
 * "Pending" and lost every probe result.
 */
function expectPlainUpdateData(data: unknown): JSONObject {
  expect(data).not.toBeInstanceOf(DatabaseBaseModel);
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  expect(Object.keys(data as JSONObject)).not.toContain("isPermissionIf");
  return data as JSONObject;
}

describe("POST /probe/discovery-scan/list", () => {
  const probeId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The probe logs the scan it is sweeping, and since scans can be named
   * (issue #3391) that log line names it the way its operator did. The name is
   * of no use to the sweep itself — it has to be asked for here or it never
   * reaches the probe at all.
   */
  test("hands the scan's name to the probe alongside its target", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    expect(select["name"]).toBe(true);
    expect(select["cidr"]).toBe(true);
  });

  test("hands out the probe's pending scans and marks each In Progress with plain column data", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).not.toHaveBeenCalled();

    // Scans are claimed for the requesting probe only, oldest first, one at a time.
    expect(scanService.findBy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect((findArgs["query"] as JSONObject)["probeId"]?.toString()).toBe(
      probeId.toString(),
    );
    expect((findArgs["query"] as JSONObject)["status"]).toBe("Pending");
    expect(findArgs["limit"]).toBe(1);
    expect((findArgs["sort"] as JSONObject)["createdAt"]).toBe(
      SortOrder.Ascending,
    );
    expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);

    /*
     * The claim: status In Progress + startedAt, and nothing else — via the
     * hook-free single-statement write. The probe synchronously waits on
     * this route every minute, so the claim must not pay the full
     * updateOneById pipeline (permission pre-fetch + row re-fetch + save()
     * transaction).
     *
     * "and nothing else" is load-bearing, not cosmetic: the service's
     * onBeforeUpdate validates the scan target, and skipping hooks is only
     * safe while the claim payload stays disjoint from the `cidr` column
     * that hook checks. Adding `cidr` here fails this assertion.
     */
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    expect((updateArgs["id"] as ObjectID).toString()).toBe(scanId.toString());
    const data: JSONObject = expectPlainUpdateData(updateArgs["data"]);
    expect(Object.keys(data).sort()).toEqual([
      "startedAt",
      "status",
      "statusMessage",
    ]);
    expect(data["status"]).toBe("In Progress");
    expect(data["startedAt"]).toBeInstanceOf(Date);
    /*
     * Cleared, not left behind: the worker writes a "nobody has picked this
     * scan up" note onto a long-unclaimed Pending scan
     * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts), and a
     * probe claiming the scan is exactly the thing that note said was not
     * happening. Leaving it would have the row explain, for the whole sweep,
     * why it had not started.
     */
    expect(data["statusMessage"]).toBeNull();

    // The scans are returned to the probe.
    expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      [scan],
      1,
      NetworkDeviceDiscoveryScan,
    );
  });

  test("marks scans In Progress BEFORE responding, so a scan can never be handed out twice", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateOrder: number =
      scanService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0]!;
    const respondOrder: number =
      responseUtil.sendEntityArrayResponse.mock.invocationCallOrder[0]!;
    expect(updateOrder).toBeLessThan(respondOrder);
  });

  test("selects every SNMP credential column the probe needs to actually run the scan", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    for (const column of [
      "cidr",
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(select[column]).toBe(true);
    }
  });

  test("claims each scan the query returns, not just the first", async () => {
    const scans: Array<NetworkDeviceDiscoveryScan> = [
      new NetworkDeviceDiscoveryScan(ObjectID.generate()),
      new NetworkDeviceDiscoveryScan(ObjectID.generate()),
    ];
    scanService.findBy.mockResolvedValue(scans as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(2);
  });

  test("no pending scans: responds with an empty list and updates nothing", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      [],
      0,
      NetworkDeviceDiscoveryScan,
    );
  });

  test("rejects a request with no authenticated probe", async () => {
    await callListEndpoint(makeRequest({}));

    expect(scanService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    scanService.findBy.mockRejectedValue(boom as never);

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("POST /probe/discovery-scan/result", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeFoundScan(overrides?: {
    isRecurring?: boolean;
    rescanIntervalInMinutes?: number;
  }): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    if (overrides?.isRecurring !== undefined) {
      scan.isRecurring = overrides.isRecurring;
    }
    if (overrides?.rescanIntervalInMinutes !== undefined) {
      scan.rescanIntervalInMinutes = overrides.rescanIntervalInMinutes;
    }
    return scan;
  }

  function lastUpdateData(): JSONObject {
    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = scanService.updateOneById.mock
      .calls[0]![0] as JSONObject;
    expect((updateArgs["id"] as ObjectID).toString()).toBe(scanId.toString());
    return expectPlainUpdateData(updateArgs["data"]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  test("stores a successful sweep: Completed, devices, counts, completedAt", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    const { next } = await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: true,
          statusMessage: "Swept 254 hosts.",
          scannedHostCount: 254,
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1" },
            { ipAddress: "10.0.0.9", sysName: "sw2" },
          ],
        },
      }),
    );

    expect(next).not.toHaveBeenCalled();

    // The lookup is scoped to the authenticated probe, not just the scanId.
    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    expect(
      ((findOneArgs["query"] as JSONObject)["probeId"] as ObjectID).toString(),
    ).toBe(probeId.toString());
    expect(
      ((findOneArgs["query"] as JSONObject)["_id"] as ObjectID).toString(),
    ).toBe(scanId.toString());

    const data: JSONObject = lastUpdateData();
    expect(Object.keys(data).sort()).toEqual([
      /*
       * Cleared on every result: a NULL marker is how the auto-import worker
       * knows the results now on this row have not been processed yet
       * (Workers/Jobs/NetworkDeviceDiscovery/ProcessAutoImportRules.ts).
       */
      "autoImportProcessedAt",
      "completedAt",
      "discoveredDevices",
      "respondedHostCount",
      "scannedHostCount",
      "status",
      "statusMessage",
    ]);
    expect(data["autoImportProcessedAt"]).toBeNull();
    expect(data["status"]).toBe("Completed");
    expect(data["statusMessage"]).toBe("Swept 254 hosts.");
    expect(data["scannedHostCount"]).toBe(254);
    expect(data["respondedHostCount"]).toBe(2);
    expect(data["completedAt"]).toBeInstanceOf(Date);
    expect((data["discoveredDevices"] as Array<JSONObject>).length).toBe(2);

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  /*
   * respondedHostCount is documented on the column as "Number of hosts that
   * responded to SNMP during the sweep" and is rendered as "Responded Hosts:
   * N of M". The probe reports ping-only hosts in the same array (tagged
   * snmpReachable: false), so counting the whole array would overstate the
   * manageable devices and contradict the statusMessage on the same row.
   */
  test("respondedHostCount counts SNMP responders only, not ping-only hosts", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          scannedHostCount: 254,
          statusMessage:
            "Swept 254 hosts: 5 answered ICMP ping, 2 answered SNMP.",
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1", snmpReachable: true },
            { ipAddress: "10.0.0.9", sysName: "sw2", snmpReachable: true },
            { ipAddress: "10.0.0.20", snmpReachable: false },
            { ipAddress: "10.0.0.21", snmpReachable: false },
            { ipAddress: "10.0.0.22", snmpReachable: false },
          ],
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["respondedHostCount"]).toBe(2);
    // Every alive host is still stored for the review modal — only the count is filtered.
    expect((data["discoveredDevices"] as Array<JSONObject>).length).toBe(5);
  });

  test("a sweep that found only ping-only hosts reports zero SNMP responders", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.20", snmpReachable: false },
            { ipAddress: "10.0.0.21", snmpReachable: false },
          ],
        },
      }),
    );

    expect(lastUpdateData()["respondedHostCount"]).toBe(0);
  });

  /*
   * An older probe omits snmpReachable entirely, and only pushed SNMP
   * responders into the array, so a missing key must still count.
   */
  test("hosts from an older probe with no snmpReachable key still count as responders", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1" },
            { ipAddress: "10.0.0.9", sysName: "sw2" },
            { ipAddress: "10.0.0.11", sysName: "sw3" },
          ],
        },
      }),
    );

    expect(lastUpdateData()["respondedHostCount"]).toBe(3);
  });

  test("flags hosts that already exist as devices so the UI can't re-import them", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    const existing: NetworkDevice = new NetworkDevice();
    existing.hostname = "10.0.0.5";
    deviceService.findBy.mockResolvedValue([existing] as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "known" },
            { ipAddress: "10.0.0.9", sysName: "new" },
          ],
        },
      }),
    );

    // Existing devices are looked up within the scan's project.
    const deviceFindArgs: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect(
      (
        (deviceFindArgs["query"] as JSONObject)["projectId"] as ObjectID
      ).toString(),
    ).toBe(projectId.toString());

    const devices: Array<JSONObject> = lastUpdateData()[
      "discoveredDevices"
    ] as Array<JSONObject>;
    expect(devices[0]!["isAlreadyRegistered"]).toBe(true);
    expect(devices[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a reported failure is stored as Failed with the probe's reason", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "CIDR too large.",
          discoveredDevices: [],
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Failed");
    expect(data["statusMessage"]).toBe("CIDR too large.");
    expect(data["respondedHostCount"]).toBe(0);
  });

  test("success defaults to true when the probe omits it", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Completed");
    // No devices reported → stored as an empty result, not a crash.
    expect(data["discoveredDevices"]).toEqual([]);
    expect(data["respondedHostCount"]).toBe(0);
    // Optional fields that weren't sent must not appear as writes.
    expect(Object.keys(data)).not.toContain("statusMessage");
    expect(Object.keys(data)).not.toContain("scannedHostCount");
    expect(Object.keys(data)).not.toContain("nextScanAt");
  });

  test("a recurring scan schedules its next run after the configured interval", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      }) as never,
    );

    const before: number = Date.now();
    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );
    const after: number = Date.now();

    const nextScanAt: Date = lastUpdateData()["nextScanAt"] as Date;
    expect(nextScanAt).toBeInstanceOf(Date);
    const sixtyMinutes: number = 60 * 60 * 1000;
    expect(nextScanAt.getTime()).toBeGreaterThanOrEqual(
      before + sixtyMinutes - 1000,
    );
    expect(nextScanAt.getTime()).toBeLessThanOrEqual(
      after + sixtyMinutes + 1000,
    );
  });

  test("a recurring scan reschedules even when the sweep failed — one bad run must not end the recurrence", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      }) as never,
    );

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "probe crashed mid-sweep",
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Failed");
    expect(data["nextScanAt"]).toBeInstanceOf(Date);
  });

  test("intervals below the 15-minute floor are clamped and the clamp is surfaced to the user", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ isRecurring: true, rescanIntervalInMinutes: 5 }) as never,
    );

    const before: number = Date.now();
    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "Swept 254 hosts.",
          discoveredDevices: [],
        },
      }),
    );
    const after: number = Date.now();

    const data: JSONObject = lastUpdateData();
    const nextScanAt: Date = data["nextScanAt"] as Date;
    const fifteenMinutes: number = 15 * 60 * 1000;
    expect(nextScanAt.getTime()).toBeGreaterThanOrEqual(
      before + fifteenMinutes - 1000,
    );
    expect(nextScanAt.getTime()).toBeLessThanOrEqual(
      after + fifteenMinutes + 1000,
    );

    // The probe's own message is kept and the clamp note is appended.
    expect(data["statusMessage"]).toBe(
      "Swept 254 hosts. Rescan interval is below the 15-minute minimum; rescanning every 15 minutes instead.",
    );
  });

  /*
   * statusMessage is a varchar(500). Postgres rejects an over-long value
   * rather than truncating it, and that rejection would fail this write —
   * losing the sweep's results and leaving a finished scan In Progress until
   * the stale-scan reaper notices. Clip instead.
   */
  test("an over-long status message is clipped instead of failing the write", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "S".repeat(900),
          discoveredDevices: [],
        },
      }),
    );

    const message: string = lastUpdateData()["statusMessage"] as string;
    expect(message).toHaveLength(500);
    // Still the probe's message, just shorter.
    expect(message.startsWith("SSS")).toBe(true);
  });

  test("a message that fits is stored verbatim", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "Swept 254 hosts: 12 answered ICMP ping.",
          discoveredDevices: [],
        },
      }),
    );

    expect(lastUpdateData()["statusMessage"]).toBe(
      "Swept 254 hosts: 12 answered ICMP ping.",
    );
  });

  test("a one-time scan gets no nextScanAt", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );

    expect(Object.keys(lastUpdateData())).not.toContain("nextScanAt");
  });

  test("rejects a result with no scanId", async () => {
    await callResultEndpoint(makeRequest({ probeId, body: {} }));

    expect(scanService.findOneBy).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("rejects a result with no authenticated probe", async () => {
    await callResultEndpoint(
      makeRequest({ body: { scanId: scanId.toString() } }),
    );

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a result for a scan the probe does not own (scoped lookup finds nothing)", async () => {
    scanService.findOneBy.mockResolvedValue(null as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    scanService.findOneBy.mockRejectedValue(boom as never);

    const { next } = await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString() },
      }),
    );

    expect(next).toHaveBeenCalledWith(boom);
  });
});

/*
 * A sweep can outlive its own claim. The stale-In-Progress reaper marks a scan
 * Failed after two hours and, if it recurs, the requeue pass then flips it
 * back to Pending for a fresh run
 * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts). A probe that
 * finally reports the ABANDONED run lands on that row — and used to stamp it
 * Completed, retiring a run that had been queued and never happened and
 * replacing the new run's empty result set with findings from hours earlier.
 */
describe("POST /probe/discovery-scan/result — a result for a superseded run", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeScanWithStatus(status: string): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = status;
    return scan;
  }

  function resultRequest(): ExpressRequest {
    return makeRequest({
      probeId,
      body: {
        scanId: scanId.toString(),
        success: true,
        statusMessage: "Swept 254 hosts.",
        scannedHostCount: 254,
        discoveredDevices: [{ ipAddress: "10.0.0.5", sysName: "sw1" }],
      },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  test("a scan that is queued for a new run keeps its fresh state", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("Pending") as never,
    );

    const { next } = await callResultEndpoint(resultRequest());

    expect(next).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "discarded" },
    );
  });

  /*
   * Only Pending is refused. A late result for a scan the reaper GUESSED was
   * abandoned is still the truth about that same run, so the probe's actual
   * findings must replace the reaper's guess.
   */
  test("a scan the reaper marked Failed still accepts the real result", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("Failed") as never,
    );

    await callResultEndpoint(resultRequest());

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    expect(data["status"]).toBe("Completed");
  });

  test("an In Progress scan — the ordinary case — is written as before", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("In Progress") as never,
    );

    await callResultEndpoint(resultRequest());

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("the status column is actually selected, or the check above is vacuous", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("In Progress") as never,
    );

    await callResultEndpoint(resultRequest());

    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    expect((findOneArgs["select"] as JSONObject)["status"]).toBe(true);
  });
});

/*
 * The already-registered flag used to come from ONE findBy at LIMIT_MAX with
 * no paging and no sort. A project with more devices than that got an
 * arbitrary 10,000 of them, so every device past the cap was reported to the
 * dashboard as NOT registered and the reviewer's "import" re-created devices
 * that already existed.
 */
describe("POST /probe/discovery-scan/result — flagging already-registered hosts", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeFullPage(): Array<NetworkDevice> {
    const page: Array<NetworkDevice> = [];
    for (let index: number = 0; index < LIMIT_MAX; index++) {
      const device: NetworkDevice = new NetworkDevice();
      device.hostname = `10.99.${Math.floor(index / 256)}.${index % 256}`;
      page.push(device);
    }
    return page;
  }

  function deviceWithHostname(hostname: string): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = hostname;
    return device;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    scanService.updateOneById.mockResolvedValue(undefined as never);
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = "In Progress";
    scanService.findOneBy.mockResolvedValue(scan as never);
  });

  function discoveredResultRequest(): ExpressRequest {
    return makeRequest({
      probeId,
      body: {
        scanId: scanId.toString(),
        success: true,
        discoveredDevices: [
          { ipAddress: "10.0.0.5" },
          { ipAddress: "10.0.0.6" },
        ],
      },
    });
  }

  test("a single short page is fetched once and not paged again", async () => {
    deviceService.findBy.mockResolvedValue([
      deviceWithHostname("10.0.0.5"),
    ] as never);

    await callResultEndpoint(discoveredResultRequest());

    expect(deviceService.findBy).toHaveBeenCalledTimes(1);

    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    const devices: Array<JSONObject> = data[
      "discoveredDevices"
    ] as Array<JSONObject>;
    expect(devices[0]!["isAlreadyRegistered"]).toBe(true);
    expect(devices[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a full page is followed by another, so device 10,001 is still seen", async () => {
    deviceService.findBy
      .mockResolvedValueOnce(makeFullPage() as never)
      .mockResolvedValueOnce([deviceWithHostname("10.0.0.6")] as never);

    await callResultEndpoint(discoveredResultRequest());

    expect(deviceService.findBy).toHaveBeenCalledTimes(2);

    // The second call must actually move the cursor, or this loops forever.
    const firstCall: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;
    const secondCall: JSONObject = deviceService.findBy.mock
      .calls[1]![0] as JSONObject;
    expect(firstCall["skip"]).toBe(0);
    expect(secondCall["skip"]).toBe(LIMIT_MAX);

    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    const devices: Array<JSONObject> = data[
      "discoveredDevices"
    ] as Array<JSONObject>;
    // Only found on the SECOND page — the case the old cap silently dropped.
    expect(devices[1]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * Postgres makes no ordering promise without an ORDER BY, so an unsorted
   * paged read can return a row twice, or skip one entirely, between pages.
   */
  test("paging is stably ordered", async () => {
    deviceService.findBy.mockResolvedValue([] as never);

    await callResultEndpoint(discoveredResultRequest());

    const findArgs: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect((findArgs["sort"] as JSONObject)["createdAt"]).toBe(
      SortOrder.Ascending,
    );
  });
});
