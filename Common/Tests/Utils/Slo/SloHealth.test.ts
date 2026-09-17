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
  SloNoticeActionTarget,
  SloNoticeData,
  SloNoticeType,
} from "../../../Utils/Slo/SloHealth";

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/** The full 30-day error budget of a 99.9% SLO: 43m 12s. */
const THIRTY_DAY_999_BUDGET_SECONDS: number = 0.001 * 30 * SECONDS_PER_DAY;

/** An SLO that is measuring normally; each test changes one thing. */
const MEASURING: SloNoticeData = {
  isArchived: false,
  isEnabled: true,
  sloStatus: SloStatus.Healthy,
  sliType: SliType.MonitorUptime,
  monitorCount: 2,
  targetPercentage: 99.9,
  lastEvaluatedAt: new Date(),
};

/*
 * One input per notice getSloNotice can return, used to sweep properties
 * every notice must have.
 */
const EVERY_NOTICE_INPUT: Array<{ name: string; data: SloNoticeData }> = [
  { name: "archived", data: { ...MEASURING, isArchived: true } },
  { name: "disabled", data: { ...MEASURING, isEnabled: false } },
  {
    name: "unsupported SLI",
    data: {
      ...MEASURING,
      sloStatus: SloStatus.Misconfigured,
      sliType: SliType.Metric,
    },
  },
  {
    name: "no monitors",
    data: { ...MEASURING, sloStatus: SloStatus.Misconfigured, monitorCount: 0 },
  },
  {
    name: "target out of range",
    data: {
      ...MEASURING,
      sloStatus: SloStatus.Misconfigured,
      targetPercentage: 100,
    },
  },
  {
    name: "generic misconfigured",
    data: { ...MEASURING, sloStatus: SloStatus.Misconfigured },
  },
  { name: "paused", data: { ...MEASURING, sloStatus: SloStatus.Paused } },
  {
    name: "never evaluated, monitors not loaded",
    data: { ...MEASURING, monitorCount: undefined, lastEvaluatedAt: null },
  },
  {
    name: "never evaluated, no monitors",
    data: { ...MEASURING, monitorCount: 0, lastEvaluatedAt: null },
  },
];

describe("SloHealth notices after the settings move", () => {
  describe("archived SLOs", () => {
    it("reports an archived SLO as archived", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        isArchived: true,
      });

      expect(notice?.type).toBe(SloNoticeType.Info);
      expect(notice?.title).toBe("This SLO is archived");
      expect(notice?.body).toContain("Unarchive");
      expect(notice?.action).toEqual({
        label: "Open Settings",
        target: SloNoticeActionTarget.Settings,
      });
    });

    /*
     * Turning evaluation back on does not bring an SLO out of the archive,
     * so "this SLO is disabled" would send the user to a fix that leaves it
     * measuring nothing.
     */
    it("reports archived ahead of disabled", () => {
      expect(
        getSloNotice({ ...MEASURING, isArchived: true, isEnabled: false })
          ?.title,
      ).toBe("This SLO is archived");
    });

    it("reports archived ahead of a stale Misconfigured status", () => {
      expect(
        getSloNotice({
          ...MEASURING,
          isArchived: true,
          sloStatus: SloStatus.Misconfigured,
          monitorCount: 0,
        })?.title,
      ).toBe("This SLO is archived");
    });

    it.each([
      { name: "false", isArchived: false },
      { name: "not loaded", isArchived: undefined },
      { name: "null", isArchived: null },
    ])(
      "says nothing about the archive when isArchived is $name",
      ({ isArchived }: { isArchived: boolean | undefined | null }) => {
        expect(
          getSloNotice({ ...MEASURING, isArchived: isArchived }),
        ).toBeNull();
      },
    );
  });

  describe("where each notice sends the user", () => {
    it("sends a disabled SLO to Settings, where evaluation is switched", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        isEnabled: false,
      });

      expect(notice?.body).toContain("Settings");
      expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
    });

    it("sends an SLO without monitors to the Monitors page", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        sloStatus: SloStatus.Misconfigured,
        monitorCount: 0,
      });

      expect(notice?.body).toContain("Monitors page");
      expect(notice?.body).toContain("monitor rule");
      expect(notice?.action).toEqual({
        label: "Attach monitors",
        target: SloNoticeActionTarget.Monitors,
      });
    });

    it("sends an out-of-range target to Settings, where the objective is edited", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        sloStatus: SloStatus.Misconfigured,
        targetPercentage: 0,
      });

      expect(notice?.title).toBe("The target is out of range");
      expect(notice?.body).toContain("Settings");
      expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
    });

    it("sends the worker's data guards to the Monitors page", () => {
      expect(
        getSloNotice({ ...MEASURING, sloStatus: SloStatus.Misconfigured })
          ?.action?.target,
      ).toBe(SloNoticeActionTarget.Monitors);
    });

    it("sends a paused SLO to the monitors whose monitoring is off", () => {
      expect(
        getSloNotice({ ...MEASURING, sloStatus: SloStatus.Paused })?.action
          ?.target,
      ).toBe(SloNoticeActionTarget.Monitors);
    });

    // No page in the product changes the SLI type, so a link would dead-end.
    it("offers no link for an unsupported SLI type", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        sloStatus: SloStatus.Misconfigured,
        sliType: SliType.Metric,
      });

      expect(notice?.title).toBe("This SLO cannot be evaluated");
      expect(notice?.action).toBeUndefined();
    });

    it("offers no link while the first evaluation is simply pending", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        lastEvaluatedAt: null,
      });

      expect(notice?.title).toBe("Not evaluated yet");
      expect(notice?.action).toBeUndefined();
    });
  });

  describe("a brand-new SLO", () => {
    /*
     * The create form no longer attaches monitors, so every new SLO starts
     * with none and the worker's first pass would mark it Misconfigured.
     */
    it("asks for monitors before the first evaluation instead of promising numbers", () => {
      const notice: SloNotice | null = getSloNotice({
        isEnabled: true,
        sloStatus: null,
        sliType: SliType.MonitorUptime,
        monitorCount: 0,
        targetPercentage: 99.9,
        lastEvaluatedAt: null,
      });

      expect(notice?.type).toBe(SloNoticeType.Warning);
      expect(notice?.title).toBe("No monitors attached");
      expect(notice?.action?.target).toBe(SloNoticeActionTarget.Monitors);
    });

    it("waits quietly when monitors are attached", () => {
      expect(
        getSloNotice({ ...MEASURING, monitorCount: 1, lastEvaluatedAt: null })
          ?.title,
      ).toBe("Not evaluated yet");
    });

    // A caller that did not select the monitors has told us nothing about them.
    it("does not assume zero monitors when the count was not loaded", () => {
      expect(
        getSloNotice({
          ...MEASURING,
          monitorCount: undefined,
          lastEvaluatedAt: null,
        })?.title,
      ).toBe("Not evaluated yet");
    });
  });

  describe("every notice", () => {
    it.each(EVERY_NOTICE_INPUT)(
      "($name) no longer points at the retired SLO Details form",
      ({ data }: { data: SloNoticeData }) => {
        const notice: SloNotice | null = getSloNotice(data);

        expect(notice).not.toBeNull();
        expect(notice!.body).not.toContain("SLO Details");
      },
    );

    it.each(EVERY_NOTICE_INPUT)(
      "($name) carries a usable action when it has one",
      ({ data }: { data: SloNoticeData }) => {
        const action: SloNotice["action"] = getSloNotice(data)?.action;

        if (!action) {
          return;
        }

        expect(action.label.trim().length).toBeGreaterThan(0);
        expect(Object.values(SloNoticeActionTarget)).toContain(action.target);
      },
    );
  });

  /*
   * The banner maps these values to Dashboard pages; renaming one here
   * without the banner would silently drop the link.
   */
  it("keeps the action targets the banner knows how to link", () => {
    expect(Object.values(SloNoticeActionTarget)).toEqual([
      "settings",
      "monitors",
      "monitor-rules",
    ]);
  });
});

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
