import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import AndroidNotificationChannel from "../../../Types/PushNotification/AndroidNotificationChannel";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
  DEFAULT_CRITICAL_ALERT_SOUND,
  getCriticalAlertSound,
  isCriticalAlertSound,
} from "../../../Types/PushNotification/CriticalAlertSound";
import {
  CRITICAL_ALERT_VOLUME_OPTIONS,
  DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
  isCriticalAlertVolumePercent,
} from "../../../Types/PushNotification/CriticalAlertVolume";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE MOBILE APP AND THE SERVER NAME THE SAME ALARMS, AND THE APP CARRIES THE
 * FILES THEY NAME.
 *
 * A critical page names its sound twice - a file for iOS, a channel for
 * Android - and both have to exist on the phone. The server's list is
 * Common/Types/PushNotification/CriticalAlertSound.ts; the app keeps its own
 * copy (MobileApp/src/notifications/criticalAlertSounds.ts and channels.ts)
 * because it is built without Common's code, and the files are bundled
 * through the expo-notifications plugin in app.json. A copy drifts, and every
 * drift is silent:
 *
 *   - a file name that differs plays iOS's default sound instead;
 *   - a channel id that differs, or a channel the app never creates, delivers
 *     an Android page with default settings - silently;
 *   - a file missing from app.json is never bundled, with the same result;
 *   - a file longer than 30 seconds, or not linear PCM, is not played by iOS.
 *
 * So this suite reads the app's files as they are - compiling its TypeScript
 * and running it beside the server's list - reads app.json, and opens every
 * WAV file, down to checking each one is exactly what the generator script
 * renders.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_APP: string = path.join(REPOSITORY_ROOT, "packages/MobileApp");
const MOBILE_NOTIFICATIONS: string = path.join(MOBILE_APP, "src/notifications");
const SOUNDS_DIRECTORY: string = path.join(MOBILE_APP, "assets/sounds");
const APP_JSON: string = path.join(MOBILE_APP, "app.json");
const GENERATOR: string = path.join(
  MOBILE_APP,
  "scripts/generate-critical-alert-sounds.js",
);

// iOS plays a sound longer than this as its default sound instead.
const IOS_LONGEST_NOTIFICATION_SOUND_SECONDS: number = 30;

// Sample rates iOS's notification sounds are played at as they are.
const IOS_SAMPLE_RATES: Array<number> = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
];

const FULL_SCALE: number = 32767;

type ModuleExports = Record<string, unknown>;

interface MobileSoundOption {
  id: string;
  title: string;
  description: string;
  fileName: string | null;
  channelId: string;
  previewSeconds: number;
}

interface MobileChannel {
  id: string;
  channel: Record<string, unknown>;
}

interface MobileSounds {
  CriticalAlertSoundId: Record<string, string>;
  DEFAULT_CRITICAL_ALERT_SOUND: string;
  CRITICAL_ALERT_SOUND_OPTIONS: Array<MobileSoundOption>;
  isCriticalAlertSoundId: (value: unknown) => boolean;
  getCriticalAlertSoundOption: (value: unknown) => MobileSoundOption;
  CRITICAL_ALERT_VOLUME_OPTIONS: Array<number>;
  DEFAULT_CRITICAL_ALERT_VOLUME: number;
}

interface MobileChannels {
  NotificationChannelId: Record<string, string>;
  CRITICAL_CHANNEL: Record<string, unknown>;
  CRITICAL_SOUND_CHANNELS: Array<MobileChannel>;
  CRITICAL_CHANNELS: Array<MobileChannel>;
  NOTIFICATION_CHANNELS: Array<MobileChannel>;
}

interface SoundGenerator {
  SAMPLE_RATE: number;
  PEAK: number;
  SOUNDS: Array<{ fileName: string; seconds: number }>;
  renderWav: (fileName: string) => Buffer;
}

/*
 * channels.ts reads expo-notifications' enums while it builds its channels
 * (AndroidImportance.MAX and the like). What they hold means nothing here, so
 * every member of every enum reads as its own name - and the module says it
 * is an ES module, so the compiled import takes it as it is.
 */
function enumStub(enumName: string): Record<string, string> {
  return new Proxy<Record<string, string>>(
    {},
    {
      get: (
        _target: Record<string, string>,
        member: string | symbol,
      ): string => {
        return `${enumName}.${String(member)}`;
      },
    },
  );
}

const EXPO_NOTIFICATIONS_STUB: ModuleExports = new Proxy<ModuleExports>(
  { __esModule: true },
  {
    get: (target: ModuleExports, name: string | symbol): unknown => {
      if (typeof name === "symbol") {
        return undefined;
      }

      return name in target ? target[name] : enumStub(name);
    },
  },
);

/*
 * The app's file compiled to CommonJS as it is and run in a fresh context,
 * its imports answered from `modules` - as AcknowledgedStateMobileParity
 * does for the app's state rules.
 */
function loadMobileModule(
  fileName: string,
  modules: Record<string, ModuleExports>,
): ModuleExports {
  const source: string = fs.readFileSync(
    path.join(MOBILE_NOTIFICATIONS, fileName),
    "utf8",
  );

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: fileName,
  }).outputText;

  const moduleObject: { exports: ModuleExports } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): ModuleExports => {
      const required: ModuleExports | undefined = modules[specifier];

      if (!required) {
        throw new Error(
          `The app's ${fileName} imports ${specifier}, which this suite does not provide.`,
        );
      }

      return required;
    },
  });

  return moduleObject.exports;
}

const channelsModule: ModuleExports = loadMobileModule("channels.ts", {
  "expo-notifications": EXPO_NOTIFICATIONS_STUB,
});

const soundsModule: ModuleExports = loadMobileModule("criticalAlertSounds.ts", {
  "./channels": channelsModule,
});

const MOBILE_SOUNDS: MobileSounds = soundsModule as unknown as MobileSounds;
const MOBILE_CHANNELS: MobileChannels =
  channelsModule as unknown as MobileChannels;

// Plain copies, so comparisons never trip over the other context's prototypes.
const MOBILE_OPTIONS: Array<MobileSoundOption> = JSON.parse(
  JSON.stringify(MOBILE_SOUNDS.CRITICAL_ALERT_SOUND_OPTIONS),
) as Array<MobileSoundOption>;

const MOBILE_SOUND_CHANNELS: Array<MobileChannel> = JSON.parse(
  JSON.stringify(MOBILE_CHANNELS.CRITICAL_SOUND_CHANNELS),
) as Array<MobileChannel>;

/*
 * The generator script through Node's own require, rooted at this file:
 * outside jest's registry, in the worker's real Node realm. It only writes
 * files when it is run as a program, never when it is required.
 */
function nodeModuleBuiltin(): typeof import("module") {
  if (typeof process.getBuiltinModule === "function") {
    return process.getBuiltinModule("module");
  }

  return Object.getPrototypeOf(
    jest.requireActual("module"),
  ) as typeof import("module");
}

const nodeRequire: NodeJS.Require =
  nodeModuleBuiltin().createRequire(__filename);

const SOUND_GENERATOR: SoundGenerator = nodeRequire(
  GENERATOR,
) as SoundGenerator;

const CUSTOM_SOUNDS: Array<CriticalAlertSoundDefinition> =
  CRITICAL_ALERT_SOUNDS.filter(
    (definition: CriticalAlertSoundDefinition): boolean => {
      return definition.sound !== CriticalAlertSound.Default;
    },
  );

const SOUND_FILES: Array<string> = CUSTOM_SOUNDS.map(
  (definition: CriticalAlertSoundDefinition): string => {
    return definition.iosSoundName;
  },
);

function mobileOptionFor(sound: string): MobileSoundOption {
  const option: MobileSoundOption | undefined = MOBILE_OPTIONS.find(
    (candidate: MobileSoundOption): boolean => {
      return candidate.id === sound;
    },
  );

  if (!option) {
    throw new Error(`The app offers no ${sound}.`);
  }

  return option;
}

interface WavChunk {
  id: string;
  offset: number;
  size: number;
}

interface WavFile {
  riff: string;
  riffSize: number;
  wave: string;
  chunks: Array<WavChunk>;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
  fileLength: number;
}

// A RIFF/WAVE file's header and chunks, walked as a player walks them.
function parseWav(buffer: Buffer): WavFile {
  const chunks: Array<WavChunk> = [];
  let offset: number = 12;

  while (offset + 8 <= buffer.length) {
    const size: number = buffer.readUInt32LE(offset + 4);

    chunks.push({
      id: buffer.toString("ascii", offset, offset + 4),
      offset: offset + 8,
      size: size,
    });

    offset += 8 + size + (size % 2);
  }

  const fmt: WavChunk | undefined = chunks.find((chunk: WavChunk): boolean => {
    return chunk.id === "fmt ";
  });
  const data: WavChunk | undefined = chunks.find((chunk: WavChunk): boolean => {
    return chunk.id === "data";
  });

  if (!fmt || !data) {
    throw new Error("The file has no fmt or no data chunk.");
  }

  return {
    riff: buffer.toString("ascii", 0, 4),
    riffSize: buffer.readUInt32LE(4),
    wave: buffer.toString("ascii", 8, 12),
    chunks: chunks,
    audioFormat: buffer.readUInt16LE(fmt.offset),
    channels: buffer.readUInt16LE(fmt.offset + 2),
    sampleRate: buffer.readUInt32LE(fmt.offset + 4),
    byteRate: buffer.readUInt32LE(fmt.offset + 8),
    blockAlign: buffer.readUInt16LE(fmt.offset + 12),
    bitsPerSample: buffer.readUInt16LE(fmt.offset + 14),
    dataOffset: data.offset,
    dataLength: data.size,
    fileLength: buffer.length,
  };
}

function readSamples(buffer: Buffer, wav: WavFile): Int16Array {
  const samples: Int16Array = new Int16Array(wav.dataLength / 2);

  for (let index: number = 0; index < samples.length; index++) {
    samples[index] = buffer.readInt16LE(wav.dataOffset + index * 2);
  }

  return samples;
}

const committedFiles: Map<string, Buffer> = new Map<string, Buffer>();

function committedFile(fileName: string): Buffer {
  let file: Buffer | undefined = committedFiles.get(fileName);

  if (!file) {
    file = fs.readFileSync(path.join(SOUNDS_DIRECTORY, fileName));
    committedFiles.set(fileName, file);
  }

  return file;
}

function expoNotificationsSounds(): Array<string> {
  const appJson: {
    expo: { plugins: Array<string | [string, Record<string, unknown>]> };
  } = JSON.parse(fs.readFileSync(APP_JSON, "utf8"));

  const plugin: string | [string, Record<string, unknown>] | undefined =
    appJson.expo.plugins.find(
      (entry: string | [string, Record<string, unknown>]): boolean => {
        return Array.isArray(entry) && entry[0] === "expo-notifications";
      },
    );

  if (!Array.isArray(plugin)) {
    throw new Error("app.json does not configure expo-notifications.");
  }

  return (plugin[1]["sounds"] as Array<string> | undefined) || [];
}

describe("the app's copy of the sounds loads from the app's own files", () => {
  test("every export this suite reads is there", () => {
    expect(Array.isArray(MOBILE_SOUNDS.CRITICAL_ALERT_SOUND_OPTIONS)).toBe(
      true,
    );
    expect(typeof MOBILE_SOUNDS.isCriticalAlertSoundId).toBe("function");
    expect(typeof MOBILE_SOUNDS.getCriticalAlertSoundOption).toBe("function");
    expect(Array.isArray(MOBILE_CHANNELS.CRITICAL_SOUND_CHANNELS)).toBe(true);
    expect(Array.isArray(MOBILE_CHANNELS.NOTIFICATION_CHANNELS)).toBe(true);
  });

  test("the stub stands in for expo-notifications' enums only - every sound a channel names is the app's own text", () => {
    for (const entry of MOBILE_SOUND_CHANNELS) {
      expect(typeof entry.channel["sound"]).toBe("string");
      expect(String(entry.channel["sound"])).not.toContain("Android");
    }
  });
});

describe("the app and the server offer the same sounds", () => {
  test("the same ids, in the same order", () => {
    expect(
      MOBILE_OPTIONS.map((option: MobileSoundOption): string => {
        return option.id;
      }),
    ).toEqual(
      CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): string => {
          return definition.sound;
        },
      ),
    );
  });

  test("the same id constants as the server's enum", () => {
    expect(Object.values(MOBILE_SOUNDS.CriticalAlertSoundId).sort()).toEqual(
      Object.values(CriticalAlertSound).sort(),
    );
  });

  test("the same default: the system's own critical sound", () => {
    expect(MOBILE_SOUNDS.DEFAULT_CRITICAL_ALERT_SOUND).toBe(
      DEFAULT_CRITICAL_ALERT_SOUND,
    );
  });

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, CriticalAlertSoundDefinition] => {
        return [definition.sound, definition];
      },
    ),
  )(
    "%s has the same title on both sides",
    (sound: string, definition: CriticalAlertSoundDefinition) => {
      expect(mobileOptionFor(sound).title).toBe(definition.title);
    },
  );

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, string, CriticalAlertSoundDefinition] => {
        return [definition.sound, definition.iosSoundName, definition];
      },
    ),
  )(
    "%s: the file the app bundles is the one the server names for iOS (%s)",
    (
      sound: string,
      _iosSoundName: string,
      definition: CriticalAlertSoundDefinition,
    ) => {
      // The app's null - the phone's own sound - is what APNs calls "default".
      const fileName: string | null = mobileOptionFor(sound).fileName;

      expect(fileName === null ? "default" : fileName).toBe(
        definition.iosSoundName,
      );
      expect(fileName === null).toBe(
        definition.sound === CriticalAlertSound.Default,
      );
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
    "%s: the channel the app plays it on is the one the server pages (%s)",
    (
      sound: string,
      _channelId: string,
      definition: CriticalAlertSoundDefinition,
    ) => {
      expect(mobileOptionFor(sound).channelId).toBe(
        definition.androidChannelId,
      );
    },
  );

  test("both read every value the same way, over thousands of generated ones", () => {
    /*
     * A value one side stores and the other reads as something else - a sound
     * the app thinks it chose that the server pages as the default - is a
     * drift no list comparison shows.
     */
    const values: Array<unknown> = [
      ...Object.values(CriticalAlertSound),
      ...generatedTexts(3000, 20261013, [
        ...Object.values(CriticalAlertSound),
        "K",
        "_",
        " ",
        "-",
        ".wav",
      ]),
      undefined,
      null,
      0,
      1,
      true,
      "",
      "Klaxon",
      " siren",
      {},
      [],
    ];

    for (const value of values) {
      expect({
        value,
        isSound: MOBILE_SOUNDS.isCriticalAlertSoundId(value),
        readAs: MOBILE_SOUNDS.getCriticalAlertSoundOption(value).id,
      }).toEqual({
        value,
        isSound: isCriticalAlertSound(value),
        readAs: getCriticalAlertSound(value),
      });
    }
  });
});

describe("the app creates every channel a critical page can be sent on", () => {
  test("the app names exactly the channel ids the server does", () => {
    expect(Object.values(MOBILE_CHANNELS.NotificationChannelId).sort()).toEqual(
      Object.values(AndroidNotificationChannel).sort(),
    );
  });

  test("every channel the server can name is one the app creates on launch", () => {
    const created: Array<string> = MOBILE_CHANNELS.NOTIFICATION_CHANNELS.map(
      (entry: MobileChannel): string => {
        return entry.id;
      },
    );

    for (const channelId of Object.values(AndroidNotificationChannel)) {
      expect(created).toContain(channelId);
    }

    expect(new Set<string>(created).size).toBe(created.length);
  });

  test("every sound's channel is among the critical channels the app creates", () => {
    const criticalChannels: Array<string> =
      MOBILE_CHANNELS.CRITICAL_CHANNELS.map((entry: MobileChannel): string => {
        return entry.id;
      });

    expect([...criticalChannels].sort()).toEqual(
      CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): string => {
          return definition.androidChannelId;
        },
      ).sort(),
    );
  });

  test("one channel per bundled sound, and none for the default", () => {
    expect(
      MOBILE_SOUND_CHANNELS.map((entry: MobileChannel): string => {
        return entry.id;
      }).sort(),
    ).toEqual(
      CUSTOM_SOUNDS.map((definition: CriticalAlertSoundDefinition): string => {
        return definition.androidChannelId;
      }).sort(),
    );
  });

  test.each(
    CUSTOM_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, string, CriticalAlertSoundDefinition] => {
        return [
          definition.androidChannelId,
          definition.iosSoundName,
          definition,
        ];
      },
    ),
  )(
    "%s plays %s - the same file the server names for iOS",
    (
      channelId: string,
      fileName: string,
      definition: CriticalAlertSoundDefinition,
    ) => {
      const entry: MobileChannel | undefined = MOBILE_SOUND_CHANNELS.find(
        (candidate: MobileChannel): boolean => {
          return candidate.id === channelId;
        },
      );

      expect(entry).toBeDefined();
      expect(entry?.channel["sound"]).toBe(fileName);
      expect(entry?.channel["sound"]).toBe(
        mobileOptionFor(definition.sound).fileName,
      );
    },
  );

  test.each(
    CUSTOM_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, CriticalAlertSoundDefinition] => {
        return [definition.androidChannelId, definition];
      },
    ),
  )(
    "%s is named after its sound in Android's notification settings",
    (channelId: string, definition: CriticalAlertSoundDefinition) => {
      const entry: MobileChannel | undefined = MOBILE_SOUND_CHANNELS.find(
        (candidate: MobileChannel): boolean => {
          return candidate.id === channelId;
        },
      );

      expect(String(entry?.channel["name"])).toBe(
        `Critical On-Call Alerts: ${definition.title}`,
      );
    },
  );

  test.each(
    CUSTOM_SOUNDS.map((definition: CriticalAlertSoundDefinition): [string] => {
      return [definition.androidChannelId];
    }),
  )(
    "%s rings through Do Not Disturb exactly as the original critical channel does",
    (channelId: string) => {
      /*
       * The sound is the only thing the responder chose. A sound channel
       * without the Do Not Disturb bypass, the alarm stream or MAX importance
       * would be a "critical" page that a silenced phone swallows.
       */
      const entry: MobileChannel | undefined = MOBILE_SOUND_CHANNELS.find(
        (candidate: MobileChannel): boolean => {
          return candidate.id === channelId;
        },
      );
      const critical: Record<string, unknown> = JSON.parse(
        JSON.stringify(MOBILE_CHANNELS.CRITICAL_CHANNEL),
      ) as Record<string, unknown>;

      const withoutChoice: (
        channel: Record<string, unknown>,
      ) => Record<string, unknown> = (
        channel: Record<string, unknown>,
      ): Record<string, unknown> => {
        const rest: Record<string, unknown> = { ...channel };
        delete rest["name"];
        delete rest["description"];
        delete rest["sound"];
        return rest;
      };

      expect(entry).toBeDefined();
      expect(withoutChoice(entry!.channel)).toEqual(withoutChoice(critical));
      expect(entry!.channel["bypassDnd"]).toBe(true);
    },
  );

  test("the original critical channel keeps the system's sound", () => {
    expect(MOBILE_CHANNELS.CRITICAL_CHANNEL["sound"]).toBe("default");
    expect(
      MOBILE_CHANNELS.CRITICAL_CHANNELS.find(
        (entry: MobileChannel): boolean => {
          return entry.id === AndroidNotificationChannel.Critical;
        },
      )?.channel["sound"],
    ).toBe("default");
  });
});

describe("the app and the server offer the same volumes", () => {
  test("the same steps", () => {
    expect([...MOBILE_SOUNDS.CRITICAL_ALERT_VOLUME_OPTIONS]).toEqual([
      ...CRITICAL_ALERT_VOLUME_OPTIONS,
    ]);
  });

  test("the same default: full volume", () => {
    expect(MOBILE_SOUNDS.DEFAULT_CRITICAL_ALERT_VOLUME).toBe(
      DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
    );
  });

  test("every step the app sends is one the server stores as it is", () => {
    for (const volume of MOBILE_SOUNDS.CRITICAL_ALERT_VOLUME_OPTIONS) {
      expect(isCriticalAlertVolumePercent(volume)).toBe(true);
    }
  });
});

describe("the app bundles every sound file a page can name", () => {
  test("app.json hands the expo-notifications plugin exactly the sound files", () => {
    const sounds: Array<string> = expoNotificationsSounds();

    expect([...sounds].sort()).toEqual(
      SOUND_FILES.map((fileName: string): string => {
        return `./assets/sounds/${fileName}`;
      }).sort(),
    );
    expect(new Set<string>(sounds).size).toBe(sounds.length);
  });

  test("every file the plugin is given is in assets/sounds", () => {
    for (const sound of expoNotificationsSounds()) {
      expect({
        sound,
        exists: fs.existsSync(path.join(MOBILE_APP, sound)),
      }).toEqual({ sound, exists: true });
    }
  });

  test("assets/sounds holds no WAV file that no sound plays", () => {
    const wavFiles: Array<string> = fs
      .readdirSync(SOUNDS_DIRECTORY)
      .filter((file: string): boolean => {
        return file.toLowerCase().endsWith(".wav");
      });

    expect(wavFiles.sort()).toEqual([...SOUND_FILES].sort());
  });

  test("the generator builds exactly these files", () => {
    expect(
      SOUND_GENERATOR.SOUNDS.map((sound: { fileName: string }): string => {
        return sound.fileName;
      }).sort(),
    ).toEqual([...SOUND_FILES].sort());
  });
});

describe.each(
  CUSTOM_SOUNDS.map(
    (
      definition: CriticalAlertSoundDefinition,
    ): [string, CriticalAlertSoundDefinition] => {
      return [definition.iosSoundName, definition];
    },
  ),
)("%s", (fileName: string, definition: CriticalAlertSoundDefinition) => {
  function wav(): WavFile {
    return parseWav(committedFile(fileName));
  }

  function samples(): Int16Array {
    return readSamples(committedFile(fileName), wav());
  }

  test("is a RIFF/WAVE file whose sizes add up", () => {
    const file: WavFile = wav();

    expect(file.riff).toBe("RIFF");
    expect(file.wave).toBe("WAVE");
    // The RIFF size counts everything after its own 8 bytes.
    expect(file.riffSize).toBe(file.fileLength - 8);
    // The data runs to the end of the file: nothing truncated, nothing after.
    expect(file.dataOffset + file.dataLength).toBe(file.fileLength);
    expect(
      file.chunks.map((chunk: WavChunk): string => {
        return chunk.id;
      }),
    ).toEqual(["fmt ", "data"]);
  });

  test("is linear PCM, mono, 16-bit - a format iOS plays as a notification sound", () => {
    const file: WavFile = wav();

    expect(file.audioFormat).toBe(1);
    expect(file.channels).toBe(1);
    expect(file.bitsPerSample).toBe(16);
    expect(file.blockAlign).toBe(file.channels * (file.bitsPerSample / 8));
  });

  test("is at a sample rate iOS plays, and says so consistently", () => {
    const file: WavFile = wav();

    expect(IOS_SAMPLE_RATES).toContain(file.sampleRate);
    expect(file.sampleRate).toBe(SOUND_GENERATOR.SAMPLE_RATE);
    expect(file.byteRate).toBe(file.sampleRate * file.blockAlign);
    expect(file.dataLength % file.blockAlign).toBe(0);
  });

  test("is shorter than 30 seconds, or iOS would play its default sound instead", () => {
    const file: WavFile = wav();
    const seconds: number = file.dataLength / file.byteRate;

    expect(seconds).toBeLessThan(IOS_LONGEST_NOTIFICATION_SOUND_SECONDS);
    expect(seconds).toBeGreaterThan(0);
  });

  test("lasts exactly as long as the app's preview says", () => {
    const file: WavFile = wav();

    expect(file.dataLength / file.byteRate).toBe(
      mobileOptionFor(definition.sound).previewSeconds,
    );
  });

  test("is loud: its peak sits near full scale, and it is not mostly silence", () => {
    const pcm: Int16Array = samples();
    let peak: number = 0;
    let sumOfSquares: number = 0;

    for (const sample of pcm) {
      peak = Math.max(peak, Math.abs(sample));
      sumOfSquares += sample * sample;
    }

    const rms: number = Math.sqrt(sumOfSquares / pcm.length);

    expect(peak).toBeGreaterThanOrEqual(0.8 * FULL_SCALE);
    expect(rms).toBeGreaterThan(0.05 * FULL_SCALE);
  });

  test("is not clipped: no sample reaches full scale", () => {
    const pcm: Int16Array = samples();
    let peak: number = 0;

    for (const sample of pcm) {
      peak = Math.max(peak, Math.abs(sample));
    }

    expect(peak).toBeLessThan(FULL_SCALE);
    expect(peak).toBeLessThanOrEqual(
      Math.round(SOUND_GENERATOR.PEAK * FULL_SCALE),
    );
  });

  test("is heard at once: it sounds within its first half second", () => {
    const pcm: Int16Array = samples();
    const halfSecond: number = wav().sampleRate / 2;
    let peak: number = 0;

    for (let index: number = 0; index < halfSecond; index++) {
      peak = Math.max(peak, Math.abs(pcm[index]!));
    }

    expect(peak).toBeGreaterThan(0.02 * FULL_SCALE);
  });

  test("ends at silence, so it stops instead of clicking", () => {
    const pcm: Int16Array = samples();
    const lastMillisecond: number = wav().sampleRate / 1000;
    let tail: number = 0;

    for (
      let index: number = pcm.length - lastMillisecond;
      index < pcm.length;
      index++
    ) {
      tail = Math.max(tail, Math.abs(pcm[index]!));
    }

    expect(pcm[pcm.length - 1]).toBe(0);
    expect(tail).toBeLessThan(0.1 * FULL_SCALE);
  });

  test("is exactly what the generator script renders, to within one step of float rounding", () => {
    /*
     * The files are synthesised, not recorded, so the script is their
     * source: a file edited by hand, or a script changed without the files
     * being rebuilt, fails here. One step either way per sample is allowed
     * for floating point that differs in its last place between machines.
     */
    const committed: Buffer = committedFile(fileName);
    const rendered: Buffer = SOUND_GENERATOR.renderWav(fileName);

    expect(rendered.length).toBe(committed.length);

    const committedWav: WavFile = parseWav(committed);
    const renderedWav: WavFile = parseWav(rendered);

    // The header and every chunk but the audio, byte for byte.
    expect(
      Buffer.from(committed.subarray(0, committedWav.dataOffset)).equals(
        Buffer.from(rendered.subarray(0, renderedWav.dataOffset)),
      ),
    ).toBe(true);

    const committedSamples: Int16Array = readSamples(committed, committedWav);
    const renderedSamples: Int16Array = readSamples(rendered, renderedWav);
    let largestDifference: number = 0;
    let samplesDiffering: number = 0;

    for (let index: number = 0; index < committedSamples.length; index++) {
      const difference: number = Math.abs(
        committedSamples[index]! - renderedSamples[index]!,
      );

      largestDifference = Math.max(largestDifference, difference);

      if (difference > 0) {
        samplesDiffering++;
      }
    }

    expect(largestDifference).toBeLessThanOrEqual(1);
    // Rounding drift touches the odd sample, never the whole sound.
    expect(samplesDiffering).toBeLessThan(committedSamples.length / 100);
  });

  test("is rendered at the length the generator gives it", () => {
    const sound: { fileName: string; seconds: number } | undefined =
      SOUND_GENERATOR.SOUNDS.find(
        (candidate: { fileName: string }): boolean => {
          return candidate.fileName === fileName;
        },
      );

    expect(sound).toBeDefined();
    expect(wav().dataLength / wav().byteRate).toBe(sound?.seconds);
  });
});
