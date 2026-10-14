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
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "./criticalAlertSounds";
import { setupNotificationChannels } from "./setup";
import { FakeAndroidNotificationChannels } from "../__tests__/fakeAndroidNotificationChannels";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Each alarm sound pages on an Android channel of its own, so "can this phone
 * ring through Do Not Disturb?" has become "can the chosen sound's channel?".
 * A status read off the system sound's channel would tell a responder who
 * picked the klaxon they were covered while the klaxon channel stayed silent.
 *
 * Driven against a fake of Android's own channel rules
 * (fakeAndroidNotificationChannels), not a mock that flips answers.
 */

let android: FakeAndroidNotificationChannels;

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

const SOUND_CHANNELS: Array<[CriticalAlertSoundIdValue, string]> =
  CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
    return [option.id, option.channelId] as [CriticalAlertSoundIdValue, string];
  });

beforeEach(() => {
  setPlatform("android");
  setIsDevice(true);
  android = new FakeAndroidNotificationChannels();
  android.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the app's start", () => {
  test("creates a channel for every alarm sound, playing that sound", async () => {
    await setupNotificationChannels();

    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(android.stored(option.channelId)?.sound).toBe(
        option.fileName ?? "default",
      );
    }
  });

  test("before Do Not Disturb access, none of them bypasses it", async () => {
    await setupNotificationChannels();

    for (const [, channelId] of SOUND_CHANNELS) {
      expect(android.stored(channelId)?.bypassDnd).toBe(false);
    }
  });

  test("with the access already granted, every one bypasses it from the start", async () => {
    android.grantDoNotDisturbAccess();

    await setupNotificationChannels();

    for (const [, channelId] of SOUND_CHANNELS) {
      expect(android.stored(channelId)?.bypassDnd).toBe(true);
    }
  });
});

describe("granting Do Not Disturb access while the app runs", () => {
  test.each(SOUND_CHANNELS)(
    "the next check reports the %s sound as granted",
    async (sound: CriticalAlertSoundIdValue) => {
      await setupNotificationChannels();
      expect(
        (await getCriticalAlertStatus({ sound: sound })).availability,
      ).toBe(CriticalAlertAvailability.Denied);

      android.grantDoNotDisturbAccess();

      expect(
        (await getCriticalAlertStatus({ sound: sound })).availability,
      ).toBe(CriticalAlertAvailability.Granted);
    },
  );

  test("one check raises the bypass on every sound's channel, so switching alarms later needs no second trip", async () => {
    await setupNotificationChannels();
    android.grantDoNotDisturbAccess();

    await getCriticalAlertStatus();

    for (const [, channelId] of SOUND_CHANNELS) {
      expect(android.stored(channelId)?.bypassDnd).toBe(true);
    }
    expect(
      (await getCriticalAlertStatus({ sound: "rising" })).availability,
    ).toBe(CriticalAlertAvailability.Granted);
  });

  test("the round trip through the access screen ends granted for the chosen sound", async () => {
    jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined as never);
    await setupNotificationChannels();

    const whileAway: CriticalAlertStatus = await requestCriticalAlertPermission(
      { sound: "smoke_alarm" },
    );

    expect(whileAway.availability).toBe(CriticalAlertAvailability.Denied);

    android.grantDoNotDisturbAccess();

    expect(
      (await getCriticalAlertStatus({ sound: "smoke_alarm" })).availability,
    ).toBe(CriticalAlertAvailability.Granted);
  });
});

describe("the chosen sound's channel is the one that answers", () => {
  test("a klaxon channel the responder changed before granting access stays denied for the klaxon - and only for it", async () => {
    /*
     * Android locks a channel the user changed: the app can no longer raise
     * its bypass. Pages with the klaxon would arrive silently in Do Not
     * Disturb, so the klaxon must read as denied even though every other
     * sound's channel is fine.
     */
    await setupNotificationChannels();
    android.userChangesChannel("oncall_critical_klaxon", {
      sound: "content://ringtone",
    });
    android.grantDoNotDisturbAccess();

    expect(
      (await getCriticalAlertStatus({ sound: "klaxon" })).availability,
    ).toBe(CriticalAlertAvailability.Denied);
    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Granted,
    );
    expect(
      (await getCriticalAlertStatus({ sound: "siren" })).availability,
    ).toBe(CriticalAlertAvailability.Granted);
  });

  test("a siren channel whose bypass the responder switched off reads as denied for the siren", async () => {
    await setupNotificationChannels();
    android.grantDoNotDisturbAccess();
    await getCriticalAlertStatus();

    android.userChangesChannel("oncall_critical_siren", { bypassDnd: false });

    expect(
      (await getCriticalAlertStatus({ sound: "siren" })).availability,
    ).toBe(CriticalAlertAvailability.Denied);
    // And the check never switches it back on.
    expect(android.stored("oncall_critical_siren")?.bypassDnd).toBe(false);
  });

  test("a sound channel the responder let through Do Not Disturb themselves reads as granted", async () => {
    await setupNotificationChannels();
    android.userChangesChannel("oncall_critical_digital", { bypassDnd: true });

    expect(
      (await getCriticalAlertStatus({ sound: "digital" })).availability,
    ).toBe(CriticalAlertAvailability.Granted);
    expect((await getCriticalAlertStatus()).availability).toBe(
      CriticalAlertAvailability.Denied,
    );
  });

  test("no sound given is the system sound's channel", async () => {
    await setupNotificationChannels();
    android.userChangesChannel("oncall_critical", { bypassDnd: true });

    expect(await isCriticalChannelBypassingDnd()).toBe(true);
    expect(await isCriticalChannelBypassingDnd("klaxon")).toBe(false);
  });

  test("a sound this build does not know is answered for the system sound, the one every phone has", async () => {
    await setupNotificationChannels();
    android.userChangesChannel("oncall_critical", { bypassDnd: true });

    expect(
      await isCriticalChannelBypassingDnd(
        "foghorn" as CriticalAlertSoundIdValue,
      ),
    ).toBe(true);
  });
});

describe("when writing the chosen sound's channel fails", () => {
  test("the answer is read back from that channel, not the system sound's", async () => {
    android.grantDoNotDisturbAccess();
    await setupNotificationChannels();

    const write: jest.SpyInstance =
      Notifications.setNotificationChannelAsync as unknown as jest.SpyInstance;
    write.mockImplementation(async (id: string) => {
      throw new Error(`binder died writing ${id}`);
    });
    const read: jest.SpyInstance =
      Notifications.getNotificationChannelAsync as unknown as jest.SpyInstance;

    expect(await isCriticalChannelBypassingDnd("rising")).toBe(true);
    expect(read).toHaveBeenCalledWith("oncall_critical_rising");
    expect(read).not.toHaveBeenCalledWith("oncall_critical");
  });

  test("a failed write of another sound's channel does not stop the chosen one being written and answered", async () => {
    await setupNotificationChannels();
    android.grantDoNotDisturbAccess();

    const write: jest.SpyInstance =
      Notifications.setNotificationChannelAsync as unknown as jest.SpyInstance;
    const realWrite: (
      id: string,
      channel: Notifications.NotificationChannelInput,
    ) => Promise<Notifications.NotificationChannel | null> =
      write.getMockImplementation() as never;
    write.mockImplementation(
      async (id: string, channel: Notifications.NotificationChannelInput) => {
        if (id === "oncall_critical_klaxon") {
          throw new Error("binder died");
        }
        return realWrite(id, channel);
      },
    );

    expect(await isCriticalChannelBypassingDnd("smoke_alarm")).toBe(true);
    expect(android.stored("oncall_critical_smoke_alarm")?.bypassDnd).toBe(true);
  });

  test("a failed write and a failed read are denied, not guessed", async () => {
    await setupNotificationChannels();

    (
      Notifications.setNotificationChannelAsync as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("binder died") as never);
    (
      Notifications.getNotificationChannelAsync as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("binder died") as never);

    expect(
      (await getCriticalAlertStatus({ sound: "klaxon" })).availability,
    ).toBe(CriticalAlertAvailability.Denied);
  });
});

describe("on iOS the sound changes nothing about the permission", () => {
  test.each(SOUND_CHANNELS)(
    "%s is granted when iOS allows critical alerts, with no channel written",
    async (sound: CriticalAlertSoundIdValue) => {
      setPlatform("ios");
      jest.spyOn(Notifications, "getPermissionsAsync").mockResolvedValue({
        status: "granted",
        ios: { allowsCriticalAlerts: true },
      } as never);

      expect(
        (await getCriticalAlertStatus({ sound: sound })).availability,
      ).toBe(CriticalAlertAvailability.Granted);
      expect(android.writes).toEqual([]);
    },
  );
});
