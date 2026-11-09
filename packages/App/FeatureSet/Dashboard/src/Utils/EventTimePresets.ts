import InBetween from "Common/Types/BaseDatabase/InBetween";
import TimeRange from "Common/Types/Time/TimeRange";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import MetricInvestigationTime, {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
} from "../Components/Metrics/Investigation/MetricInvestigationTime";

/*
 * The time ranges an incident's, alert's or episode's cards offer around
 * the event: the metric investigation of a metrics monitor's event (issue
 * #5954) and of the incident's Root Cause page (issue #6249), and the
 * logs, traces or exceptions of a log, trace or exception monitor's event
 * (issue #6251). Every card lists the same ranges, in the same order and
 * under the same names; each starts on its own default (the metrics around
 * the start, the logs on what the monitor saw).
 *
 * Worked out for a given "now", the moment the card last resolved its
 * window, so nothing moves between the reader's picks and refreshes.
 */

export enum EventTimePresetId {
  AroundStart = "around-start",
  HourBefore = "hour-before",
  DayBefore = "day-before",
  StartToEnd = "start-to-end",
  Evaluated = "evaluated",
}

// The ranges' names, in English; looked up where they are shown.
export const AROUND_START_LABEL: string = translationKey("Around the start");
export const HOUR_BEFORE_LABEL: string = translationKey(
  "The hour before it started",
);
export const DAY_BEFORE_LABEL: string = translationKey(
  "The day before it started",
);
export const START_TO_NOW_LABEL: string = translationKey("Start to now");
export const START_TO_RESOLUTION_LABEL: string = translationKey(
  "Start to resolution",
);
export const EVALUATED_LABEL: string = translationKey("What the monitor saw");

// How far "Around the start" reaches on either side of the start.
export const AROUND_START_MINUTES: number = 30;

/*
 * How far "Start to now" and "Start to resolution" reach before the start
 * and past the resolution, so the start and the end are not on the charts'
 * very edges.
 */
export const START_TO_END_MARGIN_MINUTES: number = 15;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * The ranges relative to now an event's cards offer besides its own: is it
 * still happening, and what has the metric, or the service, done lately.
 */
export const EVENT_RELATIVE_TIME_RANGES: Array<TimeRange> = [
  TimeRange.PAST_FIFTEEN_MINS,
  TimeRange.PAST_ONE_HOUR,
  TimeRange.PAST_THREE_HOURS,
  TimeRange.PAST_ONE_DAY,
  TimeRange.PAST_ONE_WEEK,
];

/*
 * What an event's metrics show before anybody picks anything: the window
 * around its start, which takes in all the monitor evaluated.
 */
export const EVENT_AROUND_START_SELECTION: MetricInvestigationTimeSelection = {
  kind: MetricInvestigationTimeKind.Preset,
  presetId: EventTimePresetId.AroundStart,
};

/*
 * What an event's logs, traces or exceptions show before anybody picks
 * anything: exactly the window the monitor evaluated when it opened the
 * event, as they always have.
 */
export const EVENT_EVALUATED_SELECTION: MetricInvestigationTimeSelection = {
  kind: MetricInvestigationTimeKind.Preset,
  presetId: EventTimePresetId.Evaluated,
};

export interface EventTimeAnchors {
  // When it was declared (an incident) or created (an alert).
  startedAt?: Date | null | undefined;
  // When it was resolved, while it still is; absent while it is open.
  endedAt?: Date | null | undefined;
  // The window the monitor evaluated when it opened it, when it kept one.
  evaluationWindow?: InBetween<Date> | null | undefined;
}

type ToMsFunction = (value: Date | null | undefined) => number;

const toMs: ToMsFunction = (value: Date | null | undefined): number => {
  if (!(value instanceof Date)) {
    return Number.NaN;
  }

  return value.getTime();
};

type WindowFunction = (startMs: number, endMs: number) => InBetween<Date>;

const toWindow: WindowFunction = (
  startMs: number,
  endMs: number,
): InBetween<Date> => {
  return new InBetween<Date>(new Date(startMs), new Date(endMs));
};

/*
 * The time ranges an event's cards offer, in the order the picker lists
 * them:
 *
 * - Around the start: 30 minutes on either side of the start, and from the
 *   start of what the monitor evaluated when that began earlier, so it
 *   always shows everything the monitor looked at. Never past now.
 * - The hour before it started, and the day before it started: how it built
 *   up. Both end at the start.
 * - Start to now (open) or Start to resolution (resolved): the whole event,
 *   15 minutes either side.
 * - What the monitor saw: exactly the window the monitor evaluated, when
 *   the event kept one.
 *
 * Without a start the event has nothing to anchor on but what the monitor
 * evaluated: its end stands in for the start. Without either, there is
 * nothing to offer.
 */
export function getEventTimePresets(
  anchors: EventTimeAnchors,
  now: Date,
): Array<MetricInvestigationTimePreset> {
  const nowMs: number = toMs(now);
  const evaluationWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(anchors.evaluationWindow);

  let startMs: number = toMs(anchors.startedAt);

  if (!Number.isFinite(startMs) && evaluationWindow) {
    startMs = evaluationWindow.endValue.getTime();
  }

  const presets: Array<MetricInvestigationTimePreset> = [];

  if (Number.isFinite(startMs)) {
    /*
     * An end at now, except where the reader's clock is behind the event's
     * (a window that would end before it starts): then the window ends
     * where it would have.
     */
    const endAtNowOr: (windowStartMs: number, endMs: number) => number = (
      windowStartMs: number,
      endMs: number,
    ): number => {
      if (Number.isFinite(nowMs) && nowMs < endMs && nowMs > windowStartMs) {
        return nowMs;
      }

      return endMs;
    };

    let aroundStartMs: number = startMs - AROUND_START_MINUTES * MINUTE_MS;

    if (evaluationWindow) {
      aroundStartMs = Math.min(
        aroundStartMs,
        evaluationWindow.startValue.getTime(),
      );
    }

    presets.push({
      id: EventTimePresetId.AroundStart,
      label: AROUND_START_LABEL,
      window: toWindow(
        aroundStartMs,
        endAtNowOr(aroundStartMs, startMs + AROUND_START_MINUTES * MINUTE_MS),
      ),
    });

    presets.push({
      id: EventTimePresetId.HourBefore,
      label: HOUR_BEFORE_LABEL,
      window: toWindow(startMs - HOUR_MS, startMs),
    });

    presets.push({
      id: EventTimePresetId.DayBefore,
      label: DAY_BEFORE_LABEL,
      window: toWindow(startMs - DAY_MS, startMs),
    });

    const endedMs: number = toMs(anchors.endedAt);
    const isResolved: boolean = Number.isFinite(endedMs) && endedMs >= startMs;
    const fromMs: number = startMs - START_TO_END_MARGIN_MINUTES * MINUTE_MS;

    if (isResolved) {
      presets.push({
        id: EventTimePresetId.StartToEnd,
        label: START_TO_RESOLUTION_LABEL,
        window: toWindow(
          fromMs,
          endAtNowOr(fromMs, endedMs + START_TO_END_MARGIN_MINUTES * MINUTE_MS),
        ),
      });
    } else {
      presets.push({
        id: EventTimePresetId.StartToEnd,
        label: START_TO_NOW_LABEL,
        window: toWindow(
          fromMs,
          Number.isFinite(nowMs) && nowMs > fromMs
            ? nowMs
            : startMs + START_TO_END_MARGIN_MINUTES * MINUTE_MS,
        ),
      });
    }
  }

  if (evaluationWindow) {
    presets.push({
      id: EventTimePresetId.Evaluated,
      label: EVALUATED_LABEL,
      window: evaluationWindow,
    });
  }

  return presets.filter((preset: MetricInvestigationTimePreset): boolean => {
    return MetricInvestigationTime.isUsableWindow(preset.window);
  });
}
