import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import {
  attributeBagsEqual,
  buildInventoryEntityModel,
  describeNetworkDevice,
  ErasedInventorySource,
  INVENTORY_SOURCES,
  inventoryEntityNeedsUpdate,
  InventoryRowProjection,
  toOtelMacAddress,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
/*
 * The OTel extraction util's default export is also named InventoryItem,
 * which would collide with the database model above, so it is imported
 * here under a name that says what it does.
 */
import OtelEntityExtractor, {
  ExtractedEntity,
  MAX_DESCRIPTIVE_ATTRIBUTE_VALUE_LENGTH,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4107 — a mirrored network device's Attributes card showed
 * `oneuptime.resource.id` and `net.device.hostname` and nothing else,
 * although the SNMP poller had long since filled the device's vendor,
 * model, serial number and firmware from ENTITY-MIB, and ARP learning its
 * MAC. The mirror simply never projected them.
 *
 * Also the reconcile's drift check, which compared `JSON.stringify` of a
 * bag built in insertion order against one read back from a `jsonb`
 * column — and jsonb stores keys shortest-first. Any bag with two keys of
 * different lengths counted as drifted on every pass, so the richer
 * network-device bag would have been rewritten for every device every
 * fifteen minutes. The real-Postgres half of that is
 * InventoryMirrorPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "6f2e5c1a-0b3d-4e5f-8a9b-1c2d3e4f5a6b",
);
const NOW: Date = new Date("2026-09-28T10:00:00.000Z");

/** A switch as the poller leaves it after a full ENTITY-MIB walk. */
function polledSwitch(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = DEVICE_ID.toString();
  device.projectId = PROJECT_ID;
  device.name = "core-sw-01";
  device.hostname = "10.20.0.1";
  device.dnsName = "core-sw-01.corp.example.com";
  device.macAddress = "00:1b:54:c2:7a:01";
  device.vendor = "Cisco";
  device.deviceModel = "WS-C3850-48P";
  device.serialNumber = "FOC1840X0AB";
  device.firmwareVersion = "16.12.4";
  device.softwareVersion = "16.12.04";
  device.sysDescr =
    "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)";
  Object.assign(device, overrides);
  return device;
}

/*
 * Postgres' jsonb orders an object's keys by length, then bytewise, and
 * hands them back in that order. Reproduced here so the drift check can be
 * exercised against the shape it actually reads.
 */
function asReadBackFromJsonb(bag: Dictionary<string>): JSONObject {
  const keys: Array<string> = Object.keys(bag).sort((a: string, b: string) => {
    if (a.length !== b.length) {
      return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out: JSONObject = {};
  for (const key of keys) {
    out[key] = bag[key]!;
  }
  return out;
}

describe("describeNetworkDevice (issue #4107)", () => {
  test("a polled switch shows serial, MAC, make, model and firmware", () => {
    expect(describeNetworkDevice(polledSwitch())).toEqual({
      "net.device.hostname": "10.20.0.1",
      "net.device.dns_name": "core-sw-01.corp.example.com",
      "host.mac": "00-1B-54-C2-7A-01",
      "device.manufacturer": "Cisco",
      "device.model.name": "WS-C3850-48P",
      "host.serial_number": "FOC1840X0AB",
      "device.firmware.version": "16.12.4",
      "os.version": "16.12.04",
      "os.description":
        "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    });
  });

  /*
   * What the reporter saw: a device added by IP that has not been walked
   * yet (or answers ping only) has nothing but its hostname. The card must
   * not grow empty rows for facts nobody has collected.
   */
  test("a never-walked device still carries just its hostname", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.20.0.9";
    expect(describeNetworkDevice(device)).toEqual({
      "net.device.hostname": "10.20.0.9",
    });
  });

  test("a device with nothing recorded produces an empty bag", () => {
    expect(describeNetworkDevice(new NetworkDevice())).toEqual({});
  });

  test.each([
    ["dnsName", "net.device.dns_name"],
    ["macAddress", "host.mac"],
    ["vendor", "device.manufacturer"],
    ["deviceModel", "device.model.name"],
    ["serialNumber", "host.serial_number"],
    ["firmwareVersion", "device.firmware.version"],
    ["softwareVersion", "os.version"],
    ["sysDescr", "os.description"],
  ])(
    "an empty or blank %s leaves %s out entirely",
    (column: string, key: string) => {
      for (const blank of ["", "   ", null, undefined]) {
        const bag: Dictionary<string> = describeNetworkDevice(
          polledSwitch({ [column]: blank } as Partial<NetworkDevice>),
        );
        expect(Object.keys(bag)).not.toContain(key);
      }
    },
  );

  test("each column lands under exactly one key", () => {
    const bag: Dictionary<string> = describeNetworkDevice(polledSwitch());
    expect(Object.keys(bag)).toHaveLength(9);
    expect(new Set(Object.values(bag)).size).toBe(9);
  });

  test("values are trimmed", () => {
    expect(
      describeNetworkDevice(polledSwitch({ serialNumber: "  FOC1840X0AB \n" }))[
        "host.serial_number"
      ],
    ).toBe("FOC1840X0AB");
  });

  /*
   * sysDescr and dnsName are LongText columns (the walk keeps 500
   * characters of sysDescr). Everything else on the card is bounded at
   * 256; these must be too, and cut the same way.
   */
  test.each([
    ["sysDescr", "os.description"],
    ["dnsName", "net.device.dns_name"],
  ])(
    "a long %s is bounded like any descriptive value",
    (column: string, key: string) => {
      const long: string = "a".repeat(500);
      expect(
        describeNetworkDevice(
          polledSwitch({ [column]: long } as Partial<NetworkDevice>),
        )[key],
      ).toBe("a".repeat(MAX_DESCRIPTIVE_ATTRIBUTE_VALUE_LENGTH));
    },
  );

  test("a bounded sysDescr never ends in half a surrogate pair", () => {
    const sysDescr: string =
      "x".repeat(MAX_DESCRIPTIVE_ATTRIBUTE_VALUE_LENGTH - 1) +
      "\u{1F5A7}".repeat(10);
    const value: string = describeNetworkDevice(polledSwitch({ sysDescr }))[
      "os.description"
    ]!;
    expect(JSON.stringify(value)).not.toMatch(/\\u[dD][89abAB][0-9a-fA-F]{2}/);
  });

  test("a multi-line sysDescr keeps its inner line breaks", () => {
    const sysDescr: string = "Juniper Networks, Inc. ex4300-48t\nJUNOS 21.4R3";
    expect(
      describeNetworkDevice(polledSwitch({ sysDescr }))["os.description"],
    ).toBe(sysDescr);
  });

  /*
   * The whole point: a CMDB sync reads the same key for the same fact
   * whether the row is a server or a switch. Feed the switch's bag through
   * the HOST extractor — every non-network key must come out unchanged,
   * which proves each is in the host allowlist under the same spelling
   * and in the same format.
   */
  test("shares its keys and formats with a host's Attributes card", () => {
    const bag: Dictionary<string> = describeNetworkDevice(polledSwitch());

    const host: ExtractedEntity | undefined =
      OtelEntityExtractor.extractEntities({
        projectId: PROJECT_ID.toString(),
        attributes: { "host.name": "core-sw-01", ...bag },
      }).find((entity: ExtractedEntity) => {
        return entity.entityType === EntityType.Host;
      });

    const shared: Dictionary<string> = {};
    for (const key of Object.keys(bag)) {
      if (!key.startsWith("net.device.")) {
        shared[key] = bag[key]!;
      }
    }

    expect(Object.keys(shared)).toHaveLength(7);
    expect(host!.descriptiveAttributes).toEqual(shared);
  });
});

describe("toOtelMacAddress", () => {
  test.each([
    ["00:1b:54:c2:7a:01", "00-1B-54-C2-7A-01"],
    ["00-1B-54-C2-7A-01", "00-1B-54-C2-7A-01"],
    ["001b.54c2.7a01", "00-1B-54-C2-7A-01"],
    ["001B54C27A01", "00-1B-54-C2-7A-01"],
    ["0x001b54c27a01", "00-1B-54-C2-7A-01"],
    ["  00:1b:54:c2:7a:01  ", "00-1B-54-C2-7A-01"],
  ])("%p becomes the IEEE RA form %p", (input: string, expected: string) => {
    expect(toOtelMacAddress(input)).toBe(expected);
  });

  test("matches the form the collector's system detector emits", () => {
    // What toIEEERA in resourcedetection's system detector produces.
    expect(toOtelMacAddress("ac:de:48:23:45:67")).toMatch(
      /^([0-9A-F]{2}-){5}[0-9A-F]{2}$/,
    );
  });

  /*
   * The column is free text an operator can type into. A value that is
   * not a 48-bit MAC is still what they recorded; passing it through
   * beats losing it.
   */
  test("a value that is not a 48-bit MAC is passed through", () => {
    expect(toOtelMacAddress("see rack label")).toBe("see rack label");
    expect(toOtelMacAddress("00:1b:54:ff:fe:c2:7a:01")).toBe(
      "00:1b:54:ff:fe:c2:7a:01",
    );
  });

  test.each([undefined, null, ""])("%p is no MAC at all", (value: unknown) => {
    expect(toOtelMacAddress(value as string | undefined)).toBeUndefined();
  });
});

describe("attributeBagsEqual", () => {
  test("key order does not matter", () => {
    expect(
      attributeBagsEqual(
        { "device.model.name": "WS-C3850-48P", "os.version": "16.12.04" },
        { "os.version": "16.12.04", "device.model.name": "WS-C3850-48P" },
      ),
    ).toBe(true);
  });

  test("a changed value is a difference", () => {
    expect(
      attributeBagsEqual(
        { "host.serial_number": "FOC1840X0AB" },
        { "host.serial_number": "FOC1840X0AC" },
      ),
    ).toBe(false);
  });

  test("a removed key is a difference, in either direction", () => {
    const full: JSONObject = { a: "1", b: "2" };
    const partial: JSONObject = { a: "1" };
    expect(attributeBagsEqual(full, partial)).toBe(false);
    expect(attributeBagsEqual(partial, full)).toBe(false);
  });

  test("same size, different keys is a difference", () => {
    expect(attributeBagsEqual({ a: "1" }, { b: "1" })).toBe(false);
  });

  /*
   * `hasOwnProperty`, not `in`: a key inherited from Object.prototype
   * must not make two different bags compare equal.
   */
  test("an inherited property name is not mistaken for a present key", () => {
    expect(attributeBagsEqual({ toString: "x" }, { other: "x" })).toBe(false);
  });

  test("missing and empty bags are all the same nothing", () => {
    expect(attributeBagsEqual(undefined, {})).toBe(true);
    expect(attributeBagsEqual(null, undefined)).toBe(true);
    expect(attributeBagsEqual({}, null)).toBe(true);
    expect(attributeBagsEqual({ a: "1" }, null)).toBe(false);
  });

  test("a value's type is part of it", () => {
    expect(attributeBagsEqual({ a: "1" }, { a: 1 })).toBe(false);
  });
});

describe("the reconcile's drift check against a jsonb read-back", () => {
  function mirrored(device: NetworkDevice): InventoryItem {
    const row: InventoryRowProjection = {
      id: DEVICE_ID,
      projectId: PROJECT_ID,
      displayName: device.name || "",
      descriptiveAttributes: describeNetworkDevice(device),
    };
    return buildInventoryEntityModel({
      source: {
        entityType: EntityType.NetworkDevice,
        resourceType: "NetworkDevice",
      },
      row,
      now: NOW,
    });
  }

  function storedAndReadBack(device: NetworkDevice): InventoryItem {
    const stored: InventoryItem = mirrored(device);
    stored.descriptiveAttributes = asReadBackFromJsonb(
      stored.descriptiveAttributes as Dictionary<string>,
    );
    return stored;
  }

  test("the fixture really is reordered by the round trip", () => {
    // Guards the tests below from passing vacuously.
    expect(
      Object.keys(storedAndReadBack(polledSwitch()).descriptiveAttributes!),
    ).not.toEqual(Object.keys(mirrored(polledSwitch()).descriptiveAttributes!));
  });

  test("an unchanged device needs no write after the jsonb round trip", () => {
    expect(
      inventoryEntityNeedsUpdate({
        existing: storedAndReadBack(polledSwitch()),
        desired: mirrored(polledSwitch()),
      }),
    ).toBe(false);
  });

  test("a new serial number (chassis swap) is written", () => {
    expect(
      inventoryEntityNeedsUpdate({
        existing: storedAndReadBack(polledSwitch()),
        desired: mirrored(polledSwitch({ serialNumber: "FOC2231Y0ZZ" })),
      }),
    ).toBe(true);
  });

  test("a firmware upgrade is written", () => {
    expect(
      inventoryEntityNeedsUpdate({
        existing: storedAndReadBack(polledSwitch()),
        desired: mirrored(polledSwitch({ firmwareVersion: "17.3.1" })),
      }),
    ).toBe(true);
  });

  /*
   * The mirror replaces the bag wholesale, so a fact that stops being
   * known — a MAC cleared by the operator — must also count as drift, or
   * the stale value would stay on the card forever.
   */
  test("a cleared MAC is written, so the stale value goes", () => {
    expect(
      inventoryEntityNeedsUpdate({
        existing: storedAndReadBack(polledSwitch()),
        desired: mirrored(polledSwitch({ macAddress: "" })),
      }),
    ).toBe(true);
  });

  test("a device first walked after it was mirrored is written", () => {
    const neverWalked: NetworkDevice = new NetworkDevice();
    neverWalked.name = "core-sw-01";
    neverWalked.hostname = "10.20.0.1";
    expect(
      inventoryEntityNeedsUpdate({
        existing: storedAndReadBack(neverWalked),
        desired: mirrored(polledSwitch()),
      }),
    ).toBe(true);
  });

  /*
   * Not only network devices: every multi-key mirror was paying this. A
   * cloud resource's four keys are of four different lengths.
   */
  test("a cloud resource's bag is steady after the round trip too", () => {
    const bag: Dictionary<string> = {
      "cloud.resource.id": "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
      "cloud.provider": "aws",
      "cloud.region": "us-east-1",
      "cloud.account.id": "123456789012",
    };
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "i-0abc";
    existing.resourceType = "CloudResource";
    existing.resourceId = DEVICE_ID;
    existing.descriptiveAttributes = asReadBackFromJsonb(bag);

    const desired: InventoryItem = new InventoryItem();
    desired.displayName = "i-0abc";
    desired.resourceType = "CloudResource";
    desired.resourceId = DEVICE_ID;
    desired.descriptiveAttributes = bag as JSONObject;

    expect(JSON.stringify(existing.descriptiveAttributes)).not.toBe(
      JSON.stringify(desired.descriptiveAttributes),
    );
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(false);
  });
});

/*
 * `describe` reads columns off the row the source's `findBy` returned, and
 * findBy only fills what `select` asked for. A column read but not
 * selected is undefined in production — the attribute silently never
 * appears — while a test that hands `describe` a fully built model passes.
 * So run the real source against a stub that honours `select`.
 */
describe("the NetworkDevice source selects every column it projects", () => {
  interface StubbableService {
    findBy?: (data: {
      select: Dictionary<boolean>;
    }) => Promise<Array<NetworkDevice>>;
  }

  function networkSource(): ErasedInventorySource {
    const source: ErasedInventorySource | undefined = INVENTORY_SOURCES.find(
      (candidate: ErasedInventorySource) => {
        return candidate.resourceType === "NetworkDevice";
      },
    );
    expect(source).toBeDefined();
    return source!;
  }

  async function fetchThroughSelect(
    full: NetworkDevice,
  ): Promise<Array<InventoryRowProjection>> {
    const service: StubbableService =
      NetworkDeviceService as unknown as StubbableService;

    service.findBy = (call: {
      select: Dictionary<boolean>;
    }): Promise<Array<NetworkDevice>> => {
      const row: NetworkDevice = new NetworkDevice();
      const fullRecord: Record<string, unknown> = full as unknown as Record<
        string,
        unknown
      >;
      const rowRecord: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      for (const column of Object.keys(call.select)) {
        if (call.select[column]) {
          rowRecord[column] = fullRecord[column];
        }
      }
      return Promise.resolve([row]);
    };

    try {
      return await networkSource().fetchPage({ skip: 0, limit: 1 });
    } finally {
      delete service.findBy;
    }
  }

  test("the projection through select equals the projection of the full row", async () => {
    const full: NetworkDevice = polledSwitch();
    const rows: Array<InventoryRowProjection> = await fetchThroughSelect(full);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.descriptiveAttributes).toEqual(describeNetworkDevice(full));
    expect(Object.keys(rows[0]!.descriptiveAttributes)).toHaveLength(9);
  });

  test("the projection carries the row's identity and name", async () => {
    const rows: Array<InventoryRowProjection> =
      await fetchThroughSelect(polledSwitch());

    expect(rows[0]!.id.toString()).toBe(DEVICE_ID.toString());
    expect(rows[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(rows[0]!.displayName).toBe("core-sw-01");
  });

  test("the query is still the archive filter alone", async () => {
    const service: {
      findBy?: (data: { query: JSONObject }) => Promise<Array<never>>;
    } = NetworkDeviceService as unknown as {
      findBy?: (data: { query: JSONObject }) => Promise<Array<never>>;
    };
    const seen: Array<JSONObject> = [];
    service.findBy = (call: { query: JSONObject }): Promise<Array<never>> => {
      seen.push(call.query);
      return Promise.resolve([]);
    };
    try {
      await networkSource().fetchPage({ skip: 0, limit: 1 });
    } finally {
      delete service.findBy;
    }
    expect(seen).toEqual([{ isArchived: false }]);
  });
});
