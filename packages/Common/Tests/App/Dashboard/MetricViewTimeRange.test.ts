import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MetricViewTimeRange from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricViewTimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Issue #4105: MetricView zooms its own window with the same page-zoom
 * machinery as every other chart, so its data's window (startAndEndDate
 * plus an optional relative rangeToken) converts to and from the picker's
 * RangeStartAndEndDateTime without losing whether it slides.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const START: Date = new Date("2026-09-28T10:00:00.000Z");
const END: Date = new Date("2026-09-28T11:00:00.000Z");

function data(overrides: Partial<MetricViewData> = {}): MetricViewData {
  return {
    queryConfigs: [],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(START, END),
    ...overrides,
  } as MetricViewData;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MetricViewTimeRange.fromData", () => {
  test("a pinned window is a custom range over its dates", () => {
    const range: RangeStartAndEndDateTime =
      MetricViewTimeRange.fromData(data());

    expect(range.range).toBe(TimeRange.CUSTOM);
    expect(range.startAndEndDate?.startValue).toBe(START);
    expect(range.startAndEndDate?.endValue).toBe(END);
  });

  test("a window with a preset token is that preset", () => {
    expect(
      MetricViewTimeRange.fromData(data({ rangeToken: TimeRange.PAST_ONE_DAY }))
        .range,
    ).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("a token that is not a preset is ignored", () => {
    expect(
      MetricViewTimeRange.fromData(data({ rangeToken: "Past Fortnight" }))
        .range,
    ).toBe(TimeRange.CUSTOM);
    expect(
      MetricViewTimeRange.fromData(data({ rangeToken: TimeRange.CUSTOM }))
        .range,
    ).toBe(TimeRange.CUSTOM);
  });

  test("no window at all is a custom range with no dates", () => {
    const range: RangeStartAndEndDateTime = MetricViewTimeRange.fromData(
      data({ startAndEndDate: null }),
    );

    expect(range.range).toBe(TimeRange.CUSTOM);
    expect(range.startAndEndDate).toBeUndefined();
  });
});

describe("MetricViewTimeRange.applyToData", () => {
  test("a custom range pins the window and drops any preset", () => {
    const next: MetricViewData = MetricViewTimeRange.applyToData(
      data({ rangeToken: TimeRange.PAST_ONE_DAY }),
      {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-28T10:20:00.000Z"),
          new Date("2026-09-28T10:30:00.000Z"),
        ),
      },
    );

    expect(next.rangeToken).toBeUndefined();
    expect(next.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-09-28T10:20:00.000Z",
    );
    expect(next.startAndEndDate?.endValue.toISOString()).toBe(
      "2026-09-28T10:30:00.000Z",
    );
  });

  test("a preset is resolved against now and keeps its token, so it slides", () => {
    const next: MetricViewData = MetricViewTimeRange.applyToData(data(), {
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(next.rangeToken).toBe(TimeRange.PAST_ONE_HOUR);
    expect(next.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-09-28T11:00:00.000Z",
    );
    expect(next.startAndEndDate?.endValue.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("leaves the queries and formulas alone", () => {
    const original: MetricViewData = data();
    const next: MetricViewData = MetricViewTimeRange.applyToData(original, {
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(next.queryConfigs).toBe(original.queryConfigs);
    expect(next.formulaConfigs).toBe(original.formulaConfigs);
  });

  test("round-trips: applying a view's own range reproduces its window", () => {
    const original: MetricViewData = data();
    const next: MetricViewData = MetricViewTimeRange.applyToData(
      original,
      MetricViewTimeRange.fromData(original),
    );

    expect(next.startAndEndDate?.startValue.getTime()).toBe(START.getTime());
    expect(next.startAndEndDate?.endValue.getTime()).toBe(END.getTime());
    expect(next.rangeToken).toBeUndefined();
  });
});
