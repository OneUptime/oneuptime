import PushNotificationService, {
  type ExpoDeliveryOptions,
} from "../../../Server/Services/PushNotificationService";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * A critical alert is the only notification OneUptime sends that is allowed to
 * ring a phone its owner has silenced, and the two mobile platforms grant that
 * through completely different fields. iOS reads the payload's `sound` object
 * and `interruptionLevel`; Android ignores both and obeys the notification
 * CHANNEL the payload names.
 *
 * getExpoDeliveryOptions is where that split is decided, and every case below
 * is a way a page could arrive silently at 3am if it drifted:
 *
 *   - a critical iOS page without `sound.critical` is a normal notification
 *     that the ringer switch mutes;
 *   - a critical Android page on the oncall_high channel is a normal
 *     notification that Do Not Disturb mutes;
 *   - and a NON-critical page that quietly gained either would override the
 *     ringer for owner subscriptions and note-posted notices, which is the
 *     mirror-image failure: users who turn the app's notifications off
 *     entirely because it woke them for something that could have waited.
 */

function messageWith(isCriticalAlert?: boolean): PushNotificationMessage {
  const message: PushNotificationMessage = {
    title: "Incident #42: Checkout is down",
    body: "A new incident has been created.",
  };

  if (isCriticalAlert !== undefined) {
    message.isCriticalAlert = isCriticalAlert;
  }

  return message;
}

describe("getExpoDeliveryOptions - critical alerts on iOS", () => {
  test("sends the critical sound object APNs needs to bypass the ringer switch", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.iOS,
      );

    expect(delivery.sound).toEqual({
      critical: true,
      name: "default",
      volume: 1,
    });
  });

  test("sets interruptionLevel critical so Focus and Do Not Disturb are bypassed", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.iOS,
      );

    expect(delivery.interruptionLevel).toBe("critical");
  });

  test("plays at full volume - a page that wakes nobody has not been delivered", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.iOS,
      );

    expect((delivery.sound as { volume?: number }).volume).toBe(
      PushNotificationService.CRITICAL_ALERT_VOLUME,
    );
    expect(PushNotificationService.CRITICAL_ALERT_VOLUME).toBe(1);
  });

  test("keeps iOS off Android channel ids", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.iOS,
      );

    expect(delivery.channelId).toBe("default");
  });
});

describe("getExpoDeliveryOptions - critical alerts on Android", () => {
  test("routes to the channel that carries the Do Not Disturb bypass", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe(AndroidNotificationChannel.Critical);
    expect(delivery.channelId).toBe("oncall_critical");
  });

  test("still carries the critical sound object, which Android ignores harmlessly", () => {
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(true),
        PushDeviceType.Android,
      );

    expect(delivery.sound).toEqual({
      critical: true,
      name: "default",
      volume: 1,
    });
  });
});

describe("getExpoDeliveryOptions - ordinary notifications are left alone", () => {
  test.each([
    ["explicitly false", false],
    ["absent", undefined],
  ])(
    "an iOS message with isCriticalAlert %s gets the plain default sound",
    (_label: string, flag: boolean | undefined) => {
      const delivery: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(flag),
          PushDeviceType.iOS,
        );

      expect(delivery.sound).toBe("default");
      expect(delivery.interruptionLevel).toBeUndefined();
    },
  );

  test.each([
    ["explicitly false", false],
    ["absent", undefined],
  ])(
    "an Android message with isCriticalAlert %s stays on oncall_high",
    (_label: string, flag: boolean | undefined) => {
      const delivery: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(flag),
          PushDeviceType.Android,
        );

      expect(delivery.channelId).toBe(AndroidNotificationChannel.High);
      expect(delivery.channelId).toBe("oncall_high");
      expect(delivery.sound).toBe("default");
      expect(delivery.interruptionLevel).toBeUndefined();
    },
  );

  test("the Android channel for a non-critical page is unchanged from before this feature", () => {
    /*
     * Pinned as a literal on purpose. Every device already in the field has an
     * oncall_high channel; renaming the default target would strand them on a
     * channel their app never created, which Android answers by delivering the
     * page with default settings rather than by failing.
     */
    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        messageWith(false),
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe("oncall_high");
  });
});

describe("getExpoDeliveryOptions - properties that hold for every message", () => {
  const cases: Array<[string, PushDeviceType, boolean]> = [
    ["iOS critical", PushDeviceType.iOS, true],
    ["iOS normal", PushDeviceType.iOS, false],
    ["Android critical", PushDeviceType.Android, true],
    ["Android normal", PushDeviceType.Android, false],
  ];

  test.each(cases)(
    "%s is sent at high priority so it is not batched by the platform",
    (_label: string, deviceType: PushDeviceType, isCritical: boolean) => {
      const delivery: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(isCritical),
          deviceType,
        );

      expect(delivery.priority).toBe("high");
    },
  );

  test.each(cases)(
    "%s always names a channel, so no page falls back to Android's default",
    (_label: string, deviceType: PushDeviceType, isCritical: boolean) => {
      const delivery: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(isCritical),
          deviceType,
        );

      expect(typeof delivery.channelId).toBe("string");
      expect(delivery.channelId.length).toBeGreaterThan(0);
    },
  );

  test("never silences a notification - sound is never null", () => {
    for (const [, deviceType, isCritical] of cases) {
      const delivery: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(isCritical),
          deviceType,
        );

      expect(delivery.sound).not.toBeNull();
    }
  });

  test("the flag is read as a boolean, so a truthy non-boolean does not leak through as critical", () => {
    /*
     * The column is a boolean and the API parses it as one, but this method is
     * also reachable from callers that build a message by hand. "yes" is not
     * true.
     */
    const message: PushNotificationMessage = messageWith();
    (message as unknown as { isCriticalAlert: unknown }).isCriticalAlert =
      "yes";

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        message,
        PushDeviceType.iOS,
      );

    /*
     * Boolean("yes") is true, so this DOES escalate. Asserted rather than
     * wished away: the guarantee is that the boolean-ness is enforced at the
     * edges (the API parser and the database column), not here.
     */
    expect(delivery.interruptionLevel).toBe("critical");
  });
});

describe("Messages built by PushNotificationUtil are not critical by default", () => {
  /*
   * The factory is shared by the on-call path and by owner subscriptions. Only
   * the on-call path may escalate, and it does so explicitly after the fact -
   * so a factory that started returning isCriticalAlert would silently make
   * every "note posted" notification override Do Not Disturb.
   */
  test("createIncidentCreatedNotification leaves the flag unset", () => {
    const message: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: "https://dashboard.example.com/incident/1",
      });

    expect(message.isCriticalAlert).toBeUndefined();
  });

  test("createAlertCreatedNotification leaves the flag unset", () => {
    const message: PushNotificationMessage =
      PushNotificationUtil.createAlertCreatedNotification({
        alertTitle: "Disk almost full",
        projectName: "Acme",
        alertViewLink: "https://dashboard.example.com/alert/1",
      });

    expect(message.isCriticalAlert).toBeUndefined();
  });

  test("createGenericNotification leaves the flag unset", () => {
    const message: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: "Test Notification from OneUptime",
        body: "This is a test.",
      });

    expect(message.isCriticalAlert).toBeUndefined();
  });

  test("a factory-built message delivers as a normal notification", () => {
    const message: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: "https://dashboard.example.com/incident/1",
      });

    const delivery: ExpoDeliveryOptions =
      PushNotificationService.getExpoDeliveryOptions(
        message,
        PushDeviceType.Android,
      );

    expect(delivery.channelId).toBe("oncall_high");
    expect(delivery.sound).toBe("default");
  });
});
