import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_SAVINGS_BASELINE_DAYS,
  CLOUD_SAVINGS_MEASURE_DAYS,
  CLOUD_SAVINGS_MEASURE_GIVE_UP_DAYS,
  CloudSavingsMeasurement,
} from "../../../Types/Cloud/CloudSavingsAction";
import { CLOUD_DAYS_IN_AVERAGE_MONTH } from "../../../Types/Cloud/CloudRightSizing";
import {
  CLOUD_SAVINGS_SETTLED_AFTER_DAYS,
  CloudSavingsCostRead,
  CloudSavingsJudgement,
  CloudSavingsMeasureWindows,
  getCloudSavingsMeasureWindows,
  getCloudSavingsRealisedThisMonth,
  getCloudSavingsScheduledHoursThisMonth,
  judgeCloudSavings,
} from "../../../Types/Cloud/CloudSavingsMeasure";

/*
 * PROVED BY THE BILL (#11010): a change is realised only when its cloud's
 * bill shows the resource costing less - never because it was promised.
 */

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

// A volume deleted on 10 November, afternoon UTC.
const APPLIED_AT: Date = at("2026-11-10T15:00:00Z");

function judge(data: {
  now: string;
  costs: Partial<CloudSavingsCostRead>;
  promisedMonthly?: number;
  undoneAt?: string;
}): CloudSavingsJudgement {
  const now: Date = at(data.now);
  const windows: CloudSavingsMeasureWindows = getCloudSavingsMeasureWindows({
    appliedAt: APPLIED_AT,
    now,
    undoneAt: data.undoneAt ? at(data.undoneAt) : null,
  });

  return judgeCloudSavings({
    windows,
    costs: {
      beforeTotal: 70,
      beforeDays: 7,
      afterTotal: 0,
      isAccountReadThrough: true,
      ...data.costs,
    },
    promisedMonthly: data.promisedMonthly ?? 300,
    appliedAt: APPLIED_AT,
    now,
  });
}

describe("getCloudSavingsMeasureWindows", () => {
  test("compares the week before the day of the change with the settled full days after it", () => {
    expect(CLOUD_SAVINGS_BASELINE_DAYS).toBe(7);
    expect(CLOUD_SAVINGS_SETTLED_AFTER_DAYS).toBe(2);

    expect(
      getCloudSavingsMeasureWindows({
        appliedAt: APPLIED_AT,
        now: at("2026-11-16T09:00:00Z"),
      }),
    ).toEqual({
      beforeStart: at("2026-11-03T00:00:00Z"),
      beforeEnd: at("2026-11-10T00:00:00Z"),
      afterStart: at("2026-11-11T00:00:00Z"),
      // The 15th is still moving on the bill: the 11th to the 14th are read.
      afterEnd: at("2026-11-15T00:00:00Z"),
      afterDays: 4,
      isClosed: false,
    });
  });

  test("has no after-window while no full day after the change has settled", () => {
    const windows: CloudSavingsMeasureWindows = getCloudSavingsMeasureWindows({
      appliedAt: APPLIED_AT,
      now: at("2026-11-12T23:00:00Z"),
    });

    expect(windows.afterDays).toBe(0);
    expect(windows.afterEnd).toEqual(windows.afterStart);
  });

  test("ends the after-window on the day a change was undone", () => {
    const windows: CloudSavingsMeasureWindows = getCloudSavingsMeasureWindows({
      appliedAt: APPLIED_AT,
      now: at("2026-11-20T09:00:00Z"),
      undoneAt: at("2026-11-13T08:00:00Z"),
    });

    expect(windows.afterEnd).toEqual(at("2026-11-13T00:00:00Z"));
    expect(windows.afterDays).toBe(2);
    expect(windows.isClosed).toBe(true);
  });

  test("is not closed while the day a change was undone is still moving on the bill", () => {
    expect(
      getCloudSavingsMeasureWindows({
        appliedAt: APPLIED_AT,
        now: at("2026-11-13T09:00:00Z"),
        undoneAt: at("2026-11-13T08:00:00Z"),
      }).isClosed,
    ).toBe(false);
  });
});

describe("judgeCloudSavings", () => {
  test("realised: the resource's cost a day fell, by most of what was promised", () => {
    // 10 a day before; nothing after: 10 a day, 304.38 a month.
    expect(judge({ now: "2026-11-16T09:00:00Z", costs: {} })).toEqual({
      measurement: CloudSavingsMeasurement.Realised,
      costBeforeDaily: 10,
      costAfterDaily: 0,
      realisedMonthlySavings: 304.38,
    });
  });

  test("realised at a quarter of what was promised, not seen below it", () => {
    // A fall of 2.5 a day is 76.09 a month: over a quarter of 300.
    expect(
      judge({ now: "2026-11-16T09:00:00Z", costs: { afterTotal: 30 } })
        .measurement,
    ).toBe(CloudSavingsMeasurement.Realised);

    // A fall of 0.5 a day is 15.22 a month: under a quarter of 300.
    const small: CloudSavingsJudgement = judge({
      now: "2026-11-16T09:00:00Z",
      costs: { afterTotal: 38 },
    });

    expect(small.measurement).toBe(CloudSavingsMeasurement.NotSeen);
    expect(small.realisedMonthlySavings).toBe(15.22);
  });

  test("not seen when the bill did not fall, and never a negative saving", () => {
    const higher: CloudSavingsJudgement = judge({
      now: "2026-11-16T09:00:00Z",
      costs: { afterTotal: 60 },
    });

    expect(higher.measurement).toBe(CloudSavingsMeasurement.NotSeen);
    expect(higher.costAfterDaily).toBe(15);
    expect(higher.realisedMonthlySavings).toBe(0);
  });

  test("a change that promised nothing is realised by any fall", () => {
    expect(
      judge({
        now: "2026-11-16T09:00:00Z",
        costs: { afterTotal: 36 },
        promisedMonthly: 0,
      }).measurement,
    ).toBe(CloudSavingsMeasurement.Realised);
  });

  test(`keeps measuring until ${CLOUD_SAVINGS_MEASURE_DAYS} settled days after the change are on the bill`, () => {
    // The 11th and 12th have settled, the 13th has not.
    expect(judge({ now: "2026-11-14T09:00:00Z", costs: {} })).toEqual({
      measurement: CloudSavingsMeasurement.Measuring,
      costBeforeDaily: 10,
    });
    expect(judge({ now: "2026-11-15T09:00:00Z", costs: {} }).measurement).toBe(
      CloudSavingsMeasurement.Realised,
    );
  });

  test("keeps measuring while the account's costs were not read through the after-window", () => {
    expect(
      judge({
        now: "2026-11-16T09:00:00Z",
        costs: { isAccountReadThrough: false },
      }).measurement,
    ).toBe(CloudSavingsMeasurement.Measuring);
  });

  test(`gives up after ${CLOUD_SAVINGS_MEASURE_GIVE_UP_DAYS} days without a settled reading`, () => {
    expect(
      judge({
        now: "2026-12-02T16:00:00Z",
        costs: { isAccountReadThrough: false },
      }),
    ).toEqual({
      measurement: CloudSavingsMeasurement.CannotMeasure,
      costBeforeDaily: 10,
    });
  });

  test("cannot measure a resource its cloud never billed by name", () => {
    for (const costs of [
      { beforeTotal: 0, beforeDays: 0 },
      { beforeTotal: 0, beforeDays: 7 },
    ]) {
      expect(judge({ now: "2026-11-16T09:00:00Z", costs }).measurement).toBe(
        CloudSavingsMeasurement.CannotMeasure,
      );
    }
  });

  test("a change undone after two days has too few days after it to prove, and says so at once", () => {
    expect(
      judge({
        now: "2026-11-20T09:00:00Z",
        costs: {},
        undoneAt: "2026-11-13T08:00:00Z",
      }),
    ).toEqual({
      measurement: CloudSavingsMeasurement.CannotMeasure,
      costBeforeDaily: 10,
    });
  });

  test("a change undone after a week is judged on the days it stood", () => {
    // Stood the 11th to the 16th: six days at 1 a day after.
    expect(
      judge({
        now: "2026-11-25T09:00:00Z",
        costs: { afterTotal: 6 },
        undoneAt: "2026-11-17T08:00:00Z",
      }),
    ).toEqual({
      measurement: CloudSavingsMeasurement.Realised,
      costBeforeDaily: 10,
      costAfterDaily: 1,
      realisedMonthlySavings: 273.94,
    });
  });
});

describe("getCloudSavingsRealisedThisMonth", () => {
  const TEN_A_DAY: number = 10 * CLOUD_DAYS_IN_AVERAGE_MONTH;

  test("counts the realised saving a day over the days of this month after the change", () => {
    // Made on 28 October: counted from 1 November to the 16th, 15 days.
    expect(
      getCloudSavingsRealisedThisMonth({
        realisedMonthlySavings: TEN_A_DAY,
        appliedAt: at("2026-10-28T10:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(150);

    // Made on 10 November: counted from the 11th, 5 days.
    expect(
      getCloudSavingsRealisedThisMonth({
        realisedMonthlySavings: TEN_A_DAY,
        appliedAt: APPLIED_AT,
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(50);
  });

  test("stops counting on the day a change was undone", () => {
    expect(
      getCloudSavingsRealisedThisMonth({
        realisedMonthlySavings: TEN_A_DAY,
        appliedAt: at("2026-10-28T10:00:00Z"),
        undoneAt: at("2026-11-05T12:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(40);
  });

  test("counts nothing for a change undone last month, or made today", () => {
    expect(
      getCloudSavingsRealisedThisMonth({
        realisedMonthlySavings: TEN_A_DAY,
        appliedAt: at("2026-10-01T10:00:00Z"),
        undoneAt: at("2026-10-20T10:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(0);
    expect(
      getCloudSavingsRealisedThisMonth({
        realisedMonthlySavings: TEN_A_DAY,
        appliedAt: at("2026-11-16T08:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(0);
  });
});

describe("getCloudSavingsScheduledHoursThisMonth", () => {
  test("counts an ended off-hours stop's hours", () => {
    expect(
      getCloudSavingsScheduledHoursThisMonth({
        appliedAt: at("2026-11-12T18:00:00Z"),
        endedAt: at("2026-11-13T07:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(13);
  });

  test("counts only the part of a stop since the 1st", () => {
    expect(
      getCloudSavingsScheduledHoursThisMonth({
        appliedAt: at("2026-10-31T18:00:00Z"),
        endedAt: at("2026-11-01T07:00:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(7);
  });

  test("counts a stop still standing up to now", () => {
    expect(
      getCloudSavingsScheduledHoursThisMonth({
        appliedAt: at("2026-11-16T07:30:00Z"),
        now: at("2026-11-16T10:00:00Z"),
      }),
    ).toBe(2.5);
  });
});
