import {
  CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS,
  CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT,
  CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
  CloudCommitmentAlertDecision,
  CloudCommitmentAlertFacts,
  CloudCommitmentAlertSettings,
  CloudCommitmentResolution,
  CloudCoverageAlertDecision,
  decideCloudCommitmentAlerts,
  decideCloudCoverageAlerts,
  getCloudCoverageAlertKey,
  isCloudCommitmentExpiryDaysText,
  readCloudCommitmentAlertState,
  readCloudCommitmentExpiryDays,
  readCloudCommitmentPercentThreshold,
  readCloudCoverageAlertState,
} from "../../../Types/Cloud/CloudCommitmentAlerts";
import { CloudCommitmentState } from "../../../Types/Cloud/CloudCommitmentInventory";
import { describe, expect, test } from "@jest/globals";

/*
 * When a commitment alerts (#11011): 90, 30 and 7 days before it ends, the
 * most urgent first; while a week's utilization is under 80%; when an
 * account's coverage falls under 60% - and when each alert is resolved.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

const SETTINGS: CloudCommitmentAlertSettings = {
  isEnabled: true,
  expiryDays: [90, 30, 7],
  utilizationThreshold: 80,
};

function facts(
  overrides: Partial<CloudCommitmentAlertFacts> = {},
): CloudCommitmentAlertFacts {
  return {
    state: CloudCommitmentState.Active,
    startsAt: new Date(NOW.getTime() - 300 * DAY),
    endsAt: new Date(NOW.getTime() + 200 * DAY),
    isAutoRenew: false,
    hasQueuedRenewal: false,
    weekUtilizationPercent: 95,
    isListed: true,
    ...overrides,
  };
}

function endingIn(days: number, hours: number = 3): Date {
  return new Date(NOW.getTime() + days * DAY + hours * 60 * 60 * 1000);
}

describe("the days before an end", () => {
  test("default to 90, 30 and 7", () => {
    expect(CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS).toEqual([90, 30, 7]);
    expect(CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT).toBe("90, 30, 7");
    expect(readCloudCommitmentExpiryDays(undefined)).toEqual([90, 30, 7]);
    expect(readCloudCommitmentExpiryDays("")).toEqual([90, 30, 7]);
  });

  test("are read from what was typed, the furthest first, each once", () => {
    expect(readCloudCommitmentExpiryDays("7,30 ,90")).toEqual([90, 30, 7]);
    expect(readCloudCommitmentExpiryDays("60; 14 14")).toEqual([60, 14]);
    expect(readCloudCommitmentExpiryDays("۶۰، ۷")).toEqual([90, 30, 7]);
    expect(readCloudCommitmentExpiryDays([120, "45", 0, -1, 9999])).toEqual([
      120, 45,
    ]);
  });

  test("a list that is not whole days is said before it is saved", () => {
    expect(isCloudCommitmentExpiryDaysText("90, 30, 7")).toBe(true);
    expect(isCloudCommitmentExpiryDaysText("180")).toBe(true);
    expect(isCloudCommitmentExpiryDaysText("90, thirty")).toBe(false);
    expect(isCloudCommitmentExpiryDaysText("7.5")).toBe(false);
    expect(isCloudCommitmentExpiryDaysText("0")).toBe(false);
    expect(isCloudCommitmentExpiryDaysText("2000")).toBe(false);
    expect(isCloudCommitmentExpiryDaysText("")).toBe(false);
  });
});

describe("a percent threshold as stored", () => {
  test("is a percent from 1 to 100, else the fallback", () => {
    expect(readCloudCommitmentPercentThreshold(75, 80)).toBe(75);
    expect(readCloudCommitmentPercentThreshold("65", 80)).toBe(65);
    expect(readCloudCommitmentPercentThreshold(undefined, 80)).toBe(80);
    expect(readCloudCommitmentPercentThreshold(null, null)).toBeNull();
    expect(readCloudCommitmentPercentThreshold("", null)).toBeNull();
    expect(readCloudCommitmentPercentThreshold(0, 80)).toBe(80);
    expect(readCloudCommitmentPercentThreshold(150, 80)).toBe(80);
    expect(CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD).toBe(80);
    expect(CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD).toBe(60);
  });
});

describe("an expiring commitment", () => {
  test("far from its end says nothing", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts(),
      state: null,
      settings: SETTINGS,
      now: NOW,
    });

    expect(decision.raiseExpiry).toBeUndefined();
    expect(decision.resolve).toEqual([]);
    expect(decision.state.expiryThresholds).toEqual([]);
  });

  test("alerts at 90 days, then at 30 superseding it, then at 7", () => {
    const at90: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(89) }),
      state: null,
      settings: SETTINGS,
      now: NOW,
    });

    expect(at90.raiseExpiry).toEqual({ threshold: 90, daysLeft: 89 });
    at90.state.expiryAlertId = "alert-90";

    // The same day read again: nothing new.
    const again: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(89) }),
      state: at90.state,
      settings: SETTINGS,
      now: NOW,
    });
    expect(again.raiseExpiry).toBeUndefined();
    expect(again.resolve).toEqual([]);

    const at30: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(30) }),
      state: at90.state,
      settings: SETTINGS,
      now: NOW,
    });

    expect(at30.raiseExpiry).toEqual({ threshold: 30, daysLeft: 30 });
    expect(at30.resolve).toEqual([
      { alertId: "alert-90", reason: CloudCommitmentResolution.Superseded },
    ]);
    expect(at30.state.expiryThresholds).toEqual([90, 30]);
    at30.state.expiryAlertId = "alert-30";

    const at7: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(6) }),
      state: at30.state,
      settings: SETTINGS,
      now: NOW,
    });

    expect(at7.raiseExpiry).toEqual({ threshold: 7, daysLeft: 6 });
    expect(at7.resolve).toEqual([
      { alertId: "alert-30", reason: CloudCommitmentResolution.Superseded },
    ]);
  });

  test("first seen with 25 days left alerts at 30, and never at 90", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(25) }),
      state: null,
      settings: SETTINGS,
      now: NOW,
    });

    expect(decision.raiseExpiry).toEqual({ threshold: 30, daysLeft: 25 });
    expect(decision.state.expiryThresholds).toEqual([90, 30]);
  });

  test("one that renews itself, or has a renewal queued, is not alerted, and its alert resolved", () => {
    for (const renewal of [
      { isAutoRenew: true },
      { hasQueuedRenewal: true },
    ] as Array<Partial<CloudCommitmentAlertFacts>>) {
      const decision: CloudCommitmentAlertDecision =
        decideCloudCommitmentAlerts({
          facts: facts({ endsAt: endingIn(20), ...renewal }),
          state: { expiryThresholds: [90], expiryAlertId: "alert-90" },
          settings: SETTINGS,
          now: NOW,
        });

      expect(decision.raiseExpiry).toBeUndefined();
      expect(decision.resolve).toEqual([
        { alertId: "alert-90", reason: CloudCommitmentResolution.Renewed },
      ]);
    }
  });

  test("its alerts are resolved once it ends, or is no longer listed", () => {
    const ended: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: new Date(NOW.getTime() - DAY) }),
      state: {
        expiryThresholds: [90, 30, 7],
        expiryAlertId: "alert-7",
        underUseAlertId: "under-1",
      },
      settings: SETTINGS,
      now: NOW,
    });

    expect(ended.resolve).toEqual([
      { alertId: "alert-7", reason: CloudCommitmentResolution.Ended },
      { alertId: "under-1", reason: CloudCommitmentResolution.Ended },
    ]);

    const gone: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ isListed: false }),
      state: { expiryThresholds: [], expiryAlertId: "alert-30" },
      settings: SETTINGS,
      now: NOW,
    });

    expect(gone.resolve).toEqual([
      { alertId: "alert-30", reason: CloudCommitmentResolution.Gone },
    ]);

    const retired: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ state: CloudCommitmentState.Retired }),
      state: { expiryThresholds: [], expiryAlertId: "alert-30" },
      settings: SETTINGS,
      now: NOW,
    });

    expect(retired.resolve[0]!.reason).toBe(CloudCommitmentResolution.Ended);
  });

  test("one queued to start, or still paying, is not alerted yet", () => {
    for (const state of [
      CloudCommitmentState.Queued,
      CloudCommitmentState.Pending,
    ]) {
      const decision: CloudCommitmentAlertDecision =
        decideCloudCommitmentAlerts({
          facts: facts({ state, endsAt: endingIn(10) }),
          state: null,
          settings: SETTINGS,
          now: NOW,
        });

      expect(decision.raiseExpiry).toBeUndefined();
    }
  });

  test("alerts turned off resolve what is open, and raise nothing", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(5), weekUtilizationPercent: 10 }),
      state: {
        expiryThresholds: [90],
        expiryAlertId: "alert-90",
        underUseAlertId: "under-1",
      },
      settings: { ...SETTINGS, isEnabled: false },
      now: NOW,
    });

    expect(decision.raiseExpiry).toBeUndefined();
    expect(decision.raiseUnderUse).toBeUndefined();
    expect(
      decision.resolve.map((entry: { reason: CloudCommitmentResolution }) => {
        return entry.reason;
      }),
    ).toEqual([
      CloudCommitmentResolution.TurnedOff,
      CloudCommitmentResolution.TurnedOff,
    ]);
  });

  test("a commitment with no end is never alerted for its end", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: undefined }),
      state: null,
      settings: SETTINGS,
      now: NOW,
    });

    expect(decision.raiseExpiry).toBeUndefined();
  });

  test("days of a project's own: one alert at 14, from the first read under it", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ endsAt: endingIn(14) }),
      state: null,
      settings: { ...SETTINGS, expiryDays: [14] },
      now: NOW,
    });

    expect(decision.raiseExpiry).toEqual({ threshold: 14, daysLeft: 14 });
  });
});

describe("an under-used commitment", () => {
  test("used at 60% over a week alerts, once", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ weekUtilizationPercent: 60 }),
      state: null,
      settings: SETTINGS,
      now: NOW,
    });

    expect(decision.raiseUnderUse).toEqual({ utilizationPercent: 60 });
    decision.state.underUseAlertId = "under-1";

    const again: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ weekUtilizationPercent: 55 }),
      state: decision.state,
      settings: SETTINGS,
      now: NOW,
    });

    expect(again.raiseUnderUse).toBeUndefined();
    expect(again.resolve).toEqual([]);
  });

  test("is resolved once a week's use is back at the threshold", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ weekUtilizationPercent: 80 }),
      state: { expiryThresholds: [], underUseAlertId: "under-1" },
      settings: SETTINGS,
      now: NOW,
    });

    expect(decision.resolve).toEqual([
      { alertId: "under-1", reason: CloudCommitmentResolution.Recovered },
    ]);
    expect(decision.state.underUseAlertId).toBeUndefined();
  });

  test("is not judged before it has run a week, nor where its cloud does not say", () => {
    expect(
      decideCloudCommitmentAlerts({
        facts: facts({
          weekUtilizationPercent: 10,
          startsAt: new Date(NOW.getTime() - 3 * DAY),
        }),
        state: null,
        settings: SETTINGS,
        now: NOW,
      }).raiseUnderUse,
    ).toBeUndefined();

    expect(
      decideCloudCommitmentAlerts({
        facts: facts({ weekUtilizationPercent: null }),
        state: null,
        settings: SETTINGS,
        now: NOW,
      }).raiseUnderUse,
    ).toBeUndefined();
  });

  test("with no threshold it never alerts, and an open alert is resolved", () => {
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: facts({ weekUtilizationPercent: 5 }),
      state: { expiryThresholds: [], underUseAlertId: "under-1" },
      settings: { ...SETTINGS, utilizationThreshold: null },
      now: NOW,
    });

    expect(decision.raiseUnderUse).toBeUndefined();
    expect(decision.resolve[0]!.reason).toBe(
      CloudCommitmentResolution.TurnedOff,
    );
  });
});

describe("a commitment's alert state as stored", () => {
  test("is read back, the malformed left out", () => {
    expect(
      readCloudCommitmentAlertState({
        expiryThresholds: [90, "30", "x", -1],
        expiryAlertId: "a",
        underUseAlertId: "",
      }),
    ).toEqual({
      expiryThresholds: [90, 30],
      expiryAlertId: "a",
      underUseAlertId: undefined,
    });
    expect(readCloudCommitmentAlertState(null)).toEqual({
      expiryThresholds: [],
      expiryAlertId: undefined,
      underUseAlertId: undefined,
    });
  });
});

describe("falling coverage", () => {
  const KEY: string = getCloudCoverageAlertKey({
    accountRowId: "row-1",
    kind: "savings-plans",
  });

  test("a first reading only remembers: coverage always under the threshold is a choice", () => {
    const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: 30 }],
      state: {},
      threshold: 60,
      isEnabled: true,
    });

    expect(decision.raise).toEqual([]);
    expect(decision.state[KEY]).toEqual({ percent: 30, alertId: undefined });
  });

  test("a fall from above the threshold to under it alerts once", () => {
    const fell: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: 41 }],
      state: { [KEY]: { percent: 72 } },
      threshold: 60,
      isEnabled: true,
    });

    expect(fell.raise).toEqual([
      { key: KEY, percent: 41, previousPercent: 72 },
    ]);

    fell.state[KEY]!.alertId = "coverage-1";

    const stillLow: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: 35 }],
      state: fell.state,
      threshold: 60,
      isEnabled: true,
    });

    expect(stillLow.raise).toEqual([]);
    expect(stillLow.state[KEY]!.alertId).toBe("coverage-1");
  });

  test("coverage back at the threshold resolves the alert", () => {
    const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: 60 }],
      state: { [KEY]: { percent: 41, alertId: "coverage-1" } },
      threshold: 60,
      isEnabled: true,
    });

    expect(decision.resolve).toEqual([
      {
        key: KEY,
        alertId: "coverage-1",
        reason: CloudCommitmentResolution.Recovered,
      },
    ]);
    expect(decision.state[KEY]!.alertId).toBeUndefined();
  });

  test("nothing left to cover resolves the alert", () => {
    const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: null }],
      state: { [KEY]: { percent: 41, alertId: "coverage-1" } },
      threshold: 60,
      isEnabled: true,
    });

    expect(decision.resolve[0]!.reason).toBe(CloudCommitmentResolution.Ended);
  });

  test("coverage alerts turned off - no threshold, or alerts off - resolve what is open and keep reading", () => {
    for (const settings of [
      { threshold: null, isEnabled: true },
      { threshold: 60, isEnabled: false },
    ]) {
      const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
        readings: [{ key: KEY, percent: 10 }],
        state: { [KEY]: { percent: 70, alertId: "coverage-1" } },
        ...settings,
      });

      expect(decision.raise).toEqual([]);
      expect(decision.resolve[0]!.reason).toBe(
        CloudCommitmentResolution.TurnedOff,
      );
      expect(decision.state[KEY]!.percent).toBe(10);
    }
  });

  test("an account this check did not read keeps what it had", () => {
    const other: string = getCloudCoverageAlertKey({
      accountRowId: "row-2",
      kind: "reservations",
    });
    const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings: [{ key: KEY, percent: 90 }],
      state: { [other]: { percent: 20, alertId: "coverage-2" } },
      threshold: 60,
      isEnabled: true,
    });

    expect(decision.state[other]).toEqual({
      percent: 20,
      alertId: "coverage-2",
    });
  });

  test("the stored state is read back from the settings' alert state", () => {
    expect(
      readCloudCoverageAlertState({
        coverage: {
          [KEY]: { percent: 55.5, alertId: "a" },
          broken: "x",
          empty: { percent: null },
        },
      }),
    ).toEqual({
      [KEY]: { percent: 55.5, alertId: "a" },
      empty: { percent: null, alertId: undefined },
    });
    expect(readCloudCoverageAlertState(null)).toEqual({});
    expect(readCloudCoverageAlertState({ coverage: [] })).toEqual({});
  });
});
