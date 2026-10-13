import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
  DEFAULT_CRITICAL_ALERT_SOUND,
  getCriticalAlertSound,
  getCriticalAlertSoundDefinition,
  isCriticalAlertSound,
} from "../../../Types/PushNotification/CriticalAlertSound";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * The alarm a critical on-call page plays, chosen per device in the mobile
 * app. The list is a contract three ways - the database stores the id, iOS
 * plays the file the push names, and Android plays the sound of the channel
 * the push names - and every way it can drift is silent:
 *
 *   - an iOS push naming a file the app does not bundle plays the default
 *     critical sound, so the responder's choice quietly does nothing;
 *   - an Android push naming a channel the app never created is delivered
 *     with default settings, which for an on-call page means SILENTLY - the
 *     page arrives and nobody wakes up;
 *   - a stored id this build reads differently (a case change, a rename)
 *     pages the device with the wrong sound or none of its choosing.
 *
 * So the ids, the files, the channels and the fall-back for anything unknown
 * are all pinned here. CriticalAlertSoundMobileParity.test.ts holds this list
 * to the app's own copy.
 */

const ALL_SOUNDS: Array<CriticalAlertSound> = [
  CriticalAlertSound.Default,
  CriticalAlertSound.Klaxon,
  CriticalAlertSound.Siren,
  CriticalAlertSound.Digital,
  CriticalAlertSound.SmokeAlarm,
  CriticalAlertSound.Rising,
];

const CUSTOM_SOUNDS: Array<CriticalAlertSoundDefinition> =
  CRITICAL_ALERT_SOUNDS.filter(
    (definition: CriticalAlertSoundDefinition): boolean => {
      return definition.sound !== CriticalAlertSound.Default;
    },
  );

function definitionOf(sound: CriticalAlertSound): CriticalAlertSoundDefinition {
  const definition: CriticalAlertSoundDefinition | undefined =
    CRITICAL_ALERT_SOUNDS.find(
      (candidate: CriticalAlertSoundDefinition): boolean => {
        return candidate.sound === sound;
      },
    );

  if (!definition) {
    throw new Error(`No definition lists ${sound}.`);
  }

  return definition;
}

/*
 * Values a device row, an API body or a hand-built message can carry that are
 * not one of the sounds. Each one is read as "not chosen", never as a sound.
 */
const NOT_A_SOUND: Array<[string, unknown]> = [
  ["a capitalised id", "Klaxon"],
  ["an upper case id", "KLAXON"],
  ["an id with a leading space", " klaxon"],
  ["an id with a trailing space", "klaxon "],
  ["a capitalised id with a leading space", " Klaxon"],
  ["a capitalised default", "Default"],
  ["the enum member's name rather than its value", "SmokeAlarm"],
  ["a hyphen where the id has an underscore", "smoke-alarm"],
  ["camel case", "smokeAlarm"],
  ["a space where the id has an underscore", "smoke alarm"],
  ["the id without its underscore", "smokealarm"],
  ["a sound's title", "System default"],
  ["another sound's title", "Smoke alarm"],
  ["a bundled file's name", "oneuptime_klaxon.wav"],
  ["the iOS sound name of the default", "default.wav"],
  ["a channel id", "oncall_critical_klaxon"],
  ["the original critical channel id", "oncall_critical"],
  ["a sound a newer app might add", "foghorn"],
  ["an empty string", ""],
  ["whitespace", "   "],
  ["null", null],
  ["undefined", undefined],
  ["zero", 0],
  ["a number", 1],
  ["NaN", NaN],
  ["true", true],
  ["false", false],
  ["an object naming a sound", { sound: "klaxon" }],
  ["a definition object", { sound: "klaxon", title: "Klaxon" }],
  ["an array holding a sound", ["klaxon"]],
  ["a boxed string", Object("klaxon")],
  ["a prototype key", "__proto__"],
  ["another prototype key", "constructor"],
  ["an Object.prototype method name", "toString"],
  ["hasOwnProperty", "hasOwnProperty"],
];

describe("CriticalAlertSound", () => {
  test("has exactly the six sounds the app offers, in the order it lists them", () => {
    expect(
      CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): CriticalAlertSound => {
          return definition.sound;
        },
      ),
    ).toEqual(ALL_SOUNDS);
  });

  test("stores the sounds as the words the database, the API and the app carry", () => {
    /*
     * These strings are persisted on UserPush.criticalAlertSound and are what
     * the app posts. Renaming one strands every device that chose it: the
     * stored value stops being a sound and the device falls back to the
     * default without anyone being told.
     */
    expect(CriticalAlertSound.Default).toBe("default");
    expect(CriticalAlertSound.Klaxon).toBe("klaxon");
    expect(CriticalAlertSound.Siren).toBe("siren");
    expect(CriticalAlertSound.Digital).toBe("digital");
    expect(CriticalAlertSound.SmokeAlarm).toBe("smoke_alarm");
    expect(CriticalAlertSound.Rising).toBe("rising");
  });

  test("lists every enum value exactly once", () => {
    const enumValues: Array<string> = Object.values(CriticalAlertSound);
    const listed: Array<string> = CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): string => {
        return definition.sound;
      },
    );

    expect([...listed].sort()).toEqual([...enumValues].sort());
    expect(new Set<string>(listed).size).toBe(listed.length);
  });

  test("defaults to the system's own sound, which is what every critical page played before the choice existed", () => {
    expect(DEFAULT_CRITICAL_ALERT_SOUND).toBe(CriticalAlertSound.Default);
  });

  test("lists the default first, where the app's settings screen and its fall-back put it", () => {
    expect(CRITICAL_ALERT_SOUNDS[0]?.sound).toBe(DEFAULT_CRITICAL_ALERT_SOUND);
  });

  test("ids are short lowercase words a URL, a log line and a database column all carry unchanged", () => {
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect(definition.sound).toMatch(/^[a-z][a-z_]*[a-z]$/);
      expect(definition.sound.length).toBeLessThanOrEqual(100);
    }
  });

  test("every sound has a title of its own for the settings screen", () => {
    const titles: Array<string> = CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): string => {
        return definition.title;
      },
    );

    for (const title of titles) {
      expect(title.trim()).toBe(title);
      expect(title.length).toBeGreaterThan(0);
    }

    expect(new Set<string>(titles).size).toBe(titles.length);
  });
});

describe("the default sound", () => {
  const defaultDefinition: CriticalAlertSoundDefinition = definitionOf(
    CriticalAlertSound.Default,
  );

  test("asks iOS for its own critical sound, by the name APNs reserves for it", () => {
    expect(defaultDefinition.iosSoundName).toBe("default");
  });

  test("pages Android on the original critical channel, which every version of the app created", () => {
    /*
     * A device whose app predates the sound choice only has oncall_critical.
     * Sending its pages anywhere else would deliver them with default
     * settings - silently.
     */
    expect(defaultDefinition.androidChannelId).toBe(
      AndroidNotificationChannel.Critical,
    );
    expect(defaultDefinition.androidChannelId).toBe("oncall_critical");
  });

  test("is the only sound on the original critical channel", () => {
    const onOriginalChannel: Array<CriticalAlertSound> =
      CRITICAL_ALERT_SOUNDS.filter(
        (definition: CriticalAlertSoundDefinition): boolean => {
          return (
            definition.androidChannelId === AndroidNotificationChannel.Critical
          );
        },
      ).map((definition: CriticalAlertSoundDefinition): CriticalAlertSound => {
        return definition.sound;
      });

    expect(onOriginalChannel).toEqual([CriticalAlertSound.Default]);
  });

  test("is the only sound that names no bundled file", () => {
    const withoutFile: Array<CriticalAlertSound> = CRITICAL_ALERT_SOUNDS.filter(
      (definition: CriticalAlertSoundDefinition): boolean => {
        return !definition.iosSoundName.endsWith(".wav");
      },
    ).map((definition: CriticalAlertSoundDefinition): CriticalAlertSound => {
      return definition.sound;
    });

    expect(withoutFile).toEqual([CriticalAlertSound.Default]);
  });
});

describe("the bundled sound files a push names on iOS", () => {
  test("there is one file for every sound but the default", () => {
    expect(CUSTOM_SOUNDS).toHaveLength(ALL_SOUNDS.length - 1);
  });

  test.each(
    CUSTOM_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [string, string] => {
        return [definition.sound, definition.iosSoundName];
      },
    ),
  )(
    "%s plays %s, a name Android accepts as a raw resource and iOS finds in the bundle",
    (_sound: string, fileName: string) => {
      /*
       * The same file is bundled for both platforms. Android resource names
       * allow lowercase letters, digits and underscores only, and must not
       * start with a digit - a file that breaks the rule fails the Android
       * build, or is renamed by it and no longer matches the push. iOS looks
       * the name up exactly, case and extension included.
       */
      expect(fileName).toMatch(/^[a-z][a-z0-9_]*\.wav$/);
      expect(fileName).not.toMatch(/^[0-9]/);
      expect(fileName).toBe(fileName.toLowerCase());
      expect(fileName.trim()).toBe(fileName);
    },
  );

  test.each(
    CUSTOM_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [string, string] => {
        return [definition.sound, definition.iosSoundName];
      },
    ),
  )(
    "%s's file is named after its id, so the two cannot drift apart",
    (sound: string, fileName: string) => {
      /*
       * Namespaced with oneuptime_ as well: Android merges every library's
       * res/raw into one folder, and a bare "siren" could collide with a
       * dependency's own resource.
       */
      expect(fileName).toBe(`oneuptime_${sound}.wav`);
    },
  );

  test("no two sounds play the same file", () => {
    const files: Array<string> = CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): string => {
        return definition.iosSoundName;
      },
    );

    expect(new Set<string>(files).size).toBe(files.length);
  });

  test("every name fits what the push relay passes on (at most 100 characters)", () => {
    /*
     * A server without its own Expo credentials sends through the relay,
     * which refuses a sound name longer than 100 characters - and a refused
     * page is a page not delivered.
     */
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect(definition.iosSoundName.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("the Android channel a page with each sound is sent on", () => {
  const androidChannels: Array<string> = Object.values(
    AndroidNotificationChannel,
  );

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [string, string] => {
        return [definition.sound, definition.androidChannelId];
      },
    ),
  )(
    "%s is sent on %s, a channel the server and the app both name",
    (_sound: string, channelId: string) => {
      expect(androidChannels).toContain(channelId);
    },
  );

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): [string, string] => {
        return [definition.sound, definition.androidChannelId];
      },
    ),
  )(
    "%s's channel %s is a critical channel",
    (_sound: string, channelId: string) => {
      /*
       * Every sound is a critical alert's sound. A sound on oncall_high would
       * be a "critical" page that Do Not Disturb silences.
       */
      expect(channelId.startsWith("oncall_critical")).toBe(true);
    },
  );

  test("every sound but the default has a channel of its own, named after it", () => {
    for (const definition of CUSTOM_SOUNDS) {
      expect(definition.androidChannelId).toBe(
        `oncall_critical_${definition.sound}`,
      );
    }
  });

  test("no two sounds share a channel - Android fixes a channel's sound when it is created", () => {
    const channels: Array<string> = CRITICAL_ALERT_SOUNDS.map(
      (definition: CriticalAlertSoundDefinition): string => {
        return definition.androidChannelId;
      },
    );

    expect(new Set<string>(channels).size).toBe(channels.length);
  });

  test("every critical channel the server can name belongs to exactly one sound", () => {
    /*
     * A critical channel no sound names is dead weight the app still has to
     * create on every phone; one named by two sounds would play the wrong
     * alarm for one of them.
     */
    const criticalChannels: Array<string> = androidChannels.filter(
      (channelId: string): boolean => {
        return channelId.startsWith("oncall_critical");
      },
    );

    expect([...criticalChannels].sort()).toEqual(
      CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): string => {
          return definition.androidChannelId;
        },
      ).sort(),
    );
  });

  test.each([
    [AndroidNotificationChannel.High],
    [AndroidNotificationChannel.Normal],
    [AndroidNotificationChannel.Low],
  ])(
    "%s, which Do Not Disturb silences, is no sound's channel",
    (channelId: AndroidNotificationChannel) => {
      for (const definition of CRITICAL_ALERT_SOUNDS) {
        expect(definition.androidChannelId).not.toBe(channelId);
      }
    },
  );

  test("the per-sound channel ids are pinned, because the app creates them by these exact names", () => {
    expect(AndroidNotificationChannel.Critical).toBe("oncall_critical");
    expect(AndroidNotificationChannel.CriticalKlaxon).toBe(
      "oncall_critical_klaxon",
    );
    expect(AndroidNotificationChannel.CriticalSiren).toBe(
      "oncall_critical_siren",
    );
    expect(AndroidNotificationChannel.CriticalDigital).toBe(
      "oncall_critical_digital",
    );
    expect(AndroidNotificationChannel.CriticalSmokeAlarm).toBe(
      "oncall_critical_smoke_alarm",
    );
    expect(AndroidNotificationChannel.CriticalRising).toBe(
      "oncall_critical_rising",
    );
  });

  test("the non-critical channels every installed app already has are unchanged", () => {
    expect(AndroidNotificationChannel.High).toBe("oncall_high");
    expect(AndroidNotificationChannel.Normal).toBe("oncall_normal");
    expect(AndroidNotificationChannel.Low).toBe("oncall_low");
  });

  test("the channel ids are unique, so no channel is two things at once", () => {
    expect(new Set<string>(androidChannels).size).toBe(androidChannels.length);
  });
});

describe("isCriticalAlertSound", () => {
  test.each(
    ALL_SOUNDS.map((sound: CriticalAlertSound): [CriticalAlertSound] => {
      return [sound];
    }),
  )("accepts %s", (sound: CriticalAlertSound) => {
    expect(isCriticalAlertSound(sound)).toBe(true);
  });

  test.each(NOT_A_SOUND)("refuses %s", (_label: string, value: unknown) => {
    /*
     * The preferences route refuses whatever this refuses, and the delivery
     * path compares exactly. A case-insensitive or trimmed match here would
     * store "Klaxon", which every other reader treats as unknown.
     */
    expect(isCriticalAlertSound(value)).toBe(false);
  });

  test("refuses every case and spacing variant of every id", () => {
    for (const sound of ALL_SOUNDS) {
      const variants: Array<string> = [
        sound.toUpperCase(),
        sound.charAt(0).toUpperCase() + sound.slice(1),
        ` ${sound}`,
        `${sound} `,
        `${sound}\n`,
        `\t${sound}`,
        sound.replace(/_/g, "-"),
        `${sound}.wav`,
        `oneuptime_${sound}`,
      ].filter((variant: string): boolean => {
        return variant !== sound;
      });

      for (const variant of variants) {
        expect({ variant, accepted: isCriticalAlertSound(variant) }).toEqual({
          variant,
          accepted: false,
        });
      }
    }
  });

  test("accepts nothing but the exact ids, over thousands of generated texts made of their pieces", () => {
    const pieces: Array<string> = [
      ...ALL_SOUNDS,
      "K",
      "k",
      "_",
      "-",
      " ",
      "smoke",
      "alarm",
      ".wav",
      "oneuptime_",
      "oncall_critical_",
    ];

    // The ids themselves first, so the sweep is never vacuous.
    const texts: Array<string> = [
      ...ALL_SOUNDS,
      ...generatedTexts(5000, 20261013, pieces, 4),
    ];
    const accepted: Set<string> = new Set<string>();

    for (const text of texts) {
      if (isCriticalAlertSound(text)) {
        accepted.add(text);
      }
    }

    // Nothing but the six ids got through, however the pieces were joined.
    expect([...accepted].sort()).toEqual([...ALL_SOUNDS].sort());
  });
});

describe("getCriticalAlertSound", () => {
  test.each(
    ALL_SOUNDS.map((sound: CriticalAlertSound): [CriticalAlertSound] => {
      return [sound];
    }),
  )("keeps a stored %s as it is", (sound: CriticalAlertSound) => {
    expect(getCriticalAlertSound(sound)).toBe(sound);
  });

  test.each(NOT_A_SOUND)(
    "reads %s as the default",
    (_label: string, value: unknown) => {
      /*
       * Unset, or written by a newer app this server does not know: the
       * system's own sound, which every app plays and every phone has the
       * channel for. Falling back to anything else could name a channel the
       * phone never created.
       */
      expect(getCriticalAlertSound(value)).toBe(DEFAULT_CRITICAL_ALERT_SOUND);
    },
  );

  test("always answers one of the sounds", () => {
    const inputs: Array<unknown> = [
      ...ALL_SOUNDS,
      ...NOT_A_SOUND.map(([, value]: [string, unknown]): unknown => {
        return value;
      }),
    ];

    for (const input of inputs) {
      expect(ALL_SOUNDS).toContain(getCriticalAlertSound(input));
    }
  });
});

describe("getCriticalAlertSoundDefinition", () => {
  test.each(
    ALL_SOUNDS.map((sound: CriticalAlertSound): [CriticalAlertSound] => {
      return [sound];
    }),
  )("answers %s with its own definition", (sound: CriticalAlertSound) => {
    const definition: CriticalAlertSoundDefinition =
      getCriticalAlertSoundDefinition(sound);

    expect(definition.sound).toBe(sound);
    expect(definition).toBe(definitionOf(sound));
  });

  test.each(NOT_A_SOUND)(
    "answers %s with the default's definition: the system sound on the original channel",
    (_label: string, value: unknown) => {
      const definition: CriticalAlertSoundDefinition =
        getCriticalAlertSoundDefinition(value);

      expect(definition).toBe(definitionOf(CriticalAlertSound.Default));
      expect(definition.iosSoundName).toBe("default");
      expect(definition.androidChannelId).toBe(
        AndroidNotificationChannel.Critical,
      );
    },
  );

  test("never answers undefined, whatever it is given", () => {
    /*
     * The delivery path reads .androidChannelId and .iosSoundName straight
     * off the answer while a page is going out; an undefined here would fail
     * the send of a critical page.
     */
    const texts: Array<string> = generatedTexts(2000, 4242, [
      ...ALL_SOUNDS,
      "X",
      " ",
      "_",
    ]);

    for (const text of texts) {
      const definition: CriticalAlertSoundDefinition =
        getCriticalAlertSoundDefinition(text);

      expect(definition).toBeDefined();
      expect(CRITICAL_ALERT_SOUNDS).toContain(definition);
    }
  });

  test("the definition of a sound agrees with getCriticalAlertSound for every input", () => {
    const inputs: Array<unknown> = [
      ...ALL_SOUNDS,
      ...NOT_A_SOUND.map(([, value]: [string, unknown]): unknown => {
        return value;
      }),
    ];

    for (const input of inputs) {
      expect(getCriticalAlertSoundDefinition(input).sound).toBe(
        getCriticalAlertSound(input),
      );
    }
  });
});
