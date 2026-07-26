import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  getSloBudgetTier,
  getSloNotice,
  isRollingWindowNotYetFull,
  SloBudgetTier,
  SloNotice,
  SloNoticeType,
} from "../../../Utils/Slo/SloHealth";

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/** The full 30-day error budget of a 99.9% SLO: 43m 12s. */
const THIRTY_DAY_999_BUDGET_SECONDS: number = 0.001 * 30 * SECONDS_PER_DAY;

describe("SloHealth", () => {
  describe("getSloBudgetTier", () => {
    it("returns Unknown when the SLO has not been evaluated", () => {
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: null })).toBe(
        SloBudgetTier.Unknown,
      );
      expect(
        getSloBudgetTier({ errorBudgetRemainingPercentage: undefined }),
      ).toBe(SloBudgetTier.Unknown);
    });

    it("returns Unknown for non-finite values", () => {
      expect(
        getSloBudgetTier({ errorBudgetRemainingPercentage: Number.NaN }),
      ).toBe(SloBudgetTier.Unknown);
    });

    it("returns Healthy well above the threshold", () => {
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: 68 })).toBe(
        SloBudgetTier.Healthy,
      );
    });

    it("returns Exhausted at exactly zero", () => {
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: 0 })).toBe(
        SloBudgetTier.Exhausted,
      );
    });

    it("returns Exhausted when overspent", () => {
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: -37 })).toBe(
        SloBudgetTier.Exhausted,
      );
    });

    it("returns AtRisk at exactly the threshold", () => {
      expect(
        getSloBudgetTier({
          errorBudgetRemainingPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
        }),
      ).toBe(SloBudgetTier.AtRisk);
    });

    it("falls back to the 20% default when no threshold is given", () => {
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: 19.9 })).toBe(
        SloBudgetTier.AtRisk,
      );
      expect(getSloBudgetTier({ errorBudgetRemainingPercentage: 20.1 })).toBe(
        SloBudgetTier.Healthy,
      );
    });

    it("honours a custom at-risk threshold instead of the hardcoded 20", () => {
      /*
       * The regression this function exists for: at a 50% threshold the
       * old `remaining <= 20` check rendered 35% green while the worker
       * had already moved the SLO to At Risk.
       */
      expect(
        getSloBudgetTier({
          errorBudgetRemainingPercentage: 35,
          atRiskThresholdPercentage: 50,
        }),
      ).toBe(SloBudgetTier.AtRisk);

      expect(
        getSloBudgetTier({
          errorBudgetRemainingPercentage: 15,
          atRiskThresholdPercentage: 5,
        }),
      ).toBe(SloBudgetTier.Healthy);
    });

    it("treats a zero threshold as 'at risk only once exhausted'", () => {
      expect(
        getSloBudgetTier({
          errorBudgetRemainingPercentage: 0.5,
          atRiskThresholdPercentage: 0,
        }),
      ).toBe(SloBudgetTier.Healthy);
    });
  });

  describe("getSloNotice", () => {
    it("returns null for a normally measuring SLO", () => {
      expect(
        getSloNotice({
          isEnabled: true,
          sloStatus: SloStatus.Healthy,
          sliType: SliType.MonitorUptime,
          monitorCount: 2,
          targetPercentage: 99.9,
          lastEvaluatedAt: new Date(),
        }),
      ).toBeNull();
    });

    it("reports a disabled SLO ahead of any other reason", () => {
      /*
       * A disabled SLO is never evaluated, so its stale Misconfigured
       * status must not send the user off to attach monitors.
       */
      const notice: SloNotice | null = getSloNotice({
        isEnabled: false,
        sloStatus: SloStatus.Misconfigured,
        monitorCount: 0,
      });

      expect(notice?.type).toBe(SloNoticeType.Info);
      expect(notice?.title).toBe("This SLO is disabled");
    });

    it("names 'no monitors' as the reason for Misconfigured", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Misconfigured,
        sliType: SliType.MonitorUptime,
        monitorCount: 0,
        targetPercentage: 99.9,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.type).toBe(SloNoticeType.Warning);
      expect(notice?.title).toBe("No monitors attached");
    });

    it("names an out-of-range target as the reason for Misconfigured", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Misconfigured,
        sliType: SliType.MonitorUptime,
        monitorCount: 1,
        targetPercentage: 100,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.title).toBe("The target is out of range");
    });

    it("names an unsupported SLI type ahead of the monitor count", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Misconfigured,
        sliType: SliType.Metric,
        monitorCount: 0,
        targetPercentage: 99.9,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.body).toContain(SliType.MonitorUptime);
    });

    it("falls back to a generic reason for Misconfigured", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Misconfigured,
        sliType: SliType.MonitorUptime,
        monitorCount: 1,
        targetPercentage: 99.9,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.title).toBe("This SLO cannot be evaluated");
    });

    it("explains Paused", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Paused,
        sliType: SliType.MonitorUptime,
        monitorCount: 2,
        targetPercentage: 99.9,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.type).toBe(SloNoticeType.Info);
      expect(notice?.title).toBe("Measurement is paused");
    });

    it("explains a never-evaluated SLO", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: SloStatus.Healthy,
        sliType: SliType.MonitorUptime,
        monitorCount: 1,
        targetPercentage: 99.9,
        lastEvaluatedAt: null,
      });

      expect(notice?.title).toBe("Not evaluated yet");
    });

    it("says nothing about a healthy SLO whose isEnabled was not selected", () => {
      // `undefined` means "not loaded", which is not the same as `false`.
      expect(
        getSloNotice({
          sloStatus: SloStatus.Healthy,
          sliType: SliType.MonitorUptime,
          monitorCount: 1,
          targetPercentage: 99.9,
          lastEvaluatedAt: new Date(),
        }),
      ).toBeNull();
    });
  });

  describe("isRollingWindowNotYetFull", () => {
    it("is false for a mature rolling window", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: THIRTY_DAY_999_BUDGET_SECONDS,
        }),
      ).toBe(false);
    });

    it("is true for a 30-day SLO carrying only a week of data", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: 0.001 * 7 * SECONDS_PER_DAY,
        }),
      ).toBe(true);
    });

    it("stays silent for Monitor Seconds Average — its budget scales with the monitor count", () => {
      /*
       * A five-monitor SLO with a week of data carries 35 monitor-days of
       * budget, which would read as mature against a 30-day yardstick. The
       * helper declines to guess rather than answer wrongly in either
       * direction.
       */
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: 0.001 * 7 * SECONDS_PER_DAY,
          multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
        }),
      ).toBe(false);
    });

    it("still answers for the default Any Monitor Down mode", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: 0.001 * 7 * SECONDS_PER_DAY,
          multiMonitorMode: SloMultiMonitorMode.AnyDown,
        }),
      ).toBe(true);
    });

    it("tolerates the small shortfall between now and the last evaluation", () => {
      // 0.5% short — a mature SLO must not flicker the banner.
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: THIRTY_DAY_999_BUDGET_SECONDS * 0.995,
        }),
      ).toBe(false);
    });

    it("is false for calendar-month windows — their budget is never prorated", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.CalendarMonth,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: 1,
        }),
      ).toBe(false);
    });

    it("is false when the SLO has not been evaluated", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: null,
        }),
      ).toBe(false);
    });

    it("is false when the target would make the full-window budget meaningless", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          targetPercentage: 100,
          errorBudgetTotalSeconds: 60,
        }),
      ).toBe(false);
    });

    it("defaults windowDays to 30 when it is not set", () => {
      expect(
        isRollingWindowNotYetFull({
          windowType: SloWindowType.Rolling,
          targetPercentage: 99.9,
          errorBudgetTotalSeconds: 0.001 * 7 * SECONDS_PER_DAY,
        }),
      ).toBe(true);
    });
  });
});
