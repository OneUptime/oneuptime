import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationService, {
  ExpoDeliveryOptions,
  ExpoPushSound,
} from "../../../Server/Services/PushNotificationService";
import logger from "../../../Server/Utils/Logger";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
} from "../../../Types/PushNotification/CriticalAlertSound";
import { CRITICAL_ALERT_VOLUME_OPTIONS } from "../../../Types/PushNotification/CriticalAlertVolume";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import API, { APIRequestOptions } from "../../../Utils/API";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";

/*
 * The alarm a device chose for critical pages, and on an iPhone how loud,
 * turned into what the push actually carries. The two platforms take the
 * choice through different fields, and a mistake on either is a page that
 * sounds wrong - or not at all - with nothing failing:
 *
 *   iOS     - the sound object names the bundled file and its volume. A file
 *             the app does not bundle plays the default sound; a volume of 0
 *             plays nothing.
 *   Android - the page names a channel, and the channel's sound plays. A
 *             channel the app never created delivers the page with default
 *             settings, which for an on-call page means SILENTLY.
 *
 * And an ordinary push must ignore the choice altogether: the sound and the
 * volume belong to critical pages only, and an owner-subscription push that
 * picked them up would ring a klaxon through Do Not Disturb.
 */

const DEVICE_TOKEN: string = "ExponentPushToken[sound-delivery-00001]";
const RECEIPT_ID: string = "7f3c9e1a-2b4d-4c6e-8f0a-1b2c3d4e5f60";

const PLATFORMS: Array<[string, PushDeviceType]> = [
  ["iOS", PushDeviceType.iOS],
  ["Android", PushDeviceType.Android],
];

const SOUND_CHANNELS: Array<string> = CRITICAL_ALERT_SOUNDS.map(
  (definition: CriticalAlertSoundDefinition): string => {
    return definition.androidChannelId;
  },
);

function page(
  overrides: Partial<PushNotificationMessage> = {},
): PushNotificationMessage {
  return {
    title: "Incident #42: Checkout is down",
    body: "A new incident has been created.",
    isCriticalAlert: true,
    ...overrides,
  };
}

function delivery(
  message: PushNotificationMessage,
  deviceType: PushDeviceType,
): ExpoDeliveryOptions {
  return PushNotificationService.getExpoDeliveryOptions(message, deviceType);
}

function soundObject(options: ExpoDeliveryOptions): {
  critical?: boolean;
  name?: string | null;
  volume?: number;
} {
  const sound: ExpoPushSound = options.sound;

  if (!sound || typeof sound !== "object") {
    throw new Error(
      `Expected a critical sound object, got ${JSON.stringify(sound)}.`,
    );
  }

  return sound;
}

// Every sound on every platform, as test.each rows.
const SOUND_ON_PLATFORM: Array<
  [string, string, CriticalAlertSoundDefinition, PushDeviceType]
> = [];

for (const definition of CRITICAL_ALERT_SOUNDS) {
  for (const [platformName, deviceType] of PLATFORMS) {
    SOUND_ON_PLATFORM.push([
      definition.sound,
      platformName,
      definition,
      deviceType,
    ]);
  }
}

describe("a critical page plays the sound its device chose", () => {
  test.each(SOUND_ON_PLATFORM)(
    "%s on %s: names the sound's file for iOS, at full volume when none was chosen",
    (
      _sound: string,
      _platform: string,
      definition: CriticalAlertSoundDefinition,
      deviceType: PushDeviceType,
    ) => {
      /*
       * Sent on Android too, where the channel has already decided the sound:
       * one shape for both platforms, so no per-platform branch can drop the
       * iOS half.
       */
      expect(
        delivery(page({ criticalAlertSound: definition.sound }), deviceType)
          .sound,
      ).toEqual({
        critical: true,
        name: definition.iosSoundName,
        volume: 1,
      });
    },
  );

  test.each(SOUND_ON_PLATFORM)(
    "%s on %s: still rings through silent mode and Do Not Disturb",
    (
      _sound: string,
      _platform: string,
      definition: CriticalAlertSoundDefinition,
      deviceType: PushDeviceType,
    ) => {
      const options: ExpoDeliveryOptions = delivery(
        page({ criticalAlertSound: definition.sound }),
        deviceType,
      );

      expect(options.interruptionLevel).toBe("critical");
      expect(options.priority).toBe("high");
      expect(soundObject(options).critical).toBe(true);
    },
  );

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, string, CriticalAlertSoundDefinition] => {
        return [definition.sound, definition.androidChannelId, definition];
      },
    ),
  )(
    "%s on Android goes on %s, the channel whose sound it is",
    (
      _sound: string,
      _channel: string,
      definition: CriticalAlertSoundDefinition,
    ) => {
      expect(
        delivery(
          page({ criticalAlertSound: definition.sound }),
          PushDeviceType.Android,
        ).channelId,
      ).toBe(definition.androidChannelId);
    },
  );

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [string] => {
        return [definition.sound];
      },
    ),
  )("%s on iOS names no Android channel - iOS has none", (sound: string) => {
    expect(
      delivery(page({ criticalAlertSound: sound }), PushDeviceType.iOS)
        .channelId,
    ).toBe("default");
  });

  test("each custom sound reaches each platform as itself, not as the default", () => {
    /*
     * The failure this whole feature can quietly have: every page still
     * "works", with the system sound, whatever the responder chose.
     */
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      if (definition.sound === CriticalAlertSound.Default) {
        continue;
      }

      const ios: ExpoDeliveryOptions = delivery(
        page({ criticalAlertSound: definition.sound }),
        PushDeviceType.iOS,
      );
      const android: ExpoDeliveryOptions = delivery(
        page({ criticalAlertSound: definition.sound }),
        PushDeviceType.Android,
      );

      expect(soundObject(ios).name).not.toBe("default");
      expect(android.channelId).not.toBe(AndroidNotificationChannel.Critical);
    }
  });

  test.each(PLATFORMS)(
    "a device that never chose is paged on %s exactly as before the choice existed",
    (_platform: string, deviceType: PushDeviceType) => {
      expect(delivery(page(), deviceType)).toEqual({
        channelId:
          deviceType === PushDeviceType.Android
            ? AndroidNotificationChannel.Critical
            : "default",
        sound: { critical: true, name: "default", volume: 1 },
        priority: "high",
        interruptionLevel: "critical",
      });
    },
  );

  test("the full-volume constant is what a device that never chose is paged at", () => {
    expect(PushNotificationService.CRITICAL_ALERT_VOLUME).toBe(1);
    expect(soundObject(delivery(page(), PushDeviceType.iOS)).volume).toBe(
      PushNotificationService.CRITICAL_ALERT_VOLUME,
    );
  });
});

describe("a critical page plays at the volume its device chose", () => {
  test.each(
    CRITICAL_ALERT_VOLUME_OPTIONS.map((volume: number): [number, number] => {
      return [volume, volume / 100];
    }),
  )("%s%% goes out as volume %s", (percent: number, volume: number) => {
    expect(
      soundObject(
        delivery(page({ criticalAlertVolume: percent }), PushDeviceType.iOS),
      ).volume,
    ).toBe(volume);
  });

  test("every sound at every step the app offers carries both, together", () => {
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      for (const percent of CRITICAL_ALERT_VOLUME_OPTIONS) {
        expect(
          delivery(
            page({
              criticalAlertSound: definition.sound,
              criticalAlertVolume: percent,
            }),
            PushDeviceType.iOS,
          ).sound,
        ).toEqual({
          critical: true,
          name: definition.iosSoundName,
          volume: percent / 100,
        });
      }
    }
  });

  test.each([
    ["missing", undefined],
    ["null, as a hand-built message may carry", null],
    ["not a number", "50"],
    ["NaN", NaN],
  ])(
    "a volume that is %s plays at full volume",
    (_label: string, stored: unknown) => {
      const message: PushNotificationMessage = page();
      (
        message as unknown as { criticalAlertVolume: unknown }
      ).criticalAlertVolume = stored;

      expect(soundObject(delivery(message, PushDeviceType.iOS)).volume).toBe(1);
    },
  );

  test.each([
    ["0, which would be silence", 0, 0.1],
    ["5, below the floor", 5, 0.1],
    ["-20", -20, 0.1],
    ["101, above full", 101, 1],
    ["250", 250, 1],
    ["a fraction, 55.5", 55.5, 0.56],
    ["1, which is a percentage here and not APNs' full volume", 1, 0.1],
  ])(
    "a stored volume of %s is pulled inside the bounds before it is sent",
    (_label: string, stored: number, volume: number) => {
      /*
       * Never written by this server, but a page must not go out silent, or
       * be refused for a volume above 1, because of a row that holds one.
       */
      expect(
        soundObject(
          delivery(page({ criticalAlertVolume: stored }), PushDeviceType.iOS),
        ).volume,
      ).toBe(volume);
    },
  );

  test("the volume never moves the Android channel - Android plays at the phone's alarm volume", () => {
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      const channels: Set<string> = new Set<string>();

      for (const percent of [10, ...CRITICAL_ALERT_VOLUME_OPTIONS, 0, 500]) {
        channels.add(
          delivery(
            page({
              criticalAlertSound: definition.sound,
              criticalAlertVolume: percent,
            }),
            PushDeviceType.Android,
          ).channelId,
        );
      }

      expect([...channels]).toEqual([definition.androidChannelId]);
    }
  });
});

describe("an ordinary push ignores the chosen sound and volume", () => {
  const ordinaryFlags: Array<[string, boolean | undefined]> = [
    ["isCriticalAlert false", false],
    ["no isCriticalAlert", undefined],
  ];

  for (const [flagName, isCriticalAlert] of ordinaryFlags) {
    for (const [platformName, deviceType] of PLATFORMS) {
      test(`${flagName} on ${platformName}: plays the plain default sound on the ordinary channel, whatever the device chose`, () => {
        /*
         * The choice is the responder's alarm for being woken. An owner
         * subscription or a page from a Standard rule follows the phone's
         * own settings, so it must come out exactly as it did before sounds
         * could be chosen - the same object, nothing added.
         */
        const expected: ExpoDeliveryOptions = {
          channelId:
            deviceType === PushDeviceType.Android
              ? AndroidNotificationChannel.High
              : "default",
          sound: "default",
          priority: "high",
        };

        for (const definition of CRITICAL_ALERT_SOUNDS) {
          for (const percent of [undefined, ...CRITICAL_ALERT_VOLUME_OPTIONS]) {
            const message: PushNotificationMessage = page({
              criticalAlertSound: definition.sound,
              criticalAlertVolume: percent,
            });

            if (isCriticalAlert === undefined) {
              delete message.isCriticalAlert;
            } else {
              message.isCriticalAlert = isCriticalAlert;
            }

            expect(delivery(message, deviceType)).toEqual(expected);
          }
        }
      });
    }
  }

  test("an ordinary Android push never lands on a sound's critical channel", () => {
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect(
        delivery(
          page({
            isCriticalAlert: false,
            criticalAlertSound: definition.sound,
          }),
          PushDeviceType.Android,
        ).channelId,
      ).toBe("oncall_high");
    }
  });
});

describe("a sound this server does not know falls back to the default", () => {
  const unknownSounds: Array<[string, unknown]> = [
    ["a sound a newer app might add", "foghorn"],
    ["a mis-cased id", "Klaxon"],
    ["an upper case id", "SIREN"],
    ["a padded id", " digital "],
    ["a file name", "oneuptime_rising.wav"],
    ["a channel id", "oncall_critical_siren"],
    ["an empty string", ""],
    ["null", null],
    ["a number", 3],
    ["an object", { sound: "klaxon" }],
  ];

  test.each(unknownSounds)(
    "%s pages Android on the original critical channel, which every app version created",
    (_label: string, sound: unknown) => {
      const message: PushNotificationMessage = page();
      (
        message as unknown as { criticalAlertSound: unknown }
      ).criticalAlertSound = sound;

      expect(delivery(message, PushDeviceType.Android).channelId).toBe(
        AndroidNotificationChannel.Critical,
      );
    },
  );

  test.each(unknownSounds)(
    "%s plays the system's critical sound on iOS",
    (_label: string, sound: unknown) => {
      const message: PushNotificationMessage = page({
        criticalAlertVolume: 50,
      });
      (
        message as unknown as { criticalAlertSound: unknown }
      ).criticalAlertSound = sound;

      expect(delivery(message, PushDeviceType.iOS).sound).toEqual({
        critical: true,
        name: "default",
        volume: 0.5,
      });
    },
  );

  test("an unknown sound is still a critical page - the fall-back is to the default sound, never to a quiet push", () => {
    const message: PushNotificationMessage = page({
      criticalAlertSound: "foghorn",
    });

    for (const [, deviceType] of PLATFORMS) {
      expect(delivery(message, deviceType).interruptionLevel).toBe("critical");
    }
  });
});

describe("Android is only ever sent a channel the sound list names", () => {
  test("over thousands of generated sound values, a critical page names a sound's channel and an ordinary one oncall_high", () => {
    const values: Array<unknown> = [
      ...CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): string => {
          return definition.sound;
        },
      ),
      ...generatedTexts(3000, 20261013, [
        "klaxon",
        "siren",
        "digital",
        "smoke",
        "_",
        "alarm",
        "rising",
        "default",
        "K",
        " ",
        "oncall_critical_",
        ".wav",
      ]),
      undefined,
      null,
      0,
      true,
      {},
    ];

    const criticalChannels: Set<string> = new Set<string>();

    for (const value of values) {
      const message: PushNotificationMessage = page();
      (
        message as unknown as { criticalAlertSound: unknown }
      ).criticalAlertSound = value;

      const critical: string = delivery(
        message,
        PushDeviceType.Android,
      ).channelId;

      message.isCriticalAlert = false;

      const ordinary: string = delivery(
        message,
        PushDeviceType.Android,
      ).channelId;

      expect(SOUND_CHANNELS).toContain(critical);
      expect(ordinary).toBe(AndroidNotificationChannel.High);

      criticalChannels.add(critical);
    }

    // Every sound's channel was reached, and nothing else.
    expect([...criticalChannels].sort()).toEqual([...SOUND_CHANNELS].sort());
  });

  test("every channel a page can name is listed in AndroidNotificationChannel, the ids the app creates its channels with", () => {
    const androidChannels: Array<string> = Object.values(
      AndroidNotificationChannel,
    );

    for (const channelId of [
      ...SOUND_CHANNELS,
      AndroidNotificationChannel.High,
    ]) {
      expect(androidChannels).toContain(channelId);
    }
  });
});

describe("the push that leaves the server carries the sound and volume", () => {
  let sentToExpo: Array<ExpoPushMessage>;
  let sentToRelay: Array<JSONObject>;

  beforeEach(() => {
    sentToExpo = [];
    sentToRelay = [];

    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (
        messages: Array<ExpoPushMessage>,
      ): Promise<Array<ExpoPushTicket>> => {
        sentToExpo.push(...messages);
        return [{ status: "ok", id: RECEIPT_ID }];
      }) as never);

    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ): Promise<HTTPResponse<JSONObject>> => {
      sentToRelay.push(options.data as JSONObject);
      return new HTTPResponse<JSONObject>(200, { success: true }, {});
    }) as never);

    // The receipt is read later from Redis; nothing here needs it.
    jest.spyOn(ExpoPushReceiptQueue, "add").mockResolvedValue(0 as never);

    // Push is on for the whole server (GlobalConfig.disablePushNotifications).
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function send(
    message: PushNotificationMessage,
    deviceType: PushDeviceType,
  ): Promise<void> {
    await PushNotificationService.sendPushNotification({
      devices: [{ token: DEVICE_TOKEN, name: "On-call phone" }],
      message: message,
      deviceType: deviceType,
    });
  }

  test.each(SOUND_ON_PLATFORM)(
    "%s on %s, sent with this server's own Expo credentials",
    async (
      _sound: string,
      _platform: string,
      definition: CriticalAlertSoundDefinition,
      deviceType: PushDeviceType,
    ) => {
      jest
        .spyOn(PushNotificationService, "hasExpoAccessToken")
        .mockReturnValue(true);

      await send(
        page({ criticalAlertSound: definition.sound, criticalAlertVolume: 75 }),
        deviceType,
      );

      expect(sentToRelay).toHaveLength(0);
      expect(sentToExpo).toHaveLength(1);
      expect(sentToExpo[0]?.sound).toEqual({
        critical: true,
        name: definition.iosSoundName,
        volume: 0.75,
      });
      expect(sentToExpo[0]).toMatchObject({
        to: DEVICE_TOKEN,
        channelId:
          deviceType === PushDeviceType.Android
            ? definition.androidChannelId
            : "default",
        priority: "high",
        interruptionLevel: "critical",
      });
    },
  );

  test.each(SOUND_ON_PLATFORM)(
    "%s on %s, sent through the push relay",
    async (
      _sound: string,
      _platform: string,
      definition: CriticalAlertSoundDefinition,
      deviceType: PushDeviceType,
    ) => {
      /*
       * The relay re-sends exactly what it is given, so the whole sound
       * object - file and volume - has to cross the wire, not the channel id
       * alone.
       */
      jest
        .spyOn(PushNotificationService, "hasExpoAccessToken")
        .mockReturnValue(false);

      await send(
        page({ criticalAlertSound: definition.sound, criticalAlertVolume: 25 }),
        deviceType,
      );

      expect(sentToExpo).toHaveLength(0);
      expect(sentToRelay).toHaveLength(1);
      expect(sentToRelay[0]?.["sound"]).toEqual({
        critical: true,
        name: definition.iosSoundName,
        volume: 0.25,
      });
      expect(sentToRelay[0]).toMatchObject({
        to: DEVICE_TOKEN,
        channelId:
          deviceType === PushDeviceType.Android
            ? definition.androidChannelId
            : "default",
        priority: "high",
        interruptionLevel: "critical",
      });
    },
  );

  test.each([
    ["with its own Expo credentials", true],
    ["through the push relay", false],
  ])(
    "an ordinary push sent %s carries the plain default sound and no interruption level, whatever the device chose",
    async (_path: string, hasExpoAccessToken: boolean) => {
      jest
        .spyOn(PushNotificationService, "hasExpoAccessToken")
        .mockReturnValue(hasExpoAccessToken);

      await send(
        page({
          isCriticalAlert: false,
          criticalAlertSound: CriticalAlertSound.SmokeAlarm,
          criticalAlertVolume: 25,
        }),
        PushDeviceType.Android,
      );

      const sent: Record<string, unknown> = (hasExpoAccessToken
        ? sentToExpo[0]
        : sentToRelay[0]) as unknown as Record<string, unknown>;

      expect(sent["sound"]).toBe("default");
      expect(sent["channelId"]).toBe(AndroidNotificationChannel.High);
      expect(sent).not.toHaveProperty("interruptionLevel");
    },
  );

  test("the chosen sound and volume are not sent as data the app would show or log", async () => {
    /*
     * They travel in the push's own sound fields. Nothing about the device's
     * preferences belongs in the notification's data payload.
     */
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    await send(
      page({
        criticalAlertSound: CriticalAlertSound.Siren,
        criticalAlertVolume: 50,
        data: { incidentId: "42" },
      }),
      PushDeviceType.iOS,
    );

    expect(sentToExpo[0]?.data).toEqual({ incidentId: "42" });
  });

  test("a page too long to send whole is cut, and keeps its sound and volume", async () => {
    /*
     * Text that would not fit is cut before it is sent (fitMessage). A cut
     * that rebuilt the message field by field would drop the alarm, and the
     * one page long enough to need cutting - a big incident - would go out
     * with the system sound.
     */
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    await send(
      page({
        body: "Checkout is down. ".repeat(2000),
        criticalAlertSound: CriticalAlertSound.Klaxon,
        criticalAlertVolume: 50,
      }),
      PushDeviceType.Android,
    );

    expect(String(sentToExpo[0]?.body).length).toBeLessThan(
      "Checkout is down. ".repeat(2000).length,
    );
    expect(sentToExpo[0]?.sound).toEqual({
      critical: true,
      name: "oneuptime_klaxon.wav",
      volume: 0.5,
    });
    expect(sentToExpo[0]?.channelId).toBe(
      AndroidNotificationChannel.CriticalKlaxon,
    );
  });

  test("a page from an installation with its own name keeps its sound and volume", async () => {
    /*
     * A renamed installation rewrites the page's text before it is sent
     * (ProductBrandingText.brandPushMessage); the alarm has to come through
     * that untouched.
     */
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);
    jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue({
      productName: "Acme Paging",
      faviconUrl: "/api/branding/favicon?v=1",
    });

    await send(
      page({
        title: "OneUptime: Checkout is down",
        criticalAlertSound: CriticalAlertSound.Rising,
        criticalAlertVolume: 75,
      }),
      PushDeviceType.iOS,
    );

    expect(sentToExpo[0]?.title).toContain("Acme Paging");
    expect(sentToExpo[0]?.sound).toEqual({
      critical: true,
      name: "oneuptime_rising.wav",
      volume: 0.75,
    });
  });

  test("the relay's own send hands Expo the sound object it was given", async () => {
    /*
     * The other half of a relayed page: the relay deployment's send, which
     * must pass the file name and volume on to Expo rather than flatten them
     * to "default".
     */
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    for (const definition of CRITICAL_ALERT_SOUNDS) {
      sentToExpo = [];

      await PushNotificationService.sendRelayPushNotification({
        to: DEVICE_TOKEN,
        title: "Incident #42",
        body: "Checkout is down",
        sound: { critical: true, name: definition.iosSoundName, volume: 0.5 },
        priority: "high",
        channelId: definition.androidChannelId,
        interruptionLevel: "critical",
      });

      expect(sentToExpo).toHaveLength(1);
      expect(sentToExpo[0]?.sound).toEqual({
        critical: true,
        name: definition.iosSoundName,
        volume: 0.5,
      });
      expect(sentToExpo[0]).toMatchObject({
        channelId: definition.androidChannelId,
        interruptionLevel: "critical",
      });
    }
  });
});
