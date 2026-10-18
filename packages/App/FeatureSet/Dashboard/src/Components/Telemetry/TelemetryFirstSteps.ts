import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT AN EMPTY LOGS, TRACES, METRICS OR EXCEPTIONS EXPLORER SAYS TO
 * SOMEONE WHO HAS SENT NOTHING YET.
 *
 * The first thing a new project sees on Logs, Traces and Metrics is the
 * explorer over the past hour. With nothing sent yet it said "No logs found.
 * Time range: past 1 hour. Try adjusting filters or expanding the time
 * range." - about filters nobody had set, and with no way to the Setup
 * Guide that would fill it. While nothing narrows the list (no filter chip,
 * no search), the empty explorer now says the data appears here once it is
 * sent, with the setup guide as its one action and a longer range beside
 * it, as AI / LLM Conversations does. A list that a filter or a search
 * emptied keeps its "try adjusting filters" line: that one is right there.
 *
 * Only the product pages pass these: a logs, traces or metrics list
 * embedded in a service, a host or an incident keeps its own message.
 *
 * React-free on purpose: App's tests read these without the explorers.
 */

export enum TelemetryFirstStepsSignal {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  Exceptions = "exceptions",
}

export interface TelemetryFirstStepsCopy {
  title: string;
  description: string;
  // The action that opens the product's Setup Guide tab.
  setupAction: string;
  // The product's own icon, as the products menu draws it.
  icon: IconProp;
  dataTestId: string;
}

export const TELEMETRY_FIRST_STEPS_COPY: Record<
  TelemetryFirstStepsSignal,
  TelemetryFirstStepsCopy
> = {
  [TelemetryFirstStepsSignal.Logs]: {
    title: translationKey("No logs here yet"),
    description: translationKey(
      "Logs appear here as soon as your apps send them.",
    ),
    setupAction: translationKey("Set up logs"),
    icon: IconProp.Logs,
    dataTestId: "logs-first-steps",
  },
  [TelemetryFirstStepsSignal.Traces]: {
    title: translationKey("No traces here yet"),
    description: translationKey(
      "Traces appear here as soon as your apps send them.",
    ),
    setupAction: translationKey("Set up tracing"),
    icon: IconProp.Waterfall,
    dataTestId: "traces-first-steps",
  },
  [TelemetryFirstStepsSignal.Metrics]: {
    title: translationKey("No metrics here yet"),
    description: translationKey(
      "Metrics appear here as soon as your apps or hosts send them.",
    ),
    setupAction: translationKey("Set up metrics"),
    icon: IconProp.Heartbeat,
    dataTestId: "metrics-first-steps",
  },
  /*
   * Exceptions has no longer range to offer: its page shows the first
   * steps only for a project that has no exception at all, in any state at
   * any time (ExceptionsViewer asks once), since an empty Unresolved list
   * of a project that has exceptions is good news, not a missing setup.
   */
  [TelemetryFirstStepsSignal.Exceptions]: {
    title: translationKey("No exceptions here yet"),
    description: translationKey(
      "Exceptions appear here as soon as your apps report them.",
    ),
    setupAction: translationKey("Set up exception tracking"),
    icon: IconProp.Bug,
    dataTestId: "exceptions-first-steps",
  },
};

export const SHOW_PAST_WEEK_ACTION: string =
  translationKey("Show the past week");

// Every preset that already covers at least a week.
const RANGES_OF_A_WEEK_OR_MORE: ReadonlyArray<TimeRange> = [
  TimeRange.PAST_ONE_WEEK,
  TimeRange.PAST_TWO_WEEKS,
  TimeRange.PAST_ONE_MONTH,
  TimeRange.PAST_THREE_MONTHS,
];

const MINUTES_IN_A_WEEK: number = 7 * 24 * 60;

/**
 * Whether the empty explorer offers to look back a week: only while it
 * shows less than that. A custom window is measured; one that already
 * spans a week or more is left alone, since "the past week" would narrow
 * it.
 */
export function offersPastWeek(timeRange: RangeStartAndEndDateTime): boolean {
  if (RANGES_OF_A_WEEK_OR_MORE.includes(timeRange.range)) {
    return false;
  }

  if (timeRange.range !== TimeRange.CUSTOM) {
    return true;
  }

  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

  return (
    OneUptimeDate.getDifferenceInMinutes(window.startValue, window.endValue) <
    MINUTES_IN_A_WEEK
  );
}

export const PAST_WEEK_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_WEEK,
};

/**
 * Whether the list shows the first steps: it came back empty while nothing
 * narrows it - no filter chip the reader added and no search they typed.
 * The chips a page pins (a service's own scope) are not passed here, and a
 * product page pins none.
 */
export function showsTelemetryFirstSteps(data: {
  hasFirstSteps: boolean;
  isEmpty: boolean;
  filterCount: number;
  searchText: string;
}): boolean {
  return (
    data.hasFirstSteps &&
    data.isEmpty &&
    data.filterCount === 0 &&
    data.searchText.trim().length === 0
  );
}
