import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import {
  CriticalAlertAvailability,
  CriticalAlertStatus,
  getCriticalAlertStatus,
  isCriticalChannelBypassingDnd,
  requestCriticalAlertPermission,
} from "./criticalAlerts";
import { CRITICAL_CHANNEL, NotificationChannelId } from "./channels";
import { setupNotificationChannels } from "./setup";
import { FakeAndroidNotificationChannels } from "../__tests__/fakeAndroidNotificationChannels";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The critical channel's whole life on Android, against a fake of Android's
 * own channel rules (see fakeAndroidNotificationChannels): the app creates
 * its channels when it starts, the responder grants Do Not Disturb access on
 * a system screen, and comes back - with the app still running.
 *
 * The bug these pin: Android settles a channel's bypass when the app WRITES
 * the channel, not when access is granted. The status check used to only
 * READ the channel, so after the responder granted access it went on reading
 * the bypassDnd false stored at start-up, told them to grant the access they
 * had just granted, and the switch would not stay on until the app was
 * restarted. The status check now writes the channel and reads back what
 * Android stored.
 */

const CRITICAL: string = NotificationChannelId.CRITICAL;

let android: FakeAndroidNotificationChannels;

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

// The app starting: it creates every channel, as usePushNotifications does.
async function appStarts(): Promise<void> {
  await setupNotificationChannels();
}

beforeEach(() => {
  setPlatform("android");
  setIsDevice(true);
  android = new FakeAndroidNotificationChannels();
  android.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a fresh install, before Do Not Disturb access", () => {
  test("the app's start creates the critical channel without the bypass", async () => {
    await appStarts();

    expect(android.stored(CRITICAL)).toBeDefined();
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(false);
    // It asked for the bypass; Android stored it false without an error.
    expect(android.writes).toContainEqual({
      id: CRITICAL,
      requestedBypassDnd: true,
    });
  });

  test("critical alerts are reported as denied, naming Do Not Disturb access", async () => {
    await appStarts();

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(status.reason).toContain("Do Not Disturb access");
  });

  test("checking before the app has created its channels creates it, still without the bypass", async () => {
    // A status read that wins the race with the start-up channel setup.
    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(false);
  });
});

describe("granting Do Not Disturb access while the app keeps running", () => {
  test("the next check reports critical alerts as granted - no restart needed", async () => {
    await appStarts();
    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Denied,
    );

    android.grantDoNotDisturbAccess();

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
  });

  test("granting alone changes nothing Android has stored - the check's write is what turns the bypass on", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();

    // Exactly what the old, read-only check saw: still false.
    const readOnly: Notifications.NotificationChannel | null =
      await Notifications.getNotificationChannelAsync(CRITICAL);

    expect(readOnly?.bypassDnd).toBe(false);

    expect(await isCriticalChannelBypassingDnd()).toBe(true);
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(true);
  });

  test("the round trip through the settings screen ends granted", async () => {
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);

    await appStarts();

    // Turning the setting on opens the Do Not Disturb access screen...
    const whileAway: CriticalAlertStatus =
      await requestCriticalAlertPermission();

    expect(whileAway.availability).toBe(CriticalAlertAvailability.Denied);
    expect(Linking.sendIntent).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );

    // ...the responder allows it there, and comes back to the app.
    android.grantDoNotDisturbAccess();

    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );
  });

  test("the app restarting afterwards changes nothing - it stays granted", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();
    await getCriticalAlertStatus();

    await appStarts();

    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );
  });

  test("access granted before the app ever created the channel is granted from the first check", async () => {
    android.grantDoNotDisturbAccess();
    await appStarts();

    expect(android.stored(CRITICAL)?.bypassDnd).toBe(true);
    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );
  });
});

describe("a channel the responder changed in Android's settings", () => {
  test("changed before access was granted: stays denied, because Android will not let the app raise it", async () => {
    /*
     * The one case the check cannot fix. Reporting it as denied is the true
     * answer: pages to this phone will not get through Do Not Disturb.
     */
    await appStarts();
    android.userChangesChannel(CRITICAL, { sound: "content://siren" });
    android.grantDoNotDisturbAccess();

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(false);
  });

  test("switched the bypass off after it was granted: the check never switches it back on", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();
    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );

    android.userChangesChannel(CRITICAL, { bypassDnd: false });

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Denied);
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(false);
  });

  test("changed the sound after it was granted: the bypass and the chosen sound both survive the check", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();
    await getCriticalAlertStatus();

    android.userChangesChannel(CRITICAL, { sound: "content://klaxon" });

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Granted);
    expect(android.stored(CRITICAL)?.sound).toBe("content://klaxon");
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(true);
  });

  test("let the channel override Do Not Disturb themselves: reported as granted", async () => {
    await appStarts();
    android.userChangesChannel(CRITICAL, { bypassDnd: true });

    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );
  });
});

describe("checking again and again", () => {
  test("repeated checks give the same answer and leave every other setting as Android stored it", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();

    const first: CriticalAlertStatus = await getCriticalAlertStatus();
    const storedAfterFirst: unknown = android.stored(CRITICAL);

    for (let check: number = 0; check < 5; check++) {
      expect(await getCriticalAlertStatus()).toEqual(first);
    }

    expect(android.stored(CRITICAL)).toEqual(storedAfterFirst);
  });

  test("access withdrawn later does not let the check switch a stored bypass off or on", async () => {
    await appStarts();
    android.grantDoNotDisturbAccess();
    await getCriticalAlertStatus();

    android.revokeDoNotDisturbAccess();
    await getCriticalAlertStatus();

    // Without the access the app's write cannot touch the bypass either way.
    expect(android.stored(CRITICAL)?.bypassDnd).toBe(true);
  });
});

describe("the channel the check writes", () => {
  test("is the one the server pages, with the critical channel's full definition", async () => {
    await getCriticalAlertStatus();

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      CRITICAL,
      CRITICAL_CHANNEL,
    );
  });

  test("is every critical channel, each alarm sound's included - the other channels are left to the app's start", async () => {
    /*
     * Each alarm sound pages on a channel of its own, and every one of them
     * has to be written again for Android to raise its bypass once the access
     * is granted - not only the chosen one, so a responder who picks another
     * alarm later finds it already ringing through.
     */
    await getCriticalAlertStatus();

    expect(
      android.writes.map((write: { id: string }) => {
        return write.id;
      }),
    ).toEqual([
      CRITICAL,
      "oncall_critical_klaxon",
      "oncall_critical_siren",
      "oncall_critical_digital",
      "oncall_critical_smoke_alarm",
      "oncall_critical_rising",
    ]);
    expect(
      android.writes.every((write: { requestedBypassDnd: boolean }) => {
        return write.requestedBypassDnd;
      }),
    ).toBe(true);
  });

  test("is not written at all on iOS, which has no channels", async () => {
    setPlatform("ios");
    jest
      .spyOn(Notifications, "getPermissionsAsync")
      .mockResolvedValue({ ios: { allowsCriticalAlerts: true } } as never);

    await getCriticalAlertStatus();

    expect(android.writes).toEqual([]);
  });

  test("is not written on a simulator, where the feature is not offered", async () => {
    setIsDevice(false);

    const status: CriticalAlertStatus = await getCriticalAlertStatus();

    expect(status.availability).toBe(CriticalAlertAvailability.Unsupported);
    expect(android.writes).toEqual([]);
  });
});
