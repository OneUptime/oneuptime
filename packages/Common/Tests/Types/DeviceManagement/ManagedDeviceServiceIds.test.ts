import { describe, expect, test } from "@jest/globals";
import {
  ESPER_DEVICE_ID_ATTRIBUTE,
  ManagedDeviceServiceId,
  getAllManagedDeviceServiceAttributeKeys,
  getManagedDeviceServiceAttributeKeys,
  getManagedDeviceServiceIds,
} from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { getManagedDeviceHostAttributes } from "../../../Server/Utils/DeviceManagement/ManagedDeviceInventory";

/*
 * The ID each device manager knows a device by, read from what its import
 * wrote on the device's host (#10097): what Inventory's Device Manager ID
 * column shows beside Agent Permissions, and what Esper's Secure Remote ADB
 * takes (`espercli secureadb connect --device <ID>`).
 */

describe("getManagedDeviceServiceIds", () => {
  test("reads Esper's ID where Esper's import writes it", () => {
    expect(ESPER_DEVICE_ID_ATTRIBUTE).toBe("esper.device.id");
    expect(
      getManagedDeviceServiceIds({
        [ESPER_DEVICE_ID_ATTRIBUTE]: "7e5c1d6a-3f2b-4c8e-9a1d-2b3c4d5e6f70",
        "esper.device.name": "ESP-ID-AAAAW",
        "host.serial_number": "R9KT30ABC12",
      }),
    ).toEqual([
      {
        provider: DeviceManagementProvider.Esper,
        deviceId: "7e5c1d6a-3f2b-4c8e-9a1d-2b3c4d5e6f70",
      },
    ]);
  });

  test("reads every service's ID under its own namespace", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const key: string =
        getManagedDeviceServiceAttributeKeys(provider).deviceId;

      expect({
        provider,
        ids: getManagedDeviceServiceIds({ [key]: `id-of-${provider}` }),
      }).toEqual({
        provider,
        ids: [{ provider, deviceId: `id-of-${provider}` }],
      });
    }
  });

  test("a host two services enroll has both, in the services' order", () => {
    expect(
      getManagedDeviceServiceIds({
        "soti.device.id": "soti-1",
        "intune.device.id": "intune-1",
        "workspaceone.device.id": "21503",
        "esper.device.id": "esper-1",
      }).map((id: ManagedDeviceServiceId): string => {
        return id.provider;
      }),
    ).toEqual([...DEVICE_MANAGEMENT_PROVIDERS]);
  });

  test("an ID is trimmed; a blank one, one that is not text, and a bag that is not one are none", () => {
    expect(
      getManagedDeviceServiceIds({ "esper.device.id": "  esper-1 " }),
    ).toEqual([
      { provider: DeviceManagementProvider.Esper, deviceId: "esper-1" },
    ]);

    for (const attributes of [
      { "esper.device.id": "" },
      { "esper.device.id": "   " },
      { "esper.device.id": 42 },
      { "esper.device.id": null },
      { "esper.device.id": ["esper-1"] },
      {},
      null,
      undefined,
      "esper.device.id",
      42,
    ]) {
      expect({
        attributes,
        ids: getManagedDeviceServiceIds(attributes),
      }).toEqual({ attributes, ids: [] });
    }
  });

  test("reads none of a service's other facts as its ID", () => {
    expect(
      getManagedDeviceServiceIds({
        "esper.device.name": "ESP-ID-AAAAW",
        "esper.group": "Stores/Store 12",
        "host.id": "a1b2c3",
      }),
    ).toEqual([]);
  });

  test("every ID it reads is one of the keys a host lets go of with its device", () => {
    const released: Array<string> = getAllManagedDeviceServiceAttributeKeys();

    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      expect(released).toContain(
        getManagedDeviceServiceAttributeKeys(provider).deviceId,
      );
    }
  });

  test("reads back what each import writes on a device's host", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const attributes: Record<string, string> = getManagedDeviceHostAttributes(
        {
          providerDeviceId: `device-of-${provider}`,
          provider,
          deviceName: "Store 12 Kiosk 3",
          serialNumber: "R9KT30ABC12",
        },
      );

      expect({ provider, ids: getManagedDeviceServiceIds(attributes) }).toEqual(
        {
          provider,
          ids: [{ provider, deviceId: `device-of-${provider}` }],
        },
      );
    }
  });
});
