/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MetricCriteriaContext, {
  MetricForecastDetails,
} from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import MetricValueFormatter from "../../../../Utils/Monitor/MetricValueFormatter";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FORECAST SECTION OF A ROOT CAUSE.
 *
 * A forecast criteria matches before anything has breached, so a root cause
 * that listed breaching samples would list none. It says instead where the
 * trend puts the metric now and at the end of the horizon, how fast it is
 * moving and when it crosses the threshold.
 */

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => MarkdownText | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const DAY: number = 24 * 60 * 60 * 1000;

function percent(value: number): string {
  return MetricValueFormatter.format({ value: value, unit: "%" });
}

function forecast(
  overrides: Partial<MetricForecastDetails> = {},
): MetricForecastDetails {
  return {
    state: "Forecast",
    direction: "above",
    threshold: 90,
    horizonInHours: 168,
    windowMs: 7 * DAY,
    sampleCount: 168,
    historyMs: 167 * 60 * 60 * 1000,
    requiredHistoryMs: 3.5 * DAY,
    sinceNewestMs: 0,
    currentValue: 84.5,
    projectedValue: 91.5,
    slopePerDay: 1,
    reachesThresholdInMs: 5.5 * DAY,
    ...overrides,
  };
}

function rootCause(details: MetricForecastDetails): string {
  const context: MetricCriteriaContext = {
    metricName: "system.filesystem.utilization",
    alias: "disk",
    unit: "%",
    aggregationType: null,
    isFormula: false,
    filterAttributes: {},
    groupBy: ["host.name", "mountpoint"],
    totalSamplesInWindow: 168,
    forecast: details,
  };

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.ForecastAbove,
        value: 90,
        metricCriteriaContext: context,
      } as CriteriaFilter,
    ],
    incidents: [],
    alerts: [],
    name: "Disk filling up",
    description: "Disk filling up",
    id: ObjectID.generate().toString(),
  };

  const markdown: MarkdownText | null = Evaluator.buildMetricRootCauseContext({
    criteriaInstance: instance,
    monitor: new Monitor(),
  });

  expect(markdown).not.toBeNull();
  return markdown!.toString();
}

describe("a forecast's root cause", () => {
  test("says where the trend puts the metric now and at the end of the horizon, how fast, and when it crosses", () => {
    const text: string = rootCause(forecast());

    expect(text).toContain(
      [
        "**Forecast**",
        `- Now, on its trend: **${percent(84.5)}**`,
        `- In 7 days: **${percent(91.5)}**`,
        `- Trend: rising ${percent(1)} a day over the last 7 days, from 168 samples`,
        `- Reaches ${percent(90)}: in about 5 days`,
      ].join("\n"),
    );
    // Nothing breached yet, so no sample is listed as if it had.
    expect(text).not.toContain("**Breaching Samples**");
  });

  test("a metric already past its threshold says so, and a falling one says it falls, by the hour under a day ahead", () => {
    expect(rootCause(forecast({ reachesThresholdInMs: 0 }))).toContain(
      `- Reaches ${percent(90)}: already above it`,
    );

    const falling: string = rootCause(
      forecast({
        direction: "below",
        threshold: 10,
        horizonInHours: 12,
        currentValue: 30,
        projectedValue: 6,
        slopePerDay: -48,
        reachesThresholdInMs: 10 * 60 * 60 * 1000,
      }),
    );

    expect(falling).toContain(`- In 12 hours: **${percent(6)}**`);
    expect(falling).toContain(`- Trend: falling ${percent(2)} an hour`);
    expect(falling).toContain(`- Reaches ${percent(10)}: in about 10 hours`);
  });

  test("a trend that never reaches the threshold names no time for it", () => {
    expect(
      rootCause(
        forecast({
          currentValue: 95,
          projectedValue: 93,
          slopePerDay: -0.3,
          reachesThresholdInMs: null,
        }),
      ),
    ).not.toContain("- Reaches");
  });

  test("a series that was not forecast has no Forecast section", () => {
    expect(
      rootCause(
        forecast({
          state: "Learning",
          currentValue: undefined,
          projectedValue: undefined,
          slopePerDay: undefined,
          reachesThresholdInMs: undefined,
        }),
      ),
    ).not.toContain("**Forecast**");
  });
});
