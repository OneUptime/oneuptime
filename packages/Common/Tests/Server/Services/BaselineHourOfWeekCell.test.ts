import { MetricBaselineService } from "../../../Server/Services/MetricBaselineService";
import { describe, expect, test } from "@jest/globals";

/*
 * The baseline views wrote hourOfWeek with mode 1 of toDayOfWeek until
 * CorrectBaselineViewHourOfWeek: Monday at 232 + hour, every other day one
 * slot early. Those rows stay stored, so every lookup of a cell has to match
 * them as well, under their own weekday. The readers against a real
 * ClickHouse are in App's CorrectBaselineViewHourOfWeekClickhouse.test.ts.
 */

// What the old view wrote for ISO weekday 1..7 and hour 0..23, as UInt8.
function oldEncoding(isoWeekday: number, hour: number): number {
  return ((((isoWeekday - 1 - 1) * 24 + hour) % 256) + 256) % 256;
}

describe("MetricBaselineService.hourOfWeekCellFilter", () => {
  test.each([
    [0, "hourOfWeek IN (0, 232) AND toDayOfWeek(day) = 1"],
    [23, "hourOfWeek IN (23, 255) AND toDayOfWeek(day) = 1"],
    [24, "hourOfWeek IN (24, 0) AND toDayOfWeek(day) = 2"],
    [167, "hourOfWeek IN (167, 143) AND toDayOfWeek(day) = 7"],
  ])("cell %i", (cell: number, filter: string) => {
    expect(MetricBaselineService.hourOfWeekCellFilter(cell)).toBe(filter);
  });

  test("matches each cell in both encodings, under its own weekday", () => {
    for (let cell: number = 0; cell < 168; cell++) {
      const isoWeekday: number = Math.floor(cell / 24) + 1;
      const hour: number = cell % 24;

      expect(MetricBaselineService.hourOfWeekCellFilter(cell)).toBe(
        `hourOfWeek IN (${cell}, ${oldEncoding(isoWeekday, hour)}) AND toDayOfWeek(day) = ${isoWeekday}`,
      );
    }
  });
});
