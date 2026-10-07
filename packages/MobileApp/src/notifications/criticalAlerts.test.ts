import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import {
  CriticalAlertAvailability,
  CriticalAlertStatus,
  getCriticalAlertStatus,
  isCriticalChannelBypassingDnd,
  openAndroidDoNotDisturbAccessSettings,
  requestCriticalAlertPermission,
} from "./criticalAlerts";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Establishing whether this handset will ACTUALLY ring through silent mode.
 *
 * Both platforms fail this silently. iOS without the critical-alert
 * entitlement grants the permission request and simply never sets
 * allowsCriticalAlerts. Android accepts a channel with bypassDnd: true and
 * stores it as false until the user grants Do Not Disturb access. In both
 * cases the app that trusts its own request believes it is covered, tells the
 * responder so, and delivers a silent page at 3am.
 *
 * So every path here is written to read the CURRENT state back from the OS,
 * and every ambiguous answer resolves to "denied" - being told to check a
 * setting that was already fine costs a responder ten seconds; the opposite
 * error costs an incident.
 */

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

/*
 * What expo-notifications reports on iOS. allowsCriticalAlerts mirrors
 * UNNotificationSettings.criticalAlertSetting: true for enabled, false for
 * disabled, and null for notSupported - the value of a build without Apple's
 * entitlement, and of an entitled build that has not asked yet.
 */
function iosPermissions(
  status: "granted" | "denied" | "undetermined",
  allowsCriticalAlerts: boolean | null | undefined,
): never {
  return { status: status, ios: { allowsCriticalAlerts } } as never;
}

describe("getCriticalAlertStatus on iOS", () => {
  beforeEach(() => {
    setPlatform("ios");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is granted when iOS reports allowsCriticalAlerts", () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    return getCriticalAlertStatus().then((status: CriticalAlertStatus) => {
      expect(status.availability).toBe(CriticalAlertAvailability.Granted);
    });
  });

  test("is denied when iOS grants notifications but NOT critical alerts", async () => {
    /*
     * The responder said no to the critical alert prompt, or switched it off
     * later: ordinary notification permission is granted, so a naive check
     * passes, while critical alerts are not.
     */
    jest.spyOn(Notifications, "getPermissionsAsync").mockResolvedValue({
      status: "granted",
      ios: { allowsCriticalAlerts: false },
    } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("is denied when iOS reports nothing about critical alerts", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ status: "granted", ios: {} } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("the denial names the iOS setting the responder has to change", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: false } } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain("Critical Alerts");
    expect(status.reason).toContain("Settings");
  });

  test("a switched-off Critical Alerts switch sends the responder back to it", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", false));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain(
      "Allow Critical Alerts for OneUptime On-Call in iOS Settings",
    );
  });

  test("a thrown permission check is reported as denied, not as granted", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("native module unavailable") as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("does not consult Android notification channels", async () => {
    const channelSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "getNotificationChannelAsync",
    );

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    await getCriticalAlertStatus();

    expect(channelSpy).not.toHaveBeenCalled();
  });
});

describe("getCriticalAlertStatus on iOS when Settings has no Critical Alerts switch", () => {
  /*
   * iOS adds a Critical Alerts switch to Settings > Notifications only after a
   * build carrying Apple's entitlement has asked for it. Until then it reports
   * the setting as not supported, which expo-notifications passes on as null.
   * Every App Store build up to 1.4.0 lacked the entitlement, so for them the
   * switch could never appear - and telling a responder to go and turn it on
   * sent them looking for something that is not there.
   */
  beforeEach(() => {
    setPlatform("ios");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is still denied rather than unsupported, so the setting stays on offer", async () => {
    /*
     * An entitled build that has not asked yet reports exactly this, and the
     * only way to get the prompt is to turn the setting on. Calling it
     * unsupported would hide the switch that asks.
     */
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("does not send the responder to a Critical Alerts switch iOS is not showing", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).not.toContain("Allow Critical Alerts");
  });

  test("says why the switch is missing and that updating the app is the fix", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain("no Critical Alerts switch");
    expect(status.reason).toContain("Update OneUptime On-Call");
    expect(status.reason).toContain("App Store");
  });

  test("reads an absent answer the same way as null", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", undefined));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Update OneUptime On-Call");
  });

  test("reads a response with no iOS block at all the same way", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ status: "granted" } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Update OneUptime On-Call");
  });

  test("gives a different instruction from a switch that exists and is off", async () => {
    const getSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const missingSwitch: CriticalAlertStatus = await getCriticalAlertStatus();

    getSpy.mockResolvedValue(iosPermissions("granted", false));

    const switchedOff: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(missingSwitch.reason).not.toBe(switchedOff.reason);
  });

  test("is denied before notification permission has been asked for at all", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("undetermined", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });
});

describe("getCriticalAlertStatus on iOS when notifications are turned off", () => {
  beforeEach(() => {
    setPlatform("ios");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("names Allow Notifications, the switch the responder needs first", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("denied", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Notifications are turned off");
    expect(status.reason).toContain("Allow Notifications");
    expect(status.reason).toContain("iOS Settings > Notifications");
  });

  test("does not blame the app version when notifications are simply off", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("denied", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).not.toContain("App Store");
  });

  test("outranks a Critical Alerts switch that is also off", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("denied", false));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Allow Notifications");
  });
});

describe("getCriticalAlertStatus on Android", () => {
  beforeEach(() => {
    setPlatform("android");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is granted when the critical channel really carries the DND bypass", async () => {
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ id: "oncall_critical", bypassDnd: true } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
  });

  test("is denied when the channel exists but the OS refused the bypass", async () => {
    /*
     * The exact state of a fresh install: the app asked for bypassDnd, Android
     * created the channel, and stored bypassDnd as false because the user has
     * not granted Do Not Disturb access. Nothing errored.
     */
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ id: "oncall_critical", bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("is denied when the channel does not exist at all", async () => {
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue(null as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("the denial names Do Not Disturb access, which is where the toggle lives", async () => {
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain("Do Not Disturb access");
  });

  test("reads the channel the server actually targets", async () => {
    const channelSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    await getCriticalAlertStatus();

    expect(channelSpy).toHaveBeenCalledWith("oncall_critical");
  });

  test("a thrown channel read is reported as denied", async () => {
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockRejectedValue(new Error("no such channel") as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("does not ask for the iOS permission", async () => {
    const permissionSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "getPermissionsAsync",
    );

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    await getCriticalAlertStatus();

    expect(permissionSpy).not.toHaveBeenCalled();
  });
});

describe("getCriticalAlertStatus where the feature cannot exist", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setIsDevice(true);
  });

  test("a simulator is unsupported, not merely denied", async () => {
    /*
     * Simulators report permissions a real handset would not honour. Offering
     * the switch there would let a developer conclude the feature works.
     */
    setPlatform("ios");
    setIsDevice(false);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Unsupported);
  });

  test("web is unsupported - a browser cannot override a phone's ringer", async () => {
    setPlatform("web");
    setIsDevice(true);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Unsupported);
  });

  test("the unsupported message says a physical device is required", async () => {
    setPlatform("ios");
    setIsDevice(false);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain("physical");
  });
});

describe("isCriticalChannelBypassingDnd", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is false on iOS, which has no channels", async () => {
    setPlatform("ios");

    expect(await isCriticalChannelBypassingDnd()).toBe(false);
  });

  test("reports what the OS stored, not what the app asked for", async () => {
    setPlatform("android");

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    expect(await isCriticalChannelBypassingDnd()).toBe(false);
  });

  test("is true once Do Not Disturb access has been granted", async () => {
    setPlatform("android");

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    expect(await isCriticalChannelBypassingDnd()).toBe(true);
  });
});

describe("requestCriticalAlertPermission on iOS", () => {
  beforeEach(() => {
    setPlatform("ios");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks iOS for the critical alert permission specifically", async () => {
    const requestSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    await requestCriticalAlertPermission();

    expect(requestSpy).toHaveBeenCalledWith({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true,
      },
    });
  });

  test("reports what the OS decided, not what was requested", async () => {
    /*
     * The request resolves successfully even when the entitlement is missing.
     * Trusting its return value is exactly how an app ends up claiming it will
     * wake somebody it cannot wake.
     */
    jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockResolvedValue({ status: "granted" } as never);

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: false } } as never);

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("a request that throws still yields a status rather than propagating", async () => {
    jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockRejectedValue(new Error("declined") as never);

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: false } } as never);

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("does not try to open Android settings", async () => {
    const intentSpy: jest.SpyInstance = jest.spyOn(Linking, "sendIntent");

    jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    await requestCriticalAlertPermission();

    expect(intentSpy).not.toHaveBeenCalled();
  });
});

describe("requestCriticalAlertPermission on iOS, with and without Apple's entitlement", () => {
  /*
   * The same request has different outcomes depending on the build, and only
   * iOS knows which build it is talking to. Each test sets what iOS reports
   * before the request and what it reports once the request has been made.
   */
  beforeEach(() => {
    setPlatform("ios");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function simulateIosRequest(
    beforeRequest: never,
    afterRequest: never,
  ): jest.SpyInstance {
    let current: never = beforeRequest;

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockImplementation(async () => {
        return current;
      });

    return jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockImplementation(async () => {
        current = afterRequest;
        return afterRequest;
      });
  }

  test("a build without the entitlement asks iOS before concluding anything", async () => {
    const requestSpy: jest.SpyInstance = simulateIosRequest(
      iosPermissions("granted", null),
      iosPermissions("granted", null),
    );

    await requestCriticalAlertPermission();

    expect(requestSpy).toHaveBeenCalledWith({
      ios: expect.objectContaining({ allowCriticalAlerts: true }),
    });
  });

  test("a build without the entitlement stays denied once iOS ignores the request", async () => {
    /*
     * The App Store builds up to 1.4.0: iOS drops the critical alert option
     * from the request without an error or a prompt, and still reports the
     * setting as not supported afterwards.
     */
    simulateIosRequest(
      iosPermissions("granted", null),
      iosPermissions("granted", null),
    );

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("a build without the entitlement is told to update, not to hunt for a switch", async () => {
    simulateIosRequest(
      iosPermissions("granted", null),
      iosPermissions("granted", null),
    );

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.reason).toContain("Update OneUptime On-Call");
    expect(status.reason).not.toContain("Allow Critical Alerts");
  });

  test("an entitled build that had not asked yet is granted when the prompt is accepted", async () => {
    /*
     * A responder updating from a build without the entitlement: iOS has never
     * shown them the prompt, so before the request the setting still reads as
     * not supported.
     */
    simulateIosRequest(
      iosPermissions("granted", null),
      iosPermissions("granted", true),
    );

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
  });

  test("an entitled build whose prompt is declined points at the switch iOS has now added", async () => {
    simulateIosRequest(
      iosPermissions("granted", null),
      iosPermissions("granted", false),
    );

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain(
      "Allow Critical Alerts for OneUptime On-Call in iOS Settings",
    );
  });

  test("with notifications turned off the responder is told to turn them back on", async () => {
    simulateIosRequest(
      iosPermissions("denied", null),
      iosPermissions("denied", null),
    );

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Allow Notifications");
  });

  test("the reason comes from the OS after the request, not from the request's return value", async () => {
    jest
      .spyOn(Notifications, "requestPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", true));
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Update OneUptime On-Call");
  });
});

describe("requestCriticalAlertPermission on Android", () => {
  beforeEach(() => {
    setPlatform("android");
    setIsDevice(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("opens the Do Not Disturb access screen, which is the only way to grant it", async () => {
    /*
     * There is no in-app prompt for this on Android. An app that only asked
     * for notification permission would leave the responder with a switch that
     * refuses to stay on and no explanation.
     */
    const intentSpy: jest.SpyInstance = jest
      .spyOn(Linking, "sendIntent")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    await requestCriticalAlertPermission();

    expect(intentSpy).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
  });

  test("returns the state as it stands, since the user has not acted yet", async () => {
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const status: CriticalAlertStatus = await requestCriticalAlertPermission();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("falls back to the app settings page when the intent is unavailable", async () => {
    /*
     * Some OEM builds do not expose the intent. One tap away from the right
     * screen beats going nowhere at all.
     */
    jest
      .spyOn(Linking, "sendIntent")
      .mockRejectedValue(new Error("no activity found") as never);

    const openSettingsSpy: jest.SpyInstance = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    await requestCriticalAlertPermission();

    expect(openSettingsSpy).toHaveBeenCalled();
  });

  test("a settings screen that cannot be opened at all does not throw", async () => {
    jest
      .spyOn(Linking, "sendIntent")
      .mockRejectedValue(new Error("no activity found") as never);
    jest
      .spyOn(Linking, "openSettings")
      .mockRejectedValue(new Error("nope") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    await expect(requestCriticalAlertPermission()).resolves.toBeDefined();
  });
});

describe("openAndroidDoNotDisturbAccessSettings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does nothing on iOS", async () => {
    setPlatform("ios");

    const intentSpy: jest.SpyInstance = jest.spyOn(Linking, "sendIntent");

    await openAndroidDoNotDisturbAccessSettings();

    expect(intentSpy).not.toHaveBeenCalled();
  });
});
