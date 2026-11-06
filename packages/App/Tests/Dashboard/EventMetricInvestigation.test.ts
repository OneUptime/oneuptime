import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import MetricInvestigationTime, {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import {
  ALERT_STARTED_COLOR,
  AROUND_START_LABEL,
  AROUND_START_MINUTES,
  DAY_BEFORE_LABEL,
  EVALUATED_LABEL,
  EVENT_METRIC_DEFAULT_SELECTION,
  EVENT_METRIC_RELATIVE_RANGES,
  EVENT_MOMENT_COLORS,
  EventMetricPresetId,
  EventMetricSubject,
  EventMetricWords,
  EventMoment,
  EventMomentRole,
  EventMomentState,
  HOUR_BEFORE_LABEL,
  START_TO_END_MARGIN_MINUTES,
  START_TO_NOW_LABEL,
  START_TO_RESOLUTION_LABEL,
  getEventMetricTimePresets,
  getEventMetricWords,
  getEventMomentColor,
  getEventMomentLabel,
  getEventMoments,
} from "../../FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";

/*
 * What an incident's, alert's or episode's metric investigation is anchored
 * on (issue #5954): the time ranges it offers around the event, and the
 * moments of the event its charts mark.
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
      getEventMetricTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: EVALUATION_WINDOW },
        LATER,
      );

    expect(
      presets.map((preset: MetricInvestigationTimePreset): string => {
        return preset.id;
      }),
    ).toEqual([
      EventMetricPresetId.AroundStart,
      EventMetricPresetId.HourBefore,
      EventMetricPresetId.DayBefore,
      EventMetricPresetId.StartToEnd,
      EventMetricPresetId.Evaluated,
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
      getEventMetricTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: EVALUATION_WINDOW },
        LATER,
      ),
    );

    // Thirty minutes either side of the start.
    expect(windowOf(byId[EventMetricPresetId.AroundStart])).toEqual({
      start: "2026-11-05T05:14:00.000Z",
      end: "2026-11-05T06:14:00.000Z",
    });
    expect(windowOf(byId[EventMetricPresetId.HourBefore])).toEqual({
      start: "2026-11-05T04:44:00.000Z",
      end: "2026-11-05T05:44:00.000Z",
    });
    expect(windowOf(byId[EventMetricPresetId.DayBefore])).toEqual({
      start: "2026-11-04T05:44:00.000Z",
      end: "2026-11-05T05:44:00.000Z",
    });
    // Open: from fifteen minutes before the start to now.
    expect(windowOf(byId[EventMetricPresetId.StartToEnd])).toEqual({
      start: "2026-11-05T05:29:00.000Z",
      end: LATER.toISOString(),
    });
    expect(byId[EventMetricPresetId.Evaluated]!.window).toBe(EVALUATION_WINDOW);
  });

  test("around the start of an incident that began ten minutes ago ends at now", () => {
    const now: Date = new Date(STARTED_AT.getTime() + 10 * MINUTE_MS);
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets({ startedAt: STARTED_AT }, now),
    );

    expect(windowOf(byId[EventMetricPresetId.AroundStart])).toEqual({
      start: "2026-11-05T05:14:00.000Z",
      end: now.toISOString(),
    });
    expect(windowOf(byId[EventMetricPresetId.StartToEnd]).end).toBe(
      now.toISOString(),
    );
  });

  test("around the start reaches back to all the monitor evaluated", () => {
    const longEvaluation: InBetween<Date> = new InBetween<Date>(
      new Date(STARTED_AT.getTime() - 2 * HOUR_MS),
      STARTED_AT,
    );
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: longEvaluation },
        LATER,
      ),
    );

    expect(windowOf(byId[EventMetricPresetId.AroundStart])).toEqual({
      start: "2026-11-05T03:44:00.000Z",
      end: "2026-11-05T06:14:00.000Z",
    });
  });

  test("a resolved incident runs from before its start to past its resolution", () => {
    const endedAt: Date = at("2026-11-05T07:02:00.000Z");
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets({ startedAt: STARTED_AT, endedAt }, LATER),
    );

    expect(byId[EventMetricPresetId.StartToEnd]!.label).toBe(
      START_TO_RESOLUTION_LABEL,
    );
    expect(windowOf(byId[EventMetricPresetId.StartToEnd])).toEqual({
      start: "2026-11-05T05:29:00.000Z",
      end: "2026-11-05T07:17:00.000Z",
    });
  });

  test("one resolved a moment ago ends at now, not in the future", () => {
    const endedAt: Date = at("2026-11-05T07:02:00.000Z");
    const now: Date = new Date(endedAt.getTime() + 5 * MINUTE_MS);
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets({ startedAt: STARTED_AT, endedAt }, now),
    );

    expect(windowOf(byId[EventMetricPresetId.StartToEnd]).end).toBe(
      now.toISOString(),
    );
  });

  test("a resolution before the start is not one: the event reads as open", () => {
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets(
        {
          startedAt: STARTED_AT,
          endedAt: new Date(STARTED_AT.getTime() - HOUR_MS),
        },
        LATER,
      ),
    );

    expect(byId[EventMetricPresetId.StartToEnd]!.label).toBe(
      START_TO_NOW_LABEL,
    );
  });

  test("without a start, the end of what the monitor evaluated stands in for it", () => {
    const byId: Record<string, MetricInvestigationTimePreset> = presetsById(
      getEventMetricTimePresets({ evaluationWindow: EVALUATION_WINDOW }, LATER),
    );

    expect(windowOf(byId[EventMetricPresetId.HourBefore]).end).toBe(
      EVALUATION_WINDOW.endValue.toISOString(),
    );
  });

  test("without a start or anything evaluated, there is nothing to anchor on", () => {
    expect(getEventMetricTimePresets({}, LATER)).toEqual([]);
    expect(
      getEventMetricTimePresets(
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
      getEventMetricTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: broken },
        LATER,
      ),
    );

    expect(byId[EventMetricPresetId.Evaluated]).toBeUndefined();
    expect(windowOf(byId[EventMetricPresetId.AroundStart]).start).toBe(
      "2026-11-05T05:14:00.000Z",
    );
  });

  test("a reader's clock behind the event still gets windows that can be shown", () => {
    const now: Date = new Date(STARTED_AT.getTime() - 2 * HOUR_MS);
    const presets: Array<MetricInvestigationTimePreset> =
      getEventMetricTimePresets({ startedAt: STARTED_AT }, now);
    const byId: Record<string, MetricInvestigationTimePreset> =
      presetsById(presets);

    expect(presets).toHaveLength(4);
    expect(windowOf(byId[EventMetricPresetId.AroundStart]).end).toBe(
      "2026-11-05T06:14:00.000Z",
    );
    expect(windowOf(byId[EventMetricPresetId.StartToEnd]).end).toBe(
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
      // Now is at or after everything the event knows of.
      const nowMs: number =
        Math.max(startMs, hasEnd ? endMs : startMs) +
        random(7 * 24 * 60) * MINUTE_MS;

      const presets: Array<MetricInvestigationTimePreset> =
        getEventMetricTimePresets(
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
        presetsById(presets)[EventMetricPresetId.AroundStart]!;
      expect(aroundStart.window.startValue.getTime()).toBeLessThanOrEqual(
        Math.min(
          startMs - AROUND_START_MINUTES * MINUTE_MS,
          hasEvaluation ? evaluationStartMs : Number.POSITIVE_INFINITY,
        ),
      );

      const startToEnd: MetricInvestigationTimePreset =
        presetsById(presets)[EventMetricPresetId.StartToEnd]!;
      expect(startToEnd.window.startValue.getTime()).toBe(
        startMs - START_TO_END_MARGIN_MINUTES * MINUTE_MS,
      );
    }
  });
});

describe("the default time range", () => {
  test("is around the start", () => {
    expect(EVENT_METRIC_DEFAULT_SELECTION).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventMetricPresetId.AroundStart,
    });
  });

  test("the ranges relative to now are the few a responder reaches for", () => {
    expect(EVENT_METRIC_RELATIVE_RANGES).toEqual([
      "Past 15 Mins",
      "Past 1 Hour",
      "Past 3 Hours",
      "Past 1 Day",
      "Past 1 Week",
    ]);

    for (const range of EVENT_METRIC_RELATIVE_RANGES) {
      expect(MetricInvestigationTime.isRelativeRange(range)).toBe(true);
    }
  });
});

const STATES: Array<EventMomentState> = [
  { _id: "identified", name: "Identified" },
  { _id: "acknowledged", name: "Acknowledged", isAcknowledgedState: true },
  { _id: "monitoring", name: "  Monitoring  " },
  { _id: "resolved", name: "Resolved", isResolvedState: true },
];

function rolesOf(moments: Array<EventMoment>): Array<string> {
  return moments.map((moment: EventMoment): string => {
    return `${moment.role}:${moment.stateName}@${moment.date.toISOString()}`;
  });
}

describe("the moments of an event", () => {
  test("its start, and every change of state after the one it opened in", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
        { stateId: "acknowledged", startsAt: at("2026-11-05T05:50:00.000Z") },
        { stateId: "monitoring", startsAt: at("2026-11-05T06:30:00.000Z") },
        { stateId: "resolved", startsAt: at("2026-11-05T07:02:00.000Z") },
      ],
      states: STATES,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "acknowledged:Acknowledged@2026-11-05T05:50:00.000Z",
      "state-changed:Monitoring@2026-11-05T06:30:00.000Z",
      "resolved:Resolved@2026-11-05T07:02:00.000Z",
    ]);
  });

  test("a timeline in any order reads in time order, and a reopen is a change too", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T08:00:00.000Z") },
        { stateId: "resolved", startsAt: at("2026-11-05T07:02:00.000Z") },
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
      ],
      states: STATES,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "resolved:Resolved@2026-11-05T07:02:00.000Z",
      "state-changed:Identified@2026-11-05T08:00:00.000Z",
    ]);
  });

  test("when impact started earlier than the start, that is marked too", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      impactStartedAt: at("2026-11-05T05:20:00.000Z"),
      timeline: [],
      states: STATES,
    });

    expect(rolesOf(moments)).toEqual([
      "impact-started:@2026-11-05T05:20:00.000Z",
      "started:@2026-11-05T05:44:00.000Z",
    ]);
  });

  test("an impact start at or after the start says nothing new", () => {
    for (const impactStartedAt of [
      STARTED_AT,
      new Date(STARTED_AT.getTime() + MINUTE_MS),
    ]) {
      expect(
        rolesOf(
          getEventMoments({
            startedAt: STARTED_AT,
            impactStartedAt,
            timeline: [],
            states: STATES,
          }),
        ),
      ).toEqual(["started:@2026-11-05T05:44:00.000Z"]);
    }
  });

  test("with no start, a recorded impact start is still marked", () => {
    expect(
      rolesOf(
        getEventMoments({
          impactStartedAt: at("2026-11-05T05:20:00.000Z"),
          timeline: [],
          states: [],
        }),
      ),
    ).toEqual(["impact-started:@2026-11-05T05:20:00.000Z"]);
  });

  test("a state no longer known is a change with no name; undated entries are skipped", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
        { stateId: "deleted-state", startsAt: at("2026-11-05T06:00:00.000Z") },
        { stateId: "acknowledged" },
        { startsAt: at("2026-11-05T06:10:00.000Z") },
        { stateId: "resolved", startsAt: new Date("nonsense") },
      ],
      states: STATES,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "state-changed:@2026-11-05T06:00:00.000Z",
      "state-changed:@2026-11-05T06:10:00.000Z",
    ]);
  });

  test("nothing known is nothing marked", () => {
    expect(getEventMoments({ timeline: [], states: [] })).toEqual([]);
  });
});

describe("the words for each kind of page", () => {
  test.each([
    [
      EventMetricSubject.Incident,
      "Around this incident",
      "This incident",
      "Declared",
      "incident",
      ChartEventKind.Incident,
    ],
    [
      EventMetricSubject.Alert,
      "Around this alert",
      "This alert",
      "Created",
      "alert",
      ChartEventKind.Alert,
    ],
    [
      EventMetricSubject.IncidentEpisode,
      "Around this episode",
      "This episode",
      "Declared",
      "incident",
      ChartEventKind.Incident,
    ],
    [
      EventMetricSubject.AlertEpisode,
      "Around this episode",
      "This episode",
      "Created",
      "alert",
      ChartEventKind.Alert,
    ],
  ])(
    "%s",
    (
      subject: EventMetricSubject,
      presetsHeading: string,
      momentSubtitle: string,
      startedLabel: string,
      telemetryNoun: string,
      markerKind: ChartEventKind,
    ) => {
      const words: EventMetricWords = getEventMetricWords(subject);

      expect(words.presetsHeading).toBe(presetsHeading);
      expect(words.momentSubtitle).toBe(momentSubtitle);
      expect(words.startedLabel).toBe(startedLabel);
      expect(words.telemetryNoun).toBe(telemetryNoun);
      expect(words.markerKind).toBe(markerKind);
      expect(words.evaluatedSubtitle).toMatch(
        /^What the monitor evaluated when it opened this /,
      );
    },
  );

  test("an unknown kind of page reads as an incident's", () => {
    expect(getEventMetricWords("later" as EventMetricSubject)).toEqual(
      getEventMetricWords(EventMetricSubject.Incident),
    );
  });
});

describe("what a moment is called, and its colour", () => {
  const incidentWords: EventMetricWords = getEventMetricWords(
    EventMetricSubject.Incident,
  );
  const alertWords: EventMetricWords = getEventMetricWords(
    EventMetricSubject.Alert,
  );

  function moment(role: EventMomentRole, stateName: string = ""): EventMoment {
    return { date: STARTED_AT, role, stateName };
  }

  test.each([
    [moment(EventMomentRole.Started), "Declared", false],
    [moment(EventMomentRole.ImpactStarted), "Impact started", false],
    [moment(EventMomentRole.Acknowledged, "Triaged"), "Triaged", true],
    [moment(EventMomentRole.Acknowledged), "Acknowledged", false],
    [moment(EventMomentRole.Resolved, "Fixed"), "Fixed", true],
    [moment(EventMomentRole.Resolved), "Resolved", false],
    [moment(EventMomentRole.StateChanged, "Monitoring"), "Monitoring", true],
    [moment(EventMomentRole.StateChanged), "State changed", false],
  ])(
    "%o is called %s",
    (value: EventMoment, text: string, isStateName: boolean) => {
      expect(getEventMomentLabel(value, incidentWords)).toEqual({
        text,
        isStateName,
      });
    },
  );

  test("an alert's start is called what its page calls it", () => {
    expect(
      getEventMomentLabel(moment(EventMomentRole.Started), alertWords).text,
    ).toBe("Created");
  });

  test("each kind of moment has its own colour, an alert's start its own too", () => {
    for (const role of Object.values(EventMomentRole)) {
      expect(getEventMomentColor(role, incidentWords)).toBe(
        EVENT_MOMENT_COLORS[role],
      );
    }

    expect(getEventMomentColor(EventMomentRole.Started, alertWords)).toBe(
      ALERT_STARTED_COLOR,
    );
    expect(getEventMomentColor(EventMomentRole.Resolved, alertWords)).toBe(
      EVENT_MOMENT_COLORS[EventMomentRole.Resolved],
    );
    expect(
      new Set(Object.values(EVENT_MOMENT_COLORS)).size +
        (Object.values(EVENT_MOMENT_COLORS).includes(ALERT_STARTED_COLOR)
          ? 0
          : 1),
    ).toBe(Object.values(EventMomentRole).length + 1);
  });
});
