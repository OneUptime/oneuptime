import { describe, expect, test } from "@jest/globals";
import {
  EXCEPTION_ANOMALY_MINIMUM_COUNT,
  EXCEPTION_BASELINE_LOOKBACK_SECONDS,
  EXCEPTION_BASELINE_MINIMUM_WEEKS,
  EXCEPTION_MEASURES,
  ExceptionAnomalySettings,
  getExceptionAnomalySettings,
  getExceptionIncreasePercent,
  getExceptionMonitorNeeds,
  getUsualExceptionCount,
  isExceptionCountAnomaly,
  isExceptionMeasure,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import {
  ANOMALY_SIGMA_BY_SENSITIVITY,
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  DEFAULT_ANOMALY_WINDOW_DAYS,
  FilterType,
  MetricAnomalyDetectionOptions,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * What an Exceptions monitor can alert on beyond how many: which measures,
 * what a step's criteria need read, the usual count per window, and how far
 * above it a count is.
 */

function stepWith(checkOns: Array<CheckOn>): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Exceptions,
    monitorName: "Checkout",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data!,
    filters: checkOns.map((checkOn: CheckOn) => {
      return { checkOn, filterType: FilterType.GreaterThan, value: 0 };
    }),
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  step.setMonitorCriteria(criteria);

  return step;
}

describe("the exception measures", () => {
  test("are the count, new, regressed and the increase over the usual", () => {
    expect(EXCEPTION_MEASURES).toEqual([
      CheckOn.ExceptionCount,
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
    ]);
    expect(isExceptionMeasure(CheckOn.NewExceptionCount)).toBe(true);
    expect(isExceptionMeasure(CheckOn.LogCount)).toBe(false);
    expect(isExceptionMeasure("New Exceptions")).toBe(true);
    expect(isExceptionMeasure(undefined)).toBe(false);
  });
});

describe("getExceptionMonitorNeeds", () => {
  test("a plain count needs nothing more", () => {
    expect(
      getExceptionMonitorNeeds(stepWith([CheckOn.ExceptionCount])),
    ).toEqual({
      newExceptions: false,
      regressedExceptions: false,
      baseline: false,
      learnedBaselineWindowDays: [],
    });
    expect(getExceptionMonitorNeeds(undefined)).toEqual({
      newExceptions: false,
      regressedExceptions: false,
      baseline: false,
      learnedBaselineWindowDays: [],
    });
  });

  test("each measure asks for what it reads", () => {
    expect(
      getExceptionMonitorNeeds(
        stepWith([
          CheckOn.NewExceptionCount,
          CheckOn.RegressedExceptionCount,
          CheckOn.ExceptionCountIncreasePercent,
        ]),
      ),
    ).toEqual({
      newExceptions: true,
      regressedExceptions: true,
      baseline: true,
      learnedBaselineWindowDays: [],
    });
    expect(
      getExceptionMonitorNeeds(stepWith([CheckOn.RegressedExceptionCount])),
    ).toEqual({
      newExceptions: false,
      regressedExceptions: true,
      baseline: false,
      learnedBaselineWindowDays: [],
    });
  });
});

describe("the usual count, and how far above it", () => {
  test("the day before, spread over windows of the same length", () => {
    expect(EXCEPTION_BASELINE_LOOKBACK_SECONDS).toBe(86400);
    // 288 five-minute windows in a day: 2880 occurrences is 10 a window.
    expect(
      getUsualExceptionCount({ previousCount: 2880, windowSeconds: 300 }),
    ).toBe(10);
    expect(
      getUsualExceptionCount({ previousCount: 0, windowSeconds: 300 }),
    ).toBe(0);
    expect(
      getUsualExceptionCount({
        previousCount: 60,
        windowSeconds: 60,
        lookbackSeconds: 3600,
      }),
    ).toBe(1);
  });

  test("the increase, in percent, never below 0", () => {
    expect(
      getExceptionIncreasePercent({ currentCount: 40, usualCount: 10 }),
    ).toBe(300);
    expect(
      getExceptionIncreasePercent({ currentCount: 10, usualCount: 10 }),
    ).toBe(0);
    expect(
      getExceptionIncreasePercent({ currentCount: 2, usualCount: 10 }),
    ).toBe(0);
  });

  test("a quiet service counts as at least one usual occurrence: ten is 900%, not infinite", () => {
    expect(
      getExceptionIncreasePercent({ currentCount: 10, usualCount: 0 }),
    ).toBe(900);
    expect(
      getExceptionIncreasePercent({ currentCount: 10, usualCount: 0.2 }),
    ).toBe(900);
    expect(
      getExceptionIncreasePercent({ currentCount: 1, usualCount: 0 }),
    ).toBe(0);
    expect(
      getExceptionIncreasePercent({ currentCount: 0, usualCount: 0 }),
    ).toBe(0);
  });
});

describe("an anomaly condition on the exception count", () => {
  function stepWithFilters(filters: Array<CriteriaFilter>): MonitorStep {
    const step: MonitorStep = stepWith([]);
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = { ...instance.data!, filters };
    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [instance] };
    step.setMonitorCriteria(criteria);
    return step;
  }

  function anomaly(
    anomalyDetection?: MetricAnomalyDetectionOptions | undefined,
    checkOn: CheckOn = CheckOn.ExceptionCount,
  ): CriteriaFilter {
    return {
      checkOn,
      filterType: FilterType.AnomalouslyHigh,
      value: undefined,
      metricMonitorOptions: anomalyDetection ? { anomalyDetection } : undefined,
    };
  }

  test("only the count has a baseline", () => {
    expect(isExceptionCountAnomaly(anomaly())).toBe(true);
    expect(
      isExceptionCountAnomaly({
        ...anomaly(),
        filterType: FilterType.Anomalous,
      }),
    ).toBe(true);
    expect(
      isExceptionCountAnomaly({
        ...anomaly(),
        filterType: FilterType.AnomalouslyLow,
      }),
    ).toBe(true);
    expect(
      isExceptionCountAnomaly({
        ...anomaly(),
        filterType: FilterType.GreaterThan,
      }),
    ).toBe(false);

    for (const checkOn of [
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
    ]) {
      expect(isExceptionCountAnomaly(anomaly(undefined, checkOn))).toBe(false);
    }
  });

  test("a plain threshold on the count reads no baseline", () => {
    expect(
      getExceptionMonitorNeeds(stepWith([CheckOn.ExceptionCount]))
        .learnedBaselineWindowDays,
    ).toEqual([]);
  });

  test("it asks for the default window, nothing else", () => {
    expect(getExceptionMonitorNeeds(stepWithFilters([anomaly()]))).toEqual({
      newExceptions: false,
      regressedExceptions: false,
      baseline: false,
      learnedBaselineWindowDays: [DEFAULT_ANOMALY_WINDOW_DAYS],
    });
  });

  test("each baseline window once, however many criteria read it", () => {
    expect(
      getExceptionMonitorNeeds(
        stepWithFilters([
          anomaly({ sensitivity: AnomalyDetectionSensitivity.Low }),
          anomaly({ sensitivity: AnomalyDetectionSensitivity.High }),
          anomaly({ windowDays: 28 }),
          anomaly({ windowDays: 28 }),
        ]),
      ).learnedBaselineWindowDays,
    ).toEqual([14, 28]);
  });

  test("an anomaly condition on a measure without a baseline reads none", () => {
    expect(
      getExceptionMonitorNeeds(
        stepWithFilters([anomaly(undefined, CheckOn.NewExceptionCount)]),
      ).learnedBaselineWindowDays,
    ).toEqual([]);
  });

  test("the settings a criteria that says nothing reads", () => {
    expect(getExceptionAnomalySettings(undefined)).toEqual({
      sensitivity: AnomalyDetectionSensitivity.Medium,
      sigmaCount: 3,
      minimumCount: 10,
      windowDays: 14,
      method: AnomalyDetectionMethod.MeanStddev,
      minSamples: 1,
    });
  });

  test("the minimum falls as the sensitivity rises, as the range narrows", () => {
    const low: ExceptionAnomalySettings = getExceptionAnomalySettings({
      sensitivity: AnomalyDetectionSensitivity.Low,
    });
    const medium: ExceptionAnomalySettings = getExceptionAnomalySettings({
      sensitivity: AnomalyDetectionSensitivity.Medium,
    });
    const high: ExceptionAnomalySettings = getExceptionAnomalySettings({
      sensitivity: AnomalyDetectionSensitivity.High,
    });

    expect(low.minimumCount).toBeGreaterThan(medium.minimumCount);
    expect(medium.minimumCount).toBeGreaterThan(high.minimumCount);
    expect(low.sigmaCount).toBeGreaterThan(medium.sigmaCount);
    expect(medium.sigmaCount).toBeGreaterThan(high.sigmaCount);
  });

  test("each sensitivity reads the numbers every anomaly condition shares", () => {
    for (const sensitivity of Object.values(AnomalyDetectionSensitivity)) {
      expect(getExceptionAnomalySettings({ sensitivity }).sigmaCount).toBe(
        ANOMALY_SIGMA_BY_SENSITIVITY[sensitivity],
      );
      expect(getExceptionAnomalySettings({ sensitivity }).minimumCount).toBe(
        EXCEPTION_ANOMALY_MINIMUM_COUNT[sensitivity],
      );
    }
  });

  test("the baseline window stays between what can be learned from and what is kept", () => {
    const windowDays: (value: number) => number = (value: number): number => {
      return getExceptionAnomalySettings({ windowDays: value }).windowDays;
    };

    expect(windowDays(7)).toBe(EXCEPTION_BASELINE_MINIMUM_WEEKS * 7);
    expect(windowDays(1)).toBe(14);
    expect(windowDays(28)).toBe(28);
    expect(windowDays(90)).toBe(90);
    expect(windowDays(365)).toBe(90);
  });

  test("an unknown sensitivity or method reads as the default", () => {
    expect(
      getExceptionAnomalySettings({
        sensitivity: "Extreme" as AnomalyDetectionSensitivity,
        method: "Astrology" as AnomalyDetectionMethod,
      }),
    ).toMatchObject({
      sensitivity: AnomalyDetectionSensitivity.Medium,
      method: AnomalyDetectionMethod.MeanStddev,
    });
  });

  test("Median & MAD is kept", () => {
    expect(
      getExceptionAnomalySettings({
        method: AnomalyDetectionMethod.MedianMad,
      }).method,
    ).toBe(AnomalyDetectionMethod.MedianMad);
  });
});
