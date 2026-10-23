/*
 * The discovery engine records what each completed result read about the
 * devices already at its addresses (OneUptime issue #5185): read once per
 * result, in chunks of addresses, planned by planDiscoveredDetails and
 * written in one batched merge - never into the devices' own columns, never
 * blocking the import or the processed stamp, in projects with or without
 * import rules.
 *
 * The collaborating services are stubbed at the module level, as the engine's
 * own suite stubs them: nothing here touches Postgres or Redis.
 */

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
      updateOneById: jest.fn(),
      countBy: jest.fn(),
      mergeDiscoveredDetails: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn(), findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("../../../Server/Services/MonitorTemplateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return { __esModule: true, default: { lock: jest.fn(), release: jest.fn() } };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import NetworkDeviceAutoImportRuleEngineService from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import logger from "../../../Server/Utils/Logger";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

if (typeof globalThis.setImmediate === "undefined") {
  (globalThis as Record<string, unknown>)["setImmediate"] = ((
    callback: () => void,
  ): ReturnType<typeof setTimeout> => {
    return setTimeout(callback, 0);
  }) as unknown as typeof globalThis.setImmediate;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const DEVICE_ID: string = "44444444-4444-4444-8444-444444444444";

const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const mergeMock: jest.Mock =
  NetworkDeviceService.mergeDiscoveredDetails as unknown as jest.Mock;
const devicesByHostnamesMock: jest.Mock =
  NetworkDeviceService.getDevicesByHostnames as unknown as jest.Mock;
const scanFindOneByMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.findOneBy as unknown as jest.Mock;
const scanUpdateMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const ruleFindByMock: jest.Mock =
  NetworkDeviceAutoImportRuleService.findBy as unknown as jest.Mock;
const loggerErrorMock: jest.Mock = logger.error as unknown as jest.Mock;

const COMPLETED_AT: Date = OneUptimeDate.getCurrentDate();

function host(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.20.12.7",
    sysName: "edge-sw-07",
    sysDescr: "Cisco IOS Software, C2960X Software, Version 15.2(7)E8",
    sysObjectId: "1.3.6.1.4.1.9.1.1208",
    sysLocation: "Back office rack",
    dnsHostname: "edge-sw-07.store-12.acme.example",
    snmpReachable: true,
    ...overrides,
  };
}

function makeScan(
  overrides: Record<string, unknown> = {},
): NetworkDeviceDiscoveryScan {
  return {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "Store subnets",
    cidr: "10.20.12.0/24",
    status: "Completed",
    startedAt: OneUptimeDate.addRemoveMinutes(COMPLETED_AT, -10),
    completedAt: COMPLETED_AT,
    autoImportProcessedAt: undefined,
    discoveredDevices: [host()],
    snmpConfigs: [],
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function deviceAt(hostname: string, id: string = DEVICE_ID): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(id);
  device.projectId = PROJECT_ID;
  device.hostname = hostname;
  return device;
}

// The findBy calls that read devices for their discovered details.
function detailReads(): Array<JSONObject> {
  return deviceFindByMock.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((args: JSONObject): boolean => {
      return Boolean((args["select"] as JSONObject)["discoveredDetails"]);
    });
}

function addressesIn(args: JSONObject): Array<string> {
  const operator: FindOperator<string> = (args["query"] as JSONObject)[
    "hostname"
  ] as unknown as FindOperator<string>;
  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters || {}) as Record<string, unknown>;
  return ((Object.values(parameters)[0] as Array<unknown>) || []).map(
    (value: unknown): string => {
      return String(value);
    },
  );
}

async function process(): Promise<void> {
  await NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
    scanId: SCAN_ID,
    existingHostnamesByProjectId: new Map(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  deviceFindByMock.mockResolvedValue([]);
  devicesByHostnamesMock.mockResolvedValue(new Map());
  mergeMock.mockResolvedValue(1);
  scanUpdateMock.mockResolvedValue(undefined);
  // A project with no import rules: the result is stamped without importing.
  ruleFindByMock.mockResolvedValue([]);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("a completed result records what it read about the devices at its addresses", () => {
  test("the devices are read by the result's addresses, live ones only, with what the plan needs", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());

    await process();

    const reads: Array<JSONObject> = detailReads();
    expect(reads).toHaveLength(1);

    const query: JSONObject = reads[0]!["query"] as JSONObject;
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["isArchived"]).toBe(false);
    expect(addressesIn(reads[0]!)).toEqual(["10.20.12.7"]);
    expect(reads[0]!["select"]).toEqual({
      _id: true,
      projectId: true,
      hostname: true,
      sysName: true,
      sysObjectId: true,
      dnsName: true,
      discoveredName: true,
      discoveredNameSource: true,
      discoveredDetails: true,
    });
    expect(reads[0]!["props"]).toEqual({ isRoot: true });
  });

  test("what the scan read is merged, credited to the scan, in one call", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());
    deviceFindByMock.mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["select"] &&
        ((args as JSONObject)["select"] as JSONObject)["discoveredDetails"]
        ? [deviceAt("10.20.12.7")]
        : [];
    });

    await process();

    expect(mergeMock).toHaveBeenCalledTimes(1);
    const input: JSONObject = mergeMock.mock.calls[0]![0] as JSONObject;
    expect((input["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );

    const patches: Array<JSONObject> = input["patches"] as Array<JSONObject>;
    expect(patches).toHaveLength(1);
    expect(patches[0]!["deviceId"]).toBe(DEVICE_ID);

    const set: JSONObject = patches[0]!["set"] as JSONObject;
    expect((set["sysName"] as JSONObject)["value"]).toBe("edge-sw-07");
    expect((set["dnsName"] as JSONObject)["value"]).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expect((set["foundBy"] as JSONObject)["readBy"]).toEqual({
      type: "discoveryScan",
      id: SCAN_ID.toString(),
      name: "Store subnets",
    });
    expect((set["foundBy"] as JSONObject)["readAt"]).toBe(
      COMPLETED_AT.toISOString(),
    );
  });

  test("in a project with no import rules too, and the result is still stamped", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());
    deviceFindByMock.mockResolvedValue([deviceAt("10.20.12.7")]);

    await process();

    expect(mergeMock).toHaveBeenCalledTimes(1);
    expect(scanUpdateMock).toHaveBeenCalled();
  });

  test("a result too old to import still records what it read - dated as it was read", async () => {
    const longAgo: Date = OneUptimeDate.addRemoveHours(COMPLETED_AT, -72);
    scanFindOneByMock.mockResolvedValue(
      makeScan({
        completedAt: longAgo,
        startedAt: OneUptimeDate.addRemoveMinutes(longAgo, -10),
      }),
    );
    deviceFindByMock.mockResolvedValue([deviceAt("10.20.12.7")]);
    ruleFindByMock.mockResolvedValue([
      {
        id: new ObjectID("77777777-7777-4777-8777-777777777777"),
        isExclusion: false,
      },
    ]);

    await process();

    expect(mergeMock).toHaveBeenCalledTimes(1);
    const set: JSONObject = (
      (mergeMock.mock.calls[0]![0] as JSONObject)[
        "patches"
      ] as Array<JSONObject>
    )[0]!["set"] as JSONObject;
    expect((set["sysName"] as JSONObject)["readAt"]).toBe(
      longAgo.toISOString(),
    );
  });

  test("a scan still sweeping records nothing: its final result is a minute away", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ status: "In Progress", completedAt: undefined }),
    );
    deviceFindByMock.mockResolvedValue([deviceAt("10.20.12.7")]);

    await process();

    expect(detailReads()).toHaveLength(0);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  test("a result already processed is not read again", async () => {
    scanFindOneByMock.mockResolvedValue(
      makeScan({ autoImportProcessedAt: COMPLETED_AT }),
    );

    await process();

    expect(detailReads()).toHaveLength(0);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  test("no device at any address: nothing merged", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());
    deviceFindByMock.mockResolvedValue([]);

    await process();

    expect(detailReads()).toHaveLength(1);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  test("a result with no hosts reads nothing", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan({ discoveredDevices: [] }));

    await process();

    expect(detailReads()).toHaveLength(0);
  });

  test("1,001 addresses are read in chunks of 500", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = [];
    for (let index: number = 0; index < 1001; index++) {
      hosts.push(
        host({
          ipAddress: `10.99.${Math.floor(index / 256)}.${index % 256}`,
          sysName: `sw-${index}`,
        }),
      );
    }
    scanFindOneByMock.mockResolvedValue(makeScan({ discoveredDevices: hosts }));

    await process();

    expect(
      detailReads().map((args: JSONObject): number => {
        return addressesIn(args).length;
      }),
    ).toEqual([500, 500, 1]);
  });

  test("a failed merge is logged and the result is stamped all the same", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());
    deviceFindByMock.mockResolvedValue([deviceAt("10.20.12.7")]);
    mergeMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(process()).resolves.toBeUndefined();

    expect(scanUpdateMock).toHaveBeenCalled();
    expect(
      loggerErrorMock.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes(
          "could not record what scan 33333333-3333-4333-8333-333333333333 read",
        );
      }),
    ).toBe(true);
  });

  test("a failed read is logged and the result is stamped all the same", async () => {
    scanFindOneByMock.mockResolvedValue(makeScan());
    deviceFindByMock.mockRejectedValue(new Error("statement timeout"));

    await expect(process()).resolves.toBeUndefined();
    expect(scanUpdateMock).toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });
});
