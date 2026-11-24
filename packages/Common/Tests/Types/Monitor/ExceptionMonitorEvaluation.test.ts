import { describe, expect, test } from "@jest/globals";
import {
  EXCEPTION_ANOMALY_MINIMUM_COUNT,
  EXCEPTION_BASELINE_LOOKBACK_SECONDS,
  EXCEPTION_BASELINE_MINIMUM_WEEKS,
  EXCEPTION_MEASURES,
  EXCEPTION_INSTALL_MEASURES,
  EXCEPTION_RULE_MEASURES,
  EXCEPTION_SHARE_MEASURES,
  ExceptionAnomalySettings,
  getExceptionAnomalySettings,
  getExceptionIncreasePercent,
  getExceptionMonitorNeeds,
  getInstallsWithExceptionsPercent,
  getSessionsWithExceptionsPercent,
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
  test("are the count, new, regressed, the increase over the usual, the sessions and the installs", () => {
    expect(EXCEPTION_MEASURES).toEqual([
      CheckOn.ExceptionCount,
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
      CheckOn.SessionsWithExceptionsPercent,
      CheckOn.SessionCount,
      CheckOn.InstallsWithExceptionsPercent,
      CheckOn.InstallCount,
    ]);
    expect(isExceptionMeasure(CheckOn.NewExceptionCount)).toBe(true);
    expect(isExceptionMeasure(CheckOn.SessionsWithExceptionsPercent)).toBe(
      true,
    );
    expect(isExceptionMeasure(CheckOn.SessionCount)).toBe(true);
    expect(isExceptionMeasure(CheckOn.InstallsWithExceptionsPercent)).toBe(
      true,
    );
    expect(isExceptionMeasure(CheckOn.InstallCount)).toBe(true);
    expect(isExceptionMeasure(CheckOn.LogCount)).toBe(false);
    expect(isExceptionMeasure("New Exceptions")).toBe(true);
    expect(isExceptionMeasure("Installs With Exceptions (in %)")).toBe(true);
    expect(isExceptionMeasure(undefined)).toBe(false);
  });

  /*
   * The form's single rule: every measure but the sessions and the installs
   * alone (#9716, #9924), which say how much the app was used.
   */
  test("the rule offers every measure but the sessions and the installs alone", () => {
    expect(EXCEPTION_RULE_MEASURES).toEqual([
      CheckOn.ExceptionCount,
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
      CheckOn.SessionsWithExceptionsPercent,
      CheckOn.InstallsWithExceptionsPercent,
    ]);
  });

  // The two shares are typed with their fraction, and judged with it.
  test("the shares are the sessions' and the installs'", () => {
    expect(EXCEPTION_SHARE_MEASURES).toEqual([
      CheckOn.SessionsWithExceptionsPercent,
      CheckOn.InstallsWithExceptionsPercent,
    ]);
    expect(EXCEPTION_INSTALL_MEASURES).toEqual([
      CheckOn.InstallsWithExceptionsPercent,
      CheckOn.InstallCount,
    ]);
    // Stored in monitor criteria: never renamed.
    expect(CheckOn.InstallsWithExceptionsPercent).toBe(
      "Installs With Exceptions (in %)",
    );
    expect(CheckOn.InstallCount).toBe("Installs");
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
      sessions: false,
      installs: false,
      learnedBaselineWindowDays: [],
    });
    expect(getExceptionMonitorNeeds(undefined)).toEqual({
      newExceptions: false,
      regressedExceptions: false,
      baseline: false,
      sessions: false,
      installs: false,
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
      sessions: false,
      installs: false,
      learnedBaselineWindowDays: [],
    });
    expect(
      getExceptionMonitorNeeds(stepWith([CheckOn.RegressedExceptionCount])),
    ).toEqual({
      newExceptions: false,
      regressedExceptions: true,
      baseline: false,
      sessions: false,
      installs: false,
      learnedBaselineWindowDays: [],
    });
  });

  test("the share of sessions, or the sessions alone, read the sessions and nothing else", () => {
    for (const checkOn of [
      CheckOn.SessionsWithExceptionsPercent,
      CheckOn.SessionCount,
    ]) {
      expect(getExceptionMonitorNeeds(stepWith([checkOn]))).toEqual({
        newExceptions: false,
        regressedExceptions: false,
        baseline: false,
        sessions: true,
        installs: false,
        learnedBaselineWindowDays: [],
      });
    }
  });

  test("the share of installs, or the installs alone, read the installs and nothing else (#9924)", () => {
    for (const checkOn of [
      CheckOn.InstallsWithExceptionsPercent,
      CheckOn.InstallCount,
    ]) {
      expect(getExceptionMonitorNeeds(stepWith([checkOn]))).toEqual({
        newExceptions: false,
        regressedExceptions: false,
        baseline: false,
        sessions: false,
        installs: true,
        learnedBaselineWindowDays: [],
      });
    }

    // A rule on both reads both.
    expect(
      getExceptionMonitorNeeds(
        stepWith([
          CheckOn.SessionsWithExceptionsPercent,
          CheckOn.InstallsWithExceptionsPercent,
        ]),
      ),
    ).toMatchObject({ sessions: true, installs: true });
  });
});

/*
 * A mobile app's crash rate per install (#9924): installs a crash happened
 * on over the window's installs, as the Overview's Crash-free installs
 * reads them.
 */
describe("the share of installs with an exception", () => {
  test("is the installs with one over the window's installs, in percent to two decimals", () => {
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 3,
        installs: 250,
      }),
    ).toBe(1.2);
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 1,
        installs: 3,
      }),
    ).toBe(33.33);
  });

  test("an install with no session counts: installs are not sessions", () => {
    // Two installs crashed, one of which never sent a session.id.
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 2,
        installs: 4,
      }),
    ).toBe(50);
  });

  test("no install to take a share of reads as no share, never 0%", () => {
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 0,
        installs: 0,
      }),
    ).toBeNull();
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 2,
        installs: 0,
      }),
    ).toBeNull();
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 0,
        installs: 120,
      }),
    ).toBe(0);
  });

  test("never above 100%: a crash's install may have sent no span in the window", () => {
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: 9,
        installs: 4,
      }),
    ).toBe(100);
    expect(
      getInstallsWithExceptionsPercent({
        installsWithExceptions: -3,
        installs: 4,
      }),
    ).toBe(0);
  });
});

/*
 * A mobile app's crash rate (#9716): crashed sessions over sessions, as
 * the Overview's Crash-free sessions tile reads them.
 */
describe("the share of sessions with an exception", () => {
  test("is the sessions with one over the window's sessions, in percent to two decimals", () => {
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 3,
        sessions: 250,
      }),
    ).toBe(1.2);
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 1,
        sessions: 3,
      }),
    ).toBe(33.33);
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 0,
        sessions: 1000,
      }),
    ).toBe(0);
  });

  test("one crashed session in 250 is under both Android vitals rates", () => {
    const share: number | null = getSessionsWithExceptionsPercent({
      sessionsWithExceptions: 1,
      sessions: 250,
    });

    expect(share).toBe(0.4);
    expect(share!).toBeLessThan(0.47);
    expect(share!).toBeLessThan(1.09);
  });

  test("is unknown, not 0%, without a session to take it of", () => {
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 0,
        sessions: 0,
      }),
    ).toBeNull();
    // Crashes, and spans that name no session: still unknown.
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 4,
        sessions: 0,
      }),
    ).toBeNull();
  });

  test("never passes 100%, though a session only an exception named counts", () => {
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: 12,
        sessions: 10,
      }),
    ).toBe(100);
  });

  test("reads a missing or negative count as none", () => {
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: -3,
        sessions: 10,
      }),
    ).toBe(0);
    expect(
      getSessionsWithExceptionsPercent({
        sessionsWithExceptions: undefined as unknown as number,
        sessions: 10,
      }),
    ).toBe(0);
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
      sessions: false,
      installs: false,
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
