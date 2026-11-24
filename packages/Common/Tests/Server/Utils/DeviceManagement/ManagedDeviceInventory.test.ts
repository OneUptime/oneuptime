import { describe, expect, test } from "@jest/globals";
import {
  IMPORT_ONLY_ATTRIBUTE_KEYS,
  ManagedDeviceHostCandidate,
  ManagedDeviceHostChoice,
  ManagedDeviceHostSubject,
  chooseManagedDeviceHost,
  getManagedDeviceHostAttributes,
  getManagedDeviceHostDisplayName,
  isImportOnlyHost,
  mergeManagedDeviceHostAttributes,
  readWrittenHostState,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceInventory";
import {
  MANAGED_DEVICE_RESOURCE_TYPE,
  ManagedDeviceHostMatch,
  getManagedDeviceServiceAttributeKeys,
} from "../../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The identity contract, as pure rules: which host a managed device is -
 * the one telemetry names by its Esper name, else by its Esper ID, else by
 * its serial number, else one the import makes - which host it lets go,
 * what it writes to its host, and that it never overwrites a value
 * telemetry or a person wrote.
 */

const DEVICE_ROW: string = "d0000000-0000-4000-8000-000000000001";

function host(
  id: string,
  overrides: Partial<ManagedDeviceHostCandidate> = {},
): ManagedDeviceHostCandidate {
  return {
    id,
    entityKey: `key-${id}`,
    source: "discovered",
    resourceType: "",
    resourceId: "",
    displayName: id,
    descriptiveAttributes: {},
    hasCustomFields: false,
    isArchived: false,
    lastSeenAt: null,
    ...overrides,
  };
}

function subject(
  overrides: Partial<ManagedDeviceHostSubject> = {},
): ManagedDeviceHostSubject {
  return {
    id: DEVICE_ROW,
    inventoryItemId: "",
    inventoryMatch: undefined,
    written: { attributes: {}, displayName: "" },
    ...overrides,
  };
}

// A host the import made for the device, holding only what it wrote.
function madeHost(attributes: Dictionary<string> = { "os.name": "Android" }): {
  item: ManagedDeviceHostCandidate;
  device: ManagedDeviceHostSubject;
} {
  return {
    item: host("made", {
      source: "inventory",
      resourceType: MANAGED_DEVICE_RESOURCE_TYPE,
      resourceId: DEVICE_ROW,
      descriptiveAttributes: { ...attributes },
    }),
    device: subject({
      inventoryItemId: "made",
      inventoryMatch: ManagedDeviceHostMatch.Created,
      written: { attributes: { ...attributes }, displayName: "Kiosk" },
    }),
  };
}

function choose(data: {
  device?: ManagedDeviceHostSubject;
  current?: ManagedDeviceHostCandidate;
  byName?: ManagedDeviceHostCandidate;
  bySerial?: Array<ManagedDeviceHostCandidate>;
  heldByOthers?: Array<string>;
}): ManagedDeviceHostChoice {
  return chooseManagedDeviceHost({
    device: data.device ?? subject(),
    current: data.current,
    byName: data.byName,
    bySerial: data.bySerial ?? [],
    heldByOthers: new Set<string>(data.heldByOthers ?? []),
  });
}

describe("which host a device is", () => {
  test("1. the host telemetry names by the device's Esper name", () => {
    expect(
      choose({
        byName: host("named"),
        bySerial: [host("by-serial")],
      }),
    ).toEqual({ match: ManagedDeviceHostMatch.Name, itemId: "named" });
  });

  test("2. else the one host with the device's serial number", () => {
    expect(choose({ bySerial: [host("by-serial")] })).toEqual({
      match: ManagedDeviceHostMatch.SerialNumber,
      itemId: "by-serial",
    });
  });

  test("...but two hosts with one serial number say nothing certain", () => {
    expect(choose({ bySerial: [host("one"), host("two")] })).toEqual({
      match: ManagedDeviceHostMatch.Created,
      itemId: "",
    });
  });

  test("3. else none: one is made", () => {
    expect(choose({})).toEqual({
      match: ManagedDeviceHostMatch.Created,
      itemId: "",
    });
  });

  test("a host another device holds is never taken", () => {
    expect(
      choose({
        byName: host("named"),
        bySerial: [host("by-serial")],
        heldByOthers: ["named", "by-serial"],
      }),
    ).toEqual({ match: ManagedDeviceHostMatch.Created, itemId: "" });
  });

  test("the host the import made, found by name, is kept while no telemetry matches", () => {
    const { item, device } = madeHost();

    expect(choose({ device, current: item, byName: item })).toEqual({
      match: ManagedDeviceHostMatch.Created,
      itemId: "made",
    });
  });

  test("...and gives way to a host telemetry reports by serial number: deleted, being the import's alone", () => {
    const { item, device } = madeHost();
    const telemetry: ManagedDeviceHostCandidate = host("telemetry");

    expect(
      choose({ device, current: item, byName: item, bySerial: [telemetry] }),
    ).toEqual({
      match: ManagedDeviceHostMatch.SerialNumber,
      itemId: "telemetry",
      release: { item, deleteIt: true },
    });
  });

  test("a made host telemetry has written to is the device's, by its name", () => {
    const { item, device } = madeHost();
    item.descriptiveAttributes["os.type"] = "linux";

    expect(
      choose({
        device,
        current: item,
        byName: item,
        bySerial: [host("other")],
      }),
    ).toEqual({ match: ManagedDeviceHostMatch.Name, itemId: "made" });
  });

  test("a made host someone added custom fields to is kept", () => {
    const { item, device } = madeHost();
    item.hasCustomFields = true;

    expect(
      choose({ device, current: item, byName: item, bySerial: [host("other")] })
        .itemId,
    ).toBe("made");
  });

  test("a host the device took from telemetry is handed back, not deleted, when the device is another host now", () => {
    const adopted: ManagedDeviceHostCandidate = host("adopted", {
      source: "inventory",
      resourceType: MANAGED_DEVICE_RESOURCE_TYPE,
      resourceId: DEVICE_ROW,
    });
    const device: ManagedDeviceHostSubject = subject({
      inventoryItemId: "adopted",
      inventoryMatch: ManagedDeviceHostMatch.SerialNumber,
    });

    expect(choose({ device, current: adopted, byName: host("named") })).toEqual(
      {
        match: ManagedDeviceHostMatch.Name,
        itemId: "named",
        release: { item: adopted, deleteIt: false },
      },
    );
  });
});

describe("a host the import alone wrote", () => {
  test("made by the import, pointing at the device, holding only what it wrote", () => {
    const { item, device } = madeHost({
      "os.name": "Android",
      "os.version": "13",
    });

    expect(isImportOnlyHost(item, device)).toBe(true);

    item.descriptiveAttributes["os.version"] = "14";
    expect(isImportOnlyHost(item, device)).toBe(false);
  });

  test("never one telemetry made, nor one pointing at another device", () => {
    const { item, device } = madeHost();

    expect(
      isImportOnlyHost(item, {
        ...device,
        inventoryMatch: ManagedDeviceHostMatch.Name,
      }),
    ).toBe(false);
    expect(isImportOnlyHost({ ...item, resourceId: "another" }, device)).toBe(
      false,
    );
  });
});

describe("what a host is described by", () => {
  test("the asset details every machine in Inventory uses, and Esper's own facts beside them", () => {
    expect(
      getManagedDeviceHostAttributes({
        providerDeviceId: "811a2d27-13fd-4358-8dc3-aed049e73ce7",
        deviceName: "ESP-ID-AAAAW",
        serialNumber: "R9KT30ABC12",
        manufacturer: "Elo Touch Solutions",
        model: "I-Series 4",
        osVersion: "13",
        buildNumber: "TKQ1.221114.001",
        securityPatchLevel: "2024-09-01",
        groupName: "West",
        groupPath: "Stores/West",
        ipAddresses: "10.40.12.31, fe80::1",
        macAddress: "a4:c1:38:00:12:7f",
        isKioskMode: true,
      }),
    ).toEqual({
      "host.serial_number": "R9KT30ABC12",
      "device.manufacturer": "Elo Touch Solutions",
      "device.model.name": "I-Series 4",
      "device.firmware.version": "TKQ1.221114.001",
      "os.name": "Android",
      "os.version": "13",
      "host.ip": "10.40.12.31, fe80::1",
      "host.mac": "A4-C1-38-00-12-7F",
      "device.type": "kiosk",
      "esper.device.id": "811a2d27-13fd-4358-8dc3-aed049e73ce7",
      "esper.device.name": "ESP-ID-AAAAW",
      "esper.group": "Stores/West",
      "android.os.security_patch": "2024-09-01",
    });
  });

  test("an unknown fact is left out; a placeholder serial number is no serial number", () => {
    expect(
      getManagedDeviceHostAttributes({
        providerDeviceId: "id",
        serialNumber: "unknown",
        isKioskMode: false,
      }),
    ).toEqual({ "os.name": "Android", "esper.device.id": "id" });
  });

  // #9837: what a device runs names its operating system.
  test("an Apple device runs what its platform says, and has no Android patch level", () => {
    expect(
      getManagedDeviceHostAttributes({
        providerDeviceId: "id",
        provider: "esper",
        platform: ManagedDevicePlatform.IPadOS,
        osVersion: "17.4.1",
        buildNumber: "21E236",
        securityPatchLevel: "2024-09-01",
      }),
    ).toEqual({
      "device.firmware.version": "21E236",
      "os.name": "iPadOS",
      "os.version": "17.4.1",
      "esper.device.id": "id",
    });
  });

  test("a device of a platform OneUptime does not name runs what its service calls it", () => {
    expect(
      getManagedDeviceHostAttributes({
        providerDeviceId: "id",
        platform: ManagedDevicePlatform.Other,
        serviceOperatingSystem: "ChromeOS",
      })["os.name"],
    ).toBe("ChromeOS");
    expect(
      getManagedDeviceHostAttributes({
        providerDeviceId: "id",
        platform: ManagedDevicePlatform.Other,
      })["os.name"],
    ).toBeUndefined();
  });

  test("a service's own facts are under its own name; a device of no known service is Esper's", () => {
    expect(getManagedDeviceServiceAttributeKeys("esper")).toEqual({
      deviceId: "esper.device.id",
      deviceName: "esper.device.name",
      group: "esper.group",
    });
    expect(getManagedDeviceServiceAttributeKeys(undefined)).toEqual(
      getManagedDeviceServiceAttributeKeys("esper"),
    );
    // Every service's keys are taken off a host that is let go.
    for (const key of ["esper.device.id", "esper.device.name", "esper.group"]) {
      expect(IMPORT_ONLY_ATTRIBUTE_KEYS).toContain(key);
    }
  });

  test("its name: the device's alias, else its Esper name", () => {
    expect(
      getManagedDeviceHostDisplayName({
        alias: "Store 0412 Kiosk 1",
        deviceName: "ESP-ID-AAAAW",
      }),
    ).toBe("Store 0412 Kiosk 1");
    expect(
      getManagedDeviceHostDisplayName({
        alias: " ",
        deviceName: "ESP-ID-AAAAW",
      }),
    ).toBe("ESP-ID-AAAAW");
  });
});

describe("never fighting telemetry or a person", () => {
  test("a value is written where the host has none", () => {
    expect(
      mergeManagedDeviceHostAttributes({
        current: { "os.type": "linux" },
        desired: { "os.version": "13" },
        written: {},
      }),
    ).toEqual({
      attributes: { "os.type": "linux", "os.version": "13" },
      written: { "os.version": "13" },
    });
  });

  test("a value someone else wrote is kept, and no longer the import's", () => {
    expect(
      mergeManagedDeviceHostAttributes({
        current: { "device.type": "pos terminal" },
        desired: { "device.type": "kiosk" },
        written: {},
      }),
    ).toBeNull();
  });

  test("the import's own value moves with the device", () => {
    expect(
      mergeManagedDeviceHostAttributes({
        current: { "os.version": "13" },
        desired: { "os.version": "14" },
        written: { "os.version": "13" },
      }),
    ).toEqual({
      attributes: { "os.version": "14" },
      written: { "os.version": "14" },
    });
  });

  test("a value the import no longer knows is taken back, unless someone changed it since", () => {
    expect(
      mergeManagedDeviceHostAttributes({
        current: { "host.ip": "10.0.0.1", "device.type": "pos" },
        desired: {},
        written: { "host.ip": "10.0.0.1", "device.type": "kiosk" },
      }),
    ).toEqual({ attributes: { "device.type": "pos" }, written: {} });
  });

  test("nothing changes: nothing is written", () => {
    expect(
      mergeManagedDeviceHostAttributes({
        current: { "os.version": "13" },
        desired: { "os.version": "13" },
        written: { "os.version": "13" },
      }),
    ).toBeNull();
  });
});

describe("what the import wrote last time", () => {
  test("read without trusting its shape", () => {
    const stored: JSONObject = {
      attributes: { "os.version": "13", bad: 4 },
      displayName: "Kiosk",
    };

    expect(readWrittenHostState(stored)).toEqual({
      attributes: { "os.version": "13" },
      displayName: "Kiosk",
    });
    expect(readWrittenHostState(null)).toEqual({
      attributes: {},
      displayName: "",
    });
    expect(readWrittenHostState([1])).toEqual({
      attributes: {},
      displayName: "",
    });
  });
});
