import { describe, expect, test } from "@jest/globals";
import {
  EXCEPTION_BASELINE_LOOKBACK_SECONDS,
  EXCEPTION_MEASURES,
  getExceptionIncreasePercent,
  getExceptionMonitorNeeds,
  getUsualExceptionCount,
  isExceptionMeasure,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
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
    });
    expect(getExceptionMonitorNeeds(undefined)).toEqual({
      newExceptions: false,
      regressedExceptions: false,
      baseline: false,
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
    });
    expect(
      getExceptionMonitorNeeds(stepWith([CheckOn.RegressedExceptionCount])),
    ).toEqual({
      newExceptions: false,
      regressedExceptions: true,
      baseline: false,
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
