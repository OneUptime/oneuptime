import MeasurementUnit, {
  DEFAULT_MEASUREMENT_UNIT,
  MEASUREMENT_UNIT_SPELLINGS,
  SECONDS_PER_MEASUREMENT_UNIT,
  convertMeasurementValueFromSeconds,
  getMeasurementUnit,
} from "../../../Types/Measurement/MeasurementUnit";
import ValueFormatter from "../../../Utils/ValueFormatter";
import { describe, expect, test } from "@jest/globals";

/*
 * "Unit field in the end could be a dropdown." - the maintainer, on a free
 * text Unit with the placeholder "seconds".
 *
 * The unit is now one of four, and it is the unit the chart's number is
 * really in: the metric writer converts each value to it. These pin how a
 * stored unit is read - including the free text some measurements were
 * saved with - and what a value becomes in each.
 */

describe("MeasurementUnit", () => {
  test("offers the four units a duration reads well in, seconds the default", () => {
    expect(Object.values(MeasurementUnit)).toEqual([
      "seconds",
      "minutes",
      "hours",
      "days",
    ]);
    expect(DEFAULT_MEASUREMENT_UNIT).toBe(MeasurementUnit.Seconds);
  });

  test("knows how many seconds each unit is", () => {
    expect(SECONDS_PER_MEASUREMENT_UNIT).toEqual({
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    });
  });

  test("reads each unit's own value as itself", () => {
    for (const unit of Object.values(MeasurementUnit)) {
      expect(getMeasurementUnit(unit)).toBe(unit);
    }
  });

  test.each([
    ["s", MeasurementUnit.Seconds],
    ["sec", MeasurementUnit.Seconds],
    ["secs", MeasurementUnit.Seconds],
    ["Second", MeasurementUnit.Seconds],
    ["min", MeasurementUnit.Minutes],
    ["Mins", MeasurementUnit.Minutes],
    [" MINUTES ", MeasurementUnit.Minutes],
    ["h", MeasurementUnit.Hours],
    ["hr", MeasurementUnit.Hours],
    ["Hours", MeasurementUnit.Hours],
    ["d", MeasurementUnit.Days],
    ["day", MeasurementUnit.Days],
  ])(
    "reads the typed spelling %p as %p",
    (typed: string, unit: MeasurementUnit) => {
      expect(getMeasurementUnit(typed)).toBe(unit);
    },
  );

  test.each([[undefined], [null], [""], ["   "], ["ms"], ["fortnights"], [42]])(
    "reads %p as seconds, the unit the values are worked out in",
    (stored: unknown) => {
      expect(getMeasurementUnit(stored)).toBe(MeasurementUnit.Seconds);
    },
  );

  test("every spelling belongs to one unit only", () => {
    const seen: Map<string, MeasurementUnit> = new Map<
      string,
      MeasurementUnit
    >();

    for (const unit of Object.values(MeasurementUnit)) {
      expect(MEASUREMENT_UNIT_SPELLINGS[unit]).toContain(unit);

      for (const spelling of MEASUREMENT_UNIT_SPELLINGS[unit]) {
        expect({ spelling, unit: seen.get(spelling) || unit }).toEqual({
          spelling,
          unit,
        });
        seen.set(spelling, unit);
        expect(spelling).toBe(spelling.toLowerCase());
      }
    }
  });

  test.each([
    [5400, "seconds", 5400],
    [5400, "minutes", 90],
    [5400, "hours", 1.5],
    [172800, "days", 2],
    [90, "min", 1.5],
    [5400, "something else", 5400],
    [5400, undefined, 5400],
  ])(
    "%p seconds in %p is %p",
    (seconds: number, unit: string | undefined, expected: number) => {
      expect(
        convertMeasurementValueFromSeconds({
          valueInSeconds: seconds,
          unit: unit,
        }),
      ).toBeCloseTo(expected, 10);
    },
  );

  /*
   * The reason seconds is the default: the dashboard's formatter scales a
   * value in seconds on its own, so "Automatic" really is automatic. A unit
   * with no scale of its own keeps its number and says its name.
   */
  test("a chart in seconds reads in whatever scale fits, one in hours stays in hours", () => {
    expect(ValueFormatter.formatValue(45, MeasurementUnit.Seconds)).toContain(
      "sec",
    );
    expect(ValueFormatter.formatValue(720, MeasurementUnit.Seconds)).toContain(
      "min",
    );
    expect(ValueFormatter.formatValue(7200, MeasurementUnit.Seconds)).toContain(
      "hours",
    );
    expect(
      ValueFormatter.formatValue(
        convertMeasurementValueFromSeconds({
          valueInSeconds: 7200,
          unit: MeasurementUnit.Hours,
        }),
        MeasurementUnit.Hours,
      ),
    ).toBe("2 Hours");
  });
});
