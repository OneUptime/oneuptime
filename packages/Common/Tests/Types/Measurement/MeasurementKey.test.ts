import {
  MEASUREMENT_KEY_FALLBACK,
  MEASUREMENT_KEY_FORMAT,
  MEASUREMENT_KEY_INVALID_MESSAGE,
  MEASUREMENT_KEY_MAX_LENGTH,
  MEASUREMENT_KEY_PATTERN,
  generateMeasurementKey,
  getMeasurementKeyError,
  getMeasurementKeyFromName,
  isValidMeasurementKey,
} from "../../../Types/Measurement/MeasurementKey";
import MeasurementDefinitionValidator from "../../../Server/Utils/Measurement/MeasurementDefinitionValidator";
import { describe, expect, test } from "@jest/globals";

/*
 * A measurement's key is made from its name - by the form while the name is
 * typed, by the server when a create leaves it out - and it is part of the
 * metric name, oneuptime.<kind>.measurement.<key>. Every key made from a
 * name must therefore be one the server accepts from someone who types it.
 */

const NAMES: Array<string> = [
  "Time to Detect",
  "Time to Acknowledge",
  "Time to Mitigate (Sev 1)",
  "Start Delay",
  "Planned window length",
  "MTTR",
  "Zeit bis zur Lösung",
  "Délai de résolution",
  "検出までの時間",
  "🚀",
  "!!!",
  "",
  "A really quite long measurement name that goes on and on and on",
  "x".repeat(300),
  "1st response",
];

describe("getMeasurementKeyFromName", () => {
  test.each([
    ["Time to Detect", "time-to-detect"],
    ["Time to Acknowledge", "time-to-acknowledge"],
    ["Time to Mitigate (Sev 1)", "time-to-mitigate-sev-1"],
    ["Start Delay", "start-delay"],
    ["MTTR", "mttr"],
    ["Zeit bis zur Lösung", "zeit-bis-zur-losung"],
    ["Délai de résolution", "delai-de-resolution"],
    ["1st response", "1st-response"],
  ])("%p -> %p", (name: string, key: string) => {
    expect(getMeasurementKeyFromName(name)).toBe(key);
  });

  test("a name with nothing usable in it gets measurement", () => {
    expect(MEASUREMENT_KEY_FALLBACK).toBe("measurement");
    expect(getMeasurementKeyFromName("!!!")).toBe("measurement");
    expect(getMeasurementKeyFromName("検出までの時間")).toBe("measurement");
    expect(getMeasurementKeyFromName("")).toBe("measurement");
  });

  test("a long name gives a key of at most fifty characters", () => {
    const key: string = getMeasurementKeyFromName(
      "A really quite long measurement name that goes on and on and on",
    );

    expect(key.length).toBeLessThanOrEqual(MEASUREMENT_KEY_MAX_LENGTH);
    expect(key).toBe("a-really-quite-long-measurement-name-that-goes-on");
  });

  test.each(NAMES)(
    "the key made from %p is one the server accepts from someone who types it",
    (name: string) => {
      const key: string = getMeasurementKeyFromName(name);

      expect(isValidMeasurementKey(key)).toBe(true);
      expect(() => {
        MeasurementDefinitionValidator.validateKey(key);
      }).not.toThrow();
    },
  );
});

describe("generateMeasurementKey", () => {
  test("is the name's key when no measurement of the project has it", () => {
    expect(
      generateMeasurementKey({
        name: "Time to Detect",
        existingKeys: ["time-to-resolve"],
      }),
    ).toBe("time-to-detect");
  });

  test("numbers the key when another measurement has it", () => {
    expect(
      generateMeasurementKey({
        name: "Time to detect",
        existingKeys: ["time-to-detect"],
      }),
    ).toBe("time-to-detect-2");

    expect(
      generateMeasurementKey({
        name: "Time to detect",
        existingKeys: ["time-to-detect", "time-to-detect-2"],
      }),
    ).toBe("time-to-detect-3");
  });

  test("a numbered key of a fifty-character name still fits", () => {
    const name: string = "x".repeat(300);
    const first: string = generateMeasurementKey({ name, existingKeys: [] });
    const second: string = generateMeasurementKey({
      name,
      existingKeys: [first],
    });

    expect(first).toBe("x".repeat(50));
    expect(second).toBe(`${"x".repeat(48)}-2`);
    expect(isValidMeasurementKey(second)).toBe(true);
  });

  test("every key it hands out, clash after clash, is valid", () => {
    const taken: Array<string> = [];

    for (const name of [...NAMES, ...NAMES, ...NAMES]) {
      const key: string = generateMeasurementKey({ name, existingKeys: taken });

      expect(taken).not.toContain(key);
      expect(isValidMeasurementKey(key)).toBe(true);
      taken.push(key);
    }
  });
});

describe("isValidMeasurementKey", () => {
  test.each([
    "time-to-detect",
    "ttd",
    "0",
    "1st-response",
    "a".repeat(50),
    // Typed before keys were made from names, and still accepted.
    "a--b",
    "trailing-",
  ])("accepts %p", (key: string) => {
    expect(isValidMeasurementKey(key)).toBe(true);
  });

  test.each([
    "",
    "Time To Detect",
    "time to detect",
    "-time-to-detect",
    "time_to_detect",
    "time.to.detect",
    "größe",
    "a".repeat(51),
    undefined,
    null,
    42,
  ])("refuses %p", (key: unknown) => {
    expect(isValidMeasurementKey(key)).toBe(false);
  });

  test("is the server's rule", () => {
    expect(MeasurementDefinitionValidator.KEY_PATTERN).toBe(
      MEASUREMENT_KEY_PATTERN,
    );
  });
});

describe("getMeasurementKeyError", () => {
  test("says nothing about a valid key", () => {
    expect(getMeasurementKeyError("time-to-detect")).toBeNull();
  });

  test("says what a key may hold when it is not valid", () => {
    expect(getMeasurementKeyError("Time To Detect")).toBe(
      MEASUREMENT_KEY_INVALID_MESSAGE,
    );
    expect(MEASUREMENT_KEY_INVALID_MESSAGE).toBe(
      "Use lowercase letters (a-z), numbers and hyphens, starting with a letter or a number, at most 50 characters.",
    );
  });
});

describe("MEASUREMENT_KEY_FORMAT", () => {
  test("joins words with hyphens, fifty characters at most", () => {
    expect(MEASUREMENT_KEY_FORMAT).toEqual({
      separator: "-",
      maxLength: 50,
      fallback: "measurement",
    });
  });
});
