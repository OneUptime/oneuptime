import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import {
  ANDROID_CRITICAL_ALERTS_OFF_IN_SETTINGS,
  CriticalAlertAvailability,
  CriticalAlertSettingsPlace,
  CriticalAlertStatus,
  IOS_CRITICAL_ALERTS_NOT_OFFERED,
  IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
  IOS_NOTIFICATIONS_OFF_IN_SETTINGS,
  getCriticalAlertStatus,
  isCriticalChannelBypassingDnd,
  openAndroidDoNotDisturbAccessSettings,
  openCriticalAlertSettings,
  requestCriticalAlertPermission,
} from "./criticalAlerts";
import { CRITICAL_CHANNEL } from "./channels";
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

  /*
   * Denied is what the screen shows, but nothing may act on it: the server
   * is told what the phone does only from a read that worked
   * (criticalAlertsReport.ts), or one failed read would turn real pages
   * ordinary until the app is next opened.
   */
  test("a thrown permission check is marked uncertain", async () => {
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("native module unavailable") as never);

    expect((await getCriticalAlertStatus()).isUncertain).toBe(true);
  });

  test.each([
    ["allowed", iosPermissions("granted", true)],
    ["switched off", iosPermissions("granted", false)],
    ["never asked", iosPermissions("granted", null)],
    ["with notifications off", iosPermissions("denied", null)],
  ])(
    "an answer from iOS (%s) is certain",
    async (_name: string, permissions: never) => {
      jest
        .spyOn(Notifications, "getPermissionsAsync")
        .mockResolvedValue(permissions);

      expect((await getCriticalAlertStatus()).isUncertain).toBeFalsy();
    },
  );

  test("does not consult Android notification channels", async () => {
    const writeSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "setNotificationChannelAsync",
    );
    const readSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "getNotificationChannelAsync",
    );

    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    await getCriticalAlertStatus();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
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
      .spyOn(Notifications, "setNotificationChannelAsync")
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
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ id: "oncall_critical", bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("is denied when the channel does not exist at all", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue(null as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("the denial names Do Not Disturb access, which is where the toggle lives", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.reason).toContain("Do Not Disturb access");
  });

  test("writes and reads back the channel the server actually targets", async () => {
    const channelSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    await getCriticalAlertStatus();

    expect(channelSpy).toHaveBeenCalledWith(
      "oncall_critical",
      CRITICAL_CHANNEL,
    );
  });

  test("a channel written while access is granted is reported as granted, without a separate read", async () => {
    /*
     * The write's answer is Android's answer: it returns the channel as
     * Android stored it. Reading again would only add a second call that can
     * fail.
     */
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);
    const readSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "getNotificationChannelAsync",
    );

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("a failed write falls back to what Android stored: a channel that already bypasses stays granted", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
  });

  test("a failed write and a stored channel without the bypass is denied", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("a failed write reads back the critical channel, not another one", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    const readSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    await getCriticalAlertStatus();

    expect(readSpy).toHaveBeenCalledWith("oncall_critical");
  });

  test("a write that hands back no channel is denied, not guessed", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue(null as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("a thrown write and a thrown read are reported as denied", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockRejectedValue(new Error("no such channel") as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
  });

  test("a thrown write and a thrown read are marked uncertain: Android was never asked", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockRejectedValue(new Error("binder died") as never);
    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockRejectedValue(new Error("no such channel") as never);

    expect((await getCriticalAlertStatus()).isUncertain).toBe(true);
  });

  test.each<[string, boolean | "throw", boolean | null | undefined]>([
    ["the write answered with the bypass", true, undefined],
    ["the write answered without it", false, undefined],
    ["the write failed and the stored channel has the bypass", "throw", true],
    ["the write failed and the stored channel lacks it", "throw", false],
    ["the write failed and there is no stored channel", "throw", null],
  ])(
    "%s: certain",
    async (
      _name: string,
      written: boolean | "throw",
      stored: boolean | null | undefined,
    ) => {
      if (written === "throw") {
        jest
          .spyOn(Notifications, "setNotificationChannelAsync")
          .mockRejectedValue(new Error("binder died") as never);
        jest
          .spyOn(Notifications, "getNotificationChannelAsync")
          .mockResolvedValue(
            (stored === null ? null : { bypassDnd: stored }) as never,
          );
      } else {
        jest
          .spyOn(Notifications, "setNotificationChannelAsync")
          .mockResolvedValue({ bypassDnd: written } as never);
      }

      expect((await getCriticalAlertStatus()).isUncertain).toBeFalsy();
    },
  );

  test("a thrown channel write is reported as denied", async () => {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
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
      .spyOn(Notifications, "setNotificationChannelAsync")
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

  test("neither writes nor reads a channel on iOS", async () => {
    setPlatform("ios");

    const writeSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "setNotificationChannelAsync",
    );
    const readSpy: jest.SpyInstance = jest.spyOn(
      Notifications,
      "getNotificationChannelAsync",
    );

    await isCriticalChannelBypassingDnd();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("asks Android for the bypass again, with the critical channel's own definition", async () => {
    /*
     * Writing is what lets Android turn the bypass on for a channel created
     * before the access was granted - the whole reason this writes rather
     * than only reads.
     */
    setPlatform("android");

    const writeSpy: jest.SpyInstance = jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: true } as never);

    await isCriticalChannelBypassingDnd();

    // Every critical channel: the system sound's and one per alarm sound.
    expect(writeSpy).toHaveBeenCalledTimes(6);
    expect(writeSpy.mock.calls[0]![0]).toBe("oncall_critical");

    for (const call of writeSpy.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ bypassDnd: true }));
    }
  });

  test("reports what the OS stored, not what the app asked for", async () => {
    setPlatform("android");

    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    expect(await isCriticalChannelBypassingDnd()).toBe(false);
  });

  test("is true once Do Not Disturb access has been granted", async () => {
    setPlatform("android");

    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
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
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    await requestCriticalAlertPermission();

    expect(intentSpy).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
  });

  test("returns the state as it stands, since the user has not acted yet", async () => {
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
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
      .spyOn(Notifications, "setNotificationChannelAsync")
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
      .spyOn(Notifications, "setNotificationChannelAsync")
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

/*
 * What the Settings screen says when the responder has Critical On-Call
 * Alerts on and the phone's own settings turn them off since: the switch
 * reads off, the server sends pages as ordinary notifications, and the
 * responder is told why and where to turn them back on (#4908's follow-up:
 * the switch used to read off with no reason).
 */
describe("why the phone's settings turn critical alerts off", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("iOS with Critical Alerts switched off: sent to this app's page in iOS Settings", async () => {
    setPlatform("ios");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", false));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.offInPhoneSettings).toEqual(
      IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
    );
    expect(status.offInPhoneSettings).toEqual({
      title: "Off in iOS Settings.",
      message:
        "On-call pages will not ring through silent mode or Do Not Disturb. Turn on Critical Alerts under Notifications.",
      place: CriticalAlertSettingsPlace.IosAppSettings,
      tone: "warning",
    });
  });

  test("iOS with notifications off: says pages do not reach the phone at all", async () => {
    setPlatform("ios");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("denied", false));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.offInPhoneSettings).toEqual(
      IOS_NOTIFICATIONS_OFF_IN_SETTINGS,
    );
    expect(status.offInPhoneSettings?.title).toBe(
      "Notifications are off in iOS Settings.",
    );
    expect(status.offInPhoneSettings?.message).toBe(
      "On-call pages do not reach this phone at all. Turn on Allow Notifications.",
    );
    expect(status.offInPhoneSettings?.place).toBe(
      CriticalAlertSettingsPlace.IosAppSettings,
    );
    // Nothing reaches the phone at all: said in red, not amber.
    expect(status.offInPhoneSettings?.tone).toBe("danger");
  });

  test("iOS that does not offer critical alerts to this version: the App Store, which the app does not open", async () => {
    setPlatform("ios");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", null));

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.offInPhoneSettings).toEqual(IOS_CRITICAL_ALERTS_NOT_OFFERED);
    expect(status.offInPhoneSettings?.title).toBe(
      "This version of the app cannot receive critical alerts.",
    );
    expect(status.offInPhoneSettings?.message).toContain(
      "Update OneUptime On-Call from the App Store.",
    );
    expect(status.offInPhoneSettings?.place).toBe(
      CriticalAlertSettingsPlace.AppStore,
    );
    expect(status.offInPhoneSettings?.tone).toBe("warning");
  });

  test("Android whose alarm cannot ring through Do Not Disturb: sent to Do Not Disturb access", async () => {
    setPlatform("android");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue({ bypassDnd: false } as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.offInPhoneSettings).toEqual(
      ANDROID_CRITICAL_ALERTS_OFF_IN_SETTINGS,
    );
    expect(status.offInPhoneSettings).toEqual({
      title: "Off in Android settings.",
      message:
        "On-call pages will not ring through Do Not Disturb. Allow OneUptime On-Call in Do Not Disturb access.",
      place: CriticalAlertSettingsPlace.AndroidDoNotDisturbAccess,
      tone: "warning",
    });
  });

  /*
   * A footnote under a switch on a phone: a short bold lead, then a line or
   * two - never the paragraph that once named a whole settings path the
   * button beside it already opens.
   */
  test("each explanation is short: a lead of a few words, two sentences after it", () => {
    for (const off of [
      IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
      IOS_NOTIFICATIONS_OFF_IN_SETTINGS,
      IOS_CRITICAL_ALERTS_NOT_OFFERED,
      ANDROID_CRITICAL_ALERTS_OFF_IN_SETTINGS,
    ]) {
      expect(off.title.endsWith(".")).toBe(true);
      expect(off.title.length).toBeLessThanOrEqual(60);
      expect(off.message.length).toBeLessThanOrEqual(120);
      expect(off.message.split(". ").length).toBe(2);
      // The button opens the place: no "Settings > A > B" path to follow.
      expect(off.message).not.toContain(" > ");
      expect(`${off.title} ${off.message}`).not.toContain("Off:");
    }
  });

  test("a granted phone has nothing to explain", async () => {
    setPlatform("ios");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue(iosPermissions("granted", true));

    expect((await getCriticalAlertStatus()).offInPhoneSettings).toBeUndefined();
  });

  test("a read that failed explains nothing: the phone was never asked", async () => {
    setPlatform("ios");
    setIsDevice(true);
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockRejectedValue(new Error("unavailable") as never);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.isUncertain).toBe(true);
    expect(status.offInPhoneSettings).toBeUndefined();
  });
});

describe("openCriticalAlertSettings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("this app's page in iOS Settings", async () => {
    setPlatform("ios");
    const openSettings: jest.SpyInstance = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as never);

    await openCriticalAlertSettings(CriticalAlertSettingsPlace.IosAppSettings);

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  test("Android's Do Not Disturb access list", async () => {
    setPlatform("android");
    const intent: jest.SpyInstance = jest
      .spyOn(Linking, "sendIntent")
      .mockResolvedValue(undefined as never);

    await openCriticalAlertSettings(
      CriticalAlertSettingsPlace.AndroidDoNotDisturbAccess,
    );

    expect(intent).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
  });

  test("never the App Store, and never throws", async () => {
    setPlatform("ios");
    const openSettings: jest.SpyInstance = jest
      .spyOn(Linking, "openSettings")
      .mockRejectedValue(new Error("no settings") as never);
    const openUrl: jest.SpyInstance = jest.spyOn(Linking, "openURL");

    await openCriticalAlertSettings(CriticalAlertSettingsPlace.AppStore);
    await expect(
      openCriticalAlertSettings(CriticalAlertSettingsPlace.IosAppSettings),
    ).resolves.toBeUndefined();

    expect(openUrl).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
