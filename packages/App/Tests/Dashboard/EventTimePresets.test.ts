import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import MetricInvestigationTime, {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import {
  AROUND_START_LABEL,
  AROUND_START_MINUTES,
  DAY_BEFORE_LABEL,
  EVALUATED_LABEL,
  EVENT_AROUND_START_SELECTION,
  EVENT_EVALUATED_SELECTION,
  EVENT_RELATIVE_TIME_RANGES,
  EventTimePresetId,
  HOUR_BEFORE_LABEL,
  START_TO_END_MARGIN_MINUTES,
  START_TO_NOW_LABEL,
  START_TO_RESOLUTION_LABEL,
  getEventTimePresets,
} from "../../FeatureSet/Dashboard/src/Utils/EventTimePresets";

/*
 * The time ranges every card of an incident, alert or episode offers
 * around the event: its metrics (issue #5954), its Root Cause page's
 * metrics (issue #6249), and its logs, traces or exceptions (issue #6251).
 * The same ranges, in the same order, under the same names; each card
 * starts on its own default.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATION_WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);
// Long after the start: nothing is cut short at now.
const LATER: Date = new Date("2026-11-06T12:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

function presetsById(
  presets: Array<MetricInvestigationTimePreset>,
): Record<string, MetricInvestigationTimePreset> {
  const byId: Record<string, MetricInvestigationTimePreset> = {};

  for (const preset of presets) {
    byId[preset.id] = preset;
  }

  return byId;
}

function windowOf(preset: MetricInvestigationTimePreset | undefined): {
  start: string;
  end: string;
} {
  return {
    start: preset!.window.startValue.toISOString(),
    end: preset!.window.endValue.toISOString(),
  };
}

describe("the time ranges around an event", () => {
  test("an open incident with what the monitor evaluated gets all five, in the picker's order", () => {
    const presets: Array<MetricInvestigationTimePreset> =
      getEventTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: EVALUATION_WINDOW },
        LATER,
      );

    expect(
      presets.map((preset: MetricInvestigationTimePreset): string => {
        return preset.id;
      }),
    ).toEqual([
      EventTimePresetId.AroundStart,
      EventTimePresetId.HourBefore,
      EventTimePresetId.DayBefore,
      EventTimePresetId.StartToEnd,
      EventTimePresetId.Evaluated,
    ]);
    expect(
      presets.map((preset: MetricInvestigationTimePreset): string => {
        return preset.label;
      }),
    ).toEqual([
      AROUND_START_LABEL,
      HOUR_BEFORE_LABEL,
      DAY_BEFORE_LABEL,
      START_TO_NOW_LABEL,
      EVALUATED_LABEL,
    ]);
  });

  test("each range covers what its name says", () => {
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: EVALUATION_WINDOW },
        LATER,
      ),
    );

    // Thirty minutes either side of the start.
    expect(windowOf(byId[EventTimePresetId.AroundStart])).toEqual({
      start: "2026-11-05T05:14:00.000Z",
      end: "2026-11-05T06:14:00.000Z",
    });
    expect(windowOf(byId[EventTimePresetId.HourBefore])).toEqual({
      start: "2026-11-05T04:44:00.000Z",
      end: "2026-11-05T05:44:00.000Z",
    });
    expect(windowOf(byId[EventTimePresetId.DayBefore])).toEqual({
      start: "2026-11-04T05:44:00.000Z",
      end: "2026-11-05T05:44:00.000Z",
    });
    // Open: from fifteen minutes before the start to now.
    expect(windowOf(byId[EventTimePresetId.StartToEnd])).toEqual({
      start: "2026-11-05T05:29:00.000Z",
      end: LATER.toISOString(),
    });
    expect(byId[EventTimePresetId.Evaluated]!.window).toBe(EVALUATION_WINDOW);
  });

  test("around the start of an incident that began ten minutes ago ends at now", () => {
    const now: Date = new Date(STARTED_AT.getTime() + 10 * MINUTE_MS);
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets({ startedAt: STARTED_AT }, now),
    );

    expect(windowOf(byId[EventTimePresetId.AroundStart])).toEqual({
      start: "2026-11-05T05:14:00.000Z",
      end: now.toISOString(),
    });
    expect(windowOf(byId[EventTimePresetId.StartToEnd]).end).toBe(
      now.toISOString(),
    );
  });

  test("around the start reaches back to all the monitor evaluated", () => {
    const longEvaluation: InBetween<Date> = new InBetween<Date>(
      new Date(STARTED_AT.getTime() - 2 * HOUR_MS),
      STARTED_AT,
    );
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: longEvaluation },
        LATER,
      ),
    );

    expect(windowOf(byId[EventTimePresetId.AroundStart])).toEqual({
      start: "2026-11-05T03:44:00.000Z",
      end: "2026-11-05T06:14:00.000Z",
    });
  });

  test("a resolved incident runs from before its start to past its resolution", () => {
    const endedAt: Date = at("2026-11-05T07:02:00.000Z");
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets({ startedAt: STARTED_AT, endedAt }, LATER),
    );

    expect(byId[EventTimePresetId.StartToEnd]!.label).toBe(
      START_TO_RESOLUTION_LABEL,
    );
    expect(windowOf(byId[EventTimePresetId.StartToEnd])).toEqual({
      start: "2026-11-05T05:29:00.000Z",
      end: "2026-11-05T07:17:00.000Z",
    });
  });

  test("one resolved a moment ago ends at now, not in the future", () => {
    const endedAt: Date = at("2026-11-05T07:02:00.000Z");
    const now: Date = new Date(endedAt.getTime() + 5 * MINUTE_MS);
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets({ startedAt: STARTED_AT, endedAt }, now),
    );

    expect(windowOf(byId[EventTimePresetId.StartToEnd]).end).toBe(
      now.toISOString(),
    );
  });

  test("a resolution before the start is not one: the event reads as open", () => {
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets(
        {
          startedAt: STARTED_AT,
          endedAt: new Date(STARTED_AT.getTime() - HOUR_MS),
        },
        LATER,
      ),
    );

    expect(byId[EventTimePresetId.StartToEnd]!.label).toBe(
      START_TO_NOW_LABEL,
    );
  });

  test("without a start, the end of what the monitor evaluated stands in for it", () => {
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets({ evaluationWindow: EVALUATION_WINDOW }, LATER),
    );

    expect(windowOf(byId[EventTimePresetId.HourBefore]).end).toBe(
      EVALUATION_WINDOW.endValue.toISOString(),
    );
  });

  test("without a start or anything evaluated, there is nothing to anchor on", () => {
    expect(getEventTimePresets({}, LATER)).toEqual([]);
    expect(
      getEventTimePresets(
        { startedAt: new Date("nonsense"), evaluationWindow: null },
        LATER,
      ),
    ).toEqual([]);
  });

  test("a window the monitor kept broken is not offered, nor widens around the start", () => {
    const broken: InBetween<Date> = new InBetween<Date>(
      new Date(STARTED_AT.getTime() + HOUR_MS),
      new Date(STARTED_AT.getTime() - 6 * HOUR_MS),
    );
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: broken },
        LATER,
      ),
    );

    expect(byId[EventTimePresetId.Evaluated]).toBeUndefined();
    expect(windowOf(byId[EventTimePresetId.AroundStart]).start).toBe(
      "2026-11-05T05:14:00.000Z",
    );
  });

  test("a reader's clock behind the event still gets windows that can be shown", () => {
    const now: Date = new Date(STARTED_AT.getTime() - 2 * HOUR_MS);
    const presets: Array<MetricInvestigationTimePreset> =
      getEventTimePresets({ startedAt: STARTED_AT }, now);
    const byId: Record<string, MetricInvestigationTimePreset> =
      presetsById(presets);

    expect(presets).toHaveLength(4);
    expect(windowOf(byId[EventTimePresetId.AroundStart]).end).toBe(
      "2026-11-05T06:14:00.000Z",
    );
    expect(windowOf(byId[EventTimePresetId.StartToEnd]).end).toBe(
      "2026-11-05T05:59:00.000Z",
    );
  });

  test("every range can be shown, ids are unique, and none ends after now (seeded)", () => {
    const random: SeededRandom = seededRandom(5954);

    for (let draw: number = 0; draw < 500; draw++) {
      const startMs: number =
        Date.UTC(2024, 0, 1) + random(2 * 365 * 24 * 60) * MINUTE_MS;
      const hasEnd: boolean = random(2) === 0;
      const endMs: number = startMs + random(3 * 24 * 60) * MINUTE_MS;
      const hasEvaluation: boolean = random(3) !== 0;
      const evaluationEndMs: number = startMs - random(5) * MINUTE_MS;
      const evaluationStartMs: number =
        evaluationEndMs - (1 + random(24 * 60)) * MINUTE_MS;
      /*
       * Now is at or after everything the event knows of: half the time
       * within the hour after it, where "never past now" cuts windows short.
       */
      const lagMinutes: number =
        random(2) === 0 ? random(60) : random(7 * 24 * 60);
      const nowMs: number =
        Math.max(startMs, hasEnd ? endMs : startMs) + lagMinutes * MINUTE_MS;

      const presets: Array<MetricInvestigationTimePreset> =
        getEventTimePresets(
          {
            startedAt: new Date(startMs),
            endedAt: hasEnd ? new Date(endMs) : undefined,
            evaluationWindow: hasEvaluation
              ? new InBetween<Date>(
                  new Date(evaluationStartMs),
                  new Date(evaluationEndMs),
                )
              : null,
          },
          new Date(nowMs),
        );

      const ids: Array<string> = presets.map(
        (preset: MetricInvestigationTimePreset): string => {
          return preset.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
      expect(presets.length).toBe(hasEvaluation ? 5 : 4);

      for (const preset of presets) {
        expect(MetricInvestigationTime.isUsableWindow(preset.window)).toBe(
          true,
        );
        expect(preset.window.endValue.getTime()).toBeLessThanOrEqual(nowMs);
      }

      // Around the start always holds the start and all that was evaluated.
      const aroundStart: MetricInvestigationTimePreset =
        presetsById(presets)[EventTimePresetId.AroundStart]!;
      expect(aroundStart.window.startValue.getTime()).toBeLessThanOrEqual(
        Math.min(
          startMs - AROUND_START_MINUTES * MINUTE_MS,
          hasEvaluation ? evaluationStartMs : Number.POSITIVE_INFINITY,
        ),
      );

      const startToEnd: MetricInvestigationTimePreset =
        presetsById(presets)[EventTimePresetId.StartToEnd]!;
      expect(startToEnd.window.startValue.getTime()).toBe(
        startMs - START_TO_END_MARGIN_MINUTES * MINUTE_MS,
      );
    }
  });
});

describe("the default time ranges", () => {
  test("an event's metrics start around the start", () => {
    expect(EVENT_AROUND_START_SELECTION).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.AroundStart,
    });
  });

  test("its logs, traces and exceptions start on what the monitor saw, as they always did", () => {
    expect(EVENT_EVALUATED_SELECTION).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.Evaluated,
    });
  });

  test("each default is a range the event offers, and shows exactly its window", () => {
    const presets: Array<MetricInvestigationTimePreset> = getEventTimePresets(
      { startedAt: STARTED_AT, evaluationWindow: EVALUATION_WINDOW },
      LATER,
    );

    for (const selection of [
      EVENT_AROUND_START_SELECTION,
      EVENT_EVALUATED_SELECTION,
    ]) {
      expect(
        MetricInvestigationTime.getDefaultSelection({
          presets: presets,
          preferred: selection,
        }),
      ).toBe(selection);
    }

    // What the monitor saw is the window it kept, to the millisecond.
    expect(
      MetricInvestigationTime.resolveWindow({
        selection: EVENT_EVALUATED_SELECTION,
        presets: presets,
        now: LATER,
      }),
    ).toEqual(EVALUATION_WINDOW);
  });

  test("an event that kept no window has no 'What the monitor saw': that default falls back to the first range", () => {
    const presets: Array<MetricInvestigationTimePreset> = getEventTimePresets(
      { startedAt: STARTED_AT },
      LATER,
    );

    expect(
      MetricInvestigationTime.isUsableSelection(
        EVENT_EVALUATED_SELECTION,
        presets,
      ),
    ).toBe(false);
    expect(
      MetricInvestigationTime.getDefaultSelection({
        presets: presets,
        preferred: EVENT_EVALUATED_SELECTION,
      }),
    ).toEqual(EVENT_AROUND_START_SELECTION);
  });

  test("the preset ids are the ones links already carry", () => {
    // A link from before the presets were shared still opens on its range.
    expect(Object.values(EventTimePresetId)).toEqual([
      "around-start",
      "hour-before",
      "day-before",
      "start-to-end",
      "evaluated",
    ]);
  });

  test("the ranges relative to now are the few a responder reaches for", () => {
    expect(EVENT_RELATIVE_TIME_RANGES).toEqual([
      "Past 15 Mins",
      "Past 1 Hour",
      "Past 3 Hours",
      "Past 1 Day",
      "Past 1 Week",
    ]);

    for (const range of EVENT_RELATIVE_TIME_RANGES) {
      expect(MetricInvestigationTime.isRelativeRange(range)).toBe(true);
    }
  });
});
