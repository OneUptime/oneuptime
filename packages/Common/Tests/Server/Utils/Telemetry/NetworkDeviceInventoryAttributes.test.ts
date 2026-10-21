import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import NetworkDeviceRoleService from "../../../../Server/Services/NetworkDeviceRoleService";
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
import logger from "../../../../Server/Utils/Logger";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_POLLED_ADDRESS_ATTRIBUTE_KEY,
  INVENTORY_SITE_ATTRIBUTE_KEY,
  InventoryAssetField,
} from "../../../../Utils/Inventory/InventoryAssetDetails";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Issue #4107 — a mirrored network device's Attributes card showed
 * `oneuptime.resource.id` and `net.device.hostname` and nothing else,
 * although the SNMP poller had long since filled the device's vendor,
 * model, serial number and firmware from ENTITY-MIB, and ARP learning its
 * MAC. The mirror simply never projected them.
 *
 * Issue #4569 — the record still showed an IP address under
 * `net.device.hostname` as the only name a Meraki MX had, and nothing about
 * what it was, although its sysName, sysDescr and role said. The mirror now
 * writes every asset fact a host has, under the host's keys.
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

const CISCO_SYS_DESCR: string =
  "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)";

function site(name: string): NetworkSite {
  const networkSite: NetworkSite = new NetworkSite();
  networkSite.name = name;
  return networkSite;
}

function role(key: string, name: string): NetworkDeviceRole {
  const deviceRole: NetworkDeviceRole = new NetworkDeviceRole();
  deviceRole.key = key;
  deviceRole.name = name;
  return deviceRole;
}

/** A switch as the poller leaves it after a full ENTITY-MIB walk. */
function polledSwitch(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = DEVICE_ID.toString();
  device.projectId = PROJECT_ID;
  device.name = "core-sw-01";
  device.hostname = "10.20.0.1";
  device.dnsName = "core-sw-01.corp.example.com";
  device.sysName = "core-sw-01";
  device.macAddress = "00:1b:54:c2:7a:01";
  device.vendor = "Cisco";
  device.deviceModel = "WS-C3850-48P";
  device.serialNumber = "FOC1840X0AB";
  device.firmwareVersion = "16.12.4";
  device.softwareVersion = "16.12.04";
  device.sysObjectId = "1.3.6.1.4.1.9.1.1745";
  device.sysDescr = CISCO_SYS_DESCR;
  device.sysLocation = "Hall 2, Rack 14";
  device.site = site("London DC1");
  Object.assign(device, overrides);
  return device;
}

/*
 * The issue's device: a locally-polled Meraki MX answers the system group
 * and nothing from ENTITY-MIB.
 */
function merakiMx(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = DEVICE_ID.toString();
  device.projectId = PROJECT_ID;
  device.name = "UN0362WANRTR01";
  device.hostname = "10.241.124.1";
  device.sysName = "UN0362WANRTR01";
  device.sysDescr = "Meraki MX85";
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

const key: (field: InventoryAssetField) => string = (
  field: InventoryAssetField,
): string => {
  return INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
};

describe("describeNetworkDevice (issues #4107, #4569)", () => {
  test("a polled switch carries every asset fact, under the keys a host uses", () => {
    expect(describeNetworkDevice(polledSwitch())).toEqual({
      "net.device.hostname": "10.20.0.1",
      "net.device.dns_name": "core-sw-01.corp.example.com",
      "host.name": "core-sw-01",
      "host.ip": "10.20.0.1",
      "host.mac": "00-1B-54-C2-7A-01",
      "device.manufacturer": "Cisco",
      "device.model.name": "WS-C3850-48P",
      "host.serial_number": "FOC1840X0AB",
      "device.firmware.version": "16.12.4",
      "os.name": "Cisco IOS XE",
      "os.version": "16.12.04",
      "os.description": CISCO_SYS_DESCR,
      "device.type": "Switch",
      "device.location": "Hall 2, Rack 14",
      "oneuptime.site.name": "London DC1",
    });
  });

  /*
   * What the reporter saw was `net.device.hostname = 10.241.124.1` and
   * `os.description = Meraki MX85`, nothing else.
   */
  test("the issue's Meraki MX: its name, address, maker, model and type", () => {
    expect(describeNetworkDevice(merakiMx())).toEqual({
      "net.device.hostname": "10.241.124.1",
      "host.name": "UN0362WANRTR01",
      "host.ip": "10.241.124.1",
      "device.manufacturer": "Cisco Meraki",
      "device.model.name": "MX85",
      "os.description": "Meraki MX85",
      "device.type": "Firewall",
    });
  });

  test("the IP address is never written as the hostname", () => {
    const bag: Dictionary<string> = describeNetworkDevice(
      merakiMx({ sysName: "10.241.124.1", name: "10.241.124.1" }),
    );
    expect(bag[key(InventoryAssetField.Hostname)]).toBeUndefined();
    expect(bag[key(InventoryAssetField.IpAddress)]).toBe("10.241.124.1");
  });

  /*
   * A device added by IP that has not been walked yet (or answers ping
   * only) has nothing but its address. The address is written as the
   * address, and nothing else is invented.
   */
  test("a never-walked device carries its address, as an address", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.20.0.9";
    expect(describeNetworkDevice(device)).toEqual({
      "net.device.hostname": "10.20.0.9",
      "host.ip": "10.20.0.9",
    });
  });

  test("a device polled by DNS name has that name, and no IP address", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "core-sw-02.corp.example.com";
    expect(describeNetworkDevice(device)).toEqual({
      "net.device.hostname": "core-sw-02.corp.example.com",
      "net.device.dns_name": "core-sw-02.corp.example.com",
      "host.name": "core-sw-02.corp.example.com",
      // The naming convention ("-sw-") is all the map has to go on, too.
      "device.type": "Switch",
    });
  });

  test("a device with nothing recorded produces an empty bag", () => {
    expect(describeNetworkDevice(new NetworkDevice())).toEqual({});
  });

  /*
   * Facts with a single source: blanking the column takes the key away.
   * (The Cisco sysDescr names no model and no firmware, so it cannot stand
   * in for either.)
   */
  test.each([
    ["macAddress", "host.mac"],
    ["deviceModel", "device.model.name"],
    ["serialNumber", "host.serial_number"],
    ["firmwareVersion", "device.firmware.version"],
    ["sysDescr", "os.description"],
    ["sysLocation", "device.location"],
  ])(
    "an empty or blank %s leaves %s out entirely",
    (column: string, attributeKey: string) => {
      for (const blank of ["", "   ", null, undefined]) {
        const bag: Dictionary<string> = describeNetworkDevice(
          polledSwitch({ [column]: blank } as Partial<NetworkDevice>),
        );
        expect(Object.keys(bag)).not.toContain(attributeKey);
      }
    },
  );

  test("a blank DNS name on a device polled by IP leaves the DNS name out", () => {
    const bag: Dictionary<string> = describeNetworkDevice(
      polledSwitch({ dnsName: "" }),
    );
    expect(Object.keys(bag)).not.toContain("net.device.dns_name");
    // The sysName still names it.
    expect(bag["host.name"]).toBe("core-sw-01");
  });

  test("a blank vendor falls back to the maker the sysDescr, then the sysObjectID, names", () => {
    expect(
      describeNetworkDevice(polledSwitch({ vendor: "", sysObjectId: "" }))[
        "device.manufacturer"
      ],
    ).toBe("Cisco");
    expect(
      describeNetworkDevice(
        polledSwitch({ vendor: "", sysDescr: "Main closet switch" }),
      )["device.manufacturer"],
    ).toBe("Cisco");
    expect(
      Object.keys(
        describeNetworkDevice(
          polledSwitch({
            vendor: "",
            sysObjectId: "",
            sysDescr: "Main closet switch",
          }),
        ),
      ),
    ).not.toContain("device.manufacturer");
  });

  test("a blank software version falls back to the release the sysDescr names", () => {
    expect(
      describeNetworkDevice(polledSwitch({ softwareVersion: "" }))[
        "os.version"
      ],
    ).toBe("16.12.4");
    expect(
      Object.keys(
        describeNetworkDevice(
          polledSwitch({ softwareVersion: "", sysDescr: "" }),
        ),
      ),
    ).not.toContain("os.version");
  });

  test("an operator's role names the device type", () => {
    expect(
      describeNetworkDevice(
        merakiMx({ networkDeviceRole: role("router", "Router") }),
      )["device.type"],
    ).toBe("Router");
  });

  test("the project's name for the classified role names the device type", () => {
    expect(
      describeNetworkDevice(merakiMx(), {
        roles: [{ key: "firewall", name: "Security Appliance" }],
      })["device.type"],
    ).toBe("Security Appliance");
  });

  test("each fact lands under its documented key", () => {
    const bag: Dictionary<string> = describeNetworkDevice(polledSwitch());

    expect(bag[key(InventoryAssetField.Hostname)]).toBe("core-sw-01");
    expect(bag[key(InventoryAssetField.IpAddress)]).toBe("10.20.0.1");
    expect(bag[key(InventoryAssetField.MacAddress)]).toBe("00-1B-54-C2-7A-01");
    expect(bag[key(InventoryAssetField.SerialNumber)]).toBe("FOC1840X0AB");
    expect(bag[key(InventoryAssetField.Manufacturer)]).toBe("Cisco");
    expect(bag[key(InventoryAssetField.Model)]).toBe("WS-C3850-48P");
    expect(bag[key(InventoryAssetField.FirmwareVersion)]).toBe("16.12.4");
    expect(bag[key(InventoryAssetField.OperatingSystem)]).toBe("Cisco IOS XE");
    expect(bag[key(InventoryAssetField.OsVersion)]).toBe("16.12.04");
    expect(bag[key(InventoryAssetField.DeviceType)]).toBe("Switch");
    expect(bag[key(InventoryAssetField.Location)]).toBe("Hall 2, Rack 14");
    expect(bag[key(InventoryAssetField.DnsName)]).toBe(
      "core-sw-01.corp.example.com",
    );
    expect(bag[key(InventoryAssetField.SystemDescription)]).toBe(
      CISCO_SYS_DESCR,
    );
    expect(bag[INVENTORY_SITE_ATTRIBUTE_KEY]).toBe("London DC1");
    expect(bag[INVENTORY_POLLED_ADDRESS_ATTRIBUTE_KEY]).toBe("10.20.0.1");
    // And nothing else.
    expect(Object.keys(bag)).toHaveLength(15);
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
    (column: string, attributeKey: string) => {
      const long: string = "a".repeat(500);
      expect(
        describeNetworkDevice(
          polledSwitch({ [column]: long } as Partial<NetworkDevice>),
        )[attributeKey],
      ).toBe("a".repeat(MAX_DESCRIPTIVE_ATTRIBUTE_VALUE_LENGTH));
    },
  );

  test("every value in the bag is bounded", () => {
    const long: string = "x".repeat(1000);
    const bag: Dictionary<string> = describeNetworkDevice(
      polledSwitch({
        vendor: long,
        deviceModel: long,
        serialNumber: long,
        firmwareVersion: long,
        softwareVersion: long,
        sysLocation: long,
        site: site(long),
        networkDeviceRole: role("custom", long),
      }),
    );
    for (const value of Object.values(bag)) {
      expect(value.length).toBeLessThanOrEqual(
        MAX_DESCRIPTIVE_ATTRIBUTE_VALUE_LENGTH,
      );
    }
  });

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
   * the HOST extractor — every key a host keeps must come out unchanged,
   * which proves each is in the host allowlist under the same spelling and
   * in the same format. The keys a host cannot have are the network ones,
   * its name (a host's name is its identity, not a description) and the
   * OneUptime site.
   */
  test("shares its keys and formats with a host's attributes", () => {
    const bag: Dictionary<string> = describeNetworkDevice(polledSwitch());

    const host: ExtractedEntity | undefined =
      OtelEntityExtractor.extractEntities({
        projectId: PROJECT_ID.toString(),
        attributes: { ...bag },
      }).find((entity: ExtractedEntity) => {
        return entity.entityType === EntityType.Host;
      });

    const notHostDescriptions: Array<string> = [
      "host.name",
      INVENTORY_SITE_ATTRIBUTE_KEY,
    ];
    const shared: Dictionary<string> = {};
    for (const attributeKey of Object.keys(bag)) {
      if (
        !attributeKey.startsWith("net.device.") &&
        !notHostDescriptions.includes(attributeKey)
      ) {
        shared[attributeKey] = bag[attributeKey]!;
      }
    }

    expect(Object.keys(shared)).toHaveLength(11);
    expect(host!.identifyingAttributes).toEqual({ "host.name": "core-sw-01" });
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
 * So run the real source against a stub that honours `select`, relations
 * included (a site's name, a role's key and name).
 */
describe("the NetworkDevice source selects every column it projects", () => {
  type SelectValue = boolean | Dictionary<boolean>;

  interface StubbableService {
    findBy?: (data: {
      query: JSONObject;
      select: Dictionary<SelectValue>;
    }) => Promise<Array<unknown>>;
  }

  const deviceService: StubbableService =
    NetworkDeviceService as unknown as StubbableService;
  const roleService: StubbableService =
    NetworkDeviceRoleService as unknown as StubbableService;

  afterEach(() => {
    delete deviceService.findBy;
    delete roleService.findBy;
    jest.restoreAllMocks();
  });

  function networkSource(): ErasedInventorySource {
    const source: ErasedInventorySource | undefined = INVENTORY_SOURCES.find(
      (candidate: ErasedInventorySource) => {
        return candidate.resourceType === "NetworkDevice";
      },
    );
    expect(source).toBeDefined();
    return source!;
  }

  // A copy of `full` holding only what `select` names, as findBy returns it.
  function selectFrom<T>(full: T, select: Dictionary<SelectValue>): T {
    const fullRecord: Record<string, unknown> = full as unknown as Record<
      string,
      unknown
    >;
    const row: Record<string, unknown> = {};

    for (const column of Object.keys(select)) {
      const wanted: SelectValue | undefined = select[column];
      const value: unknown = fullRecord[column];

      if (!wanted) {
        continue;
      }

      if (typeof wanted === "object") {
        if (value && typeof value === "object") {
          const related: Record<string, unknown> = {};
          for (const relatedColumn of Object.keys(wanted)) {
            if (wanted[relatedColumn]) {
              related[relatedColumn] = (value as Record<string, unknown>)[
                relatedColumn
              ];
            }
          }
          row[column] = related;
        }
        continue;
      }

      row[column] = value;
    }

    return Object.assign(
      Object.create(Object.getPrototypeOf(full)) as Record<string, unknown>,
      row,
    ) as T;
  }

  function stubRoles(roles: Array<NetworkDeviceRole>): Array<JSONObject> {
    const queries: Array<JSONObject> = [];
    roleService.findBy = (call: {
      query: JSONObject;
      select: Dictionary<SelectValue>;
    }): Promise<Array<unknown>> => {
      queries.push(call.query);
      return Promise.resolve(
        roles.map((deviceRole: NetworkDeviceRole) => {
          return selectFrom(deviceRole, call.select);
        }),
      );
    };
    return queries;
  }

  async function fetchThroughSelect(
    full: NetworkDevice,
  ): Promise<Array<InventoryRowProjection>> {
    deviceService.findBy = (call: {
      query: JSONObject;
      select: Dictionary<SelectValue>;
    }): Promise<Array<unknown>> => {
      return Promise.resolve([selectFrom(full, call.select)]);
    };

    return networkSource().fetchPage({ skip: 0, limit: 1 });
  }

  test("the projection through select equals the projection of the full row", async () => {
    stubRoles([]);
    const full: NetworkDevice = polledSwitch({
      networkDeviceRole: role("switch", "Access Switch"),
    });
    const rows: Array<InventoryRowProjection> = await fetchThroughSelect(full);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.descriptiveAttributes).toEqual(describeNetworkDevice(full));
    expect(Object.keys(rows[0]!.descriptiveAttributes)).toHaveLength(15);
    // The relations made it through select: the site, and the role's name.
    expect(rows[0]!.descriptiveAttributes["oneuptime.site.name"]).toBe(
      "London DC1",
    );
    expect(rows[0]!.descriptiveAttributes["device.type"]).toBe("Access Switch");
  });

  test("the naming facts discovery recorded make it through select", async () => {
    stubRoles([]);
    const rows: Array<InventoryRowProjection> = await fetchThroughSelect(
      merakiMx({
        sysName: "",
        discoveredName: "UN0362WANRTR01",
        discoveredNameSource: "netbios-name",
      }),
    );

    expect(rows[0]!.descriptiveAttributes["host.name"]).toBe("UN0362WANRTR01");
  });

  test("the classifier's role is named as the device's project names it", async () => {
    const queries: Array<JSONObject> = stubRoles([
      Object.assign(role("firewall", "Security Appliance"), {
        projectId: PROJECT_ID,
      }),
    ]);

    const rows: Array<InventoryRowProjection> =
      await fetchThroughSelect(merakiMx());

    expect(rows[0]!.descriptiveAttributes["device.type"]).toBe(
      "Security Appliance",
    );
    // One read for the page, for the projects on it.
    expect(queries).toHaveLength(1);
    expect(JSON.stringify(queries[0])).toContain(PROJECT_ID.toString());
  });

  test("another project's role names never reach this device", async () => {
    stubRoles([
      Object.assign(role("firewall", "Their Firewall"), {
        projectId: ObjectID.generate(),
      }),
    ]);

    const rows: Array<InventoryRowProjection> =
      await fetchThroughSelect(merakiMx());

    expect(rows[0]!.descriptiveAttributes["device.type"]).toBe("Firewall");
  });

  /*
   * The roles only name the type. A failed read must not stop the page's
   * devices being mirrored - they are typed by the built-in names instead.
   */
  test("a failed role read falls back to the built-in names", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
    roleService.findBy = (): Promise<Array<unknown>> => {
      return Promise.reject(new Error("role table unavailable"));
    };

    const rows: Array<InventoryRowProjection> =
      await fetchThroughSelect(merakiMx());

    expect(rows[0]!.descriptiveAttributes["device.type"]).toBe("Firewall");
    expect(logger.warn).toHaveBeenCalled();
  });

  test("the projection carries the row's identity and name", async () => {
    stubRoles([]);
    const rows: Array<InventoryRowProjection> =
      await fetchThroughSelect(polledSwitch());

    expect(rows[0]!.id.toString()).toBe(DEVICE_ID.toString());
    expect(rows[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(rows[0]!.displayName).toBe("core-sw-01");
  });

  test("the query is still the archive filter alone, and an empty page reads no roles", async () => {
    const roleQueries: Array<JSONObject> = stubRoles([]);
    const seen: Array<JSONObject> = [];
    deviceService.findBy = (call: {
      query: JSONObject;
    }): Promise<Array<unknown>> => {
      seen.push(call.query);
      return Promise.resolve([]);
    };

    await networkSource().fetchPage({ skip: 0, limit: 1 });

    expect(seen).toEqual([{ isArchived: false }]);
    expect(roleQueries).toEqual([]);
  });
});
