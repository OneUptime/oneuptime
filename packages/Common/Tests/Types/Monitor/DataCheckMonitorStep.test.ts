import { describe, expect, test } from "@jest/globals";
import {
  buildDataCheckMonitorStep,
  DataCheckMonitorStepArgs,
  getDataCheckRollingTime,
} from "../../../Types/Monitor/DataCheckMonitorStep";
import {
  DATA_CHECK_METRIC_NAME,
  DataCheckAttribute,
} from "../../../Types/DataObservability/DataCheckMetric";
import { DataCheckAlertCondition } from "../../../Types/DataObservability/DataCheckType";
import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * A check's alert is a Metrics monitor over its metric: filtered on the
 * check, grouped by segment, with the check's own condition. These pin what
 * makes it alert on that check, once per segment, and recover.
 */

function args(
  overrides: Partial<DataCheckMonitorStepArgs> = {},
): DataCheckMonitorStepArgs {
  return {
    checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    checkName: "Empty customer",
    tableKey: "public.orders",
    condition: DataCheckAlertCondition.UnusuallyHigh,
    threshold: null,
    intervalInMinutes: 60,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Empty customer - public.orders",
    ...overrides,
  };
}

function firstFilter(step: MonitorStep, index: number): CriteriaFilter {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[index]!
    .data!.filters[0]!;
}

describe("buildDataCheckMonitorStep", () => {
  test("reads the check's metric, for this check, one series per segment", () => {
    const step: MonitorStep = buildDataCheckMonitorStep(args());
    const query: NonNullable<
      NonNullable<MonitorStep["data"]>["metricMonitor"]
    >["metricViewConfig"]["queryConfigs"][number] =
      step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!;

    expect(query.metricQueryData.filterData.metricName).toBe(
      DATA_CHECK_METRIC_NAME,
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [DataCheckAttribute.CheckId]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      DataCheckAttribute.Segment,
    ]);
    expect(MonitorStep.getValidationError(step, MonitorType.Metrics)).toBe(
      null,
    );
  });

  test("a learned condition compares with the baseline, and anything else is healthy", () => {
    const step: MonitorStep = buildDataCheckMonitorStep(
      args({ condition: DataCheckAlertCondition.UnusuallyLow }),
    );

    expect(firstFilter(step, 0).filterType).toBe(FilterType.AnomalouslyLow);
    expect(
      firstFilter(step, 0).metricMonitorOptions?.anomalyDetection,
    ).toBeDefined();
    expect(firstFilter(step, 1).filterType).toBe(
      FilterType.GreaterThanOrEqualTo,
    );
  });

  test("a threshold condition breaches past it and recovers on its side", () => {
    const above: MonitorStep = buildDataCheckMonitorStep(
      args({ condition: DataCheckAlertCondition.Above, threshold: 5 }),
    );

    expect(firstFilter(above, 0).filterType).toBe(FilterType.GreaterThan);
    expect(firstFilter(above, 0).value).toBe(5);
    expect(firstFilter(above, 1).filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(firstFilter(above, 1).value).toBe(5);

    const below: MonitorStep = buildDataCheckMonitorStep(
      args({ condition: DataCheckAlertCondition.Below, threshold: 100 }),
    );

    expect(firstFilter(below, 0).filterType).toBe(FilterType.LessThan);
    expect(firstFilter(below, 1).filterType).toBe(
      FilterType.GreaterThanOrEqualTo,
    );
  });

  test("the window always holds the check's last run", () => {
    expect(getDataCheckRollingTime(15)).toBe(RollingTime.Past30Minutes);
    expect(getDataCheckRollingTime(60)).toBe(RollingTime.Past2Hours);
    expect(getDataCheckRollingTime(360)).toBe(RollingTime.Past12Hours);
    expect(getDataCheckRollingTime(1440)).toBe(RollingTime.Past2Days);
  });
});
