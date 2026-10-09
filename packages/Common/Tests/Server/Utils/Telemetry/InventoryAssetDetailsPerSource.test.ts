import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import {
  buildInventoryEntityModel,
  describeNetworkDevice,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
/*
 * The OTel extraction util's default export is also named InventoryItem; it
 * is imported under a name that says what it does.
 */
import OtelEntityExtractor, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_ASSET_FIELDS,
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  InventoryAssetKind,
  getInventoryAssetDetails,
} from "../../../../Utils/Inventory/InventoryAssetDetails";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4569, end to end per source: what Inventory shows for a machine,
 * from what the machine actually reports, through the code that stores it.
 *
 *   - a network device that answers only its system group (a Meraki MX, the
 *     issue's device) and one that answers ENTITY-MIB in full (a Catalyst),
 *     through the inventory mirror's projection;
 *   - a Windows host and a Linux host, through the OpenTelemetry entity
 *     extractor the collector's resource attributes go through at ingest.
 *
 * Each ends as an Inventory item read by getInventoryAssetDetails - the one
 * read model the item page, the list's columns and their CSV export share.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "f795b9a6-e25d-45bb-9816-f50336a0b12e",
);
const NOW: Date = new Date("2026-10-09T10:00:00.000Z");

type AssetValues = Partial<Record<InventoryAssetField, string | undefined>>;

function valuesOf(details: InventoryAssetDetails | undefined): AssetValues {
  const out: AssetValues = {};
  for (const detail of details?.details || []) {
    out[detail.field] = detail.value;
  }
  return out;
}

// A network device as the mirror stores it, read back as Inventory reads it.
function mirroredItem(device: NetworkDevice): InventoryItem {
  return buildInventoryEntityModel({
    source: {
      entityType: EntityType.NetworkDevice,
      resourceType: "NetworkDevice",
    },
    row: {
      id: DEVICE_ID,
      projectId: PROJECT_ID,
      displayName: device.name || "",
      descriptiveAttributes: describeNetworkDevice(device),
    },
    now: NOW,
  });
}

// A host as ingest stores it from a batch's resource attributes.
function discoveredHost(attributes: EntityAttributes): InventoryItem {
  const host: ExtractedEntity | undefined = OtelEntityExtractor.extractEntities(
    {
      projectId: PROJECT_ID.toString(),
      attributes,
    },
  ).find((entity: ExtractedEntity) => {
    return entity.entityType === EntityType.Host;
  });

  expect(host).toBeDefined();

  const item: InventoryItem = new InventoryItem();
  item.entityType = EntityType.Host;
  item.identifyingAttributes = host!.identifyingAttributes;
  if (host!.descriptiveAttributes) {
    item.descriptiveAttributes = host!.descriptiveAttributes;
  }
  return item;
}

describe("a network device that answers only its system group (a Meraki MX)", () => {
  function merakiMx(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.name = "UN0362WANRTR01";
    device.hostname = "10.241.124.1";
    device.sysName = "UN0362WANRTR01";
    device.sysDescr = "Meraki MX85";
    Object.assign(device, overrides);
    return device;
  }

  test("shows its name, address, maker, model and type, and names every gap", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      mirroredItem(merakiMx()),
    );

    expect(details?.kind).toBe(InventoryAssetKind.NetworkDevice);
    expect(valuesOf(details)).toEqual({
      hostname: "UN0362WANRTR01",
      ipAddress: "10.241.124.1",
      macAddress: undefined,
      serialNumber: undefined,
      manufacturer: "Cisco Meraki",
      model: "MX85",
      firmwareVersion: undefined,
      operatingSystem: undefined,
      osVersion: undefined,
      deviceType: "Firewall",
      location: undefined,
      systemDescription: "Meraki MX85",
    });
    expect(details?.unknownFields).toEqual([
      InventoryAssetField.MacAddress,
      InventoryAssetField.SerialNumber,
      InventoryAssetField.FirmwareVersion,
      InventoryAssetField.OperatingSystem,
      InventoryAssetField.OsVersion,
      InventoryAssetField.Location,
    ]);
  });

  test("with ONLY its sysDescr and address, the address is never its hostname", () => {
    const values: AssetValues = valuesOf(
      getInventoryAssetDetails(
        mirroredItem(merakiMx({ sysName: "", name: "10.241.124.1" })),
      ),
    );

    expect(values.hostname).toBeUndefined();
    expect(values.ipAddress).toBe("10.241.124.1");
    expect(values.manufacturer).toBe("Cisco Meraki");
    expect(values.model).toBe("MX85");
    expect(values.deviceType).toBe("Firewall");
  });

  test("its site, its ARP-learned MAC and an operator's role fill in", () => {
    const site: NetworkSite = new NetworkSite();
    site.name = "Store 0362";
    const role: NetworkDeviceRole = new NetworkDeviceRole();
    role.key = "router";
    role.name = "Router";

    const values: AssetValues = valuesOf(
      getInventoryAssetDetails(
        mirroredItem(
          merakiMx({
            site,
            networkDeviceRole: role,
            macAddress: "e0:55:3d:12:34:56",
            sysLocation: "Back office",
          }),
        ),
      ),
    );

    expect(values.location).toBe("Store 0362 · Back office");
    expect(values.macAddress).toBe("E0-55-3D-12-34-56");
    expect(values.deviceType).toBe("Router");
  });
});

describe("a network device that answers ENTITY-MIB in full (a Catalyst)", () => {
  function catalyst(): NetworkDevice {
    const site: NetworkSite = new NetworkSite();
    site.name = "London DC1";

    const device: NetworkDevice = new NetworkDevice();
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
    device.sysDescr =
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)";
    device.sysLocation = "Hall 2, Rack 14";
    device.site = site;
    return device;
  }

  test("knows every fact", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      mirroredItem(catalyst()),
    );

    expect(valuesOf(details)).toEqual({
      hostname: "core-sw-01",
      ipAddress: "10.20.0.1",
      macAddress: "00-1B-54-C2-7A-01",
      serialNumber: "FOC1840X0AB",
      manufacturer: "Cisco",
      model: "WS-C3850-48P",
      firmwareVersion: "16.12.4",
      operatingSystem: "Cisco IOS XE",
      osVersion: "16.12.04",
      deviceType: "Switch",
      location: "London DC1 · Hall 2, Rack 14",
      dnsName: "core-sw-01.corp.example.com",
      systemDescription: catalyst().sysDescr,
    });
    expect(details?.unknownFields).toEqual([]);
  });
});

/*
 * The issue's Windows host, as the collector's `system` detector reports it
 * with the config users had before #4107 asked for host.mac and os.version.
 */
const WINDOWS_RESOURCE: EntityAttributes = {
  "host.name": "wbqajdebsv001",
  "host.arch": "amd64",
  "host.id": "f39f917e-b361-4d81-9951-e9aae850f939",
  "host.ip": ["10.210.72.109"],
  "os.description": "Windows Server 2022 10.0",
  "os.type": "windows",
};

describe("a Windows host (the issue's)", () => {
  test("shows what the collector reports and names every gap", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      discoveredHost(WINDOWS_RESOURCE),
    );

    expect(details?.kind).toBe(InventoryAssetKind.Host);
    expect(valuesOf(details)).toEqual({
      hostname: "wbqajdebsv001",
      ipAddress: "10.210.72.109",
      macAddress: undefined,
      serialNumber: undefined,
      manufacturer: undefined,
      model: undefined,
      firmwareVersion: undefined,
      operatingSystem: "Windows Server 2022 10.0",
      osVersion: undefined,
      deviceType: "Server",
      location: undefined,
      architecture: "amd64",
    });
  });

  /*
   * The generated config's host.mac and os.version, and the WMI values its
   * Windows script stamps on: every fact the card asks for.
   */
  test("with the current config and the stamped WMI facts, knows every fact", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      discoveredHost({
        ...WINDOWS_RESOURCE,
        "host.mac": ["00-15-5D-01-02-03"],
        "os.version": "10.0.20348",
        "host.serial_number": "CZ12345678",
        "device.manufacturer": "HPE",
        "device.model.name": "ProLiant DL360 Gen10",
        "device.firmware.version": "U32 v2.72",
        "device.location": "Frankfurt DC, Rack B4",
      }),
    );

    expect(valuesOf(details)).toEqual({
      hostname: "wbqajdebsv001",
      ipAddress: "10.210.72.109",
      macAddress: "00-15-5D-01-02-03",
      serialNumber: "CZ12345678",
      manufacturer: "HPE",
      model: "ProLiant DL360 Gen10",
      firmwareVersion: "U32 v2.72",
      operatingSystem: "Windows Server 2022 10.0",
      osVersion: "10.0.20348",
      deviceType: "Server",
      location: "Frankfurt DC, Rack B4",
      architecture: "amd64",
    });
    expect(details?.unknownFields).toEqual([]);
  });
});

describe("a Linux host", () => {
  const LINUX_RESOURCE: EntityAttributes = {
    "host.name": "web-01",
    "host.arch": "arm64",
    "host.id": "ec2-9f3c",
    "host.ip": ["10.0.0.1", "10.0.0.2", "fe80::1"],
    "host.mac": ["02-42-AC-11-00-02", "00-00-00-00-00-00"],
    "os.type": "linux",
    "os.description":
      "Ubuntu 24.04.1 LTS (Noble Numbat) (Linux web-01 6.8.0-1015-aws)",
    "os.version": "24.04",
    "cloud.provider": "aws",
    "cloud.region": "us-east-1",
    "cloud.availability_zone": "us-east-1a",
  };

  test("shows its addresses, OS and cloud zone; the stamped facts are unknown until stamped", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      discoveredHost(LINUX_RESOURCE),
    );

    expect(valuesOf(details)).toEqual({
      hostname: "web-01",
      ipAddress: "10.0.0.1, 10.0.0.2, fe80::1",
      // The all-zero placeholder MAC is left out by the extractor.
      macAddress: "02-42-AC-11-00-02",
      serialNumber: undefined,
      manufacturer: undefined,
      model: undefined,
      firmwareVersion: undefined,
      operatingSystem:
        "Ubuntu 24.04.1 LTS (Noble Numbat) (Linux web-01 6.8.0-1015-aws)",
      osVersion: "24.04",
      deviceType: "Server",
      location: "AWS us-east-1a",
      architecture: "arm64",
    });
  });

  test("accepted alternative spellings fill the same facts", () => {
    const values: AssetValues = valuesOf(
      getInventoryAssetDetails(
        discoveredHost({
          ...LINUX_RESOURCE,
          "device.serial_number": "7XYZ123",
          "host.manufacturer": "Dell Inc.",
          "host.model": "PowerEdge R650",
          "host.bios.version": "1.21.0",
        }),
      ),
    );

    expect(values.serialNumber).toBe("7XYZ123");
    expect(values.manufacturer).toBe("Dell Inc.");
    expect(values.model).toBe("PowerEdge R650");
    expect(values.firmwareVersion).toBe("1.21.0");
  });

  test("a stamped device type and OS name are kept", () => {
    const item: InventoryItem = discoveredHost({
      "host.name": "kvm-07",
      "os.name": "Rocky Linux",
      "device.type": "Hypervisor",
    });

    expect(item.descriptiveAttributes).toEqual({
      "os.name": "Rocky Linux",
      "device.type": "Hypervisor",
    });
    expect(valuesOf(getInventoryAssetDetails(item))).toMatchObject({
      operatingSystem: "Rocky Linux",
      deviceType: "Hypervisor",
    });
  });
});

describe("every source, one vocabulary", () => {
  test("a host and a network device list the same facts, in the same order", () => {
    const fieldsOf: (item: InventoryItem) => Array<InventoryAssetField> = (
      item: InventoryItem,
    ): Array<InventoryAssetField> => {
      return (getInventoryAssetDetails(item)?.details || [])
        .map((detail: InventoryAssetDetail): InventoryAssetField => {
          return detail.field;
        })
        .filter((field: InventoryAssetField): boolean => {
          return INVENTORY_ASSET_FIELDS.includes(field);
        });
    };

    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.0.0.1";

    expect(fieldsOf(mirroredItem(device))).toEqual([...INVENTORY_ASSET_FIELDS]);
    expect(fieldsOf(discoveredHost(WINDOWS_RESOURCE))).toEqual([
      ...INVENTORY_ASSET_FIELDS,
    ]);
  });

  /*
   * What a CMDB sync reads over the API: a fact a host and a switch both
   * know sits under the same key in both rows' descriptiveAttributes (a
   * host's name is its identity, so it sits in identifyingAttributes).
   */
  test("a fact both kinds know is stored under the same key in both", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.20.0.1";
    device.macAddress = "00:1b:54:c2:7a:01";
    device.serialNumber = "FOC1840X0AB";
    device.vendor = "Cisco";
    device.deviceModel = "WS-C3850-48P";
    device.firmwareVersion = "16.12.4";
    device.softwareVersion = "16.12.04";
    device.sysLocation = "Hall 2";

    const switchBag: Record<string, unknown> =
      mirroredItem(device).descriptiveAttributes || {};
    const hostBag: Record<string, unknown> =
      discoveredHost({
        "host.name": "web-01",
        "host.ip": ["10.0.0.1"],
        "host.mac": ["02-42-AC-11-00-02"],
        "host.serial_number": "7XYZ123",
        "device.manufacturer": "Dell Inc.",
        "device.model.name": "PowerEdge R650",
        "device.firmware.version": "1.21.0",
        "os.version": "24.04",
        "device.location": "Hall 3",
      }).descriptiveAttributes || {};

    for (const field of [
      InventoryAssetField.IpAddress,
      InventoryAssetField.MacAddress,
      InventoryAssetField.SerialNumber,
      InventoryAssetField.Manufacturer,
      InventoryAssetField.Model,
      InventoryAssetField.FirmwareVersion,
      InventoryAssetField.OsVersion,
      InventoryAssetField.Location,
    ]) {
      const attributeKey: string = INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
      expect({ field, inSwitch: attributeKey in switchBag }).toEqual({
        field,
        inSwitch: true,
      });
      expect({ field, inHost: attributeKey in hostBag }).toEqual({
        field,
        inHost: true,
      });
    }
  });
});

/*
 * The API: what `/api/inventory-item` hands a caller - a CMDB sync, or the
 * Dashboard itself. The CRUD API serialises the rows it read with
 * BaseModel.toJSONArray (Response.sendEntityArrayResponse) and the
 * Dashboard parses them back with BaseModel.fromJSONArray (ModelAPI), so
 * this runs a mirrored device and a discovered host through exactly that,
 * across a JSON wire, and reads what arrives.
 */
describe("the API hands every caller the same asset facts", () => {
  function overTheWire(item: InventoryItem): JSONObject {
    const sent: JSONArray = BaseModel.toJSONArray([item], InventoryItem);
    return (JSON.parse(JSON.stringify(sent)) as JSONArray)[0] as JSONObject;
  }

  function merakiItem(): InventoryItem {
    const device: NetworkDevice = new NetworkDevice();
    device.name = "UN0362WANRTR01";
    device.hostname = "10.241.124.1";
    device.sysName = "UN0362WANRTR01";
    device.sysDescr = "Meraki MX85";
    const item: InventoryItem = mirroredItem(device);
    item.entityType = EntityType.NetworkDevice;
    return item;
  }

  test("a CMDB sync reads a network device's facts under the documented keys", () => {
    const wire: JSONObject = overTheWire(merakiItem());

    expect(wire["entityType"]).toBe(EntityType.NetworkDevice);
    expect(wire["descriptiveAttributes"]).toMatchObject({
      [INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.Hostname]]:
        "UN0362WANRTR01",
      [INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.IpAddress]]:
        "10.241.124.1",
      [INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.Manufacturer]]:
        "Cisco Meraki",
      [INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.Model]]: "MX85",
      [INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.DeviceType]]:
        "Firewall",
    });
  });

  test("the Dashboard reads the same details from the API as the server stored", () => {
    for (const item of [merakiItem(), discoveredHost(WINDOWS_RESOURCE)]) {
      const parsed: InventoryItem = BaseModel.fromJSONArray(
        [overTheWire(item)],
        InventoryItem,
      )[0]!;

      expect(getInventoryAssetDetails(parsed)).toEqual(
        getInventoryAssetDetails(item),
      );
      expect(getInventoryAssetDetails(parsed)).toBeDefined();
    }
  });

  test("the order jsonb hands the keys back in changes nothing", () => {
    const item: InventoryItem = merakiItem();
    const bag: Record<string, unknown> = item.descriptiveAttributes || {};
    const reordered: JSONObject = {};
    for (const key of Object.keys(bag).sort((a: string, b: string) => {
      return a.length - b.length || (a < b ? -1 : 1);
    })) {
      reordered[key] = bag[key] as string;
    }
    const readBack: InventoryItem = mirroredItem(new NetworkDevice());
    readBack.entityType = EntityType.NetworkDevice;
    readBack.descriptiveAttributes = reordered;

    expect(getInventoryAssetDetails(readBack)).toEqual(
      getInventoryAssetDetails(item),
    );
  });

  /*
   * The CMDB page tells a sync to use an API key with Read Telemetry
   * Service. Every column the asset details read must be readable with it,
   * or the sync's select is refused as a whole.
   */
  test("an API key with Read Telemetry Service may read every column the details read", () => {
    const model: InventoryItem = new InventoryItem();
    for (const column of [
      "entityType",
      "identifyingAttributes",
      "descriptiveAttributes",
    ]) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);
      expect({
        column,
        readable: access?.read?.includes(Permission.ReadTelemetryService),
      }).toEqual({
        column,
        readable: true,
      });
    }
  });
});
