/** @timezone Europe/London */

import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";

describe("XAxisUtil", () => {
  test("formats past-day chart labels in local BST time instead of UTC", () => {
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-04-06T14:00:00.000Z"),
      xAxisMax: new Date("2026-04-07T14:00:00.000Z"),
    });

    expect(formatter(new Date("2026-04-07T07:30:00.000Z"))).toBe(
      "07 Apr, 08:00",
    );
  });

  test("does not mutate the original date while rounding local labels", () => {
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-04-06T14:00:00.000Z"),
      xAxisMax: new Date("2026-04-07T14:00:00.000Z"),
    });

    const originalDate: Date = new Date("2026-04-07T07:30:45.000Z");

    formatter(originalDate);

    expect(originalDate.toISOString()).toBe("2026-04-07T07:30:45.000Z");
  });
});
