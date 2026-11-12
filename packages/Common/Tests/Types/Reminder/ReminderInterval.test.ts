import { describe, expect, test } from "@jest/globals";
import {
  MAX_REMINDER_INTERVAL_IN_MINUTES,
  MIN_REMINDER_INTERVAL_IN_MINUTES,
  REMINDER_INTERVAL_COLUMN,
  REMINDER_INTERVAL_REFUSAL,
  getReminderIntervalInMinutes,
  getReminderIntervalRefusal,
  readReminderIntervalInMinutes,
} from "../../../Types/Reminder/ReminderInterval";

/*
 * A REMINDER RULE'S INTERVAL: A WHOLE NUMBER OF MINUTES FROM 1 TO A YEAR.
 *
 * The services hold every write to it (getReminderIntervalRefusal,
 * readReminderIntervalInMinutes), and the workers, the services that
 * schedule a record's next reminder and the Dashboard's countdown read a
 * saved rule with getReminderIntervalInMinutes - where an interval below a
 * minute, which a rule saved before the check can hold, reminds nobody
 * instead of every minute.
 */

describe("the interval's bounds", () => {
  test("from a minute, the workers' own beat, to a year", () => {
    expect(MIN_REMINDER_INTERVAL_IN_MINUTES).toBe(1);
    expect(MAX_REMINDER_INTERVAL_IN_MINUTES).toBe(525600);
    expect(MAX_REMINDER_INTERVAL_IN_MINUTES).toBe(365 * 24 * 60);
  });

  test("the year fits the integer column it is saved in", () => {
    expect(MAX_REMINDER_INTERVAL_IN_MINUTES).toBeLessThan(2 ** 31 - 1);
  });

  test("names the column every reminder rule keeps it in", () => {
    expect(REMINDER_INTERVAL_COLUMN).toBe("reminderIntervalInMinutes");
  });

  test("the refusal says what the field is called and what it takes", () => {
    expect(REMINDER_INTERVAL_REFUSAL).toBe(
      "Reminder Interval (Minutes) must be a whole number of minutes from 1 to 525600 (a year).",
    );
  });
});

describe("what a write may save (readReminderIntervalInMinutes)", () => {
  test.each([
    [1, 1],
    [30, 30],
    [1440, 1440],
    [525600, 525600],
    ["30", 30],
    [" 45 ", 45],
    ["1", 1],
    ["525600", 525600],
    // Text that is a whole number is the number it spells, written as one.
    ["30.0", 30],
    ["1e3", 1000],
    [30.0, 30],
  ])("%p saves as %p", (value: unknown, minutes: number) => {
    expect(readReminderIntervalInMinutes(value)).toBe(minutes);
  });

  test.each([
    [0],
    [-0],
    [-1],
    [-5],
    [0.5],
    [1.5],
    [29.99],
    [525601],
    [2 ** 31],
    [Number.MAX_SAFE_INTEGER],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    ["0"],
    ["-5"],
    ["1.5"],
    ["thirty"],
    ["30 minutes"],
    [""],
    ["   "],
    [null],
    [undefined],
    [true],
    [false],
    [{}],
    [[30]],
  ])("%p is not saved", (value: unknown) => {
    expect(readReminderIntervalInMinutes(value)).toBeNull();
  });
});

describe("why a write is refused (getReminderIntervalRefusal)", () => {
  test("an interval of 0, below 0, a part of a minute or over a year is refused in the rule's own words", () => {
    for (const value of [0, -5, -1, 1.5, 525601, "0", "-5", "abc", ""]) {
      expect(getReminderIntervalRefusal(value)).toBe(REMINDER_INTERVAL_REFUSAL);
    }
  });

  test("null - an interval taken away - is refused too: a rule always has one", () => {
    expect(getReminderIntervalRefusal(null)).toBe(REMINDER_INTERVAL_REFUSAL);
  });

  test("nothing at all is no interval written: no refusal of its own", () => {
    expect(getReminderIntervalRefusal(undefined)).toBeNull();
  });

  test.each([[1], [30], [525600], ["30"]])(
    "%p is not refused",
    (value: unknown) => {
      expect(getReminderIntervalRefusal(value)).toBeNull();
    },
  );

  test("refuses exactly what readReminderIntervalInMinutes does not save", () => {
    const values: Array<unknown> = [
      -10,
      -1,
      0,
      0.5,
      1,
      2,
      59,
      60,
      1.25,
      525599,
      525600,
      525601,
      "7",
      "7.5",
      "x",
      null,
      true,
    ];

    for (const value of values) {
      expect(getReminderIntervalRefusal(value) === null).toBe(
        readReminderIntervalInMinutes(value) !== null,
      );
    }
  });
});

describe("how often a saved rule reminds (getReminderIntervalInMinutes)", () => {
  test.each([
    [1, 1],
    [30, 30],
    [10080, 10080],
    [525600, 525600],
  ])(
    "a rule saved with %p reminds every %p minutes",
    (saved: number, minutes: number) => {
      expect(getReminderIntervalInMinutes(saved)).toBe(minutes);
    },
  );

  test.each([[-5], [-1], [0], [-0], [null], [undefined], [Number.NaN]])(
    "a rule saved with %p reminds nobody - never every minute",
    (saved: unknown) => {
      expect(getReminderIntervalInMinutes(saved)).toBeNull();
    },
  );

  test("a rule saved before the check with more than a year reminds once a year", () => {
    expect(getReminderIntervalInMinutes(600000)).toBe(525600);
    expect(getReminderIntervalInMinutes(2 ** 31 - 1)).toBe(525600);
  });

  test("an interval read back as text is the number it spells", () => {
    expect(getReminderIntervalInMinutes("45")).toBe(45);
    expect(getReminderIntervalInMinutes("-5")).toBeNull();
    expect(getReminderIntervalInMinutes("1.5")).toBeNull();
  });

  test("every interval a write may save reminds at exactly that interval", () => {
    for (const minutes of [1, 2, 15, 30, 60, 1440, 10080, 525600]) {
      expect(
        getReminderIntervalInMinutes(readReminderIntervalInMinutes(minutes)),
      ).toBe(minutes);
    }
  });
});
