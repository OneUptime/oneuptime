import { describe, expect, test } from "@jest/globals";
import {
  ManagedDeviceAppSyncPlan,
  ManagedDeviceFields,
  ManagedDeviceSyncPlan,
  REMOVED_DEVICE_RETENTION_DAYS,
  StoredManagedDevice,
  planManagedDeviceAppSync,
  planManagedDeviceSync,
  toManagedDeviceFields,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceSync";
import {
  ProviderApp,
  ProviderDevice,
  ProviderGroup,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import { parseEsperDevice } from "../../../../Server/Utils/DeviceManagement/Esper/EsperParsers";
import { EsperDeviceFixture, buildEsperDevice } from "./EsperFixtures";

/*
 * What a read changes, worked out before anything is written: devices
 * added, changed, gone from Esper (marked removed, never from a list cut
 * short), back again, and gone long enough to delete; check-ins that only
 * move forward; and one device's apps added, updated and uninstalled.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;
const GROUP_WEST: string = "22222222-bbbb-4bbb-8bbb-000000000001";
const GROUP_EAST: string = "22222222-bbbb-4bbb-8bbb-000000000002";

const GROUPS: Map<string, ProviderGroup> = new Map<string, ProviderGroup>([
  [GROUP_WEST, { id: GROUP_WEST, name: "West", path: "Stores/West" }],
  [GROUP_EAST, { id: GROUP_EAST, name: "East", path: "Stores/East" }],
]);

function device(
  id: string,
  overrides: Partial<EsperDeviceFixture> = {},
): ProviderDevice {
  return parseEsperDevice(
    buildEsperDevice({
      id,
      name: `ESP-${id}`,
      groupId: GROUP_WEST,
      ...overrides,
    }),
  )!;
}

function stored(
  readNow: ProviderDevice,
  data: {
    id?: string;
    lastCheckInAt?: Date | null;
    removedAt?: Date | null;
    fields?: Partial<ManagedDeviceFields>;
  } = {},
): StoredManagedDevice {
  return {
    id: data.id ?? `row-${readNow.providerDeviceId}`,
    providerDeviceId: readNow.providerDeviceId,
    fields: {
      ...toManagedDeviceFields({
        device: readNow,
        groups: GROUPS,
        isGroupListComplete: true,
      }),
      ...(data.fields || {}),
    },
    lastCheckInAt: data.lastCheckInAt ?? null,
    removedAt: data.removedAt ?? null,
  };
}

function plan(data: {
  stored: Array<StoredManagedDevice>;
  devices: Array<ProviderDevice>;
  isDeviceListComplete?: boolean;
  isGroupListComplete?: boolean;
  checkIns?: Map<string, Date>;
  groups?: Map<string, ProviderGroup>;
}): ManagedDeviceSyncPlan {
  return planManagedDeviceSync({
    stored: data.stored,
    devices: data.devices,
    groups: data.groups ?? GROUPS,
    isGroupListComplete: data.isGroupListComplete ?? true,
    isDeviceListComplete: data.isDeviceListComplete ?? true,
    checkIns: data.checkIns ?? new Map<string, Date>(),
    now: NOW,
  });
}

describe("devices", () => {
  test("a device new to OneUptime is created, its group named from the groups read", () => {
    const result: ManagedDeviceSyncPlan = plan({
      stored: [],
      devices: [device("a")],
      checkIns: new Map([["a", new Date(NOW.getTime() - 60000)]]),
    });

    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]!.providerDeviceId).toBe("a");
    expect(result.creates[0]!.fields.groupName).toBe("West");
    expect(result.creates[0]!.fields.groupPath).toBe("Stores/West");
    expect(result.creates[0]!.lastCheckInAt).toEqual(
      new Date(NOW.getTime() - 60000),
    );
    expect(result.updates).toEqual([]);
    expect(result.removals).toEqual([]);
  });

  test("a steady device costs no write", () => {
    const now: ProviderDevice = device("a");

    expect(plan({ stored: [stored(now)], devices: [now] })).toEqual({
      creates: [],
      updates: [],
      removals: [],
      purges: [],
    });
  });

  test("a device that changed is updated, only in what changed, and counted", () => {
    const before: ProviderDevice = device("a", { osVersion: "12" });
    const after: ProviderDevice = device("a", {
      osVersion: "13",
      securityPatchLevel: "2024-10-05",
      groupId: GROUP_EAST,
    });

    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(before)],
      devices: [after],
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.isCounted).toBe(true);
    expect(result.updates[0]!.changes).toEqual({
      osVersion: "13",
      securityPatchLevel: "2024-10-05",
      groupId: GROUP_EAST,
      groupName: "East",
      groupPath: "Stores/East",
    });
  });

  test("a battery level or an address that moved is written, not counted as a change", () => {
    const before: ProviderDevice = device("a", { batteryLevel: 90 });
    const after: ProviderDevice = device("a", {
      batteryLevel: 40,
      ipAddresses: ["10.40.12.99"],
      state: 60,
    });

    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(before)],
      devices: [after],
    });

    expect(result.updates[0]!.isCounted).toBe(false);
    expect(result.updates[0]!.changes).toEqual({
      batteryLevel: 40,
      ipAddresses: "10.40.12.99",
      providerState: 60,
    });
  });

  test("a check-in only moves forward", () => {
    const now: ProviderDevice = device("a");
    const known: Date = new Date(NOW.getTime() - 5 * 60000);

    expect(
      plan({
        stored: [stored(now, { lastCheckInAt: known })],
        devices: [now],
        checkIns: new Map([["a", new Date(known.getTime() - 60000)]]),
      }).updates,
    ).toEqual([]);

    const newer: Date = new Date(NOW.getTime() - 60000);

    expect(
      plan({
        stored: [stored(now, { lastCheckInAt: known })],
        devices: [now],
        checkIns: new Map([["a", newer]]),
      }).updates[0]!.changes,
    ).toEqual({ lastCheckInAt: newer });
  });

  test("a device missing from a list read to its end is marked removed, once", () => {
    const gone: ProviderDevice = device("gone");
    const kept: ProviderDevice = device("kept");

    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(gone), stored(kept)],
      devices: [kept],
    });

    expect(result.removals).toEqual(["row-gone"]);

    // Already marked: nothing more to say.
    expect(
      plan({
        stored: [stored(gone, { removedAt: new Date(NOW.getTime() - DAY) })],
        devices: [],
      }).removals,
    ).toEqual([]);
  });

  test("never from a list cut short, which says nothing about the devices it left out", () => {
    const gone: ProviderDevice = device("gone");

    expect(
      plan({
        stored: [stored(gone)],
        devices: [],
        isDeviceListComplete: false,
      }).removals,
    ).toEqual([]);
  });

  test("a removed device listed again is back: no longer removed", () => {
    const back: ProviderDevice = device("back");

    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(back, { removedAt: new Date(NOW.getTime() - DAY) })],
      devices: [back],
    });

    expect(result.updates[0]!.isBack).toBe(true);
    expect(result.updates[0]!.changes).toEqual({ removedAt: null });
  });

  test("a device removed long enough ago goes for good", () => {
    const old: ProviderDevice = device("old");
    const recent: ProviderDevice = device("recent");

    const result: ManagedDeviceSyncPlan = plan({
      stored: [
        stored(old, {
          removedAt: new Date(
            NOW.getTime() - (REMOVED_DEVICE_RETENTION_DAYS + 1) * DAY,
          ),
        }),
        stored(recent, { removedAt: new Date(NOW.getTime() - DAY) }),
      ],
      devices: [],
    });

    expect(result.purges).toEqual(["row-old"]);
  });

  test("a group the list cut short left out keeps the name stored, while the device stays in it", () => {
    const now: ProviderDevice = device("a");
    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(now)],
      devices: [now],
      groups: new Map(),
      isGroupListComplete: false,
    });

    expect(result.updates).toEqual([]);
  });

  test("a group gone from a complete list leaves the device's group unnamed", () => {
    const now: ProviderDevice = device("a");
    const result: ManagedDeviceSyncPlan = plan({
      stored: [stored(now)],
      devices: [now],
      groups: new Map(),
    });

    expect(result.updates[0]!.changes).toEqual({
      groupName: "",
      groupPath: "",
    });
  });

  test("a device listed twice is read once", () => {
    expect(
      plan({ stored: [], devices: [device("a"), device("a")] }).creates,
    ).toHaveLength(1);
  });
});

describe("apps", () => {
  const app: (packageName: string, versionName?: string) => ProviderApp = (
    packageName: string,
    versionName: string = "1.0.0",
  ): ProviderApp => {
    return {
      packageName,
      appName: packageName,
      versionName,
      versionCode: "1",
      state: "INSTALL",
      isKioskApp: false,
      isManagedByService: true,
    };
  };

  test("new apps created, a new version updated, an uninstalled app deleted", () => {
    const result: ManagedDeviceAppSyncPlan = planManagedDeviceAppSync({
      stored: [
        { id: "1", app: app("com.example.kiosk", "2.4.0") },
        { id: "2", app: app("com.example.removed") },
        { id: "3", app: app("io.esper.agent") },
      ],
      apps: [
        app("com.example.kiosk", "2.4.1"),
        app("io.esper.agent"),
        app("com.example.new"),
      ],
    });

    expect(
      result.creates.map((created: ProviderApp) => {
        return created.packageName;
      }),
    ).toEqual(["com.example.new"]);
    expect(result.updates).toEqual([
      { id: "1", app: app("com.example.kiosk", "2.4.1") },
    ]);
    expect(result.deletes).toEqual(["2"]);
  });

  test("a duplicate stored row is cleaned up; an app listed twice is read once", () => {
    const result: ManagedDeviceAppSyncPlan = planManagedDeviceAppSync({
      stored: [
        { id: "1", app: app("com.example.kiosk") },
        { id: "2", app: app("com.example.kiosk") },
      ],
      apps: [app("com.example.kiosk"), app("com.example.kiosk")],
    });

    expect(result).toEqual({ creates: [], updates: [], deletes: ["2"] });
  });
});
