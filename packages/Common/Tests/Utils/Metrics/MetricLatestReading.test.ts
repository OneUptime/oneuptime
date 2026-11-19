import { describe, expect, test } from "@jest/globals";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import { MonitorStepIoTMonitorUtil } from "../../../Types/Monitor/MonitorStepIoTMonitor";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricLatestReading from "../../../Utils/Metrics/MetricLatestReading";

/*
 * Each series judged on its latest reading (judgeLatestReading): an IoT
 * Device monitor's Device Offline, and a Metrics monitor of managed
 * devices' check-ins (#9835) - where a reading is taken every read of a
 * connection, up to an hour apart, and judged whole the window would hold
 * a device's old readings for that long.
 */

const START: number = Date.UTC(2026, 10, 19, 12, 0, 0);
const MINUTE: number = 60_000;

function row(minute: number, value: number): AggregatedModel {
  return {
    timestamp: new Date(START + minute * MINUTE),
    value,
  } as AggregatedModel;
}

function series(
  fingerprint: string,
  rows: Array<AggregatedModel>,
): MetricSeriesResult {
  return {
    fingerprint,
    labels: { "oneuptime.managed_device.name": fingerprint },
    aggregatedResults: [{ data: rows }],
  };
}

describe("MetricLatestReading.keepLatestRow", () => {
  test("keeps the newest row, whatever order the rows came in", () => {
    const result: AggregatedResult = {
      data: [row(30, 75), row(0, 5), row(15, 20)],
    };

    expect(MetricLatestReading.keepLatestRow(result).data).toEqual([
      row(30, 75),
    ]);
  });

  test("keeps no row of an empty result, so no data is still no data", () => {
    expect(MetricLatestReading.keepLatestRow({ data: [] }).data).toEqual([]);
  });

  test("reads a timestamp handed back as text", () => {
    const result: AggregatedResult = {
      data: [
        {
          timestamp: new Date(START).toISOString() as unknown as Date,
          value: 5,
        } as AggregatedModel,
        {
          timestamp: new Date(
            START + 15 * MINUTE,
          ).toISOString() as unknown as Date,
          value: 20,
        } as AggregatedModel,
      ],
    };

    expect(MetricLatestReading.keepLatestRow(result).data[0]!.value).toBe(20);
  });

  test("never changes the result it was handed", () => {
    const result: AggregatedResult = { data: [row(0, 5), row(15, 20)] };

    MetricLatestReading.keepLatestRow(result);

    expect(result.data).toHaveLength(2);
  });
});

describe("MetricLatestReading.keepLatestReadings", () => {
  test("judges each series on its own latest reading", () => {
    const kept: Array<MetricSeriesResult> =
      MetricLatestReading.keepLatestReadings<
        AggregatedModel,
        MetricSeriesResult
      >([
        // Quiet for an hour and a quarter at the last read, back since.
        series("ESP-ID-AAAAW", [row(0, 75), row(15, 2)]),
        // Checked in, then went quiet.
        series("ESP-ID-AAAAX", [row(0, 3), row(15, 18), row(30, 33)]),
      ]);

    expect(
      kept.map((entry: MetricSeriesResult) => {
        return [entry.fingerprint, entry.aggregatedResults[0]!.data];
      }),
    ).toEqual([
      ["ESP-ID-AAAAW", [row(15, 2)]],
      ["ESP-ID-AAAAX", [row(30, 33)]],
    ]);
  });

  test("keeps a series' labels and its fingerprint, and every query's and formula's result", () => {
    const entry: MetricSeriesResult = {
      fingerprint: "fp",
      labels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
      aggregatedResults: [
        { data: [row(0, 1), row(5, 2)] },
        { data: [row(0, 10), row(5, 20)] },
      ],
    };

    const [kept]: Array<MetricSeriesResult> =
      MetricLatestReading.keepLatestReadings<
        AggregatedModel,
        MetricSeriesResult
      >([entry]);

    expect(kept!.fingerprint).toBe("fp");
    expect(kept!.labels).toEqual(entry.labels);
    expect(
      kept!.aggregatedResults.map((result: AggregatedResult) => {
        return result.data;
      }),
    ).toEqual([[row(5, 2)], [row(5, 20)]]);
  });

  test("a series with no reading in the window stays empty, for its no-data policy to judge", () => {
    expect(
      MetricLatestReading.keepLatestReadings<
        AggregatedModel,
        MetricSeriesResult
      >([series("ESP-ID-AAAAW", [])])[0]!.aggregatedResults[0]!.data,
    ).toEqual([]);
  });
});

describe("the monitors that ask for it", () => {
  test("an IoT Device monitor's latest reading is the same", () => {
    const breakdown: Array<MetricSeriesResult> = [
      series("device-1", [row(0, 0), row(10, 1)]),
    ];

    expect(MonitorStepIoTMonitorUtil.keepLatestReadings(breakdown)).toEqual(
      MetricLatestReading.keepLatestReadings<
        AggregatedModel,
        MetricSeriesResult
      >(breakdown),
    );
  });

  test("a Metrics monitor's step asks only when it says so", () => {
    expect(MonitorStepMetricMonitorUtil.judgesLatestReading(undefined)).toBe(
      false,
    );
    expect(
      MonitorStepMetricMonitorUtil.judgesLatestReading({
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past2Hours,
      }),
    ).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.judgesLatestReading({
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past2Hours,
        judgeLatestReading: true,
      }),
    ).toBe(true);
  });
});
