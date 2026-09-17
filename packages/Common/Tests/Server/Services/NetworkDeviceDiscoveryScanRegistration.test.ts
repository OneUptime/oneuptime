import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import FindBy from "../../../Server/Types/Database/FindBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface FindSuccessHook {
  onFindSuccess(
    onFind: OnFind<NetworkDeviceDiscoveryScan>,
    items: Array<NetworkDeviceDiscoveryScan>,
  ): Promise<OnFind<NetworkDeviceDiscoveryScan>>;
}

function context(
  props: DatabaseCommonInteractionProps = { isRoot: true },
): OnFind<NetworkDeviceDiscoveryScan> {
  return {
    findBy: {
      query: {},
      select: { discoveredDevices: true },
      skip: 0,
      limit: 100,
      props,
    },
    carryForward: undefined,
  };
}

function host(
  ipAddress: string,
  isAlreadyRegistered?: boolean,
): DiscoveredNetworkDevice {
  return { ipAddress, isAlreadyRegistered };
}

// JSONB can contain older or malformed payloads, so accept unknown here.
function scanWith(
  discoveredDevices: unknown,
  projectId: ObjectID | undefined = PROJECT_ID,
): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  scan.projectId = projectId;
  (scan as unknown as Record<string, unknown>)["discoveredDevices"] =
    discoveredDevices;
  return scan;
}

async function readScans(
  items: Array<NetworkDeviceDiscoveryScan>,
  onFind: OnFind<NetworkDeviceDiscoveryScan> = context(),
): Promise<Array<NetworkDeviceDiscoveryScan>> {
  const result: OnFind<NetworkDeviceDiscoveryScan> = await (
    NetworkDeviceDiscoveryScanService as unknown as FindSuccessHook
  ).onFindSuccess(onFind, items);

  expect(result.findBy).toBe(onFind.findBy);
  return result.carryForward as Array<NetworkDeviceDiscoveryScan>;
}

function discoveredAt(
  scans: Array<NetworkDeviceDiscoveryScan>,
  scanIndex: number = 0,
): Array<DiscoveredNetworkDevice> {
  return scans[scanIndex]!.discoveredDevices!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceDiscoveryScanService current registration on read", () => {
  let registrationSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    registrationSpy = jest
      .spyOn(NetworkDeviceService, "getRegisteredHostnames")
      .mockResolvedValue(new Set<string>());
    updateSpy = jest
      .spyOn(NetworkDeviceDiscoveryScanService, "updateBy")
      .mockResolvedValue(0);
  });

  it("clears a stored registered flag when the device has been deleted", async () => {
    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host("10.0.0.5", true)]),
    ]);

    expect(discoveredAt(result)).toEqual([host("10.0.0.5", false)]);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
  });

  it("marks a stored unregistered host registered after an import", async () => {
    registrationSpy.mockResolvedValue(new Set(["10.0.0.5"]));

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host("10.0.0.5", false)]),
    ]);

    expect(discoveredAt(result)).toEqual([host("10.0.0.5", true)]);
  });

  it("derives registration for results written before the flag existed", async () => {
    registrationSpy.mockResolvedValue(new Set(["10.0.0.5"]));

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([{ ipAddress: "10.0.0.5" }, { ipAddress: "10.0.0.6" }]),
    ]);

    expect(discoveredAt(result)).toEqual([
      host("10.0.0.5", true),
      host("10.0.0.6", false),
    ]);
  });

  it("keeps both registered and unregistered hosts accurate in the same result", async () => {
    registrationSpy.mockResolvedValue(new Set(["10.0.0.5", "10.0.0.7"]));

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([
        host("10.0.0.5", true),
        host("10.0.0.6", true),
        host("10.0.0.7", false),
        host("10.0.0.8", false),
      ]),
    ]);

    expect(discoveredAt(result)).toEqual([
      host("10.0.0.5", true),
      host("10.0.0.6", false),
      host("10.0.0.7", true),
      host("10.0.0.8", false),
    ]);
  });

  it("rechecks inventory on every read across import, deletion and reimport", async () => {
    const saved: NetworkDeviceDiscoveryScan = scanWith([
      host("10.0.0.5", true),
    ]);
    registrationSpy
      .mockResolvedValueOnce(new Set(["10.0.0.5"]))
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValueOnce(new Set(["10.0.0.5"]));

    expect(discoveredAt(await readScans([saved]))[0]!.isAlreadyRegistered).toBe(
      true,
    );
    expect(discoveredAt(await readScans([saved]))[0]!.isAlreadyRegistered).toBe(
      false,
    );
    expect(discoveredAt(await readScans([saved]))[0]!.isAlreadyRegistered).toBe(
      true,
    );
    expect(registrationSpy).toHaveBeenCalledTimes(3);
    expect(saved.discoveredDevices).toEqual([host("10.0.0.5", true)]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("copies results without changing persisted scan data or model methods", async () => {
    const originalHost: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      isAlreadyRegistered: true,
      sysName: "Core switch",
      sysDescr: "A managed switch",
      sysObjectId: "1.3.6.1.4.1.9",
      sysLocation: "Rack 2",
      sysContact: "Network team",
      sysUpTimeSeconds: 1234,
      dnsHostname: "switch.example.test",
      snmpReachable: true,
      snmpConfigId: "office-snmp",
    };
    const originalHosts: Array<DiscoveredNetworkDevice> = [originalHost];
    const saved: NetworkDeviceDiscoveryScan = scanWith(originalHosts);
    saved.name = "Office discovery";
    saved.status = "Completed";
    saved.completedAt = new Date("2026-09-01T10:00:00Z");
    saved.scannedHostCount = 256;
    saved.respondedHostCount = 1;
    Object.freeze(originalHost);
    Object.freeze(originalHosts);
    Object.freeze(saved);
    const originalItems: Array<NetworkDeviceDiscoveryScan> = [saved];
    Object.freeze(originalItems);

    const result: Array<NetworkDeviceDiscoveryScan> =
      await readScans(originalItems);

    expect(result).not.toBe(originalItems);
    expect(result[0]).not.toBe(saved);
    expect(result[0]).toBeInstanceOf(NetworkDeviceDiscoveryScan);
    expect(Object.getPrototypeOf(result[0])).toBe(Object.getPrototypeOf(saved));
    expect(result[0]).toEqual({
      ...saved,
      discoveredDevices: [{ ...originalHost, isAlreadyRegistered: false }],
    });
    expect(discoveredAt(result)).not.toBe(originalHosts);
    expect(discoveredAt(result)[0]).not.toBe(originalHost);
    expect(originalHost.isAlreadyRegistered).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("batches and deduplicates all hosts for the same project across scans", async () => {
    registrationSpy.mockResolvedValue(new Set(["10.0.0.6"]));
    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host("10.0.0.5"), host("10.0.0.5"), host("10.0.0.6")]),
      scanWith(
        [host("10.0.0.6"), host("10.0.0.7")],
        new ObjectID(PROJECT_ID.toString()),
      ),
    ]);

    expect(registrationSpy).toHaveBeenCalledTimes(1);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "10.0.0.6", "10.0.0.7"],
      props: { isRoot: true },
    });
    expect(discoveredAt(result, 0)).toEqual([
      host("10.0.0.5", false),
      host("10.0.0.5", false),
      host("10.0.0.6", true),
    ]);
    expect(discoveredAt(result, 1)).toEqual([
      host("10.0.0.6", true),
      host("10.0.0.7", false),
    ]);
  });

  it("keeps the same address independent between projects", async () => {
    registrationSpy.mockImplementation(
      async (data: { projectId: ObjectID }): Promise<Set<string>> => {
        return data.projectId.toString() === PROJECT_ID.toString()
          ? new Set(["10.0.0.5"])
          : new Set<string>();
      },
    );

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host("10.0.0.5", false)], PROJECT_ID),
      scanWith([host("10.0.0.5", true)], OTHER_PROJECT_ID),
    ]);

    expect(registrationSpy).toHaveBeenCalledTimes(2);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: OTHER_PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
    expect(discoveredAt(result, 0)[0]!.isAlreadyRegistered).toBe(true);
    expect(discoveredAt(result, 1)[0]!.isAlreadyRegistered).toBe(false);
  });

  it("uses the request tenant when projectId was not selected", async () => {
    const saved: NetworkDeviceDiscoveryScan = scanWith([
      host("10.0.0.5", true),
    ]);
    delete saved.projectId;
    const result: Array<NetworkDeviceDiscoveryScan> = await readScans(
      [saved],
      context({ tenantId: PROJECT_ID }),
    );

    expect(discoveredAt(result)[0]!.isAlreadyRegistered).toBe(false);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
    expect(result[0]!.projectId).toBeUndefined();
  });

  it("uses the scan project before the request tenant", async () => {
    await readScans(
      [scanWith([host("10.0.0.5", true)], OTHER_PROJECT_ID)],
      context({ tenantId: PROJECT_ID }),
    );

    expect(registrationSpy).toHaveBeenCalledTimes(1);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: OTHER_PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
  });

  it("leaves results unchanged when neither project nor tenant is available", async () => {
    const saved: NetworkDeviceDiscoveryScan = scanWith([
      host("10.0.0.5", true),
    ]);
    delete saved.projectId;

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([saved]);

    expect(result[0]).toBe(saved);
    expect(registrationSpy).not.toHaveBeenCalled();
  });

  it("normalizes whitespace for lookup without rewriting the stored address", async () => {
    registrationSpy.mockResolvedValue(new Set(["10.0.0.5"]));

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host(" 10.0.0.5 \t", false), host("10.0.0.5", false)]),
    ]);

    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
    expect(discoveredAt(result)).toEqual([
      host(" 10.0.0.5 \t", true),
      host("10.0.0.5", true),
    ]);
  });

  it.each([
    ["omitted", undefined],
    ["null", null],
    ["empty", []],
    ["object", { ipAddress: "10.0.0.5" }],
    ["string", "10.0.0.5"],
    ["number", 42],
  ])(
    "does not query inventory for %s results",
    async (_label: string, payload: unknown) => {
      const saved: NetworkDeviceDiscoveryScan = scanWith(payload);

      const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
        saved,
      ]);

      expect(result[0]).toBe(saved);
      expect(registrationSpy).not.toHaveBeenCalled();
    },
  );

  it("does not query inventory for an empty scan page", async () => {
    expect(await readScans([])).toEqual([]);
    expect(registrationSpy).not.toHaveBeenCalled();
  });

  it("does not query inventory for only malformed host entries", async () => {
    const junk: Array<unknown> = [
      null,
      false,
      42,
      "10.0.0.5",
      [],
      {},
      { ipAddress: null },
      { ipAddress: 10 },
      { ipAddress: "", isAlreadyRegistered: true },
      { ipAddress: " \t\n ", isAlreadyRegistered: true },
    ];
    const saved: NetworkDeviceDiscoveryScan = scanWith(junk);

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([saved]);

    expect(result[0]).toBe(saved);
    expect(result[0]!.discoveredDevices).toBe(junk);
    expect(registrationSpy).not.toHaveBeenCalled();
  });

  it("preserves malformed entries among valid hosts", async () => {
    const junkObject: Record<string, unknown> = {
      ipAddress: 10,
      isAlreadyRegistered: true,
    };
    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([null, junkObject, host("10.0.0.5", true), "invalid"]),
    ]);

    expect(discoveredAt(result)).toEqual([
      null,
      junkObject,
      host("10.0.0.5", false),
      "invalid",
    ]);
    expect(discoveredAt(result)[1]).toBe(junkObject);
    expect(registrationSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: { isRoot: true },
    });
  });

  it("preserves unselected rows beside rows that need registration refresh", async () => {
    const unselected: NetworkDeviceDiscoveryScan = scanWith(undefined);
    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      unselected,
      scanWith([host("10.0.0.5", true)]),
    ]);

    expect(result[0]).toBe(unselected);
    expect(discoveredAt(result, 1)[0]!.isAlreadyRegistered).toBe(false);
    expect(registrationSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates lookup failure instead of reporting all hosts as importable", async () => {
    const error: Error = new Error("inventory lookup unavailable");
    registrationSpy.mockRejectedValue(error);
    const saved: NetworkDeviceDiscoveryScan = scanWith([
      host("10.0.0.5", true),
    ]);

    await expect(readScans([saved])).rejects.toBe(error);

    expect(saved.discoveredDevices).toEqual([host("10.0.0.5", true)]);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("discovery registration with the inventory lookup service", () => {
  it("keeps a live device registered after its monitor has been deleted", async () => {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.0.0.5";
    delete device.monitorId;
    const findSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([device]);

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith([host("10.0.0.5", false)]),
    ]);

    expect(discoveredAt(result)[0]!.isAlreadyRegistered).toBe(true);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      hostname: expect.any(FindOperator),
    });
  });

  it("refreshes more than 900 hosts through bounded inventory lookup chunks", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = Array.from(
      { length: 1001 },
      (_value: unknown, index: number): DiscoveredNetworkDevice => {
        return host(`10.99.${Math.floor(index / 256)}.${index % 256}`, true);
      },
    );
    const liveHostnames: Set<string> = new Set([
      hosts[0]!.ipAddress,
      hosts[500]!.ipAddress,
      hosts[1000]!.ipAddress,
    ]);
    const requestedChunks: Array<Array<string>> = [];
    const findSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation(
        async (
          findBy: FindBy<NetworkDevice>,
        ): Promise<Array<NetworkDevice>> => {
          expect(findBy.query.projectId).toEqual(PROJECT_ID);
          expect(findBy.props).toEqual({ isRoot: true });
          const operator: FindOperator<string> = findBy.query
            .hostname as unknown as FindOperator<string>;
          const parameters: Record<string, unknown> =
            operator.objectLiteralParameters || {};
          const requested: Array<string> = Object.values(
            parameters,
          )[0] as Array<string>;
          requestedChunks.push(requested);

          return requested
            .filter((hostname: string): boolean => {
              return liveHostnames.has(hostname);
            })
            .map((hostname: string): NetworkDevice => {
              const device: NetworkDevice = new NetworkDevice();
              device.hostname = hostname;
              return device;
            });
        },
      );

    const result: Array<NetworkDeviceDiscoveryScan> = await readScans([
      scanWith(hosts),
    ]);

    expect(findSpy).toHaveBeenCalledTimes(3);
    expect(
      requestedChunks.map((chunk: Array<string>): number => {
        return chunk.length;
      }),
    ).toEqual([500, 500, 1]);
    expect(requestedChunks.flat()).toEqual(
      hosts.map((item: DiscoveredNetworkDevice): string => {
        return item.ipAddress;
      }),
    );
    expect(discoveredAt(result)).toHaveLength(1001);
    for (const item of discoveredAt(result)) {
      expect(item.isAlreadyRegistered).toBe(liveHostnames.has(item.ipAddress));
    }
    expect(
      hosts.every((item: DiscoveredNetworkDevice): boolean => {
        return item.isAlreadyRegistered === true;
      }),
    ).toBe(true);
  });
});
