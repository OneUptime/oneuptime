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
  SLO_TARGET_OUT_OF_RANGE_BODY_TEMPLATE,
  SLO_TARGET_OUT_OF_RANGE_FIGURES,
} from "../../../Utils/Slo/SloHealth";
import fs from "fs";
import path from "path";

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/** The full 30-day error budget of a 99.9% SLO: 43m 12s. */
const THIRTY_DAY_999_BUDGET_SECONDS: number = 0.001 * 30 * SECONDS_PER_DAY;

// An SLI type OneUptime does not measure: Metric is measured now (#8445).
const UNSUPPORTED_SLI_TYPE: SliType = "Availability" as SliType;

// A Metric SLO's metric it can count with.
const COUNTER_METRIC: Record<string, unknown> = {
  metricName: "http_requests_total",
  kind: "Counter",
  goodFilter: "@http.response.status_code:<500",
};

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
      sliType: UNSUPPORTED_SLI_TYPE,
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
    name: "waiting for evaluation with monitors attached",
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
    /*
     * Evaluation is one switch now, and the banner carries a button that
     * turns it back on where the notice is - not a trip to Settings to find
     * the switch.
     */
    it("turns a disabled SLO's evaluation on where the notice is", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        isEnabled: false,
      });

      expect(notice?.action).toEqual({
        label: "Turn evaluation on",
        target: SloNoticeActionTarget.TurnEvaluationOn,
      });
      expect(notice?.body).toContain("Turn evaluation back on");
      expect(notice?.body).not.toContain("Settings");
    });

    it("keeps an archived SLO's way back on Settings, even when it is also disabled", () => {
      /*
       * Turning evaluation on would leave an archived SLO measuring
       * nothing, so its notice offers no in-place switch.
       */
      expect(
        getSloNotice({ ...MEASURING, isArchived: true, isEnabled: false })
          ?.action?.target,
      ).toBe(SloNoticeActionTarget.Settings);
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
    it("sends an unsupported SLI type to Settings, where what it measures is chosen", () => {
      const notice: SloNotice | null = getSloNotice({
        ...MEASURING,
        sloStatus: SloStatus.Misconfigured,
        sliType: UNSUPPORTED_SLI_TYPE,
      });

      expect(notice?.title).toBe("This SLO cannot be evaluated");
      expect(notice?.action).toEqual({
        label: "Open Settings",
        target: SloNoticeActionTarget.Settings,
      });
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
   * The banner maps these values to Dashboard pages, and the last to the
   * button that turns evaluation on in place; renaming one here without
   * the banner would silently drop the link or the button.
   */
  it("keeps the action targets the banner knows how to draw", () => {
    expect(Object.values(SloNoticeActionTarget)).toEqual([
      "settings",
      "monitors",
      "monitor-rules",
      "turn-evaluation-on",
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
        sliType: UNSUPPORTED_SLI_TYPE,
        monitorCount: 0,
        targetPercentage: 99.9,
        lastEvaluatedAt: new Date(),
      });

      expect(notice?.body).toContain(
        "monitor uptime, request success, request latency or a metric",
      );
    });

    describe("waiting for evaluation after monitors are attached", () => {
      it.each([
        { monitorCount: 1, lastEvaluatedAt: null },
        { monitorCount: 16, lastEvaluatedAt: null },
        { monitorCount: 1, lastEvaluatedAt: undefined },
        { monitorCount: 16, lastEvaluatedAt: undefined },
        {
          monitorCount: 1,
          lastEvaluatedAt: new Date("2026-09-21T12:00:00.000Z"),
        },
        {
          monitorCount: 16,
          lastEvaluatedAt: "2026-09-21T12:00:00.000Z",
        },
      ])(
        "is informational with $monitorCount monitors and lastEvaluatedAt=$lastEvaluatedAt",
        ({
          monitorCount,
          lastEvaluatedAt,
        }: {
          monitorCount: number;
          lastEvaluatedAt: Date | string | null | undefined;
        }) => {
          const notice: SloNotice | null = getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Misconfigured,
            monitorCount,
            lastEvaluatedAt,
          });

          expect(notice?.type).toBe(SloNoticeType.Info);
          expect(notice?.title).toBe("Waiting for SLO evaluation");
          expect(notice?.body).toContain("Monitors are attached");
          expect(notice?.body).toContain("every few minutes");
          expect(notice?.body).toContain(
            "once monitor status data is available and the next evaluation completes",
          );
          expect(notice?.action).toEqual({
            label: "View monitors",
            target: SloNoticeActionTarget.Monitors,
          });
        },
      );

      it.each([undefined, null])(
        "retains the default monitor-uptime behavior when sliType is %s",
        (sliType: undefined | null) => {
          expect(
            getSloNotice({
              ...MEASURING,
              sloStatus: SloStatus.Misconfigured,
              sliType,
            })?.type,
          ).toBe(SloNoticeType.Info);
        },
      );

      it.each([0, -1, 100, 101, Number.NaN, Infinity, null, undefined])(
        "still warns about target %s even with monitors attached",
        (targetPercentage: number | null | undefined) => {
          const notice: SloNotice | null = getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Misconfigured,
            monitorCount: 16,
            targetPercentage,
          });

          expect(notice?.type).toBe(SloNoticeType.Warning);
          expect(notice?.title).toBe("The target is out of range");
          expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
        },
      );

      // #9089: set up right, only waiting for its monitors' first check.
      it("says an SLO whose monitors nothing has checked yet waits for their first check", () => {
        const notice: SloNotice | null = getSloNotice({
          ...MEASURING,
          sloStatus: SloStatus.Misconfigured,
          monitorCount: 2,
          isWaitingForFirstCheck: true,
        });

        expect(notice).toEqual({
          type: SloNoticeType.Info,
          title: "Waiting for the first check",
          body: "Nothing has checked this SLO's monitors yet. It is measured from their first check.",
          action: {
            label: "View monitors",
            target: SloNoticeActionTarget.Monitors,
          },
        });
      });

      it.each([false, null, undefined])(
        "keeps Waiting for SLO evaluation when isWaitingForFirstCheck is %s",
        (isWaitingForFirstCheck: boolean | null | undefined) => {
          expect(
            getSloNotice({
              ...MEASURING,
              sloStatus: SloStatus.Misconfigured,
              isWaitingForFirstCheck,
            })?.title,
          ).toBe("Waiting for SLO evaluation");
        },
      );

      /*
       * The status of its own the worker gives such an SLO now (#9354): the
       * banner says the same thing for it, whatever the page read of its
       * monitors, and an SLO stored as Misconfigured for it before Waiting
       * existed keeps the same banner until its next evaluation.
       */
      it("says a Waiting SLO waits for its monitors' first check, whatever was read of its monitors", () => {
        for (const isWaitingForFirstCheck of [true, false, null, undefined]) {
          expect(
            getSloNotice({
              ...MEASURING,
              sloStatus: SloStatus.Waiting,
              monitorCount: 2,
              isWaitingForFirstCheck,
            }),
          ).toEqual({
            type: SloNoticeType.Info,
            title: "Waiting for the first check",
            body: "Nothing has checked this SLO's monitors yet. It is measured from their first check.",
            action: {
              label: "View monitors",
              target: SloNoticeActionTarget.Monitors,
            },
          });
        }
      });

      it("still names archived and disabled before Waiting", () => {
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Waiting,
            isArchived: true,
          })?.title,
        ).toBe("This SLO is archived");
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Waiting,
            isEnabled: false,
          })?.title,
        ).toBe("This SLO is disabled");
      });

      it("names a real setup problem before the first check", () => {
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Misconfigured,
            targetPercentage: 100,
            isWaitingForFirstCheck: true,
          })?.title,
        ).toBe("The target is out of range");
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Misconfigured,
            monitorCount: 0,
            isWaitingForFirstCheck: true,
          })?.title,
        ).toBe("No monitors attached");
      });

      it("says nothing of a first check for an SLO that is Paused or measuring", () => {
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Paused,
            isWaitingForFirstCheck: true,
          })?.title,
        ).toBe("Measurement is paused");
        expect(
          getSloNotice({
            ...MEASURING,
            sloStatus: SloStatus.Healthy,
            isWaitingForFirstCheck: true,
          }),
        ).toBeNull();
      });

      it("leaves a request SLO's waiting notice alone", () => {
        expect(
          getSloNotice({
            ...MEASURING,
            sliType: SliType.RequestSuccess,
            serviceCount: 1,
            sloStatus: SloStatus.Misconfigured,
            isWaitingForFirstCheck: true,
          })?.title,
        ).toBe("Waiting for requests");
      });

      it("still warns about an unsupported SLI with monitors attached", () => {
        const notice: SloNotice | null = getSloNotice({
          ...MEASURING,
          sloStatus: SloStatus.Misconfigured,
          sliType: UNSUPPORTED_SLI_TYPE,
          monitorCount: 16,
        });

        expect(notice?.type).toBe(SloNoticeType.Warning);
        expect(notice?.title).toBe("This SLO cannot be evaluated");
        expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
      });

      it.each([SloStatus.Healthy, SloStatus.AtRisk, SloStatus.BudgetExhausted])(
        "stops displaying the notice after evaluation reports %s",
        (sloStatus: SloStatus) => {
          expect(
            getSloNotice({ ...MEASURING, sloStatus, monitorCount: 16 }),
          ).toBeNull();
        },
      );
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

/*
 * A request SLO (Request Success, Request Latency) measures its services'
 * requests: its notices name services and a latency threshold, never
 * monitors, and every one of them leads to Settings, What It Measures.
 */
describe("SloHealth notices of a request SLO", () => {
  const REQUEST: SloNoticeData = {
    isEnabled: true,
    isArchived: false,
    sliType: SliType.RequestSuccess,
    sloStatus: SloStatus.Misconfigured,
    monitorCount: 0,
    serviceCount: 2,
    targetPercentage: 99.9,
    lastEvaluatedAt: new Date("2026-09-21T12:00:00.000Z"),
  };

  it("no services: chooses them in Settings, never 'attach monitors'", () => {
    const notice: SloNotice | null = getSloNotice({
      ...REQUEST,
      serviceCount: 0,
    });

    expect(notice).toEqual({
      type: SloNoticeType.Warning,
      title: "No services chosen",
      body: "A request SLO measures the requests its services serve, so it cannot be evaluated without at least one. Choose its services in Settings.",
      action: {
        label: "Choose services",
        target: SloNoticeActionTarget.Settings,
      },
    });
  });

  it("a Request Latency SLO without a threshold: sets it in Settings", () => {
    const notice: SloNotice | null = getSloNotice({
      ...REQUEST,
      sliType: SliType.RequestLatency,
      latencyThresholdInMilliseconds: null,
    });

    expect(notice?.title).toBe("No latency threshold");
    expect(notice?.action).toEqual({
      label: "Set the threshold",
      target: SloNoticeActionTarget.Settings,
    });
  });

  it("a Request Latency SLO with a threshold and services waits for requests", () => {
    const notice: SloNotice | null = getSloNotice({
      ...REQUEST,
      sliType: SliType.RequestLatency,
      latencyThresholdInMilliseconds: 300,
    });

    expect(notice?.title).toBe("Waiting for requests");
    expect(notice?.type).toBe(SloNoticeType.Info);
    expect(notice?.body).toContain("traces reach OneUptime");
    expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
  });

  it("a target out of range is still named before the wait", () => {
    expect(getSloNotice({ ...REQUEST, targetPercentage: 100 })?.title).toBe(
      "The target is out of range",
    );
  });

  it("is never told about monitors, attached or not", () => {
    for (const notice of [
      getSloNotice(REQUEST),
      getSloNotice({ ...REQUEST, serviceCount: 0 }),
      getSloNotice({ ...REQUEST, lastEvaluatedAt: null }),
    ]) {
      expect(notice?.title).not.toBe("No monitors attached");
      expect(notice?.action?.target).not.toBe(SloNoticeActionTarget.Monitors);
    }
  });

  it("a brand-new request SLO with services is simply not evaluated yet", () => {
    expect(
      getSloNotice({
        ...REQUEST,
        sloStatus: SloStatus.Healthy,
        lastEvaluatedAt: null,
      })?.title,
    ).toBe("Not evaluated yet");
  });

  it("a brand-new request SLO with no services is told to choose them", () => {
    expect(
      getSloNotice({
        ...REQUEST,
        sloStatus: SloStatus.Healthy,
        lastEvaluatedAt: null,
        serviceCount: 0,
      })?.title,
    ).toBe("No services chosen");
  });

  it("an SLO measuring normally has no notice", () => {
    expect(
      getSloNotice({ ...REQUEST, sloStatus: SloStatus.Healthy }),
    ).toBeNull();
  });
});

/*
 * Every notice the banner can show, worded in the reader's language
 * (#8446). Its title, body and action label are translation keys of the
 * Dashboard's English locale, so the extractor keeps them and every
 * language words them; the one body that states figures is a template
 * whose figures the banner writes in the reader's digits.
 */
describe("SloHealth notices are translation keys", () => {
  const ENGLISH_LOCALE: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const BASE: SloNoticeData = {
    isEnabled: true,
    isArchived: false,
    sliType: SliType.MonitorUptime,
    monitorCount: 2,
    serviceCount: 1,
    latencyThresholdInMilliseconds: 300,
    targetPercentage: 99.9,
    lastEvaluatedAt: new Date("2026-09-21T12:00:00.000Z"),
  };

  // One input for every notice getSloNotice gives.
  const EVERY_NOTICE: Array<SloNotice | null> = [
    getSloNotice({ ...BASE, isArchived: true }),
    getSloNotice({ ...BASE, isEnabled: false }),
    getSloNotice({
      ...BASE,
      sliType: UNSUPPORTED_SLI_TYPE,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      monitorCount: 0,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      sliType: SliType.RequestSuccess,
      serviceCount: 0,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      sliType: SliType.RequestLatency,
      latencyThresholdInMilliseconds: null,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      targetPercentage: 100,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      sliType: SliType.RequestSuccess,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({ ...BASE, sloStatus: SloStatus.Misconfigured }),
    getSloNotice({
      ...BASE,
      sloStatus: SloStatus.Misconfigured,
      isWaitingForFirstCheck: true,
    }),
    getSloNotice({ ...BASE, sloStatus: SloStatus.Paused }),
    getSloNotice({ ...BASE, lastEvaluatedAt: null }),
    // A Metric SLO's own (#8445).
    getSloNotice({
      ...BASE,
      sliType: SliType.Metric,
      serviceCount: 0,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      sliType: SliType.Metric,
      sloStatus: SloStatus.Misconfigured,
    }),
    getSloNotice({
      ...BASE,
      sliType: SliType.Metric,
      metricQueryConfig: COUNTER_METRIC,
      sloStatus: SloStatus.Misconfigured,
    }),
  ];

  test("the inputs reach every notice, each once", () => {
    const titles: Array<string> = EVERY_NOTICE.map(
      (notice: SloNotice | null): string => {
        return notice?.title || "";
      },
    );

    expect(titles).toEqual([
      "This SLO is archived",
      "This SLO is disabled",
      "This SLO cannot be evaluated",
      "No monitors attached",
      "No services chosen",
      "No latency threshold",
      "The target is out of range",
      "Waiting for requests",
      "Waiting for SLO evaluation",
      "Waiting for the first check",
      "Measurement is paused",
      "Not evaluated yet",
      "No services chosen",
      "No metric to count",
      "Waiting for its metric",
    ]);
  });

  test("every title, body and action label is a key of the Dashboard's English", () => {
    const missing: Array<string> = [];

    for (const notice of EVERY_NOTICE) {
      const texts: Array<string> = [
        notice!.title,
        notice!.bodyTemplate || notice!.body,
        ...(notice!.action ? [notice!.action.label] : []),
      ];

      for (const text of texts) {
        if (typeof ENGLISH_LOCALE[text] !== "string") {
          missing.push(text);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("only the out-of-range target states figures, as a template the banner fills in", () => {
    const withFigures: Array<SloNotice | null> = EVERY_NOTICE.filter(
      (notice: SloNotice | null): boolean => {
        return Boolean(notice?.bodyTemplate);
      },
    );

    expect(withFigures).toHaveLength(1);

    const notice: SloNotice = withFigures[0]!;

    expect(notice.title).toBe("The target is out of range");
    expect(notice.bodyTemplate).toBe(SLO_TARGET_OUT_OF_RANGE_BODY_TEMPLATE);
    expect(notice.bodyFigures).toEqual(SLO_TARGET_OUT_OF_RANGE_FIGURES);
    expect(SLO_TARGET_OUT_OF_RANGE_FIGURES).toEqual({
      min: { value: 0, isPercent: false },
      max: { value: 100, isPercent: false },
      fullTarget: { value: 100, isPercent: true },
      exampleTarget: { value: 99.9, isPercent: false },
    });
    // The English reads exactly as it always did.
    expect(notice.body).toBe(
      "A target must be greater than 0 and less than 100 — a 100% target leaves no error budget to track. Set a target such as 99.9 in Settings.",
    );
  });

  test("no other notice's words hold a figure a reader would write in their own digits", () => {
    for (const notice of EVERY_NOTICE) {
      if (notice?.bodyTemplate) {
        continue;
      }

      expect({ title: notice?.title, body: notice?.body }).toEqual({
        title: notice?.title,
        body: notice?.body?.replace(/\d/g, ""),
      });
    }
  });
});

/*
 * A Metric SLO (#8445) is set up like a request SLO - its services - and
 * also needs a metric it can count. Each notice mirrors a guard of the
 * worker (EvaluateSlos.getRequestSloMisconfiguredReason), in the order a
 * person fixes them.
 */
describe("getSloNotice - a Metric SLO", () => {
  const METRIC_SLO: SloNoticeData = {
    ...MEASURING,
    sliType: SliType.Metric,
    serviceCount: 2,
    metricQueryConfig: COUNTER_METRIC,
  };

  it("with no services asks for them, saying what a Metric SLO measures", () => {
    const notice: SloNotice | null = getSloNotice({
      ...METRIC_SLO,
      sloStatus: SloStatus.Misconfigured,
      serviceCount: 0,
    });

    expect(notice?.title).toBe("No services chosen");
    expect(notice?.body).toContain("the metric its services send");
    expect(notice?.action?.target).toBe(SloNoticeActionTarget.Settings);
  });

  it.each<[string, unknown]>([
    ["no metric", undefined],
    ["a counter with no good condition", { metricName: "m", kind: "Counter" }],
    [
      "a histogram with no value",
      { metricName: "http.server.request.duration", kind: "Histogram" },
    ],
    [
      "one of OneUptime's own",
      { ...COUNTER_METRIC, metricName: "oneuptime.slo.sli.percent" },
    ],
  ])(
    "with %s asks for a metric it can count",
    (_label: string, metric: unknown) => {
      const notice: SloNotice | null = getSloNotice({
        ...METRIC_SLO,
        sloStatus: SloStatus.Misconfigured,
        metricQueryConfig: metric,
      });

      expect(notice?.type).toBe(SloNoticeType.Warning);
      expect(notice?.title).toBe("No metric to count");
      expect(notice?.action).toEqual({
        label: "Choose the metric",
        target: SloNoticeActionTarget.Settings,
      });
    },
  );

  it("with its services and a metric waits for the metric, never for traces", () => {
    const notice: SloNotice | null = getSloNotice({
      ...METRIC_SLO,
      sloStatus: SloStatus.Misconfigured,
    });

    expect(notice?.type).toBe(SloNoticeType.Info);
    expect(notice?.title).toBe("Waiting for its metric");
    expect(notice?.body).not.toContain("traces");
  });

  it("before its first evaluation names what is missing, or that numbers are coming", () => {
    expect(
      getSloNotice({
        ...METRIC_SLO,
        lastEvaluatedAt: null,
        metricQueryConfig: null,
      })?.title,
    ).toBe("No metric to count");
    expect(getSloNotice({ ...METRIC_SLO, lastEvaluatedAt: null })?.title).toBe(
      "Not evaluated yet",
    );
  });

  it("measuring, says nothing", () => {
    expect(getSloNotice(METRIC_SLO)).toBeNull();
  });
});
