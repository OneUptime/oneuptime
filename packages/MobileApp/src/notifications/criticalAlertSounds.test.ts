import * as Notifications from "expo-notifications";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  CRITICAL_ALERT_VOLUME_OPTIONS,
  CriticalAlertSoundId,
  DEFAULT_CRITICAL_ALERT_SOUND,
  DEFAULT_CRITICAL_ALERT_VOLUME,
  getCriticalAlertSoundOption,
  getCriticalAlertVolume,
  isCriticalAlertSoundId,
  isCriticalAlertVolumeOption,
  type CriticalAlertSoundOption,
} from "./criticalAlertSounds";
import {
  CRITICAL_CHANNEL,
  CRITICAL_CHANNELS,
  CRITICAL_SOUND_CHANNELS,
  NOTIFICATION_CHANNELS,
  NotificationChannelId,
} from "./channels";
import { describe, expect, test } from "@jest/globals";

/*
 * The alarms a critical page can play. Every one is a promise in three
 * places at once - the server names it in the page, iOS has to find its file
 * in the app, and Android has to have a channel that plays it - and none of
 * them fails loudly when it is broken: iOS falls back to the default sound,
 * and Android delivers a page on a missing channel silently. So the list is
 * held, entry by entry, to the channels that play it.
 */

function channelFor(
  id: string,
): Notifications.NotificationChannelInput | undefined {
  return CRITICAL_CHANNELS.find((entry: { id: string }) => {
    return entry.id === id;
  })?.channel;
}

describe("The sounds on offer", () => {
  test("are the system sound and five alarms, in the order the screen lists them", () => {
    expect(
      CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
        return option.id;
      }),
    ).toEqual([
      "default",
      "klaxon",
      "siren",
      "digital",
      "smoke_alarm",
      "rising",
    ]);
  });

  test("the ids are the server's (Common CriticalAlertSound)", () => {
    expect(CriticalAlertSoundId).toEqual({
      DEFAULT: "default",
      KLAXON: "klaxon",
      SIREN: "siren",
      DIGITAL: "digital",
      SMOKE_ALARM: "smoke_alarm",
      RISING: "rising",
    });
  });

  test("the titles are the server's, word for word", () => {
    expect(
      CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
        return option.title;
      }),
    ).toEqual([
      "System default",
      "Klaxon",
      "Siren",
      "Digital alarm",
      "Smoke alarm",
      "Rising alarm",
    ]);
  });

  test("every sound says what it sounds like", () => {
    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(option.description.length).toBeGreaterThan(10);
      expect(option.description.endsWith(".")).toBe(true);
    }
  });

  test("ids, titles, files and channels are each used once", () => {
    for (const field of ["id", "title", "fileName", "channelId"] as const) {
      const values: Array<unknown> = CRITICAL_ALERT_SOUND_OPTIONS.map(
        (option: CriticalAlertSoundOption) => {
          return option[field];
        },
      );

      expect(new Set(values).size).toBe(values.length);
    }
  });

  test("the system sound is the default, and the only one without a file", () => {
    expect(DEFAULT_CRITICAL_ALERT_SOUND).toBe("default");
    expect(CRITICAL_ALERT_SOUND_OPTIONS[0]!.id).toBe("default");

    const withoutFile: Array<string> = CRITICAL_ALERT_SOUND_OPTIONS.filter(
      (option: CriticalAlertSoundOption) => {
        return option.fileName === null;
      },
    ).map((option: CriticalAlertSoundOption) => {
      return option.id;
    });

    expect(withoutFile).toEqual(["default"]);
  });

  test("the system sound pages on the original critical channel, which every version of the app created", () => {
    expect(getCriticalAlertSoundOption("default").channelId).toBe(
      NotificationChannelId.CRITICAL,
    );
  });

  test("each file name is one Android accepts as a raw resource and iOS plays", () => {
    /*
     * Android resource names allow lowercase letters, digits and underscores
     * and must not start with a digit; the build fails on anything else. iOS
     * plays .wav (linear PCM) notification sounds from the bundle.
     */
    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      if (option.fileName === null) {
        continue;
      }

      expect(option.fileName).toMatch(/^[a-z][a-z0-9_]*\.wav$/);
      expect(option.fileName).toBe(`oneuptime_${option.id}.wav`);
    }
  });

  test("a preview lasts as long as its sound, and no sound outlasts iOS's 30 seconds", () => {
    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(option.previewSeconds).toBeGreaterThan(0);
      expect(option.previewSeconds).toBeLessThan(30);
    }
  });
});

describe("Every sound has the channel that plays it", () => {
  test.each(
    CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
      return [option.id, option] as [string, CriticalAlertSoundOption];
    }),
  )(
    "%s pages on a critical channel the app creates, which plays its file",
    (_id: string, option: CriticalAlertSoundOption) => {
      const channel: Notifications.NotificationChannelInput | undefined =
        channelFor(option.channelId);

      expect(channel).toBeDefined();
      expect(channel!.sound).toBe(option.fileName ?? "default");
      expect(channel!.bypassDnd).toBe(true);
      expect(
        NOTIFICATION_CHANNELS.some((entry: { id: string }) => {
          return entry.id === option.channelId;
        }),
      ).toBe(true);
    },
  );

  test("there is no critical channel without a sound, and no sound without one", () => {
    expect(
      CRITICAL_CHANNELS.map((entry: { id: string }) => {
        return entry.id;
      }).sort(),
    ).toEqual(
      CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
        return option.channelId;
      }).sort(),
    );
    expect(CRITICAL_SOUND_CHANNELS).toHaveLength(
      CRITICAL_ALERT_SOUND_OPTIONS.length - 1,
    );
  });

  test("the system sound's channel is still the original definition, untouched", () => {
    /*
     * Android froze that channel on every phone that has it. Changing its
     * definition here would change nothing on those phones and quietly differ
     * on new ones.
     */
    expect(channelFor(NotificationChannelId.CRITICAL)).toBe(CRITICAL_CHANNEL);
  });
});

describe("isCriticalAlertSoundId", () => {
  test.each(["default", "klaxon", "siren", "digital", "smoke_alarm", "rising"])(
    "accepts %s",
    (value: string) => {
      expect(isCriticalAlertSoundId(value)).toBe(true);
    },
  );

  test.each([
    ["an unknown sound", "foghorn"],
    ["the wrong case", "Klaxon"],
    ["padding", " klaxon "],
    ["a title instead of an id", "Smoke alarm"],
    ["a file name instead of an id", "oneuptime_klaxon.wav"],
    ["a channel instead of an id", "oncall_critical_klaxon"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["an object", { id: "klaxon" }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(isCriticalAlertSoundId(value)).toBe(false);
  });
});

describe("getCriticalAlertSoundOption", () => {
  test("finds each sound by its id", () => {
    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(getCriticalAlertSoundOption(option.id)).toBe(option);
    }
  });

  test.each([["foghorn"], [""], [null], [undefined], [42], ["KLAXON"]])(
    "anything else (%p) is the system sound, which every phone can play",
    (value: unknown) => {
      expect(getCriticalAlertSoundOption(value).id).toBe("default");
    },
  );
});

describe("The iPhone volume steps", () => {
  test("are a quarter, a half, three quarters and full, full by default", () => {
    expect(CRITICAL_ALERT_VOLUME_OPTIONS).toEqual([25, 50, 75, 100]);
    expect(DEFAULT_CRITICAL_ALERT_VOLUME).toBe(100);
  });

  test("never offer silence: a critical alert exists to wake somebody", () => {
    for (const volume of CRITICAL_ALERT_VOLUME_OPTIONS) {
      expect(volume).toBeGreaterThanOrEqual(10);
      expect(volume).toBeLessThanOrEqual(100);
      expect(Number.isInteger(volume)).toBe(true);
    }
  });

  test.each([25, 50, 75, 100])("%d is a step", (volume: number) => {
    expect(isCriticalAlertVolumeOption(volume)).toBe(true);
    expect(getCriticalAlertVolume(volume)).toBe(volume);
  });

  test.each([0, 10, 60, 99, 101, -25, 25.5, Number.NaN, "50", null, undefined])(
    "%p is not a step, and reads as full volume",
    (value: unknown) => {
      expect(isCriticalAlertVolumeOption(value)).toBe(false);
      expect(getCriticalAlertVolume(value)).toBe(100);
    },
  );
});
