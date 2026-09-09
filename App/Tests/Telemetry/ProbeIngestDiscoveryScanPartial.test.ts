import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DISCOVERY_SCAN_STARTED_MESSAGE } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
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

// Importing the router module registers its routes on the mocked router.
import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

/*
 * The server's half of incremental discovery results (OneUptime issues #3598
 * and #3599).
 *
 * A discovery sweep used to report exactly once, at the end. On the reported
 * 15,360-address scan that meant the Discovery page said "0 of 15360" for as
 * long as the sweep ran, a sweep abandoned at the probe's deadline reported
 * nothing at all having already confirmed hundreds of devices, and the
 * auto-import worker — which reads a scan's stored results — had nothing to
 * read until the very end.
 *
 * A probe now posts a cumulative PARTIAL result every 30 seconds. The two
 * things that makes safe are pinned here:
 *
 *   - a partial writes RESULTS and nothing else. The run state (status,
 *     completedAt, the recurrence schedule) belongs to the run and is written
 *     once, by the final result; a partial that touched any of it would end
 *     the run early.
 *   - a partial is refused for a scan that is not In Progress, so a straggler
 *     can never replace a finished run's results with the snapshot that
 *     preceded them.
 */

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

const mockResponse: ExpressResponse = {} as ExpressResponse;
const probeId: ObjectID = ObjectID.generate();
const scanId: ObjectID = ObjectID.generate();

function makeRequest(body: JSONObject): ExpressRequest {
  const req: JSONObject = { body: body };
  req["probe"] = new Probe(probeId);
  return req as unknown as ExpressRequest;
}

async function callResultEndpoint(
  body: JSONObject,
): Promise<{ next: NextFunction }> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/probe/discovery-scan/result")
    .handlerFunction(makeRequest(body), mockResponse, next);
  return { next };
}

function makeFoundScan(overrides: JSONObject = {}): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
    scanId,
  );
  scan.projectId = ObjectID.generate();
  scan.status = "In Progress";
  scan.isSnmpEnabled = true;
  scan.isRecurring = false;

  for (const key of Object.keys(overrides)) {
    (scan as unknown as JSONObject)[key] = overrides[key];
  }

  return scan;
}

// The partial write goes through the hook-free single-statement path.
function partialWrite(): { data: JSONObject; expectedData: JSONObject } {
  const call: JSONObject = scanService.updateColumnsByIdWithoutHooks.mock
    .calls[0]![0] as JSONObject;

  return {
    data: call["data"] as JSONObject,
    expectedData: call["expectedData"] as JSONObject,
  };
}

const PARTIAL_HOSTS: Array<JSONObject> = [
  { ipAddress: "10.240.249.5", sysName: "sw-core-1", snmpReachable: true },
  { ipAddress: "10.240.249.6", sysName: "sw-core-2", snmpReachable: true },
  { ipAddress: "10.240.249.9", snmpReachable: false },
];

function partialBody(overrides: JSONObject = {}): JSONObject {
  return {
    scanId: scanId.toString(),
    isPartial: true,
    success: true,
    statusMessage:
      "Scan in progress: 1,024 of 15,360 addresses swept so far, 3 answered ICMP ping, 2 answered SNMP. These results update as the sweep continues.",
    discoveredDevices: PARTIAL_HOSTS,
    scannedHostCount: 1024,
    ...overrides,
  };
}

describe("POST /probe/discovery-scan/result — a partial result", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  test("stores the hosts found so far and the addresses swept so far", async () => {
    const { next } = await callResultEndpoint(partialBody());

    expect(next).not.toHaveBeenCalled();

    const { data } = partialWrite();

    expect(data["discoveredDevices"]).toHaveLength(3);
    expect(data["scannedHostCount"]).toBe(1024);
    expect(String(data["statusMessage"])).toContain("Scan in progress");
  });

  /*
   * The run state belongs to the RUN, and is written once by the final
   * result. A partial that stamped any of it would end the run early: a
   * status of Completed retires it, a completedAt makes the freshness horizon
   * start ticking, and a nextScanAt schedules the next run of a scan that has
   * not finished this one.
   */
  test("never touches the run state", async () => {
    await callResultEndpoint(partialBody());

    const { data } = partialWrite();
    const columns: Array<string> = Object.keys(data);

    expect(columns).not.toContain("status");
    expect(columns).not.toContain("completedAt");
    expect(columns).not.toContain("nextScanAt");
    expect(columns).not.toContain("startedAt");
  });

  /*
   * A NULL marker is the auto-import worker's "the results now on this row
   * have not been processed" signal. Clearing it on every partial is what
   * makes each batch importable within a minute of being found, instead of
   * after the whole sweep (issue #3599).
   */
  test("clears the auto-import marker so the new hosts are picked up", async () => {
    await callResultEndpoint(partialBody());

    expect(partialWrite().data["autoImportProcessedAt"]).toBeNull();
  });

  test("counts SNMP responders as the responded-host count on an SNMP scan", async () => {
    await callResultEndpoint(partialBody());

    // Two of the three hosts answered SNMP; the third is ping-only.
    expect(partialWrite().data["respondedHostCount"]).toBe(2);
  });

  /*
   * On an ICMP-only scan every host is snmpReachable:false by construction,
   * so counting SNMP responders would store a hard zero for a sweep that is
   * working perfectly — the same false negative the final-result path already
   * avoids (issue #3445).
   */
  test("counts every alive host on an ICMP-only scan", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ isSnmpEnabled: false }) as never,
    );

    await callResultEndpoint(
      partialBody({
        discoveredDevices: [
          { ipAddress: "10.0.0.5", snmpReachable: false },
          { ipAddress: "10.0.0.6", snmpReachable: false },
        ],
      }),
    );

    expect(partialWrite().data["respondedHostCount"]).toBe(2);
  });

  test("marks hosts that already have a device, same as a final result", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.240.249.5"]) as never,
    );

    await callResultEndpoint(partialBody());

    const stored: Array<JSONObject> = partialWrite().data[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(stored[0]!["isAlreadyRegistered"]).toBe(true);
    expect(stored[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("answers 'partial' so the probe can tell it apart from a stored result", async () => {
    await callResultEndpoint(partialBody());

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "partial" },
    );
  });

  /*
   * This write lands every 30 seconds for the whole length of a sweep and the
   * probe waits on the response, so it takes the hook-free single-statement
   * path the claim endpoint uses — not the full updateOneById pipeline
   * (permission pre-fetch SELECT + row re-fetch + save() transaction).
   */
  test("uses the hook-free single-statement write, not the full pipeline", async () => {
    await callResultEndpoint(partialBody());

    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(1);
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * Guarded so a final result landing between the read and this write wins:
   * the partial simply affects zero rows rather than putting the previous
   * snapshot back on a finished scan.
   */
  test("is guarded on the scan still being In Progress", async () => {
    await callResultEndpoint(partialBody());

    expect(partialWrite().expectedData["status"]).toBe("In Progress");
  });

  /*
   * The same regression guard the final-result path carries: a `new
   * NetworkDeviceDiscoveryScan()` payload carries the non-column base
   * property `isPermissionIf`, which made every update throw.
   */
  test("writes a plain object, never a model instance", async () => {
    await callResultEndpoint(partialBody());

    const { data } = partialWrite();

    expect(data).not.toBeInstanceOf(DatabaseBaseModel);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.keys(data)).not.toContain("isPermissionIf");
  });

  test("clips an over-long status message to the column width", async () => {
    await callResultEndpoint(partialBody({ statusMessage: "x".repeat(900) }));

    expect(String(partialWrite().data["statusMessage"]).length).toBe(500);
  });

  test("stores no scannedHostCount when the probe sent none", async () => {
    await callResultEndpoint(partialBody({ scannedHostCount: undefined }));

    expect(Object.keys(partialWrite().data)).not.toContain("scannedHostCount");
  });
});

describe("POST /probe/discovery-scan/result — a partial for a run that is over", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  /*
   * The straggler case, and the reason the probe's ordering guarantee is not
   * relied on alone: only the server can see the order the writes actually
   * arrive in. A partial accepted here would replace a finished run's
   * results — reverse-DNS names and all — with the snapshot that preceded
   * them, and would clear the auto-import marker on a scan that has already
   * been processed.
   */
  test("is discarded for a Completed scan", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ status: "Completed" }) as never,
    );

    await callResultEndpoint(partialBody());

    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "discarded" },
    );
  });

  test("is discarded for a Failed scan", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ status: "Failed" }) as never,
    );

    await callResultEndpoint(partialBody());

    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * A Pending scan is refused for the older, stronger reason: the row is
   * queued for a NEW run, so this result is from a run that was already
   * abandoned.
   */
  test("is discarded for a re-queued (Pending) scan", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ status: "Pending" }) as never,
    );

    await callResultEndpoint(partialBody());

    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "discarded" },
    );
  });

  test("is scoped to the probe that owns the scan, like every other result", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(partialBody());

    const query: JSONObject = (
      scanService.findOneBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;

    expect(query["probeId"]).toEqual(probeId);
  });
});

/*
 * The other half of not losing a long sweep's work: the report that ENDS an
 * abandoned run must not erase what the run already uploaded.
 */
describe("POST /probe/discovery-scan/result — a failure report and the hosts already stored", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  function finalWrite(): JSONObject {
    return (scanService.updateOneById.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
  }

  test("leaves the stored hosts alone when the report mentions none", async () => {
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: false,
      statusMessage:
        "The sweep of 10.240.249.0-255.220-225 did not finish within 90 minutes and was abandoned.",
    });

    const data: JSONObject = finalWrite();

    expect(data["status"]).toBe("Failed");
    /*
     * The columns are simply not written. The hosts the sweep uploaded as it
     * went are the truth about that run, and a failure that erased them is
     * the exact loss incremental results exist to prevent (issue #3598).
     */
    expect(Object.keys(data)).not.toContain("discoveredDevices");
    expect(Object.keys(data)).not.toContain("respondedHostCount");
  });

  /*
   * An older probe still sends `discoveredDevices: []` on a failure. That IS
   * a statement — "this run found nothing" — and keeps behaving as it always
   * has, because such a probe never uploaded anything to lose.
   */
  test("an explicit empty list from an older probe still writes an empty result", async () => {
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: false,
      statusMessage: "CIDR too large.",
      discoveredDevices: [],
    });

    const data: JSONObject = finalWrite();

    expect(data["status"]).toBe("Failed");
    expect(data["discoveredDevices"]).toEqual([]);
    expect(data["respondedHostCount"]).toBe(0);
  });

  /*
   * A SUCCESSFUL run always states its host list, even when the list is
   * empty and even when the key is missing entirely: "the sweep finished and
   * found nothing" is a finding, and the Discovery page renders it as one.
   */
  test("a successful run with no hosts still records the empty result", async () => {
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: true,
      scannedHostCount: 254,
    });

    const data: JSONObject = finalWrite();

    expect(data["status"]).toBe("Completed");
    expect(data["discoveredDevices"]).toEqual([]);
    expect(data["respondedHostCount"]).toBe(0);
  });
});

describe("POST /probe/discovery-scan/result — live progress across a run", () => {
  let storedScan: NetworkDeviceDiscoveryScan;

  beforeEach(() => {
    jest.resetAllMocks();
    storedScan = makeFoundScan();
    storedScan.startedAt = new Date("2026-09-09T10:00:00.000Z");
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );

    /*
     * Each request reads a snapshot. Writes merge into the stored row just as
     * the database does, including the partial result's conditional update.
     */
    scanService.findOneBy.mockImplementation(async () => {
      return Object.assign(new NetworkDeviceDiscoveryScan(), storedScan);
    });
    scanService.updateColumnsByIdWithoutHooks.mockImplementation(
      async (input: JSONObject): Promise<void> => {
        const expected: JSONObject = input["expectedData"] as JSONObject;
        if (
          Object.entries(expected).every(
            ([key, value]: [string, unknown]): boolean => {
              const stored: unknown = (storedScan as unknown as JSONObject)[
                key
              ];
              if (stored instanceof ObjectID && value instanceof ObjectID) {
                return stored.toString() === value.toString();
              }
              return (stored ?? null) === (value ?? null);
            },
          )
        ) {
          Object.assign(storedScan, input["data"]);
        }
      },
    );
    scanService.updateOneById.mockImplementation(
      async (input: JSONObject): Promise<void> => {
        Object.assign(storedScan, input["data"]);
      },
    );
  });

  test("marks a fresh claim until its first progress report replaces the previous run's counters", async () => {
    storedScan.status = "Pending";
    storedScan.statusMessage = "Waiting for an available probe.";
    storedScan.probeId = probeId;
    storedScan.cidr = "10.0.0.0/24";
    storedScan.scannedHostCount = 254;
    storedScan.respondedHostCount = 1;
    storedScan.discoveredDevices = [{ ipAddress: "10.0.0.9" }];
    scanService.findBy.mockResolvedValueOnce([
      Object.assign(new NetworkDeviceDiscoveryScan(), storedScan),
    ] as never);
    const claimNext: NextFunction = jest.fn() as unknown as NextFunction;
    await mockRouter
      .match("post", "/probe/discovery-scan/list")
      .handlerFunction(makeRequest({}), mockResponse, claimNext);

    expect(claimNext).not.toHaveBeenCalled();
    expect(storedScan.status).toBe("In Progress");
    expect(storedScan.statusMessage).toBe(DISCOVERY_SCAN_STARTED_MESSAGE);
    expect(storedScan.scannedHostCount).toBe(254);
    expect(storedScan.discoveredDevices).toHaveLength(1);
    const startedAt: Date = storedScan.startedAt!;

    const { next } = await callResultEndpoint(
      partialBody({
        scannedHostCount: 0,
        discoveredDevices: [],
        statusMessage:
          "Checking the first addresses. Results appear here as hosts respond.",
      }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(storedScan.scannedHostCount).toBe(0);
    expect(storedScan.respondedHostCount).toBe(0);
    expect(storedScan.discoveredDevices).toEqual([]);
    expect(storedScan.statusMessage).not.toBe(DISCOVERY_SCAN_STARTED_MESSAGE);
    expect(storedScan.status).toBe("In Progress");
    expect(storedScan.startedAt).toEqual(startedAt);
    expect(storedScan.completedAt).toBeUndefined();
    expect(storedScan.nextScanAt).toBeUndefined();
  });

  test("advances the scanned count throughout a subnet with no responding hosts", async () => {
    for (const scannedHostCount of [0, 64, 128, 254]) {
      const statusMessage: string = `${scannedHostCount} of 254 addresses checked. No hosts have responded yet.`;
      const { next } = await callResultEndpoint(
        partialBody({
          scannedHostCount: scannedHostCount,
          discoveredDevices: [],
          statusMessage: statusMessage,
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(storedScan.scannedHostCount).toBe(scannedHostCount);
      expect(storedScan.respondedHostCount).toBe(0);
      expect(storedScan.discoveredDevices).toEqual([]);
      expect(storedScan.statusMessage).toBe(statusMessage);
      expect(storedScan.status).toBe("In Progress");
    }

    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(4);
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "clears the claim marker when a report has no message (partial: %s)",
    async (isPartial: boolean) => {
      storedScan.statusMessage = DISCOVERY_SCAN_STARTED_MESSAGE;
      await callResultEndpoint({
        scanId: scanId.toString(),
        isPartial: isPartial,
        scannedHostCount: 128,
        discoveredDevices: [],
      });

      expect(storedScan.statusMessage).toBeNull();
      expect(storedScan.scannedHostCount).toBe(128);
      expect(storedScan.status).toBe(isPartial ? "In Progress" : "Completed");
    },
  );

  test("replaces cumulative snapshots without duplicating previously found hosts", async () => {
    const firstHost: JSONObject = {
      ipAddress: "10.0.0.5",
      snmpReachable: true,
    };
    const secondHost: JSONObject = {
      ipAddress: "10.0.0.6",
      snmpReachable: false,
    };

    await callResultEndpoint(
      partialBody({ scannedHostCount: 64, discoveredDevices: [firstHost] }),
    );
    await callResultEndpoint(
      partialBody({
        scannedHostCount: 128,
        discoveredDevices: [firstHost, secondHost],
      }),
    );

    expect(storedScan.scannedHostCount).toBe(128);
    expect(storedScan.discoveredDevices).toHaveLength(2);
    expect(storedScan.respondedHostCount).toBe(1);
    expect(storedScan.autoImportProcessedAt).toBeNull();
  });

  test("retains the latest count and discovered hosts when the sweep times out", async () => {
    await callResultEndpoint(
      partialBody({
        scannedHostCount: 128,
        discoveredDevices: [{ ipAddress: "10.0.0.5", snmpReachable: true }],
      }),
    );
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: false,
      statusMessage:
        "The scan exceeded its time limit. Results found so far were saved.",
    });

    expect(storedScan.status).toBe("Failed");
    expect(storedScan.scannedHostCount).toBe(128);
    expect(storedScan.respondedHostCount).toBe(1);
    expect(storedScan.discoveredDevices).toEqual([
      {
        ipAddress: "10.0.0.5",
        snmpReachable: true,
        isAlreadyRegistered: false,
      },
    ]);
    expect(storedScan.completedAt).toBeInstanceOf(Date);
  });

  test("retains useful progress when a zero-response sweep fails", async () => {
    await callResultEndpoint(
      partialBody({ scannedHostCount: 128, discoveredDevices: [] }),
    );
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: false,
      statusMessage:
        "The probe stopped before the remaining addresses were checked.",
    });

    expect(storedScan.status).toBe("Failed");
    expect(storedScan.scannedHostCount).toBe(128);
    expect(storedScan.respondedHostCount).toBe(0);
    expect(storedScan.discoveredDevices).toEqual([]);
  });

  test("keeps the final result if an earlier partial finishes its lookup later", async () => {
    let finishLookup: (hosts: Set<string>) => void = (): void => {};
    let reportLookupStarted: () => void = (): void => {};
    const lookupStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        reportLookupStarted = resolve;
      },
    );
    deviceService.getRegisteredHostnames.mockImplementationOnce(() => {
      reportLookupStarted();
      return new Promise<Set<string>>(
        (resolve: (hosts: Set<string>) => void) => {
          finishLookup = resolve;
        },
      );
    });

    const pendingPartial: ReturnType<typeof callResultEndpoint> =
      callResultEndpoint(
        partialBody({
          scannedHostCount: 64,
          discoveredDevices: [{ ipAddress: "10.0.0.5", snmpReachable: true }],
        }),
      );
    await lookupStarted;
    await callResultEndpoint({
      scanId: scanId.toString(),
      success: true,
      scannedHostCount: 254,
      discoveredDevices: [
        {
          ipAddress: "10.0.0.5",
          sysName: "core-switch",
          snmpReachable: true,
        },
      ],
    });
    finishLookup(new Set<string>());
    await pendingPartial;

    expect(storedScan.status).toBe("Completed");
    expect(storedScan.scannedHostCount).toBe(254);
    expect(storedScan.discoveredDevices?.[0]?.sysName).toBe("core-switch");
    expect(storedScan.completedAt).toBeInstanceOf(Date);
  });
});
