import {
  StoredRestrictionRead,
  StoredRotationRead,
  countWrittenRows,
  isSameStoredJson,
  readIntervalWord,
  readStoredRestriction,
  readStoredRotation,
} from "../../../FeatureSet/Workers/DataMigrations/RepairScheduleLayerRestrictionTypes";
import DataMigrations from "../../../FeatureSet/Workers/DataMigrations/Index";
import EventInterval from "Common/Types/Events/EventInterval";
import { JSONObject } from "Common/Types/JSON";
import { RestrictionType } from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE REPAIR OF STORED SCHEDULE LAYERS READS EACH ONE AS (#11269).
 *
 * A layer is read as the engine reads it now; what it pages by before is
 * what the engine read before - the older key alone - and a layer whose
 * paging changes is the one whose schedule is told. Its Postgres suite runs
 * the statements; here, what each stored value comes to.
 */

function restriction(value: JSONObject): JSONObject {
  return { _type: "RestrictionTimes", value: value };
}

const NIGHTS: JSONObject = {
  startTime: { _type: "DateTime", value: "2026-01-05T16:00:00.000Z" },
  endTime: { _type: "DateTime", value: "2026-01-06T06:00:00.000Z" },
};

const MONDAY: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: { _type: "DateTime", value: "2026-01-05T08:00:00.000Z" },
  endTime: { _type: "DateTime", value: "2026-01-05T16:00:00.000Z" },
};

describe("readStoredRestriction", () => {
  test("the older spelling alone: the same type, stored under its name", () => {
    const read: StoredRestrictionRead = readStoredRestriction(
      restriction({
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [],
      }),
    )!;

    expect(read.typeBefore).toBe(RestrictionType.Daily);
    expect(read.typeNow).toBe(RestrictionType.Daily);
    expect(read.stored).toEqual({
      _type: "RestrictionTimes",
      value: {
        restrictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [],
      },
    });
  });

  test("REGRESSION: the natural spelling paged nobody before, and pages now", () => {
    const read: StoredRestrictionRead = readStoredRestriction(
      restriction({
        restrictionType: "None",
        dayRestrictionTimes: null,
        weeklyRestrictionTimes: [],
      }),
    )!;

    expect(read.typeBefore).toBeNull();
    expect(read.typeNow).toBe(RestrictionType.None);
  });

  test("no type at all: read for the hours it holds", () => {
    expect(
      readStoredRestriction(restriction({ weeklyRestrictionTimes: [MONDAY] }))!
        .typeNow,
    ).toBe(RestrictionType.Weekly);
    expect(
      readStoredRestriction(
        restriction({ type: "Daily", dayRestrictionTimes: NIGHTS }),
      )!.typeNow,
    ).toBe(RestrictionType.Daily);
    expect(readStoredRestriction(restriction({}))!.typeNow).toBe(
      RestrictionType.None,
    );
  });

  test("both spellings stored: the one under its name is what the engine reads now", () => {
    const read: StoredRestrictionRead = readStoredRestriction(
      restriction({
        restrictionType: "Weekly",
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [MONDAY],
      }),
    )!;

    expect(read.typeBefore).toBe(RestrictionType.Daily);
    expect(read.typeNow).toBe(RestrictionType.Weekly);
  });

  test("not a restriction this reads: left as it is", () => {
    for (const raw of [
      null,
      "None",
      [],
      { _type: "Recurring", value: {} },
      {
        _type: "RestrictionTimes",
      },
    ]) {
      expect(readStoredRestriction(raw)).toBeNull();
    }
  });
});

describe("readStoredRotation", () => {
  test("an interval the engine knows: nothing to repair", () => {
    expect(
      readStoredRotation({
        _type: "Recurring",
        value: { intervalType: "Week", intervalCount: 1 },
      }),
    ).toBeNull();
    // Left out, fromJSON has always read a day.
    expect(
      readStoredRotation({ _type: "Recurring", value: { intervalCount: 2 } }),
    ).toBeNull();
  });

  test('REGRESSION: "Weekly" is the week it names, keeping its count', () => {
    const read: StoredRotationRead = readStoredRotation({
      _type: "Recurring",
      value: {
        intervalType: "Weekly",
        intervalCount: { _type: "PositiveNumber", value: 2 },
      },
    })!;

    expect(read.intervalBefore).toBe("Weekly");
    expect(read.intervalNow).toBe(EventInterval.Week);
    expect(read.stored).toEqual({
      _type: "Recurring",
      value: {
        intervalType: "Week",
        intervalCount: { _type: "PositiveNumber", value: 2 },
      },
    });
  });

  test("an interval named in no way the engine's words say: a day, as it was stepped", () => {
    expect(
      readStoredRotation({
        _type: "Recurring",
        value: { intervalType: "fortnight", intervalCount: 1 },
      })!.intervalNow,
    ).toBe(EventInterval.Day);
  });

  test("readIntervalWord: the other ways each interval was written", () => {
    const words: Record<string, EventInterval> = {
      hourly: EventInterval.Hour,
      HOURS: EventInterval.Hour,
      " daily ": EventInterval.Day,
      week: EventInterval.Week,
      Weeks: EventInterval.Week,
      monthly: EventInterval.Month,
      Year: EventInterval.Year,
      annually: EventInterval.Year,
    };

    for (const [word, interval] of Object.entries(words)) {
      expect(readIntervalWord(word)).toBe(interval);
    }

    expect(readIntervalWord("fortnight")).toBeNull();
    expect(readIntervalWord(7)).toBeNull();
  });
});

describe("isSameStoredJson", () => {
  test("keys in any order, and a key left undefined, are the same JSON", () => {
    expect(
      isSameStoredJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true);
    expect(isSameStoredJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  test("a value, a key or an order of a list that differs is not", () => {
    expect(isSameStoredJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(isSameStoredJson({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(isSameStoredJson([1, 2], [2, 1])).toBe(false);
    expect(isSameStoredJson({ a: [] }, { a: {} })).toBe(false);
  });
});

describe("countWrittenRows", () => {
  test("REGRESSION: an UPDATE's [rows, rowCount] that wrote nothing is nothing, not two", () => {
    expect(countWrittenRows([[], 0])).toBe(0);
    expect(countWrittenRows([[{ id: "a" }], 1])).toBe(1);
  });

  test("rows alone, and anything else", () => {
    expect(countWrittenRows([{ id: "a" }, { id: "b" }])).toBe(2);
    expect(countWrittenRows([])).toBe(0);
    expect(countWrittenRows(undefined)).toBe(0);
  });
});

describe("its place among the data migrations", () => {
  test("registered once, before the two slots kept last", () => {
    const names: Array<string> = DataMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === "RepairScheduleLayerRestrictionTypes";
      }),
    ).toHaveLength(1);
    expect(names.indexOf("RepairScheduleLayerRestrictionTypes")).toBeLessThan(
      names.indexOf("BackfillIncidentCallTranscriptSignInAccount"),
    );
  });
});
