import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

type Unit = "minutes" | "hours" | "days";

describe("RollingTimeUtil", () => {
  // Slack for the two OneUptimeDate.getCurrentDate() calls the util makes.
  const TOLERANCE_MS: number = 2000;

  const applyUnit: (endValue: Date, unit: Unit, amount: number) => Date = (
    endValue: Date,
    unit: Unit,
    amount: number,
  ): Date => {
    if (unit === "minutes") {
      return OneUptimeDate.addRemoveMinutes(endValue, -amount);
    }
    if (unit === "hours") {
      return OneUptimeDate.addRemoveHours(endValue, -amount);
    }
    return OneUptimeDate.addRemoveDays(endValue, -amount);
  };

  describe("getDefault", () => {
    test("defaults to the past 1 minute", () => {
      expect(RollingTimeUtil.getDefault()).toBe(RollingTime.Past1Minute);
    });
  });

  describe("convertToStartAndEndDate", () => {
    // Note: RollingTime.Past1Hours is labelled "Past 1 Day" and subtracts a day.
    const cases: Array<[RollingTime, Unit, number]> = [
      [RollingTime.Past1Minute, "minutes", 1],
      [RollingTime.Past5Minutes, "minutes", 5],
      [RollingTime.Past10Minutes, "minutes", 10],
      [RollingTime.Past15Minutes, "minutes", 15],
      [RollingTime.Past30Minutes, "minutes", 30],
      [RollingTime.Past1Hour, "hours", 1],
      [RollingTime.Past2Hours, "hours", 2],
      [RollingTime.Past3Hours, "hours", 3],
      [RollingTime.Past6Hours, "hours", 6],
      [RollingTime.Past12Hours, "hours", 12],
      [RollingTime.Past1Hours, "days", 1],
      [RollingTime.Past2Days, "days", 2],
      [RollingTime.Past3Days, "days", 3],
      [RollingTime.Past7Days, "days", 7],
      [RollingTime.Past14Days, "days", 14],
      [RollingTime.Past30Days, "days", 30],
      [RollingTime.Past60Days, "days", 60],
      [RollingTime.Past90Days, "days", 90],
      [RollingTime.Past180Days, "days", 180],
      [RollingTime.Past365Days, "days", 365],
    ];

    test.each(cases)(
      "%s spans the expected window ending now",
      (rollingTime: RollingTime, unit: Unit, amount: number) => {
        const range: InBetween<Date> =
          RollingTimeUtil.convertToStartAndEndDate(rollingTime);

        // End of the window is (approximately) now.
        expect(
          Math.abs(
            range.endValue.getTime() - OneUptimeDate.getCurrentDate().getTime(),
          ),
        ).toBeLessThan(TOLERANCE_MS);

        // Start is before end.
        expect(range.startValue.getTime()).toBeLessThan(
          range.endValue.getTime(),
        );

        /*
         * Start is the end shifted back by the expected amount (DST-safe:
         * computed with the same helper the util uses, off its own end date).
         */
        const expectedStart: Date = applyUnit(range.endValue, unit, amount);
        expect(
          Math.abs(range.startValue.getTime() - expectedStart.getTime()),
        ).toBeLessThan(TOLERANCE_MS);
      },
    );

    test("returns an InBetween instance", () => {
      const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past1Hour,
      );
      expect(range).toBeInstanceOf(InBetween);
    });

    test("longer rolling windows produce earlier start dates", () => {
      const oneHour: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past1Hour,
      );
      const oneDay: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past2Days,
      );

      expect(oneDay.startValue.getTime()).toBeLessThan(
        oneHour.startValue.getTime(),
      );
    });
  });
});
