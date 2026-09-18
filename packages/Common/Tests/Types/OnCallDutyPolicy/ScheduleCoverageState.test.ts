import OneUptimeDate from "../../../Types/Date";
import ScheduleShiftUtil, {
  CoverageGap,
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";

/*
 * getCoverageState is the replacement for the inverted `assignedUserCount > 0`
 * gate that made a schedule with a permanent coverage gap render as nothing at
 * all. Every surface that shows "who is on call" now derives its state from
 * here, so this suite pins the whole contract: the status precedence, the
 * current/next passthrough, and the ratio arithmetic (including the degenerate
 * windows a caller can hand it).
 */

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

/*
 * Build an OnCallShift literal directly. getCoverageState never reads
 * coverageSeconds, so defaulting it to the wall-clock span keeps the fixtures
 * honest without making them noisy.
 */
const mkShift: (userId: string, start: Date, end: Date) => OnCallShift = (
  userId: string,
  start: Date,
  end: Date,
): OnCallShift => {
  return {
    userId,
    start,
    end,
    coverageSeconds: OneUptimeDate.getDifferenceInSeconds(end, start),
  };
};

/*
 * Fixed instants only — a suite that computed "now" from the clock would flip
 * between Covered and UncoveredNow depending on when CI happened to run.
 */
const NOW: Date = at("2024-03-04T12:00:00Z");
const WINDOW_END: Date = at("2024-03-05T12:00:00Z");
const WINDOW_SECONDS: number = 24 * 3600;

/*
 * Defaults describe a healthy schedule (one layer, one assigned user, a 24h
 * summary window) so each test only spells out the field it is exercising.
 */
function coverage(data: {
  layerCount?: number | undefined;
  assignedUserCount?: number | undefined;
  shifts?: Array<OnCallShift> | undefined;
  now?: Date | undefined;
  windowEnd?: Date | undefined;
  minimumGapSeconds?: number | undefined;
}): ScheduleCoverageState {
  return ScheduleShiftUtil.getCoverageState({
    layerCount: data.layerCount === undefined ? 1 : data.layerCount,
    assignedUserCount:
      data.assignedUserCount === undefined ? 1 : data.assignedUserCount,
    shifts: data.shifts === undefined ? [] : data.shifts,
    now: data.now === undefined ? NOW : data.now,
    windowEnd: data.windowEnd === undefined ? WINDOW_END : data.windowEnd,
    minimumGapSeconds: data.minimumGapSeconds,
  });
}

function sumGapSeconds(gaps: Array<CoverageGap>): number {
  return gaps.reduce((total: number, gap: CoverageGap): number => {
    return total + OneUptimeDate.getDifferenceInSeconds(gap.end, gap.start);
  }, 0);
}

const coveringShift: OnCallShift = mkShift(
  "alice",
  at("2024-03-04T09:00:00Z"),
  at("2024-03-05T12:00:00Z"),
);

describe("ScheduleShiftUtil.getCoverageState", () => {
  describe("status precedence", () => {
    test("reports NoLayers when the schedule has no layers at all", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 0,
        assignedUserCount: 0,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoLayers);
    });

    /*
     * NoLayers must win over everything else: a schedule with no layers cannot
     * produce coverage, so any shifts handed in are stale data from a previous
     * render and must not talk the UI out of the "add a layer" remedy.
     */
    test("NoLayers outranks assigned users and shifts that cover now", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 0,
        assignedUserCount: 5,
        shifts: [coveringShift],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoLayers);
      expect(state.status).not.toBe(ScheduleCoverageStatus.Covered);
    });

    /*
     * THE HEADLINE REGRESSION. Layers exist but nobody is assigned to them, so
     * the engine emits zero events and NOBODY is ever on call. The old UI gated
     * its gap warning on `assignedUserCount > 0` — exactly inverted — so this
     * permanent 100% gap was the one state that rendered nothing at all.
     */
    test("reports NoUsers when layers exist but nobody is assigned", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 2,
        assignedUserCount: 0,
        shifts: [],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoUsers);
      expect(state.status).not.toBe(ScheduleCoverageStatus.Covered);
      expect(state.status).not.toBe(ScheduleCoverageStatus.UncoveredNow);
      expect(state.current).toBeNull();
      expect(state.gaps).toHaveLength(1);
      expect(state.uncoveredSeconds).toBe(WINDOW_SECONDS);
      expect(state.coverageRatio).toBe(0);
    });

    /*
     * The remedies differ: NoUsers means "assign somebody", UncoveredNow means
     * "widen the rotation". Collapsing the unassigned schedule into the generic
     * uncovered state would send the operator to the wrong fix.
     */
    test("NoUsers outranks UncoveredNow rather than collapsing into it", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 0,
        shifts: [],
        now: NOW,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoUsers);
    });

    /*
     * Stale shifts left over from before the last user was removed must not
     * flip an unassigned schedule back to Covered.
     */
    test("NoUsers outranks Covered even when a shift still spans now", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 0,
        shifts: [coveringShift],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoUsers);
      expect(state.current).not.toBeNull();
    });

    test("reports UncoveredNow when users are assigned but no shift spans now", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 3,
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T20:00:00Z"),
            at("2024-03-05T04:00:00Z"),
          ),
        ],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.UncoveredNow);
      expect(state.current).toBeNull();
    });

    test("reports Covered when a shift spans now", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 1,
        shifts: [coveringShift],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.current?.userId).toBe("alice");
    });

    /*
     * The status answers "is somebody on call RIGHT NOW"; the gaps array carries
     * the rest of the window. Downgrading to UncoveredNow because of a hole
     * three hours from now would fire a false alarm during a healthy shift.
     */
    test("stays Covered when somebody is on call now but later gaps exist", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 2,
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-05T09:00:00Z"),
            at("2024-03-05T12:00:00Z"),
          ),
        ],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.gaps.length).toBeGreaterThan(0);
    });

    /*
     * A caller that derives its counts from an array length can hand over -1
     * from a `findIndex`, and a deleted layer can transiently report 0. Both
     * must land in the "misconfigured" statuses, never in Covered.
     */
    test("treats a negative layerCount as NoLayers", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: -1,
        assignedUserCount: 4,
        shifts: [coveringShift],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoLayers);
    });

    test("treats a negative assignedUserCount as NoUsers", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: -3,
        shifts: [coveringShift],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoUsers);
    });

    /*
     * Boundary of the "contains now" test. A handover is inclusive at the start
     * and exclusive at the end, so the two people never both count as current
     * and the instant of handover is never reported as an uncovered second.
     */
    test("a shift starting exactly at now already counts as Covered", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [mkShift("alice", NOW, at("2024-03-04T20:00:00Z"))],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.current?.userId).toBe("alice");
    });

    test("a shift ending exactly at now no longer counts as Covered", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [mkShift("alice", at("2024-03-04T04:00:00Z"), NOW)],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.UncoveredNow);
      expect(state.current).toBeNull();
    });
  });

  describe("current and next passthrough", () => {
    test("current spans now and next is the earliest strictly future shift", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T17:00:00Z"),
            at("2024-03-05T01:00:00Z"),
          ),
          mkShift(
            "carol",
            at("2024-03-05T01:00:00Z"),
            at("2024-03-05T09:00:00Z"),
          ),
        ],
      });

      expect(state.current?.userId).toBe("alice");
      expect(state.next?.userId).toBe("bob");
    });

    test("both current and next are null when there are no shifts", () => {
      const state: ScheduleCoverageState = coverage({ shifts: [] });

      expect(state.current).toBeNull();
      expect(state.next).toBeNull();
    });

    /*
     * Inside a gap the UI still has something useful to say — "nobody until
     * 9:00 AM" — which only works if next survives a null current.
     */
    test("next is still resolved while current is null inside a gap", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T01:00:00Z"),
            at("2024-03-04T09:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T18:00:00Z"),
            at("2024-03-05T02:00:00Z"),
          ),
        ],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.UncoveredNow);
      expect(state.current).toBeNull();
      expect(state.next?.userId).toBe("bob");
    });

    /*
     * Multi-layer merges interleave events from several layers, so the caller's
     * array is not guaranteed to be ordered by start time. next must be the
     * earliest future shift, not simply the first future entry encountered.
     */
    test("next is the earliest future shift regardless of input ordering", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "carol",
            at("2024-03-05T06:00:00Z"),
            at("2024-03-05T10:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T18:00:00Z"),
            at("2024-03-04T22:00:00Z"),
          ),
        ],
      });

      expect(state.next?.userId).toBe("bob");
    });

    test("next is null once now is past every shift", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-01T09:00:00Z"),
            at("2024-03-01T17:00:00Z"),
          ),
        ],
      });

      expect(state.current).toBeNull();
      expect(state.next).toBeNull();
    });
  });

  describe("coverageRatio and uncoveredSeconds", () => {
    test("a fully covered window reports ratio 1 and zero uncovered seconds", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [mkShift("alice", NOW, WINDOW_END)],
      });

      expect(state.gaps).toHaveLength(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);
    });

    test("a window covered only for its second half reports ratio 0.5", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [mkShift("alice", at("2024-03-05T00:00:00Z"), WINDOW_END)],
      });

      expect(state.uncoveredSeconds).toBe(12 * 3600);
      expect(state.coverageRatio).toBeCloseTo(0.5, 6);
    });

    test("no shifts at all reports ratio 0 and the entire window uncovered", () => {
      const state: ScheduleCoverageState = coverage({ shifts: [] });

      expect(state.uncoveredSeconds).toBe(WINDOW_SECONDS);
      expect(state.coverageRatio).toBe(0);
    });

    test("uncoveredSeconds is the sum of the reported gap durations", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T13:00:00Z"),
            at("2024-03-04T15:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T18:00:00Z"),
            at("2024-03-04T20:00:00Z"),
          ),
        ],
      });

      expect(state.gaps).toHaveLength(2);
      expect(state.uncoveredSeconds).toBe(sumGapSeconds(state.gaps));
      expect(state.uncoveredSeconds).toBe(1 * 3600 + 3 * 3600);
    });

    /*
     * A zero-length window is what a caller produces when it renders "the rest
     * of today" at midnight. Dividing by it must not leak NaN or Infinity into
     * a percentage badge.
     */
    test("windowEnd equal to now reports ratio 0 with no NaN or Infinity", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [coveringShift],
        windowEnd: NOW,
      });

      expect(Number.isFinite(state.coverageRatio)).toBe(true);
      expect(Number.isNaN(state.coverageRatio)).toBe(false);
      expect(state.coverageRatio).toBe(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.gaps).toHaveLength(0);
    });

    /*
     * SUSPECTED PRODUCT BUG — asserting the correct behaviour, marked failing.
     *
     * An inverted window (windowEnd before now) is what a caller produces from
     * a stale or mis-ordered range, and it must degrade to "we know nothing",
     * i.e. ratio 0 — the same answer as the zero-length window above.
     *
     * This is a REGRESSION TEST for a real defect: the original clamp tested
     * `windowSeconds <= 0`, but OneUptimeDate.getDifferenceInSeconds returns the
     * ABSOLUTE difference, so an inverted window yielded a positive
     * windowSeconds, zero gaps, and a confident ratio of 1. The function whose
     * entire job is to surface missing coverage reported 100% covered. The
     * window's order is now tested explicitly with isBefore.
     */
    test("windowEnd before now reports ratio 0 rather than a false 100%", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [],
        now: NOW,
        windowEnd: at("2024-03-03T12:00:00Z"),
      });

      expect(Number.isFinite(state.coverageRatio)).toBe(true);
      expect(state.coverageRatio).toBeGreaterThanOrEqual(0);
      expect(state.coverageRatio).toBe(0);
    });

    test("an inverted window never yields a negative or non-finite ratio", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [],
        now: NOW,
        windowEnd: at("2024-03-03T12:00:00Z"),
      });

      expect(Number.isFinite(state.coverageRatio)).toBe(true);
      expect(Number.isNaN(state.coverageRatio)).toBe(false);
      expect(state.coverageRatio).toBeGreaterThanOrEqual(0);
      expect(state.coverageRatio).toBeLessThanOrEqual(1);
    });

    /*
     * A schedule with no layers (or no assigned users) can never put anyone on
     * call, so its coverage is 0 whatever shifts a caller happened to pass in.
     * The ratio used to be derived purely from those shifts and ignore the
     * status, letting a stale set render "100% covered" directly beside
     * "no layers configured".
     */
    test("ratio is 0 for NoLayers even when stale shifts cover the window", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 0,
        assignedUserCount: 0,
        shifts: [mkShift("alice", NOW, WINDOW_END)],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.NoLayers);
      expect(state.coverageRatio).toBe(0);
    });

    /*
     * Shifts are fetched over a wider range than the summary window, so the
     * leading gap can be many times the window itself. Without the lower clamp
     * that arithmetic goes negative and a progress bar renders backwards.
     */
    test("clamps to 0 when the leading gap overshoots a short window", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-06T00:00:00Z"),
            at("2024-03-06T08:00:00Z"),
          ),
        ],
        windowEnd: at("2024-03-04T13:00:00Z"),
      });

      expect(state.uncoveredSeconds).toBeGreaterThan(3600);
      expect(state.coverageRatio).toBe(0);
    });

    /*
     * LayerUtil advances each following segment with addRemoveSeconds(end, 1)
     * and the multi-layer merge leaves seams of the same magnitude, so a
     * one-second hole is an engine artifact and must never be billed as
     * uncovered time.
     */
    test("the engine's one-second seam is not counted as uncovered time", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T17:00:01Z"),
            at("2024-03-05T12:00:00Z"),
          ),
        ],
      });

      expect(state.gaps).toHaveLength(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);
    });

    /*
     * Guards the contiguity tolerance drop from 90s to 5s: a schedule whose
     * layers are misaligned by a minute is genuinely uncovered for that minute
     * and used to report full coverage.
     */
    test("a one-minute misalignment between layers is reported as a real gap", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T17:01:00Z"),
            at("2024-03-05T12:00:00Z"),
          ),
        ],
      });

      expect(state.gaps).toHaveLength(1);
      expect(state.uncoveredSeconds).toBe(60);
      expect(state.coverageRatio).toBeCloseTo(
        (WINDOW_SECONDS - 60) / WINDOW_SECONDS,
        6,
      );
    });

    /*
     * Render surfaces that consider sub-five-minute holes to be display noise
     * raise the threshold themselves rather than relying on the detector to
     * hide real misconfiguration from everybody.
     */
    test("minimumGapSeconds lets a caller suppress holes it treats as noise", () => {
      const state: ScheduleCoverageState = coverage({
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T17:01:00Z"),
            at("2024-03-05T12:00:00Z"),
          ),
        ],
        minimumGapSeconds: 300,
      });

      expect(state.gaps).toHaveLength(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);
    });

    /*
     * The ratio feeds percentage labels and progress bars, so no combination of
     * window and shift data may escape [0,1] or turn non-finite — including the
     * degenerate windows above and shifts that sit entirely outside the window.
     */
    test("ratio stays finite and within [0,1] across a spread of inputs", () => {
      const windowEnds: Array<Date> = [
        at("2024-03-03T12:00:00Z"),
        NOW,
        at("2024-03-04T12:00:01Z"),
        at("2024-03-04T13:00:00Z"),
        WINDOW_END,
        at("2024-04-03T12:00:00Z"),
      ];

      const shiftSets: Array<Array<OnCallShift>> = [
        [],
        [mkShift("alice", NOW, WINDOW_END)],
        [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-05T09:00:00Z"),
            at("2024-03-05T17:00:00Z"),
          ),
        ],
        [
          mkShift(
            "alice",
            at("2024-02-01T00:00:00Z"),
            at("2024-02-02T00:00:00Z"),
          ),
        ],
        [
          mkShift(
            "alice",
            at("2024-06-01T00:00:00Z"),
            at("2024-06-02T00:00:00Z"),
          ),
        ],
      ];

      for (const windowEnd of windowEnds) {
        for (const shifts of shiftSets) {
          const state: ScheduleCoverageState = coverage({
            shifts,
            windowEnd,
          });

          expect(Number.isFinite(state.coverageRatio)).toBe(true);
          expect(Number.isNaN(state.coverageRatio)).toBe(false);
          expect(state.coverageRatio).toBeGreaterThanOrEqual(0);
          expect(state.coverageRatio).toBeLessThanOrEqual(1);
          expect(Number.isFinite(state.uncoveredSeconds)).toBe(true);
          expect(state.uncoveredSeconds).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("adversarial shift input", () => {
    /*
     * getCoverageState runs inside render paths with no error boundary of its
     * own, so a malformed shift list must degrade to a wrong-but-safe answer
     * rather than blanking the schedule page with an exception. These are the
     * shapes the multi-layer merge and override lens can actually produce.
     */
    const adversarialShiftSets: Array<{
      name: string;
      shifts: Array<OnCallShift>;
    }> = [
      { name: "an empty shift list", shifts: [] },
      {
        name: "shifts handed over out of start order",
        shifts: [
          mkShift(
            "carol",
            at("2024-03-05T06:00:00Z"),
            at("2024-03-05T10:00:00Z"),
          ),
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T17:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T20:00:00Z"),
            at("2024-03-05T04:00:00Z"),
          ),
        ],
      },
      {
        name: "shifts that overlap each other",
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T18:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T11:00:00Z"),
            at("2024-03-05T02:00:00Z"),
          ),
        ],
      },
      {
        name: "a shift fully swallowed by an earlier one",
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T00:00:00Z"),
            at("2024-03-06T00:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2024-03-04T11:00:00Z"),
            at("2024-03-04T13:00:00Z"),
          ),
        ],
      },
      {
        name: "zero-length shifts",
        shifts: [
          mkShift("alice", NOW, NOW),
          mkShift(
            "bob",
            at("2024-03-04T18:00:00Z"),
            at("2024-03-04T18:00:00Z"),
          ),
        ],
      },
      {
        name: "an inverted shift whose end precedes its start",
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T18:00:00Z"),
            at("2024-03-04T09:00:00Z"),
          ),
        ],
      },
      {
        name: "shifts lying entirely outside the window",
        shifts: [
          mkShift(
            "alice",
            at("2023-01-01T00:00:00Z"),
            at("2023-01-02T00:00:00Z"),
          ),
          mkShift(
            "bob",
            at("2030-01-01T00:00:00Z"),
            at("2030-01-02T00:00:00Z"),
          ),
        ],
      },
    ];

    for (const scenario of adversarialShiftSets) {
      test(`returns a well-formed state for ${scenario.name}`, () => {
        let state: ScheduleCoverageState | null = null;

        expect(() => {
          state = coverage({
            layerCount: 1,
            assignedUserCount: 2,
            shifts: scenario.shifts,
          });
        }).not.toThrow();

        const resolved: ScheduleCoverageState = state!;

        expect(
          Object.values(ScheduleCoverageStatus).includes(resolved.status),
        ).toBe(true);
        expect(Array.isArray(resolved.gaps)).toBe(true);
        expect(Number.isFinite(resolved.uncoveredSeconds)).toBe(true);
        expect(resolved.uncoveredSeconds).toBeGreaterThanOrEqual(0);
        expect(resolved.coverageRatio).toBeGreaterThanOrEqual(0);
        expect(resolved.coverageRatio).toBeLessThanOrEqual(1);
        expect(resolved.uncoveredSeconds).toBe(sumGapSeconds(resolved.gaps));
      });
    }

    /*
     * A zero-length shift is a degenerate override (start === end). It covers no
     * instant at all, so it must never be presented as the person on call.
     */
    test("a zero-length shift is never resolved as the current shift", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 1,
        assignedUserCount: 1,
        shifts: [mkShift("alice", NOW, NOW)],
      });

      expect(state.current).toBeNull();
      expect(state.status).toBe(ScheduleCoverageStatus.UncoveredNow);
    });

    /*
     * Overlapping shifts come out of the multi-layer priority merge. The
     * overlap must not be double-counted into a gap, and the higher shift must
     * not be mistaken for "up next" while it is already running.
     */
    test("overlapping shifts stay Covered without inventing a gap", () => {
      const state: ScheduleCoverageState = coverage({
        layerCount: 2,
        assignedUserCount: 2,
        shifts: [
          mkShift(
            "alice",
            at("2024-03-04T09:00:00Z"),
            at("2024-03-04T18:00:00Z"),
          ),
          mkShift("bob", at("2024-03-04T11:00:00Z"), WINDOW_END),
        ],
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.gaps).toHaveLength(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.next).toBeNull();
    });
  });
});
