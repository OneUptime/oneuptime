import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * chooseDeviceAttachment is pure, but the module also imports ModelAPI (for
 * getDeviceAttachment), and ModelAPI transitively loads Common/UI/Config,
 * which reads `window` at import time and throws in this node test
 * environment. Mocking the ModelAPI module keeps the import graph
 * browser-free and doubles as the seam for asserting WHICH queries the
 * lookup issues - the card's whole correctness rests on asking for the right
 * rows and then applying the map's rules to them.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getItem: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The rows below were seen at 10:00 that morning, and a row is only evidence
 * of an ADDRESS while it is inside the window the map ages endpoints out on
 * - the same rule the topology builder applies. So the clock is pinned a few
 * minutes after the sightings; timers are left real, the lookups await them.
 */
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date("2026-09-07T10:05:00Z"),
    doNotFake: [
      "setTimeout",
      "setImmediate",
      "nextTick",
      "queueMicrotask",
      "performance",
      "hrtime",
    ],
  });
});
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import {
  AttachmentEndpointRow,
  DeviceAttachment,
  DeviceAttachmentLookupResult,
  chooseDeviceAttachment,
  getDeviceAttachment,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceAttachmentLookupUtil";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getItemMock: jest.Mock = ModelAPI.getItem as unknown as jest.Mock;

const DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000aa",
);

const SWITCH_A: string = "3f1b6b0e-0000-4000-8000-00000000a001";
const SWITCH_B: string = "3f1b6b0e-0000-4000-8000-00000000b001";
const SITE_ONE: string = "3f1b6b0e-0000-4000-8000-000000005001";
const SITE_TWO: string = "3f1b6b0e-0000-4000-8000-000000005002";

const REGISTER_MAC: string = "aa:bb:cc:dd:ee:ff";
const OTHER_MAC: string = "11:22:33:44:55:66";
const REGISTER_IP: string = "10.0.0.5";

/*
 * The forwarding-table row as the card's query returns it. Everything
 * defaults to "the register, seen on switch A port 7, just now" and each
 * test overrides the one thing it is about.
 */
function endpointRow(
  overrides: Partial<AttachmentEndpointRow> & { _id: string },
): AttachmentEndpointRow {
  return {
    macAddress: REGISTER_MAC,
    ipAddress: REGISTER_IP,
    siteId: SITE_ONE,
    attachedNetworkDeviceId: SWITCH_A,
    attachedNetworkDevice: { _id: SWITCH_A, name: "Store switch" },
    attachedPortName: "Gi1/0/7",
    attachedInterfaceIndex: 7,
    vlanId: 20,
    lastSeenAt: new Date("2026-09-07T10:00:00Z"),
    ...overrides,
  };
}

describe("chooseDeviceAttachment - matching by MAC", () => {
  test.each([
    "aa:bb:cc:dd:ee:ff",
    "AA:BB:CC:DD:EE:FF",
    "AA-BB-CC-DD-EE-FF",
    "aabb.ccdd.eeff",
    "aabbccddeeff",
    "0xaabbccddeeff",
  ])(
    "the declared MAC matches the learned one spelt %s",
    (spelling: string) => {
      const found: DeviceAttachment | undefined = chooseDeviceAttachment(
        { macAddress: spelling, hostname: "register-01.store.example" },
        [endpointRow({ _id: "e1" })],
      );

      expect(found?.matchedBy).toBe("mac");
      expect(found?.macAddress).toBe(REGISTER_MAC);
      expect(found?.switchDeviceId).toBe(SWITCH_A);
      expect(found?.switchName).toBe("Store switch");
      expect(found?.portName).toBe("Gi1/0/7");
      expect(found?.vlanId).toBe(20);
    },
  );

  test("the learned MAC is matched in any spelling too", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { macAddress: REGISTER_MAC },
      [endpointRow({ _id: "e1", macAddress: "AABB.CCDD.EEFF" })],
    );

    expect(found?.matchedBy).toBe("mac");
    expect(found?.macAddress).toBe(REGISTER_MAC);
  });

  test("a MAC match ignores the site: a MAC is unique per project", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { macAddress: REGISTER_MAC, siteId: SITE_TWO },
      [endpointRow({ _id: "e1", siteId: SITE_ONE })],
    );

    expect(found?.matchedBy).toBe("mac");
  });

  test("a different MAC is not this device", () => {
    expect(
      chooseDeviceAttachment({ macAddress: OTHER_MAC }, [
        endpointRow({ _id: "e1" }),
      ]),
    ).toBeUndefined();
  });
});

describe("chooseDeviceAttachment - matching by IP address", () => {
  test("an IP hostname matches the ARP-bound address at the same site", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { hostname: REGISTER_IP, siteId: SITE_ONE },
      [endpointRow({ _id: "e1" })],
    );

    expect(found?.matchedBy).toBe("ip");
    expect(found?.ipAddress).toBe(REGISTER_IP);
    // The MAC shown is the one the switch learned, which the device lacks.
    expect(found?.macAddress).toBe(REGISTER_MAC);
  });

  test("an address match is blocked across sites: every branch has a 10.0.0.5", () => {
    expect(
      chooseDeviceAttachment({ hostname: REGISTER_IP, siteId: SITE_TWO }, [
        endpointRow({ _id: "e1", siteId: SITE_ONE }),
      ]),
    ).toBeUndefined();
  });

  test("a device with no site does not match an endpoint that has one, nor the reverse", () => {
    expect(
      chooseDeviceAttachment({ hostname: REGISTER_IP }, [
        endpointRow({ _id: "e1", siteId: SITE_ONE }),
      ]),
    ).toBeUndefined();

    expect(
      chooseDeviceAttachment({ hostname: REGISTER_IP, siteId: SITE_ONE }, [
        endpointRow({ _id: "e1", siteId: undefined }),
      ]),
    ).toBeUndefined();
  });

  test("no site on either side is the same site: a project without sites still matches", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { hostname: REGISTER_IP, siteId: "  " },
      [endpointRow({ _id: "e1", siteId: "" })],
    );

    expect(found?.matchedBy).toBe("ip");
  });

  test("a DNS hostname never matches by address, even when ARP knows the name", () => {
    expect(
      chooseDeviceAttachment(
        { hostname: "register-01.store.example", siteId: SITE_ONE },
        [
          endpointRow({
            _id: "e1",
            ipAddress: "register-01.store.example",
          }),
        ],
      ),
    ).toBeUndefined();
  });

  test("an out-of-range quad is not an address", () => {
    expect(
      chooseDeviceAttachment({ hostname: "10.0.0.999", siteId: SITE_ONE }, [
        endpointRow({ _id: "e1", ipAddress: "10.0.0.999" }),
      ]),
    ).toBeUndefined();
  });

  test("the hostname is trimmed before it is compared", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { hostname: ` ${REGISTER_IP} `, siteId: SITE_ONE },
      [endpointRow({ _id: "e1" })],
    );

    expect(found?.matchedBy).toBe("ip");
  });
});

describe("chooseDeviceAttachment - which sighting is the cable", () => {
  test("the freshest row wins, whatever order the rows arrive in", () => {
    const stale: AttachmentEndpointRow = endpointRow({
      _id: "stale",
      attachedNetworkDeviceId: SWITCH_A,
      lastSeenAt: new Date("2026-09-01T10:00:00Z"),
    });
    const fresh: AttachmentEndpointRow = endpointRow({
      _id: "fresh",
      macAddress: OTHER_MAC,
      attachedNetworkDeviceId: SWITCH_B,
      attachedNetworkDevice: { _id: SWITCH_B, name: "New switch" },
      lastSeenAt: new Date("2026-09-07T10:00:00Z"),
    });

    for (const rows of [
      [stale, fresh],
      [fresh, stale],
    ]) {
      const found: DeviceAttachment | undefined = chooseDeviceAttachment(
        { macAddress: REGISTER_MAC, hostname: REGISTER_IP, siteId: SITE_ONE },
        rows,
      );

      expect(found?.endpointId).toBe("fresh");
      expect(found?.switchDeviceId).toBe(SWITCH_B);
      expect(found?.matchedBy).toBe("ip");
    }
  });

  test("at equal freshness a MAC match beats an address match", () => {
    const seenAt: Date = new Date("2026-09-07T10:00:00Z");
    const byIp: AttachmentEndpointRow = endpointRow({
      _id: "by-ip",
      macAddress: "00:00:00:00:00:01",
      attachedNetworkDeviceId: SWITCH_B,
      lastSeenAt: seenAt,
    });
    const byMac: AttachmentEndpointRow = endpointRow({
      _id: "by-mac",
      ipAddress: undefined,
      lastSeenAt: seenAt,
    });

    for (const rows of [
      [byIp, byMac],
      [byMac, byIp],
    ]) {
      const found: DeviceAttachment | undefined = chooseDeviceAttachment(
        { macAddress: REGISTER_MAC, hostname: REGISTER_IP, siteId: SITE_ONE },
        rows,
      );

      expect(found?.endpointId).toBe("by-mac");
      expect(found?.matchedBy).toBe("mac");
    }
  });

  test("equal on both, the lowest MAC settles it", () => {
    const seenAt: Date = new Date("2026-09-07T10:00:00Z");
    const higher: AttachmentEndpointRow = endpointRow({
      _id: "higher",
      macAddress: "00:00:00:00:00:09",
      lastSeenAt: seenAt,
    });
    const lower: AttachmentEndpointRow = endpointRow({
      _id: "lower",
      macAddress: "00:00:00:00:00:01",
      lastSeenAt: seenAt,
    });

    for (const rows of [
      [higher, lower],
      [lower, higher],
    ]) {
      expect(
        chooseDeviceAttachment(
          { hostname: REGISTER_IP, siteId: SITE_ONE },
          rows,
        )?.endpointId,
      ).toBe("lower");
    }
  });

  test("an address row nothing has seen inside the fresh window is not evidence at all", () => {
    /*
     * The map's rule, restated here: an address is re-leased, so a row a
     * router bound months ago (or never dated) may name a laptop that held
     * the register's address before the register was plugged in. Such a
     * row is not ranked last - it is refused. A MAC match has no window.
     */
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { hostname: REGISTER_IP, siteId: SITE_ONE },
      [
        endpointRow({
          _id: "never",
          macAddress: "00:00:00:00:00:01",
          lastSeenAt: undefined,
        }),
        endpointRow({
          _id: "once",
          macAddress: "00:00:00:00:00:09",
          lastSeenAt: new Date("2020-01-01T00:00:00Z"),
        }),
      ],
    );

    expect(found).toBeUndefined();

    const byMac: DeviceAttachment | undefined = chooseDeviceAttachment(
      { macAddress: "00:00:00:00:00:09" },
      [
        endpointRow({
          _id: "once",
          macAddress: "00:00:00:00:00:09",
          lastSeenAt: new Date("2020-01-01T00:00:00Z"),
        }),
      ],
    );

    expect(byMac?.endpointId).toBe("once");
  });

  test("nothing matching is undefined", () => {
    expect(
      chooseDeviceAttachment(
        { macAddress: OTHER_MAC, hostname: "10.9.9.9", siteId: SITE_ONE },
        [endpointRow({ _id: "e1" })],
      ),
    ).toBeUndefined();
  });

  test("no rows is undefined", () => {
    expect(
      chooseDeviceAttachment({ macAddress: REGISTER_MAC }, []),
    ).toBeUndefined();
  });

  test("a device with neither key matches nothing, however well the rows fit", () => {
    expect(
      chooseDeviceAttachment(
        { hostname: "register-01.store.example", siteId: SITE_ONE },
        [endpointRow({ _id: "e1" })],
      ),
    ).toBeUndefined();
  });

  test("a sighting from the device's own tables is not a cable to itself", () => {
    /*
     * The map adopts such a row and draws nothing for it. The card must
     * not do better than the map here: "Connected to <this router>" would
     * be a wrong answer, and a different one from the map's.
     */
    expect(
      chooseDeviceAttachment(
        {
          id: SWITCH_A,
          macAddress: REGISTER_MAC,
        },
        [endpointRow({ _id: "self", attachedNetworkDeviceId: SWITCH_A })],
      ),
    ).toBeUndefined();
  });

  test("the port falls back to the interface index, and ids come from the relation when the column is absent", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { macAddress: REGISTER_MAC },
      [
        endpointRow({
          _id: "e1",
          attachedPortName: undefined,
          attachedNetworkDeviceId: undefined,
          attachedNetworkDevice: { _id: SWITCH_B, name: "Relation only" },
        }),
      ],
    );

    expect(found?.portName).toBeUndefined();
    expect(found?.interfaceIndex).toBe(7);
    expect(found?.switchDeviceId).toBe(SWITCH_B);
    expect(found?.switchName).toBe("Relation only");
  });
});

/*
 * The fetching half: which queries go out for which device, and that the
 * two pages are merged into one set of rows before the rules run.
 */
describe("getDeviceAttachment", () => {
  function deviceRow(data: {
    hostname?: string | undefined;
    macAddress?: string | undefined;
    siteId?: ObjectID | undefined;
  }): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device._id = DEVICE_ID.toString();

    /*
     * Assigned only when present: the project compiles with
     * exactOptionalPropertyTypes, so writing an explicit `undefined` into
     * an optional property is an error rather than a no-op.
     */
    if (data.hostname !== undefined) {
      device.hostname = data.hostname;
    }

    if (data.macAddress !== undefined) {
      device.macAddress = data.macAddress;
    }

    if (data.siteId !== undefined) {
      device.siteId = data.siteId;
    }

    return device;
  }

  function endpointModel(data: {
    _id: string;
    macAddress: string;
    ipAddress?: string | undefined;
    siteId?: ObjectID | undefined;
    attachedNetworkDeviceId?: ObjectID | undefined;
    switchName?: string | undefined;
    portName?: string | undefined;
    lastSeenAt?: Date | undefined;
  }): NetworkEndpoint {
    const endpoint: NetworkEndpoint = new NetworkEndpoint();
    endpoint._id = data._id;
    endpoint.macAddress = data.macAddress;

    if (data.ipAddress !== undefined) {
      endpoint.ipAddress = data.ipAddress;
    }

    if (data.siteId !== undefined) {
      endpoint.siteId = data.siteId;
    }

    if (data.attachedNetworkDeviceId !== undefined) {
      endpoint.attachedNetworkDeviceId = data.attachedNetworkDeviceId;

      const attached: NetworkDevice = new NetworkDevice();
      attached._id = data.attachedNetworkDeviceId.toString();

      if (data.switchName !== undefined) {
        attached.name = data.switchName;
      }

      endpoint.attachedNetworkDevice = attached;
    }

    if (data.portName !== undefined) {
      endpoint.attachedPortName = data.portName;
    }

    if (data.lastSeenAt !== undefined) {
      endpoint.lastSeenAt = data.lastSeenAt;
    }

    return endpoint;
  }

  function listResult(data: Array<NetworkEndpoint>): {
    data: Array<NetworkEndpoint>;
    count: number;
    skip: number;
    limit: number;
  } {
    return { data, count: data.length, skip: 0, limit: 50 };
  }

  /*
   * The endpoint-table queries only. The device-table reads that fetch the
   * other devices which could claim the same rows are asserted separately.
   */
  function issuedQueries(): Array<Record<string, unknown>> {
    return getListMock.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === NetworkEndpoint
        );
      })
      .map((call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      });
  }

  function issuedDeviceQueries(): Array<Record<string, unknown>> {
    return getListMock.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === NetworkDevice;
      })
      .map((call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      });
  }

  beforeEach(() => {
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockResolvedValue(listResult([]));
  });

  test("a device with a MAC and an IP hostname is looked up by both keys", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        hostname: REGISTER_IP,
        macAddress: "AA-BB-CC-DD-EE-FF",
        siteId: new ObjectID(SITE_ONE),
      }),
    );

    const result: DeviceAttachmentLookupResult =
      await getDeviceAttachment(DEVICE_ID);

    expect(result.isLookupPossible).toBe(true);
    /*
     * The MAC is queried in the form the endpoint table stores it in, and
     * the address is scoped to the device's site on the server: every
     * branch has a 10.0.0.5, and a page of other sites' rows would crowd
     * this site's out.
     */
    const queries: Array<Record<string, unknown>> = issuedQueries();
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual({ macAddress: REGISTER_MAC });
    expect(queries[1]?.["ipAddress"]).toBe(REGISTER_IP);
    expect(queries[1]?.["siteId"]?.toString()).toBe(SITE_ONE);
  });

  test("the other devices that could claim the same rows are read too", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        hostname: REGISTER_IP,
        macAddress: REGISTER_MAC,
        siteId: new ObjectID(SITE_ONE),
      }),
    );

    await getDeviceAttachment(DEVICE_ID);

    const deviceQueries: Array<Record<string, unknown>> = issuedDeviceQueries();
    expect(deviceQueries).toHaveLength(2);
    // Every device declaring one of the MACs in play...
    expect(
      JSON.parse(JSON.stringify(deviceQueries[0]?.["macAddress"])),
    ).toEqual(expect.objectContaining({ _type: "Includes" }));
    // ...and every device registered at this address.
    expect(deviceQueries[1]).toEqual({ hostname: REGISTER_IP });
  });

  test("a device with only a MAC is looked up by MAC alone", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        hostname: "register-01.store.example",
        macAddress: REGISTER_MAC,
      }),
    );

    await getDeviceAttachment(DEVICE_ID);

    expect(issuedQueries()).toEqual([{ macAddress: REGISTER_MAC }]);
  });

  test("a device with only an IP hostname is looked up by address alone", async () => {
    getItemMock.mockResolvedValue(deviceRow({ hostname: REGISTER_IP }));

    await getDeviceAttachment(DEVICE_ID);

    expect(issuedQueries()).toEqual([{ ipAddress: REGISTER_IP }]);
  });

  test("a device with neither key issues no query and says the lookup is impossible", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({ hostname: "register-01.store.example" }),
    );

    const result: DeviceAttachmentLookupResult =
      await getDeviceAttachment(DEVICE_ID);

    expect(getListMock).not.toHaveBeenCalled();
    expect(result.isLookupPossible).toBe(false);
    expect(result.attachment).toBeUndefined();
  });

  test("the device read selects only the columns the keys come from, and never a project id", async () => {
    getItemMock.mockResolvedValue(deviceRow({ hostname: REGISTER_IP }));

    await getDeviceAttachment(DEVICE_ID);

    const request: { id: ObjectID; select: Record<string, unknown> } =
      getItemMock.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
      };

    expect(request.id.toString()).toBe(DEVICE_ID.toString());
    expect(Object.keys(request.select).sort()).toEqual([
      "_id",
      "hostname",
      "macAddress",
      "siteId",
    ]);

    for (const call of getListMock.mock.calls) {
      const listRequest: { query: Record<string, unknown> } = call[0] as {
        query: Record<string, unknown>;
      };
      expect(listRequest.query).not.toHaveProperty("projectId");
    }
  });

  test("the two pages are merged and deduped before the rules run", async () => {
    const seenAt: Date = new Date("2026-09-07T10:00:00Z");
    const sharedRow: NetworkEndpoint = endpointModel({
      _id: "shared",
      macAddress: REGISTER_MAC,
      ipAddress: REGISTER_IP,
      siteId: new ObjectID(SITE_ONE),
      attachedNetworkDeviceId: new ObjectID(SWITCH_A),
      switchName: "Store switch",
      portName: "Gi1/0/7",
      lastSeenAt: seenAt,
    });
    // The same address at another site: what the unscoped IP query drags in.
    const otherBranch: NetworkEndpoint = endpointModel({
      _id: "other-branch",
      macAddress: OTHER_MAC,
      ipAddress: REGISTER_IP,
      siteId: new ObjectID(SITE_TWO),
      attachedNetworkDeviceId: new ObjectID(SWITCH_B),
      switchName: "Other branch switch",
      lastSeenAt: new Date("2026-09-07T11:00:00Z"),
    });

    getItemMock.mockResolvedValue(
      deviceRow({
        hostname: REGISTER_IP,
        macAddress: REGISTER_MAC,
        siteId: new ObjectID(SITE_ONE),
      }),
    );
    getListMock
      .mockResolvedValueOnce(listResult([sharedRow]))
      .mockResolvedValueOnce(listResult([sharedRow, otherBranch]));

    const result: DeviceAttachmentLookupResult =
      await getDeviceAttachment(DEVICE_ID);

    expect(result.attachment).toEqual({
      endpointId: "shared",
      macAddress: REGISTER_MAC,
      ipAddress: REGISTER_IP,
      matchedBy: "mac",
      switchDeviceId: SWITCH_A,
      switchName: "Store switch",
      portName: "Gi1/0/7",
      interfaceIndex: undefined,
      vlanId: undefined,
      lastSeenAt: seenAt,
    });
  });

  test("the row from the device's own tables draws nothing", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({ hostname: REGISTER_IP, siteId: new ObjectID(SITE_ONE) }),
    );
    getListMock.mockResolvedValue(
      listResult([
        endpointModel({
          _id: "self",
          macAddress: REGISTER_MAC,
          ipAddress: REGISTER_IP,
          siteId: new ObjectID(SITE_ONE),
          attachedNetworkDeviceId: DEVICE_ID,
        }),
      ]),
    );

    const result: DeviceAttachmentLookupResult =
      await getDeviceAttachment(DEVICE_ID);

    expect(result.isLookupPossible).toBe(true);
    expect(result.attachment).toBeUndefined();
  });

  test("a device that no longer exists is an error the card can show", async () => {
    getItemMock.mockResolvedValue(null);

    await expect(getDeviceAttachment(DEVICE_ID)).rejects.toThrow(
      "This device no longer exists.",
    );
  });
});

/*
 * The map resolves a row against EVERY device, and refuses a key two
 * devices claim. The card is handed the other devices that could claim
 * the same rows, and must give the map's answer - which is sometimes
 * "nothing", on a device that a device-alone match would have cabled.
 */
describe("chooseDeviceAttachment - the other devices that could claim a row", () => {
  const THIS_DEVICE: string = DEVICE_ID.toString();
  const OTHER_DEVICE: string = "3f1b6b0e-0000-4000-8000-0000000000bb";

  test("a row whose MAC another device declares is that device's, not an address match here", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { id: THIS_DEVICE, hostname: REGISTER_IP, siteId: SITE_ONE },
      [endpointRow({ _id: "e1", macAddress: OTHER_MAC })],
      [{ id: OTHER_DEVICE, hostname: "other.example", macAddress: OTHER_MAC }],
    );

    expect(found).toBeUndefined();
  });

  test("two devices registered at one address in one site: neither is cabled", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { id: THIS_DEVICE, hostname: REGISTER_IP, siteId: SITE_ONE },
      [endpointRow({ _id: "e1", macAddress: OTHER_MAC })],
      [{ id: OTHER_DEVICE, hostname: REGISTER_IP, siteId: SITE_ONE }],
    );

    expect(found).toBeUndefined();
  });

  test("the same address in another site is not a rival", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { id: THIS_DEVICE, hostname: REGISTER_IP, siteId: SITE_ONE },
      [endpointRow({ _id: "e1", macAddress: OTHER_MAC })],
      [{ id: OTHER_DEVICE, hostname: REGISTER_IP, siteId: SITE_TWO }],
    );

    expect(found?.matchedBy).toBe("ip");
  });

  test("two devices declaring one MAC: neither is cabled by it", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { id: THIS_DEVICE, macAddress: REGISTER_MAC },
      [endpointRow({ _id: "e1" })],
      [
        {
          id: OTHER_DEVICE,
          hostname: "other.example",
          macAddress: REGISTER_MAC,
        },
      ],
    );

    expect(found).toBeUndefined();
  });

  test("the device itself in the list of others changes nothing", () => {
    const found: DeviceAttachment | undefined = chooseDeviceAttachment(
      { id: THIS_DEVICE, macAddress: REGISTER_MAC },
      [endpointRow({ _id: "e1" })],
      [{ id: THIS_DEVICE, macAddress: REGISTER_MAC }],
    );

    expect(found?.matchedBy).toBe("mac");
  });
});
