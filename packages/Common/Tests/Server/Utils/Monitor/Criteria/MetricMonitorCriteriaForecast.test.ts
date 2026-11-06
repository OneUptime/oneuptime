import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaMessageBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaMessageBuilder";
import MonitorCriteriaExpectationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaExpectationBuilder";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../../Types/JSON";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  DEFAULT_FORECAST_HORIZON_IN_HOURS,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import { MetricForecastDetails } from "../../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import MetricValueFormatter from "../../../../../Utils/Monitor/MetricValueFormatter";
import { describe, expect, test } from "@jest/globals";

/*
 * FORECASTING A FILESYSTEM FILLING UP.
 *
 * A customer asked to be told before a filesystem fills, from the metrics
 * their OpenTelemetry collectors send. A Metrics monitor reads
 * system.filesystem.utilization, Max per hour, grouped by host and
 * mountpoint, over the last 7 days, with "Forecast to rise above 90% within
 * 7 days": each mount's trend is fitted through its week of data and
 * followed a week ahead.
 *
 * The data is shaped as the worker hands it over: one bucket an hour per
 * series over the 7-day window, ending at a fixed time. Nothing here reads
 * the clock.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const WINDOW: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
  RollingTime.Past7Days,
  NOW,
);

const HOST_KEY: string = "host.name";
const MOUNT_KEY: string = "mountpoint";

function percent(value: number): string {
  return MetricValueFormatter.format({ value: value, unit: "%" });
}

function step(): MonitorStep {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Metrics,
    monitorName: "Disks",
    defaultMonitorStatusId: ObjectID.generate(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  const monitorStep: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;

  monitorStep.setMetricMonitor({
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "disk",
            title: "Disk Used (%)",
            description: "",
            legend: "",
            legendUnit: "%",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.filesystem.utilization",
              aggegationType: "Max",
              attributes: {},
              aggregateBy: {},
            },
            groupByAttributeKeys: [HOST_KEY, MOUNT_KEY],
          },
        } as unknown as MetricQueryConfigData,
        {
          metricAliasData: {
            metricVariable: "free",
            title: "Free Space",
            description: "",
            legend: "",
            legendUnit: "By",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.filesystem.usage",
              aggegationType: "Avg",
              attributes: { state: "free" },
              aggregateBy: {},
            },
            groupByAttributeKeys: [HOST_KEY, MOUNT_KEY],
          },
        } as unknown as MetricQueryConfigData,
      ],
      formulaConfigs: [],
    },
    rollingTime: RollingTime.Past7Days,
  });

  return monitorStep;
}

const STEP: MonitorStep = step();

function forecastFilter(
  overrides: Partial<CriteriaFilter> = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.ForecastAbove,
    value: 90,
    metricMonitorOptions: {
      metricAlias: "disk",
      // What a form leaves on a filter: the forecast ignores it.
      metricAggregationType: EvaluateOverTimeType.AllValues,
      forecast: { horizonInHours: 168 },
    },
    ...overrides,
  };
}

function labelsOf(host: string, mount: string = "/"): JSONObject {
  return { [HOST_KEY]: host, [MOUNT_KEY]: mount };
}

/*
 * One mount's series, one bucket an hour from `fromHoursAgo` to
 * `toHoursAgo`, for both queries: the disk's utilization from `percentAt`,
 * and its free bytes from `freeAt`.
 */
function series(data: {
  host: string;
  percentAt: (hoursAgo: number) => number;
  freeAt?: (hoursAgo: number) => number;
  fromHoursAgo?: number;
  toHoursAgo?: number;
}): MetricSeriesResult {
  const percentRows: Array<AggregateModel> = [];
  const freeRows: Array<AggregateModel> = [];

  for (
    let hoursAgo: number = data.fromHoursAgo ?? 168;
    hoursAgo >= (data.toHoursAgo ?? 1);
    hoursAgo--
  ) {
    const timestamp: Date = new Date(NOW.getTime() - hoursAgo * HOUR);

    percentRows.push({
      timestamp,
      value: data.percentAt(hoursAgo),
      attributes: labelsOf(data.host),
    });
    freeRows.push({
      timestamp,
      value: data.freeAt ? data.freeAt(hoursAgo) : 1e12,
      attributes: labelsOf(data.host),
    });
  }

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(
      labelsOf(data.host),
    ),
    labels: labelsOf(data.host),
    aggregatedResults: [{ data: percentRows }, { data: freeRows }],
  };
}

function response(breakdown: Array<MetricSeriesResult>): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: MonitorStep.getMetricsViewConfig(STEP)!,
    metricResult: [],
    seriesBreakdown: breakdown,
    startAndEndDate: WINDOW,
  };
}

async function evaluate(
  breakdown: Array<MetricSeriesResult>,
  criteriaFilter: CriteriaFilter = forecastFilter(),
): Promise<Array<MetricSeriesEvaluationResult>> {
  return MetricMonitorCriteria.evaluateAllSeries({
    dataToProcess: response(breakdown) as DataToProcess,
    criteriaFilter,
    monitorStep: STEP,
  });
}

function evaluationOf(
  evaluations: Array<MetricSeriesEvaluationResult>,
  host: string,
): MetricSeriesEvaluationResult {
  return evaluations.find((evaluation: MetricSeriesEvaluationResult) => {
    return evaluation.labels[HOST_KEY] === host;
  })!;
}

function metricsMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  return monitor;
}

// 84.5% now, rising 1% a day: 91.5% in a week, 90% in five and a half days.
const filling: (hoursAgo: number) => number = (hoursAgo: number): number => {
  return 84.5 - hoursAgo / 24;
};

const flat: (hoursAgo: number) => number = (): number => {
  return 50;
};

describe("Forecast Above on a filling filesystem", () => {
  test("the filling mount matches; the flat one does not", async () => {
    const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate([
      series({ host: "web-1", percentAt: filling }),
      series({ host: "web-2", percentAt: flat }),
    ]);

    expect(evaluationOf(evaluations, "web-1").rootCause).not.toBeNull();
    expect(evaluationOf(evaluations, "web-2").rootCause).toBeNull();
  });

  test("the root cause says where the mount is headed, how fast, and when it gets there", async () => {
    const [evaluation] = await evaluate([
      series({ host: "web-1", percentAt: filling }),
    ]);

    expect(evaluation!.rootCause).toContain(
      `Disk Used (%) is forecast to be ${percent(91.5)} in 7 days, above the ${percent(90)} threshold. Over the last 7 days it has been rising ${percent(1)} a day: at that rate it reaches ${percent(90)} in about 5 days.`,
    );
    // The series it is about comes first.
    expect(evaluation!.rootCause).toContain("web-1");

    const forecast: MetricForecastDetails = evaluation!.context.forecast!;

    expect(forecast).toMatchObject({
      state: "Forecast",
      direction: "above",
      threshold: 90,
      horizonInHours: 168,
      windowMs: 7 * DAY,
      sampleCount: 168,
    });
    expect(forecast.currentValue).toBeCloseTo(84.5, 6);
    expect(forecast.projectedValue).toBeCloseTo(91.5, 6);
    expect(forecast.slopePerDay).toBeCloseTo(1, 6);
    expect(forecast.reachesThresholdInMs! / DAY).toBeCloseTo(5.5, 6);
    // A match is explained by the root cause, not by a message of its own.
    expect(forecast.message).toBeUndefined();
    expect(evaluation!.context.totalSamplesInWindow).toBe(168);
    expect(evaluation!.context.sampleValueRange!.max).toBeCloseTo(
      84.5 - 1 / 24,
      6,
    );
  });

  test("a mount already past the threshold and still filling says where it is now", async () => {
    const [evaluation] = await evaluate([
      series({
        host: "web-1",
        percentAt: (hoursAgo: number) => {
          return 95 - hoursAgo / 48;
        },
      }),
    ]);

    expect(evaluation!.rootCause).toContain(
      `Its trend over the last 7 days puts it at ${percent(95)} now, rising ${percent(0.5)} a day.`,
    );
    expect(evaluation!.context.forecast!.reachesThresholdInMs).toBe(0);
  });

  test("a shorter horizon does not reach as far: the same mount is not forecast past 90% within a day", async () => {
    const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate(
      [series({ host: "web-1", percentAt: filling })],
      forecastFilter({
        metricMonitorOptions: {
          metricAlias: "disk",
          forecast: { horizonInHours: 24 },
        },
      }),
    );

    expect(evaluations[0]!.rootCause).toBeNull();
    expect(evaluations[0]!.context.forecast!.projectedValue).toBeCloseTo(
      85.5,
      6,
    );
  });

  test("a horizon under a day reads its trend by the hour", async () => {
    const [evaluation] = await evaluate(
      [
        series({
          host: "web-1",
          percentAt: (hoursAgo: number) => {
            return 89 - hoursAgo / 4;
          },
        }),
      ],
      forecastFilter({
        metricMonitorOptions: {
          metricAlias: "disk",
          forecast: { horizonInHours: 12 },
        },
      }),
    );

    expect(evaluation!.rootCause).toContain(
      `is forecast to be ${percent(92)} in 12 hours`,
    );
    expect(evaluation!.rootCause).toContain(`rising ${percent(0.25)} an hour`);
  });

  test("a filter with no horizon of its own looks a week ahead", async () => {
    expect(DEFAULT_FORECAST_HORIZON_IN_HOURS).toBe(168);

    const [evaluation] = await evaluate(
      [series({ host: "web-1", percentAt: filling })],
      forecastFilter({ metricMonitorOptions: { metricAlias: "disk" } }),
    );

    expect(evaluation!.rootCause).not.toBeNull();
    expect(evaluation!.context.forecast!.horizonInHours).toBe(168);
  });
});

describe("A forecast that does not match says why", () => {
  test("a mount whose trend stays under the threshold: the forecast, and what the condition needs", async () => {
    const [evaluation] = await evaluate([
      series({
        host: "web-2",
        percentAt: (hoursAgo: number) => {
          return 70 - hoursAgo / 24;
        },
      }),
    ]);

    expect(evaluation!.rootCause).toBeNull();
    expect(evaluation!.context.forecast!.message).toContain(
      `Disk Used (%) is forecast to be ${percent(77)} in 7 days, from its trend over the last 7 days. The condition requires the forecast to be above the ${percent(90)} threshold.`,
    );
  });

  test("a mount that started reporting two days ago is still learning", async () => {
    const [evaluation] = await evaluate([
      series({
        host: "web-3",
        percentAt: (hoursAgo: number) => {
          return 80 - hoursAgo / 2;
        },
        fromHoursAgo: 48,
      }),
    ]);

    const forecast: MetricForecastDetails = evaluation!.context.forecast!;

    expect(evaluation!.rootCause).toBeNull();
    expect(forecast.state).toBe("Learning");
    expect(forecast.message).toContain(
      "Disk Used (%) is not forecast yet: its data covers 47 hours of the last 7 days, and a forecast needs at least half of it.",
    );
  });

  test("a mount whose host stopped reporting two days ago is not forecast from its old trend", async () => {
    const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate([
      series({ host: "web-1", percentAt: flat }),
      series({
        host: "web-4",
        percentAt: (hoursAgo: number) => {
          return 95 - hoursAgo / 12;
        },
        toHoursAgo: 48,
      }),
    ]);

    const stopped: MetricSeriesEvaluationResult = evaluationOf(
      evaluations,
      "web-4",
    );

    expect(stopped.rootCause).toBeNull();
    expect(stopped.context.forecast!.state).toBe("Stale");
    expect(stopped.context.forecast!.message).toContain(
      "Disk Used (%) is not forecast: its newest value is 47 hours old.",
    );
  });

  test("an empty window has no trend, even when no data counts as zero", async () => {
    const [evaluation] = await evaluate(
      [
        {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(
            labelsOf("web-5"),
          ),
          labels: labelsOf("web-5"),
          aggregatedResults: [{ data: [] }, { data: [] }],
        },
      ],
      forecastFilter({
        metricMonitorOptions: {
          metricAlias: "disk",
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
        },
      }),
    );

    expect(evaluation!.rootCause).toBeNull();
    expect(evaluation!.context.forecast!.message).toContain(
      "Disk Used (%) has no data in the last 7 days to forecast from.",
    );
  });

  test("the evaluation log names the mount closest to its threshold", async () => {
    const criteriaFilter: CriteriaFilter = forecastFilter();

    const match: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response([
          series({ host: "web-1", percentAt: flat }),
          series({
            host: "web-2",
            percentAt: (hoursAgo: number) => {
              return 80 - hoursAgo / 24;
            },
          }),
          series({
            host: "web-3",
            percentAt: (hoursAgo: number) => {
              return 60 - hoursAgo / 24;
            },
          }),
        ]) as DataToProcess,
        criteriaFilter,
        monitorStep: STEP,
      });

    expect(match).toBeNull();

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        monitor: metricsMonitor(),
        criteriaFilter,
        dataToProcess: response([]) as DataToProcess,
        monitorStep: STEP,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      criteriaFilter.metricCriteriaContext!.forecast!.message,
    );
    expect(message).toContain("web-2");
    expect(message).toContain(`is forecast to be ${percent(87)} in 7 days`);
  });
});

describe("Forecast Below on free space, in the unit the threshold is entered in", () => {
  test("free bytes falling 10 GB a day from 100 GB are forecast under 50 GB within 7 days", async () => {
    const [evaluation] = await evaluate(
      [
        series({
          host: "db-1",
          percentAt: flat,
          freeAt: (hoursAgo: number) => {
            return (100 + (10 * hoursAgo) / 24) * 1e9;
          },
        }),
      ],
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.ForecastBelow,
        value: 50,
        metricMonitorOptions: {
          metricAlias: "free",
          thresholdUnit: "GB",
          forecast: { horizonInHours: 168 },
        },
      },
    );

    const forecast: MetricForecastDetails = evaluation!.context.forecast!;

    expect(evaluation!.rootCause).not.toBeNull();
    expect(forecast.direction).toBe("below");
    expect(forecast.threshold).toBe(50);
    // Compared in GB, as the threshold was entered.
    expect(forecast.currentValue).toBeCloseTo(100, 6);
    expect(forecast.projectedValue).toBeCloseTo(30, 6);
    expect(forecast.slopePerDay).toBeCloseTo(-10, 6);
    expect(forecast.reachesThresholdInMs! / DAY).toBeCloseTo(5, 6);
    expect(evaluation!.rootCause).toContain("Free Space is forecast to be");
    expect(evaluation!.rootCause).toContain("below the");
    expect(evaluation!.rootCause).toContain("falling");
  });
});

describe("The criteria's other words", () => {
  test("the forecast filter types are the forecast ones, and keep a threshold", () => {
    expect(
      CriteriaFilterUtil.isForecastFilterType(FilterType.ForecastAbove),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.isForecastFilterType(FilterType.ForecastBelow),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.isForecastFilterType(FilterType.GreaterThan),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.hasValueField({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.ForecastAbove,
      }),
    ).toBe(true);
  });

  test("a horizon that is not a positive number falls back to a week", () => {
    expect(
      CriteriaFilterUtil.getForecastHorizonInHours(
        forecastFilter({
          metricMonitorOptions: { forecast: { horizonInHours: 0 } },
        }),
      ),
    ).toBe(168);
    expect(
      CriteriaFilterUtil.getForecastHorizonInHours(
        forecastFilter({
          metricMonitorOptions: { forecast: { horizonInHours: 36 } },
        }),
      ),
    ).toBe(36);
    expect(CriteriaFilterUtil.getForecastHorizonInHours(undefined)).toBe(168);
  });

  test("the expectation names the forecast, its horizon and no aggregation", () => {
    expect(
      MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
        forecastFilter(),
        { unit: "%" },
      ),
    ).toBe(`to be forecast above ${percent(90)} within 7 days`);
    expect(
      MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
        forecastFilter({
          filterType: FilterType.ForecastBelow,
          value: 5,
          metricMonitorOptions: { forecast: { horizonInHours: 12 } },
        }),
      ),
    ).toBe("to be forecast below 5 within 12 hours");
  });
});
