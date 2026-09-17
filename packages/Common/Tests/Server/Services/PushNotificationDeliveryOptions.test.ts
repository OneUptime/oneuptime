import PushNotificationService, {
  ExpoDeliveryOptions,
} from "../../../Server/Services/PushNotificationService";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * getExpoDeliveryOptions is the single point that turns "this device opted into
 * critical alerts" into the payload fields that actually make a handset ring
 * through silent mode. It is the server's half of the three-way handshake
 * documented on PushNotificationMessage.isCriticalAlert, so every branch of it
 * is pinned here: a field quietly dropped from the critical branch is a page
 * that arrives silently to a sleeping responder, and a field wrongly present on
 * the non-critical branch is every ordinary notification screaming through Do
 * Not Disturb.
 */

function messageWith(
  overrides: Partial<PushNotificationMessage> = {},
): PushNotificationMessage {
  return {
    title: "Alert",
    body: "Something is on fire",
    ...overrides,
  };
}

describe("PushNotificationService.getExpoDeliveryOptions", () => {
  describe("a normal (non-critical) push", () => {
    test.each<[string, PushDeviceType]>([
      ["iOS", PushDeviceType.iOS],
      ["Android", PushDeviceType.Android],
    ])(
      "on %s uses a plain 'default' sound, never the critical sound object",
      (_label: string, deviceType: PushDeviceType) => {
        const options: ExpoDeliveryOptions =
          PushNotificationService.getExpoDeliveryOptions(
            messageWith({ isCriticalAlert: false }),
            deviceType,
          );

        expect(options.sound).toBe("default");
        expect(options.priority).toBe("high");
      },
    );

    test("carries NO interruptionLevel - that field is the iOS critical lever", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: false }),
          PushDeviceType.iOS,
        );

      expect(options.interruptionLevel).toBeUndefined();
    });

    test("an unset isCriticalAlert is treated exactly like false", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith(),
          PushDeviceType.iOS,
        );

      expect(options.sound).toBe("default");
      expect(options.interruptionLevel).toBeUndefined();
    });

    test("Android without the critical flag stays on the High channel", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: false }),
          PushDeviceType.Android,
        );

      expect(options.channelId).toBe(AndroidNotificationChannel.High);
    });

    test("iOS names the payload-sound 'default' channel, not an Android channel", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: false }),
          PushDeviceType.iOS,
        );

      expect(options.channelId).toBe("default");
    });
  });

  describe("a critical push", () => {
    test("iOS gets the critical sound object AND interruptionLevel 'critical'", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: true }),
          PushDeviceType.iOS,
        );

      /*
       * Both are required together: APNs ignores the ringer only when the
       * sound object says critical AND the interruption level is critical.
       */
      expect(options.sound).toEqual({
        critical: true,
        name: "default",
        volume: PushNotificationService.CRITICAL_ALERT_VOLUME,
      });
      expect(options.interruptionLevel).toBe("critical");
      expect(options.priority).toBe("high");
    });

    test("the critical volume is pinned to the maximum (1)", () => {
      /*
       * A critical alert exists to wake somebody; a quieter volume would
       * defeat the whole opt-in.
       */
      expect(PushNotificationService.CRITICAL_ALERT_VOLUME).toBe(1);

      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: true }),
          PushDeviceType.iOS,
        );

      expect((options.sound as { volume: number }).volume).toBe(1);
    });

    test("Android is moved to the Critical channel (its only lever for DND bypass)", () => {
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: true }),
          PushDeviceType.Android,
        );

      expect(options.channelId).toBe(AndroidNotificationChannel.Critical);
    });

    test("the critical sound object is sent on Android too, one shape for both platforms", () => {
      /*
       * The comment in source is explicit that keeping one shape avoids a
       * per-platform branch that could drop the iOS half; Android ignores it.
       */
      const options: ExpoDeliveryOptions =
        PushNotificationService.getExpoDeliveryOptions(
          messageWith({ isCriticalAlert: true }),
          PushDeviceType.Android,
        );

      expect(options.sound).toEqual({
        critical: true,
        name: "default",
        volume: PushNotificationService.CRITICAL_ALERT_VOLUME,
      });
      expect(options.interruptionLevel).toBe("critical");
    });
  });

  describe("the critical flag is the ONLY thing that changes the sound", () => {
    test.each<[PushDeviceType]>([
      [PushDeviceType.iOS],
      [PushDeviceType.Android],
      [PushDeviceType.Web],
    ])(
      "flipping isCriticalAlert flips the sound between plain and critical (%s)",
      (deviceType: PushDeviceType) => {
        const normal: ExpoDeliveryOptions =
          PushNotificationService.getExpoDeliveryOptions(
            messageWith({ isCriticalAlert: false }),
            deviceType,
          );
        const critical: ExpoDeliveryOptions =
          PushNotificationService.getExpoDeliveryOptions(
            messageWith({ isCriticalAlert: true }),
            deviceType,
          );

        expect(normal.sound).toBe("default");
        expect(critical.sound).not.toBe("default");
        expect(normal.interruptionLevel).toBeUndefined();
        expect(critical.interruptionLevel).toBe("critical");
      },
    );
  });

  describe("priority is always high", () => {
    test.each<[string, PushDeviceType, boolean]>([
      ["iOS normal", PushDeviceType.iOS, false],
      ["iOS critical", PushDeviceType.iOS, true],
      ["Android normal", PushDeviceType.Android, false],
      ["Android critical", PushDeviceType.Android, true],
    ])(
      "%s is delivered with priority 'high'",
      (_label: string, deviceType: PushDeviceType, isCritical: boolean) => {
        const options: ExpoDeliveryOptions =
          PushNotificationService.getExpoDeliveryOptions(
            messageWith({ isCriticalAlert: isCritical }),
            deviceType,
          );

        expect(options.priority).toBe("high");
      },
    );
  });
});
