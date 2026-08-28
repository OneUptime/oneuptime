import fs from "fs";
import path from "path";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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

/*
 * Only the one method this route uses. Deliberately narrow: the route used to
 * page every device in the project itself with findBy, and leaving findBy on
 * this mock would let that walk quietly come back — the tests here would keep
 * passing while the request went back to eight full-table scans. With just
 * this method mocked, any other call on the service throws.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getRegisteredHostnames: jest.fn(),
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
const deviceService: { getRegisteredHostnames: jest.Mock } =
  NetworkDeviceService as unknown as { getRegisteredHostnames: jest.Mock };
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

  /*
   * The claim is a read-then-write: the SELECT above filters on
   * `probeId + status = "Pending"`, but the UPDATE addresses the row by id
   * alone. That gap was harmless while a scan's settings were fixed at
   * creation. Once they became editable (OneUptime issue #3444) a save landing
   * inside it would hand this probe one configuration and stamp the row with
   * another — and, if the probe was reassigned, wedge the scan for two hours:
   * the old probe's result is rejected on the probeId scope, and the new probe
   * can never claim a row that already says In Progress.
   *
   * So the claim carries its own precondition. Every setting handed to the
   * probe is asserted in the same statement, which makes a claim on stale
   * settings a no-op rather than a lie.
   */
  test("claims a scan only while the settings it was handed are still current", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.cidr = "192.168.1.0/24";
    scan.snmpVersion = "V2c";
    scan.snmpCommunityString = "public";
    scan.snmpPort = 161;

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    /*
     * Status and probe first: those are what a re-queue and a probe
     * reassignment change, and either one invalidates a claim outright.
     */
    expect(expected["status"]).toBe("Pending");
    expect((expected["probeId"] as ObjectID).toString()).toBe(
      probeId.toString(),
    );

    // ...then every setting that decides what the sweep actually does.
    expect(expected["cidr"]).toBe("192.168.1.0/24");
    expect(expected["snmpVersion"]).toBe("V2c");
    expect(expected["snmpCommunityString"]).toBe("public");
    expect(expected["snmpPort"]).toBe(161);

    /*
     * The v3 credentials are unset on this v2c scan and are expected as NULL
     * rather than omitted: `expectedData` renders each key as
     * `IS NOT DISTINCT FROM`, so an omitted key would let a credential
     * appear between the SELECT and the UPDATE without voiding the claim.
     */
    for (const column of [
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(Object.keys(expected)).toContain(column);
      expect(expected[column]).toBeNull();
    }

    /*
     * And NOT the name. A rename changes nothing about the sweep, and voiding
     * a claim over one would cost the probe a whole cycle for nothing.
     */
    expect(Object.keys(expected)).not.toContain("name");
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
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
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

    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

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
    const lookupArgs: JSONObject = deviceService.getRegisteredHostnames.mock
      .calls[0]![0] as JSONObject;
    expect((lookupArgs["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );

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
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
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
 * Which discovered hosts already have a device — the flag the review modal
 * uses to grey out "import", and therefore the thing standing between a
 * re-scan and a duplicated inventory.
 *
 * The endpoint used to work this out itself, by copying every hostname in the
 * project into a Set: first one findBy capped at 10,000 (so a larger fleet
 * silently reported its devices as NOT registered), then a paged walk ordered
 * by createdAt (so a bulk import's identically-stamped rows made the pages
 * overlap and skip, with the same result). It now ASKS — one narrow question
 * about the addresses this sweep actually found.
 *
 * That moved the interesting arithmetic — chunking, dedup, how many
 * statements — into NetworkDeviceService, where
 * Common/Tests/Server/Services/NetworkDeviceRegisteredHostnames.test.ts
 * covers it. What is left for the endpoint, and what this block covers, is
 * the contract between the two: ask about the right addresses in the right
 * project, and put the answer on the right hosts.
 */
describe("POST /probe/discovery-scan/result — flagging already-registered hosts", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeScan(
    status: string = "In Progress",
  ): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = status;
    return scan;
  }

  function resultRequest(discoveredDevices: Array<JSONObject>): ExpressRequest {
    return makeRequest({
      probeId,
      body: {
        scanId: scanId.toString(),
        success: true,
        discoveredDevices: discoveredDevices,
      },
    });
  }

  // The argument the endpoint handed the service.
  function lookupArgs(): JSONObject {
    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    return deviceService.getRegisteredHostnames.mock.calls[0]![0] as JSONObject;
  }

  function askedAbout(): Array<string> {
    return lookupArgs()["hostnames"] as Array<string>;
  }

  // The hosts as they were written to the scan row, flags and all.
  function storedDevices(): Array<JSONObject> {
    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    return data["discoveredDevices"] as Array<JSONObject>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    scanService.updateOneById.mockResolvedValue(undefined as never);
    scanService.findOneBy.mockResolvedValue(makeScan() as never);
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
  });

  /*
   * The load-bearing one. The question is about the sweep's addresses, so its
   * cost is bounded by the sweep — not by the fleet, which is what made the
   * old walk both slow and wrong.
   */
  test("asks about the addresses this sweep found, not about the whole project", async () => {
    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "10.0.0.6" }]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  test("asks within the scan's own project", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect((lookupArgs()["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
  });

  /*
   * The probe is authenticated as a probe, not as a project member, so the
   * lookup has no user permissions to ride on.
   */
  test("asks as root", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect((lookupArgs()["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  /*
   * One question for the whole sweep. The endpoint no longer loops: a large
   * sweep must not turn into a page-at-a-time walk inside the request the
   * probe is synchronously waiting on.
   */
  test("asks once, however many hosts the sweep found", async () => {
    const discovered: Array<JSONObject> = [];
    for (let index: number = 0; index < 300; index++) {
      discovered.push({
        ipAddress: `10.7.${Math.floor(index / 256)}.${index % 256}`,
      });
    }

    await callResultEndpoint(resultRequest(discovered));

    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    expect(askedAbout()).toHaveLength(300);
  });

  test("flags exactly the hosts the answer named", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "10.0.0.7"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5" },
        { ipAddress: "10.0.0.6" },
        { ipAddress: "10.0.0.7" },
      ]),
    );

    expect(
      storedDevices().map((device: JSONObject) => {
        return device["isAlreadyRegistered"];
      }),
    ).toEqual([true, false, true]);
  });

  /*
   * Every host carries the flag explicitly. A missing key reads as falsy in
   * the review modal by accident rather than by decision, and "accidentally
   * importable" is the failure mode that duplicates devices.
   */
  test("every host is flagged, never left undefined", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "10.0.0.6" }]),
    );

    for (const device of storedDevices()) {
      expect(Object.keys(device)).toContain("isAlreadyRegistered");
      expect(typeof device["isAlreadyRegistered"]).toBe("boolean");
    }
  });

  /*
   * A host the probe found but could not name. It is asked about as the empty
   * string — which the service drops — and must never come back flagged, or
   * the modal would refuse to import a host that has no device at all.
   */
  test("a host with no ipAddress is asked about as an empty string and is not flagged", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { sysName: "unnamed" }]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", ""]);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a host reported with a null ipAddress is handled the same way", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: null }]));

    expect(askedAbout()).toEqual([""]);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(false);
  });

  /*
   * A sweep can report the same address twice — two interfaces answering, or
   * a probe retry. Both entries describe the same device, so both must be
   * flagged; flagging only the first would offer the second for import.
   */
  test("a repeated address is flagged on every entry that carries it", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", sysName: "first" },
        { ipAddress: "10.0.0.5", sysName: "second" },
      ]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * Ping-only hosts are offered for import too (as ICMP-monitored devices),
   * so they need the same guard against being imported twice.
   */
  test("ping-only hosts are asked about alongside the SNMP responders", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.20"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", snmpReachable: true },
        { ipAddress: "10.0.0.20", snmpReachable: false },
      ]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", "10.0.0.20"]);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(true);
  });

  test("addresses are asked about in the order the probe reported them", async () => {
    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.9" },
        { ipAddress: "10.0.0.5" },
        { ipAddress: "10.0.0.7" },
      ]),
    );

    expect(askedAbout()).toEqual(["10.0.0.9", "10.0.0.5", "10.0.0.7"]);
  });

  test("a sweep that found nothing asks about nothing and stores nothing", async () => {
    await callResultEndpoint(resultRequest([]));

    expect(askedAbout()).toEqual([]);
    expect(storedDevices()).toEqual([]);
  });

  /*
   * The flags have to survive onto the array that is actually persisted — the
   * review modal reads them off the stored row, not off the request.
   */
  test("the flags land on the hosts written to the scan row", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", sysName: "known" },
        { ipAddress: "10.0.0.9", sysName: "new" },
      ]),
    );

    expect(storedDevices()).toEqual([
      { ipAddress: "10.0.0.5", sysName: "known", isAlreadyRegistered: true },
      { ipAddress: "10.0.0.9", sysName: "new", isAlreadyRegistered: false },
    ]);
  });

  test("the hosts are flagged before the row is written", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(
      deviceService.getRegisteredHostnames.mock.invocationCallOrder[0]!,
    ).toBeLessThan(scanService.updateOneById.mock.invocationCallOrder[0]!);
  });

  /*
   * A result for a run that was already superseded is discarded, and a
   * discarded result must not spend a query proving it.
   */
  test("a result for a superseded run never asks", async () => {
    scanService.findOneBy.mockResolvedValue(makeScan("Pending") as never);

    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * If the lookup fails, the honest answer is an error. Treating the failure
   * as "none of these are registered" would offer the whole sweep for import
   * and duplicate every device in it.
   */
  test("a failed lookup errors instead of storing every host as new", async () => {
    const boom: Error = new Error("db down");
    deviceService.getRegisteredHostnames.mockRejectedValue(boom as never);

    const { next } = await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }]),
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * The scale the endpoint has to survive: a sweep of ScanTargetUtil-sized
   * range. Still one question, and the answer still lands on the right hosts.
   */
  test("a 5,000-host sweep is one question, and the flags still land correctly", async () => {
    const discovered: Array<JSONObject> = [];
    for (let index: number = 0; index < 5000; index++) {
      discovered.push({
        ipAddress: `10.60.${Math.floor(index / 256)}.${index % 256}`,
      });
    }

    const registeredAddress: string = discovered[4999]!["ipAddress"] as string;
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>([registeredAddress]) as never,
    );

    await callResultEndpoint(resultRequest(discovered));

    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    expect(askedAbout()).toHaveLength(5000);

    const stored: Array<JSONObject> = storedDevices();
    expect(stored[4999]!["isAlreadyRegistered"]).toBe(true);
    expect(
      stored.filter((device: JSONObject) => {
        return device["isAlreadyRegistered"] === true;
      }),
    ).toHaveLength(1);
  });

  /*
   * Three things and no more. The paging arguments the endpoint used to build
   * itself — skip, limit, sort — are the service's business now, and passing
   * one from here would mean the walk had started growing back.
   */
  test("asks with exactly three things: the project, the addresses, and root", () => {
    return callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }])).then(
      (): void => {
        expect(Object.keys(lookupArgs()).sort()).toEqual([
          "hostnames",
          "projectId",
          "props",
        ]);
      },
    );
  });

  /*
   * The flag is the endpoint's answer, not the probe's claim. A probe that
   * sent isAlreadyRegistered itself — buggy, old, or hostile — could
   * otherwise hide a host from the review modal, or offer a host that already
   * has a device.
   */
  test("a flag the probe sent itself is overwritten, not trusted", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", isAlreadyRegistered: false },
        { ipAddress: "10.0.0.9", isAlreadyRegistered: true },
      ]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a numeric ipAddress is asked about as its string form", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["42"]) as never,
    );

    await callResultEndpoint(resultRequest([{ ipAddress: 42 }]));

    expect(askedAbout()).toEqual(["42"]);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * Exact string matching, and deliberately so — "10.0.0.5 " and "10.0.0.5"
   * are different hostnames in the column this is asked of, and pretending
   * otherwise here would flag a host against a device that does not exist.
   */
  test("matching is exact — a padded or differently-cased answer flags nothing", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>([" 10.0.0.5", "SWITCH-1"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "switch-1" }]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(false);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("an answer naming an address this sweep never reported changes nothing", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "192.168.1.1"]) as never,
    );

    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(storedDevices()).toHaveLength(1);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * The two things the endpoint does to the host list are independent: a host
   * that already has a device still answered SNMP, and still counts.
   */
  test("flagging a host does not take it out of respondedHostCount", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "10.0.0.6"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", snmpReachable: true },
        { ipAddress: "10.0.0.6", snmpReachable: true },
      ]),
    );

    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    expect(data["respondedHostCount"]).toBe(2);
  });

  // A failed sweep still reports the hosts it managed to find.
  test("a sweep the probe reports as failed still gets its hosts flagged", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "probe crashed mid-sweep",
          discoveredDevices: [{ ipAddress: "10.0.0.5" }],
        },
      }),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  test("the happy path never reaches the error handler", async () => {
    const { next } = await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }]),
    );

    expect(next).not.toHaveBeenCalled();
  });

  /*
   * Every way the request can be turned away before the scan is in hand. None
   * of them should spend a query on a result that is going to be refused.
   */
  test("a request refused before the scan is loaded never asks", async () => {
    await callResultEndpoint(makeRequest({ probeId, body: {} }));
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();

    await callResultEndpoint(
      makeRequest({ body: { scanId: scanId.toString() } }),
    );
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();

    scanService.findOneBy.mockResolvedValue(null as never);
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();
  });
});

/*
 * The failure this file was recovered from, guarded from the other side.
 *
 * PR #3441 moved the already-registered lookup into
 * NetworkDeviceService.getRegisteredHostnames. The mock factory at the top of
 * this file still offered only findBy, so every test here died with
 * "getRegisteredHostnames is not a function" and the App Test job went red on
 * master.
 *
 * TypeScript could not see it coming: a jest.mock factory is an untyped
 * object literal, and nothing checks it against the module it replaces. So
 * the route's own source is read here and every service method it calls is
 * required to exist on the stub. A method nobody stubbed now fails with a
 * sentence naming it, instead of thirty identical TypeErrors.
 */
describe("the service stubs in this file track the route they stand in for", () => {
  const ROUTE_SOURCE_PATH: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "API",
    "ProbeIngest",
    "DiscoveryScan.ts",
  );

  /*
   * Comments are stripped first: this file's own prose names these services
   * and their methods, and the route's does too. Only real call sites count.
   */
  const routeCode: string = fs
    .readFileSync(ROUTE_SOURCE_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  function methodsCalledOn(serviceName: string): Array<string> {
    const called: Set<string> = new Set<string>();
    const callSite: RegExp = new RegExp(
      `\\b${serviceName}\\.([A-Za-z0-9_]+)\\s*\\(`,
      "g",
    );

    let match: RegExpExecArray | null = callSite.exec(routeCode);

    while (match) {
      called.add(match[1]!);
      match = callSite.exec(routeCode);
    }

    return Array.from(called).sort();
  }

  function methodsMissingFrom(
    stub: unknown,
    serviceName: string,
  ): Array<string> {
    return methodsCalledOn(serviceName).filter((method: string): boolean => {
      return typeof (stub as JSONObject)[method] !== "function";
    });
  }

  /*
   * If the route ever moves, the scan below would find nothing and pass
   * vacuously. Pin what it is expected to see.
   */
  test("the route's source is found and its calls are visible", () => {
    expect(methodsCalledOn("NetworkDeviceService")).toEqual([
      "getRegisteredHostnames",
    ]);
    expect(methodsCalledOn("NetworkDeviceDiscoveryScanService")).toEqual(
      expect.arrayContaining([
        "findBy",
        "findOneBy",
        "updateColumnsByIdWithoutHooks",
        "updateOneById",
      ]),
    );
  });

  test("every NetworkDeviceService method the route calls is stubbed here", () => {
    expect(methodsMissingFrom(deviceService, "NetworkDeviceService")).toEqual(
      [],
    );
  });

  test("every NetworkDeviceDiscoveryScanService method the route calls is stubbed here", () => {
    expect(
      methodsMissingFrom(scanService, "NetworkDeviceDiscoveryScanService"),
    ).toEqual([]);
  });
});
