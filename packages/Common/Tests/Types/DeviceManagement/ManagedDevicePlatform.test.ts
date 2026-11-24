import { describe, expect, test } from "@jest/globals";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_OPERATING_SYSTEM_NAMES,
  MANAGED_DEVICE_PLATFORMS,
  ManagedDevicePlatform,
  getManagedDeviceOperatingSystemName,
  isAppleManagedDevicePlatform,
  isManagedDevicePlatform,
  readManagedDevicePlatform,
  readManagedDevicePlatformFromName,
} from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import {
  MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
  MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES,
  ManagedDeviceCheckInCadence,
  ManagedDeviceStatus,
  getManagedDeviceCheckInCadence,
  getManagedDeviceOnlineWindowMinutes,
  getManagedDeviceStatus,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";

/*
 * What a managed device runs (#9837): its operating system in Inventory,
 * and how long it may go without checking in before it is offline - an
 * Esper Android device's heartbeat every few minutes, an Apple device's
 * check-in hours apart.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

describe("a device's platform", () => {
  test("is one of the platforms OneUptime names, stored by its value", () => {
    expect(MANAGED_DEVICE_PLATFORMS).toEqual([
      "android",
      "ios",
      "ipados",
      "tvos",
      "macos",
      "windows",
      "linux",
      "other",
    ]);
    expect(isManagedDevicePlatform("ipados")).toBe(true);
    expect(isManagedDevicePlatform("iPadOS")).toBe(false);
    expect(isManagedDevicePlatform(undefined)).toBe(false);
  });

  test("a row written before the platform was kept is Android; anything unknown is Other", () => {
    expect(readManagedDevicePlatform(undefined)).toBe(
      ManagedDevicePlatform.Android,
    );
    expect(readManagedDevicePlatform(null)).toBe(ManagedDevicePlatform.Android);
    expect(readManagedDevicePlatform("")).toBe(ManagedDevicePlatform.Android);
    expect(readManagedDevicePlatform("macos")).toBe(
      ManagedDevicePlatform.MacOS,
    );
    expect(readManagedDevicePlatform("chromeos")).toBe(
      ManagedDevicePlatform.Other,
    );
  });

  test("is read from the names the services give it, whatever their case and punctuation", () => {
    const cases: Array<[unknown, ManagedDevicePlatform]> = [
      // Esper's os, Intune's operatingSystem.
      ["Android", ManagedDevicePlatform.Android],
      ["AndroidEnterprise", ManagedDevicePlatform.Android],
      ["AndroidForWork", ManagedDevicePlatform.Android],
      ["android", ManagedDevicePlatform.Android],
      ["iOS", ManagedDevicePlatform.IOS],
      ["iPhone", ManagedDevicePlatform.IOS],
      ["iPadOS", ManagedDevicePlatform.IPadOS],
      ["iPad", ManagedDevicePlatform.IPadOS],
      ["tvOS", ManagedDevicePlatform.TvOS],
      ["Apple TV", ManagedDevicePlatform.TvOS],
      ["macOS", ManagedDevicePlatform.MacOS],
      ["Mac OS X", ManagedDevicePlatform.MacOS],
      ["AppleOsX", ManagedDevicePlatform.MacOS],
      ["Windows", ManagedDevicePlatform.Windows],
      ["windows", ManagedDevicePlatform.Windows],
      ["Windows Desktop", ManagedDevicePlatform.Windows],
      ["WinRT", ManagedDevicePlatform.Windows],
      ["Linux", ManagedDevicePlatform.Linux],
      ["Linux (Ubuntu)", ManagedDevicePlatform.Linux],
      ["ChromeOS", ManagedDevicePlatform.Other],
      ["", ManagedDevicePlatform.Other],
      ["   ", ManagedDevicePlatform.Other],
      [null, ManagedDevicePlatform.Other],
      [42, ManagedDevicePlatform.Other],
    ];

    for (const [name, platform] of cases) {
      expect(readManagedDevicePlatformFromName(name)).toBe(platform);
    }
  });

  test("names its operating system as its maker writes it, in every language", () => {
    expect(MANAGED_DEVICE_OPERATING_SYSTEM_NAMES).toEqual({
      android: "Android",
      ios: "iOS",
      ipados: "iPadOS",
      tvos: "tvOS",
      macos: "macOS",
      windows: "Windows",
      linux: "Linux",
    });
    expect(getManagedDeviceOperatingSystemName({ platform: "ipados" })).toBe(
      "iPadOS",
    );
    // A row written before the platform was kept runs Android.
    expect(getManagedDeviceOperatingSystemName({ platform: null })).toBe(
      "Android",
    );
    // Another platform is the service's own word for it.
    expect(
      getManagedDeviceOperatingSystemName({
        platform: ManagedDevicePlatform.Other,
        serviceOperatingSystem: " ChromeOS ",
      }),
    ).toBe("ChromeOS");
    expect(
      getManagedDeviceOperatingSystemName({
        platform: ManagedDevicePlatform.Other,
      }),
    ).toBe("");
  });

  test("Apple's are iOS, iPadOS, tvOS and macOS", () => {
    expect(
      MANAGED_DEVICE_PLATFORMS.filter((platform: ManagedDevicePlatform) => {
        return isAppleManagedDevicePlatform(platform);
      }),
    ).toEqual(["ios", "ipados", "tvos", "macos"]);
    expect(isAppleManagedDevicePlatform(undefined)).toBe(false);
  });
});

describe("how long a device may be quiet", () => {
  test("an Esper Android device has a heartbeat: 30 minutes, Esper's own window", () => {
    for (const platform of [ManagedDevicePlatform.Android, undefined, null]) {
      expect(
        getManagedDeviceCheckInCadence({
          provider: DeviceManagementProvider.Esper,
          platform,
        }),
      ).toBe(ManagedDeviceCheckInCadence.Heartbeat);
    }
    // A row read without its connection is Esper's, as every one was before.
    expect(getManagedDeviceOnlineWindowMinutes({})).toBe(
      MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
    );
    expect(MANAGED_DEVICE_ONLINE_WINDOW_MINUTES).toBe(30);
  });

  test("an Esper Apple device checks in hours apart: a day, Esper's next bucket", () => {
    for (const platform of [
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.TvOS,
    ]) {
      expect(
        getManagedDeviceOnlineWindowMinutes({
          provider: DeviceManagementProvider.Esper,
          platform,
        }),
      ).toBe(MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES);
    }
    expect(MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES).toBe(24 * 60);
  });

  test("a device of another service syncs on its schedule: a day, whatever it runs", () => {
    expect(
      getManagedDeviceCheckInCadence({
        provider: "another-service",
        platform: ManagedDevicePlatform.Android,
      }),
    ).toBe(ManagedDeviceCheckInCadence.Sync);
  });

  test("an iPad seen three hours ago is online, and an Android device seen as long ago is offline", () => {
    expect(
      getManagedDeviceStatus({
        lastCheckInAt: minutesAgo(3 * 60),
        provider: DeviceManagementProvider.Esper,
        platform: ManagedDevicePlatform.IPadOS,
        now: NOW,
      }),
    ).toBe(ManagedDeviceStatus.Online);
    expect(
      getManagedDeviceStatus({
        lastCheckInAt: minutesAgo(3 * 60),
        provider: DeviceManagementProvider.Esper,
        platform: ManagedDevicePlatform.Android,
        now: NOW,
      }),
    ).toBe(ManagedDeviceStatus.Offline);
  });

  test("an iPad is offline a minute past a day, online on the day itself", () => {
    const status: (minutes: number) => ManagedDeviceStatus = (
      minutes: number,
    ): ManagedDeviceStatus => {
      return getManagedDeviceStatus({
        lastCheckInAt: minutesAgo(minutes),
        provider: DeviceManagementProvider.Esper,
        platform: "ios",
        now: NOW,
      });
    };

    expect(status(24 * 60)).toBe(ManagedDeviceStatus.Online);
    expect(status(24 * 60 + 1)).toBe(ManagedDeviceStatus.Offline);
  });

  test("an iPad being set up, disabled or wiped says so, by the same state numbers as Android's", () => {
    const status: (state: number) => ManagedDeviceStatus = (
      state: number,
    ): ManagedDeviceStatus => {
      return getManagedDeviceStatus({
        providerState: state,
        lastCheckInAt: minutesAgo(5),
        provider: DeviceManagementProvider.Esper,
        platform: ManagedDevicePlatform.IPadOS,
        now: NOW,
      });
    };

    // device_DeviceStateEnumApple: 20, 70, 80, 90, 100 and 200.
    expect(status(20)).toBe(ManagedDeviceStatus.Disabled);
    expect(status(70)).toBe(ManagedDeviceStatus.Wiping);
    expect(status(80)).toBe(ManagedDeviceStatus.Provisioning);
    expect(status(90)).toBe(ManagedDeviceStatus.OnboardingFailed);
    expect(status(100)).toBe(ManagedDeviceStatus.Provisioning);
    expect(status(200)).toBe(ManagedDeviceStatus.Provisioning);
    expect(status(1)).toBe(ManagedDeviceStatus.Online);
  });
});
