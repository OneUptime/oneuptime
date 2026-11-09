import {
  DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
  DISCOVERED_DEVICE_RETENTION_REFUSAL,
  KEEP_EVERY_DISCOVERED_DEVICE,
  MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  getDiscoveredDeviceRetentionProblem,
  isDiscoveredDeviceRetentionInDays,
  isDiscoveredDeviceRetentionOn,
  readDiscoveredDeviceRetentionInDays,
  toDiscoveredDeviceRetentionInDays,
} from "../../../Types/NetworkDevice/DiscoveredDeviceRetention";
import { describe, expect, test } from "@jest/globals";

/*
 * How long a discovered device stays once nothing sees it (issue #6389):
 * the values Project.discoveredDeviceRetentionInDays takes. ProjectService
 * refuses anything else, the age-out job and the list read it with these,
 * and the Dashboard offers exactly these choices - so a value one of them
 * takes, the others take too.
 */

const NOT_A_CHOICE: Array<number> = [
  1, 6, 8, 15, 29, 31, 45, 59, 61, 100, 364, 366, 1000, -7, -30, 7.5, 30.0001,
];

describe("the choices", () => {
  test("run from a week to a year, shortest first, and 30 days is the default", () => {
    expect(DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS).toEqual([
      7, 14, 30, 60, 90, 180, 365,
    ]);
    expect(DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS).toBe(30);
    expect(DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS).toContain(
      DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
    );
    expect(MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS).toBe(7);
  });

  test("0 is Never, and no choice is 0", () => {
    expect(KEEP_EVERY_DISCOVERED_DEVICE).toBe(0);
    expect(DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS).not.toContain(0);
  });

  test("the refusal names every choice and how to keep every device", () => {
    expect(DISCOVERED_DEVICE_RETENTION_REFUSAL).toBe(
      "Pick how long a discovered device stays once it is no longer seen: 7, 14, 30, 60, 90, 180 or 365 days, or 0 to keep every device.",
    );
  });
});

describe("isDiscoveredDeviceRetentionInDays", () => {
  test.each([...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS, 0])(
    "takes %p",
    (days: number) => {
      expect(isDiscoveredDeviceRetentionInDays(days)).toBe(true);
    },
  );

  test.each(NOT_A_CHOICE)("refuses %p, which is not a choice", (days: number) => {
    expect(isDiscoveredDeviceRetentionInDays(days)).toBe(false);
  });

  test.each([NaN, Infinity, -Infinity, "30", null, undefined, {}, [], true])(
    "refuses %p, which is not a number",
    (value: unknown) => {
      expect(isDiscoveredDeviceRetentionInDays(value)).toBe(false);
    },
  );
});

describe("getDiscoveredDeviceRetentionProblem", () => {
  test.each([...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS, 0])(
    "finds nothing wrong with %p",
    (days: number) => {
      expect(getDiscoveredDeviceRetentionProblem(days)).toBeNull();
    },
  );

  test.each(["30", " 60 ", "0", "365"])(
    "reads a whole number written as text, %p, as the number",
    (value: string) => {
      expect(getDiscoveredDeviceRetentionProblem(value)).toBeNull();
    },
  );

  test.each([
    ...NOT_A_CHOICE,
    NaN,
    Infinity,
    null,
    undefined,
    "",
    " ",
    "30 days",
    "thirty",
    "30.5",
    "-7",
    "1e1",
    "12345",
    "45",
    true,
    {},
    [30],
  ])("refuses %p with the choices", (value: unknown) => {
    expect(getDiscoveredDeviceRetentionProblem(value)).toBe(
      DISCOVERED_DEVICE_RETENTION_REFUSAL,
    );
  });
});

describe("toDiscoveredDeviceRetentionInDays", () => {
  test("stores a choice, Never, or text of either as the number", () => {
    expect(toDiscoveredDeviceRetentionInDays(90)).toBe(90);
    expect(toDiscoveredDeviceRetentionInDays(0)).toBe(0);
    expect(toDiscoveredDeviceRetentionInDays("14")).toBe(14);
    expect(toDiscoveredDeviceRetentionInDays(" 365 ")).toBe(365);
    expect(toDiscoveredDeviceRetentionInDays("0")).toBe(0);
  });

  test("anything else becomes the default, never a value the column cannot hold", () => {
    expect(toDiscoveredDeviceRetentionInDays(45)).toBe(30);
    expect(toDiscoveredDeviceRetentionInDays(null)).toBe(30);
    expect(toDiscoveredDeviceRetentionInDays("never")).toBe(30);
  });
});

describe("readDiscoveredDeviceRetentionInDays", () => {
  test("reads a choice and Never as they are", () => {
    for (const days of [...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS, 0]) {
      expect(readDiscoveredDeviceRetentionInDays(days)).toBe(days);
    }

    expect(readDiscoveredDeviceRetentionInDays("180")).toBe(180);
  });

  test("says nothing, rather than guess, of a value that is missing or not a choice", () => {
    for (const value of [
      undefined,
      null,
      45,
      -1,
      NaN,
      "abc",
      "",
      {},
      [],
    ] as Array<unknown>) {
      expect(readDiscoveredDeviceRetentionInDays(value)).toBeUndefined();
    }
  });
});

describe("isDiscoveredDeviceRetentionOn", () => {
  test("every choice removes devices, and Never removes none", () => {
    for (const days of DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS) {
      expect(isDiscoveredDeviceRetentionOn(days)).toBe(true);
    }

    expect(isDiscoveredDeviceRetentionOn(KEEP_EVERY_DISCOVERED_DEVICE)).toBe(
      false,
    );
  });
});
