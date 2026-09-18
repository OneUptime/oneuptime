import * as Notifications from "expo-notifications";
import {
  CRITICAL_CHANNEL,
  HIGH_CHANNEL,
  LOW_CHANNEL,
  NORMAL_CHANNEL,
  NOTIFICATION_CHANNELS,
  NotificationChannelId,
} from "./channels";
import { describe, expect, test } from "@jest/globals";

/*
 * On Android, a channel's settings are frozen when the channel is created and
 * the app can never raise them again - that is a platform guarantee protecting
 * users from apps that get louder after install. It also means every property
 * below is a one-way door: shipping the critical channel with the wrong
 * importance, the wrong audio usage, or bypassDnd missing does not fail at
 * build time, does not error at runtime, and cannot be fixed by an update for
 * anybody who already installed the app. It can only be fixed by shipping a
 * NEW channel id.
 *
 * So these are not "does the object have the field" tests. Each one is a
 * property that, wrong at release, permanently silences on-call pages for
 * every handset that installed that build.
 */

describe("The critical channel is what overrides silent mode", () => {
  test("bypasses Do Not Disturb", () => {
    /*
     * The single field that makes this channel different from oncall_high.
     * Android grants it only once the user allows Do Not Disturb access, but
     * the channel has to ASK for it at creation - a channel created without it
     * can never gain it.
     */
    expect(CRITICAL_CHANNEL.bypassDnd).toBe(true);
  });

  test("plays on the alarm stream, which survives the ringer switch", () => {
    /*
     * The other half of "override silent mode", and the half that needs no
     * permission at all: a silenced phone still plays alarms. Without this,
     * granting Do Not Disturb access covers DND but not a plain muted phone.
     */
    expect(CRITICAL_CHANNEL.audioAttributes?.usage).toBe(
      Notifications.AndroidAudioUsage.ALARM,
    );
  });

  test("asks the system not to duck the sound for whatever else is playing", () => {
    expect(CRITICAL_CHANNEL.audioAttributes?.flags?.enforceAudibility).toBe(
      true,
    );
  });

  test("is sonification, not media - so it is not treated as content playback", () => {
    expect(CRITICAL_CHANNEL.audioAttributes?.contentType).toBe(
      Notifications.AndroidAudioContentType.SONIFICATION,
    );
  });

  test("uses MAX importance, without which there is no sound and no heads-up", () => {
    expect(CRITICAL_CHANNEL.importance).toBe(
      Notifications.AndroidImportance.MAX,
    );
  });

  test("actually has a sound", () => {
    /*
     * A channel with sound: null is silent no matter what else it declares,
     * which would make every other assertion in this file meaningless.
     */
    expect(CRITICAL_CHANNEL.sound).toBe("default");
  });

  test("vibrates as well, for a phone that is face-down or in a pocket", () => {
    expect(CRITICAL_CHANNEL.enableVibrate).toBe(true);
    expect(CRITICAL_CHANNEL.vibrationPattern?.length).toBeGreaterThan(0);
  });

  test("shows on the lock screen, so the page is readable without unlocking", () => {
    expect(CRITICAL_CHANNEL.lockscreenVisibility).toBe(
      Notifications.AndroidNotificationVisibility.PUBLIC,
    );
  });

  test("is named so a responder can find it in Android's notification settings", () => {
    expect(CRITICAL_CHANNEL.name).toBe("Critical On-Call Alerts");
    expect(CRITICAL_CHANNEL.description).toContain("Do Not Disturb");
  });
});

describe("The ordinary channels stay ordinary", () => {
  test.each([
    ["high", HIGH_CHANNEL],
    ["normal", NORMAL_CHANNEL],
    ["low", LOW_CHANNEL],
  ])(
    "the %s channel does not bypass Do Not Disturb",
    (_label: string, channel: Notifications.NotificationChannelInput) => {
      /*
       * These carry every notification for a responder who has NOT opted in.
       * A bypassDnd that crept onto oncall_high would override the ringer for
       * everybody, permanently, with no setting to turn it back off.
       */
      expect(channel.bypassDnd).toBeFalsy();
    },
  );

  test.each([
    ["high", HIGH_CHANNEL],
    ["normal", NORMAL_CHANNEL],
    ["low", LOW_CHANNEL],
  ])(
    "the %s channel does not use the alarm audio stream",
    (_label: string, channel: Notifications.NotificationChannelInput) => {
      expect(channel.audioAttributes?.usage).toBeUndefined();
    },
  );

  test("the high channel is still loud enough for a page", () => {
    expect(HIGH_CHANNEL.importance).toBe(Notifications.AndroidImportance.HIGH);
    expect(HIGH_CHANNEL.sound).toBe("default");
  });

  test("the low channel makes no sound", () => {
    expect(LOW_CHANNEL.importance).toBe(Notifications.AndroidImportance.LOW);
    expect(LOW_CHANNEL.sound).toBeUndefined();
  });
});

describe("Channel ids match the contract the server sends", () => {
  /*
   * The server names a channel by string id. An id it sends that the app never
   * created does not error - Android delivers the notification with default
   * settings, which for an on-call page means silently. These literals are the
   * shared contract with
   * Common/Types/PushNotification/AndroidNotificationChannel.ts.
   */
  test("the critical channel id is oncall_critical", () => {
    expect(NotificationChannelId.CRITICAL).toBe("oncall_critical");
  });

  test("the default on-call channel id is oncall_high", () => {
    expect(NotificationChannelId.HIGH).toBe("oncall_high");
  });

  test("the remaining ids are unchanged", () => {
    expect(NotificationChannelId.NORMAL).toBe("oncall_normal");
    expect(NotificationChannelId.LOW).toBe("oncall_low");
  });

  test("every id the app creates is distinct", () => {
    const ids: Array<string> = NOTIFICATION_CHANNELS.map(
      (entry: { id: string }) => {
        return entry.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all four channels are registered for creation", () => {
    expect(
      NOTIFICATION_CHANNELS.map((entry: { id: string }) => {
        return entry.id;
      }),
    ).toEqual([
      "oncall_critical",
      "oncall_high",
      "oncall_normal",
      "oncall_low",
    ]);
  });

  test("the critical id maps to the critical channel definition", () => {
    const entry: { channel: Notifications.NotificationChannelInput } =
      NOTIFICATION_CHANNELS.find((candidate: { id: string }) => {
        return candidate.id === "oncall_critical";
      })!;

    expect(entry.channel).toBe(CRITICAL_CHANNEL);
    expect(entry.channel.bypassDnd).toBe(true);
  });
});
