import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_ASSET_FIELDS,
  INVENTORY_ASSET_OPTIONAL_FIELDS,
  INVENTORY_SITE_ATTRIBUTE_KEY,
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  InventoryAssetKind,
  getCloudPlacement,
  getInventoryAssetDetails,
  getInventoryAssetKind,
  getInventoryAssetValue,
  getOperatingSystemName,
} from "../../../Utils/Inventory/InventoryAssetDetails";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4569: Inventory showed a host and a network device in two different
 * vocabularies, and a fact nobody had reported was simply not there. These
 * pin the one set of asset details both are read into: the same facts, in
 * the same order, from the same keys, with an unknown fact present and
 * undefined rather than missing.
 */

function valuesOf(
  details: InventoryAssetDetails | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const detail of details?.details || []) {
    out[detail.field] = detail.value;
  }
  return out;
}

function fieldsOf(
  details: InventoryAssetDetails | undefined,
): Array<InventoryAssetField> {
  return (details?.details || []).map(
    (detail: InventoryAssetDetail): InventoryAssetField => {
      return detail.field;
    },
  );
}

// The issue's Windows host, as its Inventory item stores it today.
const WINDOWS_HOST: {
  entityType: EntityType;
  identifyingAttributes: Record<string, string>;
  descriptiveAttributes: Record<string, string>;
} = {
  entityType: EntityType.Host,
  identifyingAttributes: { "host.name": "wbqajdebsv001" },
  descriptiveAttributes: {
    "host.arch": "amd64",
    "host.id": "f39f917e-b361-4d81-9951-e9aae850f939",
    "host.ip": "10.210.72.109",
    "os.description": "Windows Server 2022 10.0",
    "os.type": "windows",
  },
};

describe("getInventoryAssetDetails (issue #4569)", () => {
  test("the issue's Windows host: what is known, and every gap named", () => {
    const details: InventoryAssetDetails | undefined =
      getInventoryAssetDetails(WINDOWS_HOST);

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
    expect(details?.unknownFields).toEqual([
      InventoryAssetField.MacAddress,
      InventoryAssetField.SerialNumber,
      InventoryAssetField.Manufacturer,
      InventoryAssetField.Model,
      InventoryAssetField.FirmwareVersion,
      InventoryAssetField.OsVersion,
      InventoryAssetField.Location,
    ]);
  });

  test("a fully stamped Linux host knows every fact", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.Host,
        identifyingAttributes: { "host.name": "web-01" },
        descriptiveAttributes: {
          "host.ip": "10.0.0.1, 10.0.0.2",
          "host.mac": "02-42-AC-11-00-02, 00-15-5D-01-02-03",
          "host.arch": "amd64",
          "host.serial_number": "7XYZ123",
          "device.manufacturer": "Dell Inc.",
          "device.model.name": "PowerEdge R650",
          "device.firmware.version": "1.21.0",
          "os.type": "linux",
          "os.description": "Ubuntu 24.04.1 LTS (Noble Numbat)",
          "os.version": "24.04",
          "cloud.provider": "aws",
          "cloud.region": "us-east-1",
          "cloud.availability_zone": "us-east-1a",
        },
      },
    );

    expect(valuesOf(details)).toEqual({
      hostname: "web-01",
      ipAddress: "10.0.0.1, 10.0.0.2",
      macAddress: "02-42-AC-11-00-02, 00-15-5D-01-02-03",
      serialNumber: "7XYZ123",
      manufacturer: "Dell Inc.",
      model: "PowerEdge R650",
      firmwareVersion: "1.21.0",
      operatingSystem: "Ubuntu 24.04.1 LTS (Noble Numbat)",
      osVersion: "24.04",
      deviceType: "Server",
      location: "AWS us-east-1a",
      architecture: "amd64",
    });
    expect(details?.unknownFields).toEqual([]);
  });

  test("the issue's Meraki MX, as the mirror now writes it", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.NetworkDevice,
        identifyingAttributes: {
          "oneuptime.resource.id": "f795b9a6-e25d-45bb-9816-f50336a0b12e",
        },
        descriptiveAttributes: {
          "net.device.hostname": "10.241.124.1",
          "host.name": "UN0362WANRTR01",
          "host.ip": "10.241.124.1",
          "device.manufacturer": "Cisco Meraki",
          "device.model.name": "MX85",
          "os.description": "Meraki MX85",
          "device.type": "Firewall",
          [INVENTORY_SITE_ATTRIBUTE_KEY]: "Store 0362",
        },
      },
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
      location: "Store 0362",
      systemDescription: "Meraki MX85",
    });
  });

  /*
   * The record the customer saw before the fix: an IP address under
   * net.device.hostname and nothing else. The address is read as what it is.
   */
  test("an old mirrored bag never shows its polled address as the hostname", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.NetworkDevice,
        descriptiveAttributes: {
          "net.device.hostname": "10.241.124.1",
          "os.description": "Meraki MX85",
        },
      },
    );

    expect(valuesOf(details)["hostname"]).toBeUndefined();
  });

  test("a network device's location is its site and the location it reports", () => {
    expect(
      getInventoryAssetValue(
        {
          entityType: EntityType.NetworkDevice,
          descriptiveAttributes: {
            [INVENTORY_SITE_ATTRIBUTE_KEY]: "London DC1",
            "device.location": "Hall 2, Rack 14",
          },
        },
        InventoryAssetField.Location,
      ),
    ).toBe("London DC1 · Hall 2, Rack 14");
  });

  test("a site and a location that say the same thing say it once", () => {
    expect(
      getInventoryAssetValue(
        {
          entityType: EntityType.NetworkDevice,
          descriptiveAttributes: {
            [INVENTORY_SITE_ATTRIBUTE_KEY]: "Store 0362",
            "device.location": "Store 0362",
          },
        },
        InventoryAssetField.Location,
      ),
    ).toBe("Store 0362");
  });

  test("a network device's OS is the one its sysDescr names, never the raw sysDescr", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.NetworkDevice,
        descriptiveAttributes: {
          "os.name": "Cisco IOS",
          "os.description":
            "Cisco IOS Software, C2960 Software, Version 15.0(2)SE11",
        },
      },
    );

    expect(valuesOf(details)["operatingSystem"]).toBe("Cisco IOS");
    expect(valuesOf(details)["systemDescription"]).toBe(
      "Cisco IOS Software, C2960 Software, Version 15.0(2)SE11",
    );
  });

  test("a network device is never classified on the client: its type is what the mirror wrote", () => {
    expect(
      getInventoryAssetValue(
        {
          entityType: EntityType.NetworkDevice,
          descriptiveAttributes: {
            "os.description": "Linux fw01 5.10.0 x86_64",
          },
        },
        InventoryAssetField.DeviceType,
      ),
    ).toBeUndefined();
  });

  test("every asset lists the same facts in the same order, then the optional ones it knows", () => {
    const host: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.Host,
      identifyingAttributes: { "host.name": "web-01" },
    });
    const device: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.NetworkDevice,
    });

    expect(fieldsOf(host)).toEqual([...INVENTORY_ASSET_FIELDS]);
    expect(fieldsOf(device)).toEqual([...INVENTORY_ASSET_FIELDS]);
  });

  test("an asset with nothing reported still lists every fact, each unknown", () => {
    const device: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.NetworkDevice,
    });

    expect(device?.unknownFields).toEqual([...INVENTORY_ASSET_FIELDS]);
    for (const detail of device?.details || []) {
      expect(detail.value).toBeUndefined();
    }
  });

  test("optional facts follow the core ones, and only when known", () => {
    const device: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.NetworkDevice,
      descriptiveAttributes: {
        "net.device.dns_name": "core-sw-01.corp.example.com",
        "os.description": "Cisco IOS Software",
      },
    });

    expect(fieldsOf(device)).toEqual([
      ...INVENTORY_ASSET_FIELDS,
      InventoryAssetField.DnsName,
      InventoryAssetField.SystemDescription,
    ]);
  });

  test("a host's description is its operating system, not an extra row", () => {
    expect(fieldsOf(getInventoryAssetDetails(WINDOWS_HOST))).not.toContain(
      InventoryAssetField.SystemDescription,
    );
  });

  test("a stamped device type and location beat what is derived", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        ...WINDOWS_HOST,
        descriptiveAttributes: {
          ...WINDOWS_HOST.descriptiveAttributes,
          "device.type": "Hypervisor",
          "device.location": "HQ, Rack 3",
          "cloud.provider": "azure",
          "cloud.region": "westeurope",
        },
      },
    );

    expect(valuesOf(details)["deviceType"]).toBe("Hypervisor");
    expect(valuesOf(details)["location"]).toBe("HQ, Rack 3");
  });

  test.each([
    [{ "os.type": "linux" }, "web-01", "Server"],
    [{ "os.description": "macOS 14.4.1 (23E224)" }, "laptop-17", "Host"],
    [{}, "fw-01", "Firewall"],
    [{}, "build-agent-3", "Host"],
  ])(
    "a host with %p named %p is a %p",
    (attributes: Record<string, string>, hostname: string, type: string) => {
      expect(
        getInventoryAssetValue(
          {
            entityType: EntityType.Host,
            identifyingAttributes: { "host.name": hostname },
            descriptiveAttributes: attributes,
          },
          InventoryAssetField.DeviceType,
        ),
      ).toBe(type);
    },
  );

  test("a host's OS falls back from its description to its name to its type", () => {
    const read: (attributes: Record<string, string>) => string | undefined = (
      attributes: Record<string, string>,
    ): string | undefined => {
      return getInventoryAssetValue(
        { entityType: EntityType.Host, descriptiveAttributes: attributes },
        InventoryAssetField.OperatingSystem,
      );
    };

    expect(
      read({
        "os.description": "Windows Server 2022 10.0",
        "os.name": "Windows",
      }),
    ).toBe("Windows Server 2022 10.0");
    expect(read({ "os.name": "Ubuntu", "os.type": "linux" })).toBe("Ubuntu");
    expect(read({ "os.type": "darwin" })).toBe("macOS");
    expect(read({})).toBeUndefined();
  });

  test("the descriptive value wins over the identifying one", () => {
    expect(
      getInventoryAssetValue(
        {
          entityType: EntityType.Host,
          identifyingAttributes: { "host.name": "web-01" },
          descriptiveAttributes: { "host.name": "WEB-01" },
        },
        InventoryAssetField.Hostname,
      ),
    ).toBe("WEB-01");
  });

  test("values are trimmed, and blank values are unknown", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.NetworkDevice,
        descriptiveAttributes: {
          "host.serial_number": "  FOC1840X0AB ",
          "device.model.name": "   ",
        },
      },
    );

    expect(valuesOf(details)["serialNumber"]).toBe("FOC1840X0AB");
    expect(valuesOf(details)["model"]).toBeUndefined();
  });

  test.each([
    EntityType.Service,
    EntityType.KubernetesPod,
    EntityType.Container,
    EntityType.CloudResource,
    EntityType.DockerHost,
    "appliance",
    undefined,
    42,
  ])("%p is not an asset kind", (entityType: unknown) => {
    expect(getInventoryAssetDetails({ entityType })).toBeUndefined();
    expect(
      getInventoryAssetValue({ entityType }, InventoryAssetField.Hostname),
    ).toBeUndefined();
  });

  test.each([
    [null, null],
    ["not an object", 7],
    [[], ["host.name"]],
    [{ "host.name": 42 }, { "host.ip": { a: 1 } }],
  ])(
    "malformed attribute bags (%p, %p) read as unknown",
    (identifying: unknown, descriptive: unknown) => {
      const details: InventoryAssetDetails | undefined =
        getInventoryAssetDetails({
          entityType: EntityType.NetworkDevice,
          identifyingAttributes: identifying,
          descriptiveAttributes: descriptive,
        });

      expect(details?.unknownFields).toEqual([...INVENTORY_ASSET_FIELDS]);
    },
  );
});

describe("the asset vocabulary", () => {
  test("every fact has one key, and no two facts share one", () => {
    const fields: Array<InventoryAssetField> = [
      ...INVENTORY_ASSET_FIELDS,
      ...INVENTORY_ASSET_OPTIONAL_FIELDS,
    ];
    expect(new Set(fields).size).toBe(fields.length);
    expect(Object.keys(INVENTORY_ASSET_ATTRIBUTE_KEYS).sort()).toEqual(
      [...fields].sort(),
    );
    const keys: Array<string> = Object.values(INVENTORY_ASSET_ATTRIBUTE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the keys a host's facts were documented under before #4569 are unchanged", () => {
    expect(INVENTORY_ASSET_ATTRIBUTE_KEYS).toMatchObject({
      ipAddress: "host.ip",
      macAddress: "host.mac",
      serialNumber: "host.serial_number",
      manufacturer: "device.manufacturer",
      model: "device.model.name",
      firmwareVersion: "device.firmware.version",
      osVersion: "os.version",
      architecture: "host.arch",
      systemDescription: "os.description",
      dnsName: "net.device.dns_name",
    });
  });

  test("only hosts and network devices are asset kinds", () => {
    expect(getInventoryAssetKind(EntityType.Host)).toBe(
      InventoryAssetKind.Host,
    );
    expect(getInventoryAssetKind(EntityType.NetworkDevice)).toBe(
      InventoryAssetKind.NetworkDevice,
    );
    expect(getInventoryAssetKind("HOST")).toBeUndefined();
  });

  test.each([
    ["windows", "Windows"],
    ["LINUX", "Linux"],
    ["darwin", "macOS"],
    ["z_os", "z/OS"],
    ["plan9", "plan9"],
  ])("os.type %p reads %p", (osType: string, expected: string) => {
    expect(getOperatingSystemName(osType)).toBe(expected);
  });

  test("cloud placement names the provider and the narrowest place known", () => {
    expect(
      getCloudPlacement({
        provider: "gcp",
        region: "europe-west1",
        zone: "europe-west1-b",
      }),
    ).toBe("Google Cloud europe-west1-b");
    expect(getCloudPlacement({ provider: "aws", region: "us-east-1" })).toBe(
      "AWS us-east-1",
    );
    expect(getCloudPlacement({ region: "westeurope" })).toBe("westeurope");
    expect(getCloudPlacement({ provider: "on-prem" })).toBe("on-prem");
    expect(getCloudPlacement({})).toBeUndefined();
  });
});
