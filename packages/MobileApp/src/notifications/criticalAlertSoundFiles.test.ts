import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Platform } from "react-native";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  type CriticalAlertSoundOption,
} from "./criticalAlertSounds";
import { describe, expect, test } from "@jest/globals";

/*
 * The alarm files themselves. Each is checked for what makes a phone refuse
 * to play it - silently, in both cases: iOS plays the default sound instead
 * of a custom one that is too long or in a format it does not take, and
 * Android plays nothing on a channel whose sound it cannot read. They are
 * also checked against the script that makes them, so a regenerated file
 * that was never committed - or a committed file nobody can regenerate -
 * fails here.
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const generator: {
  SAMPLE_RATE: number;
  PEAK: number;
  SOUNDS: Array<{ fileName: string; seconds: number }>;
} = require("../../scripts/generate-critical-alert-sounds.js");

const appJson: {
  expo: { plugins: Array<string | [string, Record<string, unknown>]> };
} = require("../../app.json");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

const APP_ROOT: string = path.resolve(__dirname, "../..");

interface Wav {
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  samples: Int16Array;
}

// Reads every chunk rather than assuming the 44-byte layout the script writes.
function parseWav(buffer: Buffer): Wav {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Not a RIFF/WAVE file");
  }

  expect(buffer.readUInt32LE(4)).toBe(buffer.length - 8);

  let offset: number = 12;
  let format: Omit<Wav, "samples"> | null = null;
  let samples: Int16Array | null = null;

  while (offset + 8 <= buffer.length) {
    const id: string = buffer.toString("ascii", offset, offset + 4);
    const length: number = buffer.readUInt32LE(offset + 4);
    const body: number = offset + 8;

    if (id === "fmt ") {
      format = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }

    if (id === "data") {
      expect(body + length).toBeLessThanOrEqual(buffer.length);
      samples = new Int16Array(length / 2);

      for (let index: number = 0; index < samples.length; index++) {
        samples[index] = buffer.readInt16LE(body + index * 2);
      }
    }

    offset = body + length + (length % 2);
  }

  if (!format || !samples) {
    throw new Error("A WAVE file needs a fmt chunk and a data chunk");
  }

  return { ...format, samples };
}

function rms(samples: Int16Array, from: number, to: number): number {
  let sum: number = 0;
  const end: number = Math.min(to, samples.length);

  for (let index: number = from; index < end; index++) {
    sum += (samples[index]! / 32768) ** 2;
  }

  return Math.sqrt(sum / Math.max(1, end - from));
}

const BUNDLED: Array<CriticalAlertSoundOption> =
  CRITICAL_ALERT_SOUND_OPTIONS.filter((option: CriticalAlertSoundOption) => {
    return option.fileName !== null;
  });

function filePath(option: CriticalAlertSoundOption): string {
  return path.join(APP_ROOT, "assets/sounds", option.fileName!);
}

function read(option: CriticalAlertSoundOption): Wav {
  return parseWav(readFileSync(filePath(option)));
}

function bundledSounds(): Array<string> {
  const plugin: string | [string, Record<string, unknown>] | undefined =
    appJson.expo.plugins.find(
      (item: string | [string, Record<string, unknown>]): boolean => {
        return Array.isArray(item) && item[0] === "expo-notifications";
      },
    );

  return ((plugin as [string, { sounds?: Array<string> }])[1].sounds ||
    []) as Array<string>;
}

describe.each(
  BUNDLED.map((option: CriticalAlertSoundOption) => {
    return [option.id, option] as [string, CriticalAlertSoundOption];
  }),
)("the %s alarm", (_id: string, option: CriticalAlertSoundOption) => {
  test("is a file in assets/sounds that the app bundles", () => {
    expect(existsSync(filePath(option))).toBe(true);
    expect(bundledSounds()).toContain(`./assets/sounds/${option.fileName}`);
  });

  test("is linear PCM, mono, 16-bit - a notification sound both platforms play", () => {
    const wav: Wav = read(option);

    expect(wav.format).toBe(1);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.sampleRate).toBe(16000);
    expect(wav.blockAlign).toBe(2);
    expect(wav.byteRate).toBe(wav.sampleRate * wav.blockAlign);
  });

  test("lasts under 30 seconds, as iOS requires, and exactly as long as its preview", () => {
    const wav: Wav = read(option);
    const seconds: number = wav.samples.length / wav.sampleRate;

    expect(seconds).toBeLessThan(30);
    expect(seconds).toBe(option.previewSeconds);
  });

  test("is loud: its peak sits just under full scale and it never clips", () => {
    const wav: Wav = read(option);
    let peak: number = 0;

    for (const sample of wav.samples) {
      peak = Math.max(peak, Math.abs(sample));
    }

    expect(peak / 32767).toBeCloseTo(generator.PEAK, 2);
    expect(peak).toBeLessThan(32767);
    expect(rms(wav.samples, 0, wav.samples.length)).toBeGreaterThan(0.2);
  });

  test("starts and ends without a click", () => {
    const wav: Wav = read(option);

    expect(Math.abs(wav.samples[0]!)).toBeLessThan(500);
    expect(Math.abs(wav.samples[wav.samples.length - 1]!)).toBeLessThan(2000);
  });
});

describe("the files are exactly what the generator makes", () => {
  /*
   * Rendered once, under the iOS project only: the audio does not depend on
   * the platform. And rendered by the script itself, run as Node runs it:
   * under Jest's transform the same arithmetic is a hundred times slower.
   */
  const run: typeof test.skip = Platform.OS === "ios" ? test : test.skip;

  test("every sound the app offers is one the generator makes, and the reverse", () => {
    expect(
      generator.SOUNDS.map((sound: { fileName: string }) => {
        return sound.fileName;
      }),
    ).toEqual(
      BUNDLED.map((option: CriticalAlertSoundOption) => {
        return option.fileName;
      }),
    );
    expect(bundledSounds()).toEqual(
      generator.SOUNDS.map((sound: { fileName: string }) => {
        return `./assets/sounds/${sound.fileName}`;
      }),
    );
  });

  test("each file is as long as the generator makes it", () => {
    for (const sound of generator.SOUNDS) {
      const option: CriticalAlertSoundOption = BUNDLED.find(
        (candidate: CriticalAlertSoundOption) => {
          return candidate.fileName === sound.fileName;
        },
      )!;

      expect(option.previewSeconds).toBe(sound.seconds);
    }
  });

  run(
    "each committed file matches a fresh render, sample for sample",
    () => {
      const directory: string = mkdtempSync(
        path.join(os.tmpdir(), "oneuptime-alarm-sounds-"),
      );

      try {
        execFileSync(
          process.execPath,
          [
            path.join(APP_ROOT, "scripts/generate-critical-alert-sounds.js"),
            "--out",
            directory,
          ],
          { stdio: "pipe" },
        );

        compareWith(directory);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    60000,
  );

  function compareWith(directory: string): void {
    for (const option of BUNDLED) {
      const committed: Wav = read(option);
      const rendered: Wav = parseWav(
        readFileSync(path.join(directory, option.fileName!)),
      );

      expect(rendered.samples.length).toBe(committed.samples.length);

      let largestDifference: number = 0;

      for (let index: number = 0; index < rendered.samples.length; index++) {
        largestDifference = Math.max(
          largestDifference,
          Math.abs(rendered.samples[index]! - committed.samples[index]!),
        );
      }

      // One step of rounding is all floating point may move a sample.
      expect(largestDifference).toBeLessThanOrEqual(1);
    }
  }
});

describe("what each alarm is meant to sound like", () => {
  function readById(id: string): Wav {
    return read(
      BUNDLED.find((option: CriticalAlertSoundOption) => {
        return option.id === id;
      })!,
    );
  }

  test("the smoke alarm beeps three times, pauses, and does it again (ISO 8201)", () => {
    const wav: Wav = readById("smoke_alarm");
    const half: number = wav.sampleRate / 2;
    const levels: Array<boolean> = [];

    // Each half second, sampled away from the edges of the beeps.
    for (let window: number = 0; window < 8; window++) {
      const from: number = window * half + half / 4;
      levels.push(rms(wav.samples, from, from + half / 2) > 0.1);
    }

    expect(levels).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  test("the rising alarm starts softly and ends at full strength", () => {
    const wav: Wav = readById("rising");
    const second: number = wav.sampleRate;
    const opening: number = rms(wav.samples, 0, 3 * second);
    const closing: number = rms(
      wav.samples,
      wav.samples.length - 3 * second,
      wav.samples.length,
    );

    expect(closing).toBeGreaterThan(opening * 3);
  });

  test("the siren never stops sounding", () => {
    const wav: Wav = readById("siren");
    const tenth: number = wav.sampleRate / 10;

    for (
      let from: number = tenth;
      from + tenth < wav.samples.length - tenth;
      from += tenth
    ) {
      expect(rms(wav.samples, from, from + tenth)).toBeGreaterThan(0.2);
    }
  });

  test("the klaxon and the digital alarm come in bursts with gaps between them", () => {
    for (const id of ["klaxon", "digital"]) {
      const wav: Wav = readById(id);
      const window: number = wav.sampleRate / 20;
      let quiet: number = 0;
      let loud: number = 0;

      for (
        let from: number = 0;
        from + window <= wav.samples.length;
        from += window
      ) {
        if (rms(wav.samples, from, from + window) < 0.02) {
          quiet++;
        } else {
          loud++;
        }
      }

      expect(quiet).toBeGreaterThan(10);
      expect(loud).toBeGreaterThan(quiet);
    }
  });
});
