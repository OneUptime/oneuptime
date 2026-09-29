import DayOfWeek, { DayOfWeekUtil } from "../../../Types/Day/DayOfWeek";
import { describe, expect, test } from "@jest/globals";

describe("DayOfWeekUtil.getNumberOfDayOfWeek", () => {
  test("maps each day to its JS Date index (Sunday=0 … Saturday=6)", () => {
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Sunday)).toBe(0);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Monday)).toBe(1);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Tuesday)).toBe(2);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Wednesday)).toBe(3);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Thursday)).toBe(4);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Friday)).toBe(5);
    expect(DayOfWeekUtil.getNumberOfDayOfWeek(DayOfWeek.Saturday)).toBe(6);
  });

  test("agrees with the native Date.getDay() for a known week", () => {
    // 2024-01-07 is a Sunday; the following seven days walk the whole week.
    const days: Array<DayOfWeek> = [
      DayOfWeek.Sunday,
      DayOfWeek.Monday,
      DayOfWeek.Tuesday,
      DayOfWeek.Wednesday,
      DayOfWeek.Thursday,
      DayOfWeek.Friday,
      DayOfWeek.Saturday,
    ];

    days.forEach((day: DayOfWeek, index: number) => {
      const date: Date = new Date(Date.UTC(2024, 0, 7 + index));
      expect(DayOfWeekUtil.getNumberOfDayOfWeek(day)).toBe(date.getUTCDay());
    });
  });

  test("returns unique indices for all seven days", () => {
    const allDays: Array<DayOfWeek> = Object.values(DayOfWeek);
    const indices: Array<number> = allDays.map((day: DayOfWeek) => {
      return DayOfWeekUtil.getNumberOfDayOfWeek(day);
    });

    expect(new Set(indices).size).toBe(7);
    expect(
      indices.sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
