import MetricMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import { mcpWrittenMetricMonitorSteps } from "../../../../Helpers/McpWrittenMetricMonitor";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MCP-WRITTEN METRICS MONITOR, JUDGED BY THE METRIC EVALUATOR.
 *
 * An AI created a monitor of an App Service's HTTP 5xx count through the
 * MCP server, with its rolling time as "15 minutes" and its conditions as
 * "GreaterThan" and "LessThanOrEqual" - none of them spelled as OneUptime
 * spells them. Its checks read a window of no length, so the alerting
 * criteria fired on every run through its no-data policy; and its
 * conditions matched no value at all, so the alert could never have fired
 * on an error, and Healthy never matched.
 *
 * Read as written now, each check reads its 15 minutes, the alert fires on
 * a 5xx and only then, and Healthy matches a window of none.
 */

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-11-10T16:19:23.977Z");

interface ParsedMonitor {
  step: MonitorStep;
  healthy: MonitorCriteriaInstance;
  alerting: MonitorCriteriaInstance;
}

const readMonitor: () => ParsedMonitor = (): ParsedMonitor => {
  const step: MonitorStep = MonitorSteps.fromJSON(
    mcpWrittenMetricMonitorSteps(),
  ).data!.monitorStepsInstanceArray[0]!;
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return { step, healthy: instances[0]!, alerting: instances[1]! };
};

/*
 * What the worker reads for the step: the metric's points in its window,
 * one a minute.
 */
const responseWith: (data: {
  step: MonitorStep;
  values: Array<number>;
}) => MetricMonitorResponse = (data: {
  step: MonitorStep;
  values: Array<number>;
}): MetricMonitorResponse => {
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    data.step.data!.metricMonitor!.rollingTime,
    NOW,
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    startAndEndDate: window,
    metricViewConfig: MonitorStepMetricMonitorUtil.getMetricViewConfig(
      data.step.data!.metricMonitor,
    ),
    metricResult: [
      {
        data: data.values.map((value: number, index: number) => {
          return {
            timestamp: new Date(
              window.startValue.getTime() + (index + 1) * MINUTE,
            ),
            value: value,
          } as AggregateModel;
        }),
      },
    ],
  } as MetricMonitorResponse;
};

const judge: (data: {
  step: MonitorStep;
  criteria: MonitorCriteriaInstance;
  values: Array<number>;
}) => Promise<string | null> = async (data: {
  step: MonitorStep;
  criteria: MonitorCriteriaInstance;
  values: Array<number>;
}): Promise<string | null> => {
  // A filter is judged once: the evaluator writes what it saw onto it.
  const criteriaFilter: CriteriaFilter = JSON.parse(
    JSON.stringify(data.criteria.data!.filters[0]),
  ) as CriteriaFilter;

  return await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    criteriaFilter,
    monitorStep: data.step,
    dataToProcess: responseWith({ step: data.step, values: data.values }),
  });
};

describe("the MCP-written Metrics monitor, read as written", () => {
  test("reads its criteria with the values they mean", () => {
    const monitor: ParsedMonitor = readMonitor();

    expect(monitor.healthy.data!.filterCondition).toBe(FilterCondition.Any);
    expect(monitor.healthy.data!.filters[0]).toMatchObject({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.LessThanOrEqualTo,
      metricMonitorOptions: {
        metricAlias: "m1",
        onNoDataPolicy: NoDataPolicy.Ignore,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    });
    expect(monitor.alerting.data!.filters[0]).toMatchObject({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      metricMonitorOptions: {
        metricAlias: "m1",
        onNoDataPolicy: NoDataPolicy.Trigger,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    });
  });

  test("checks the last 15 minutes", () => {
    const monitor: ParsedMonitor = readMonitor();
    const response: MetricMonitorResponse = responseWith({
      step: monitor.step,
      values: [],
    });
    const window: InBetween<Date> = response.startAndEndDate as InBetween<Date>;

    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
      15 * MINUTE,
    );
  });

  test("alerts on a server error in the window", async () => {
    const monitor: ParsedMonitor = readMonitor();
    const values: Array<number> = [0, 0, 0, 0, 2, 0, 0];

    const alerting: string | null = await judge({
      step: monitor.step,
      criteria: monitor.alerting,
      values,
    });

    expect(alerting).toBe(
      "HTTP 5xx was 2 in 1 of 7 readings, above the 0 threshold.",
    );

    /*
     * Healthy - "any value at or below 0" - matches the same window: a
     * minute with no error is in it. Criteria are judged in the order they
     * are listed and the first that matches wins, so as this monitor lists
     * them it turns Healthy whenever one minute of the window had no
     * error. That is how it was written, not how it was read.
     */
    expect(
      await judge({ step: monitor.step, criteria: monitor.healthy, values }),
    ).toBeTruthy();
  });

  test("is healthy, and does not alert, with no server error in the window", async () => {
    const monitor: ParsedMonitor = readMonitor();
    const values: Array<number> = new Array(15).fill(0);

    expect(
      await judge({ step: monitor.step, criteria: monitor.alerting, values }),
    ).toBeNull();
    expect(
      await judge({ step: monitor.step, criteria: monitor.healthy, values }),
    ).toBeTruthy();
  });

  test("alerts on a window with no data, as its no-data policy says, and Healthy ignores one", async () => {
    const monitor: ParsedMonitor = readMonitor();

    expect(
      await judge({
        step: monitor.step,
        criteria: monitor.alerting,
        values: [],
      }),
    ).toContain("No data received");
    expect(
      await judge({
        step: monitor.step,
        criteria: monitor.healthy,
        values: [],
      }),
    ).toBeNull();
  });
});

/*
 * Why the values are read on the way in: the evaluator compares a filter's
 * condition with the ones OneUptime writes, and matches nothing else.
 */
describe("the MCP-written conditions, if they were not read", () => {
  test("match no value at all", async () => {
    const monitor: ParsedMonitor = readMonitor();

    for (const [criteria, writtenCondition] of [
      [monitor.alerting, "GreaterThan"],
      [monitor.healthy, "LessThanOrEqual"],
    ] as Array<[MonitorCriteriaInstance, string]>) {
      criteria.data!.filters[0]!.filterType = writtenCondition as FilterType;

      for (const values of [[0], [2], [0, 5, 0]]) {
        expect(
          await judge({ step: monitor.step, criteria, values }),
        ).toBeNull();
      }
    }
  });
});
