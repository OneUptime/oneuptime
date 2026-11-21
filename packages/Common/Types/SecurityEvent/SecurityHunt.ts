import OneUptimeDate from "../Date";
import TimeRange from "../Time/TimeRange";
import { DETECTION_EVALUATION_DELAY_IN_SECONDS } from "./DetectionFindingConstants";
import {
  SecurityEventArrivalRange,
  floorToSecond,
  getArrivalEventTimeBounds,
} from "./SecurityEventArrival";
import { writeOwnValue } from "../../Utils/LookupTable";

/*
 * HUNTS: SEARCHES OVER SECURITY EVENTS, SAVED.
 *
 * A hunt is a search over a project's security events, kept with a name:
 * the search bar's text and the sidebar's chips as Security Events > Events
 * draws them, and how far back it looks when it is opened. A team saves the
 * questions it asks again and again - encoded PowerShell, admin sign-ins
 * from a new country, a known-bad domain - and opens any of them in one
 * click, on the Events explorer, to bookmark what it finds onto a case.
 *
 * A hunt can also run on a schedule - every hour, 6 hours, day or week. Each
 * run reads the events that arrived since the one before (never the same
 * events twice), counts what the search finds in them, and, when it finds
 * any, tells the people and teams the hunt names, through each person's
 * notification settings. A run reads only what the person who set the
 * schedule can read, at the moment it runs, so a hunt never learns more
 * than its author could look at. A run opens no case and raises no alert:
 * what should open cases is written as a detection rule.
 *
 * Shared by the server, which keeps and runs hunts (SecurityHuntService,
 * SecurityHuntScheduler), and the Dashboard, which saves, edits and opens
 * them. Each message below is a Dashboard translation key, read from here
 * by the string extractor, so a form shows it in the reader's language and
 * the API answers a save in the same words.
 */

// How often a hunt runs on its own.
export enum SecurityHuntSchedule {
  // Opened by hand only.
  NotScheduled = "Not Scheduled",
  EveryHour = "Every Hour",
  EverySixHours = "Every 6 Hours",
  EveryDay = "Every Day",
  EveryWeek = "Every Week",
}

// In the order the form offers them: not scheduled first, then the shortest.
export const SECURITY_HUNT_SCHEDULES: ReadonlyArray<SecurityHuntSchedule> = [
  SecurityHuntSchedule.NotScheduled,
  SecurityHuntSchedule.EveryHour,
  SecurityHuntSchedule.EverySixHours,
  SecurityHuntSchedule.EveryDay,
  SecurityHuntSchedule.EveryWeek,
];

const SCHEDULE_INTERVAL_IN_MINUTES: Readonly<
  Record<SecurityHuntSchedule, number | null>
> = {
  [SecurityHuntSchedule.NotScheduled]: null,
  [SecurityHuntSchedule.EveryHour]: 60,
  [SecurityHuntSchedule.EverySixHours]: 6 * 60,
  [SecurityHuntSchedule.EveryDay]: 24 * 60,
  [SecurityHuntSchedule.EveryWeek]: 7 * 24 * 60,
};

export function isSecurityHuntSchedule(
  value: unknown,
): value is SecurityHuntSchedule {
  return SECURITY_HUNT_SCHEDULES.includes(value as SecurityHuntSchedule);
}

// How many minutes apart a schedule's runs are; null when it does not run on its own.
export function getSecurityHuntIntervalInMinutes(
  schedule: SecurityHuntSchedule | string | undefined | null,
): number | null {
  if (!isSecurityHuntSchedule(schedule)) {
    return null;
  }

  return SCHEDULE_INTERVAL_IN_MINUTES[schedule];
}

export function isScheduledSecurityHunt(
  schedule: SecurityHuntSchedule | string | undefined | null,
): boolean {
  return getSecurityHuntIntervalInMinutes(schedule) !== null;
}

/*
 * How far back a hunt searches when it is opened: any window the Events
 * page's time picker offers that moves with the clock. A fixed window would
 * open on the same past events forever.
 */
const TIME_RANGE_LENGTH_IN_MINUTES: ReadonlyArray<[TimeRange, number]> = [
  [TimeRange.PAST_FIVE_MINS, 5],
  [TimeRange.PAST_FIFTEEN_MINS, 15],
  [TimeRange.PAST_THIRTY_MINS, 30],
  [TimeRange.PAST_ONE_HOUR, 60],
  [TimeRange.PAST_TWO_HOURS, 2 * 60],
  [TimeRange.PAST_THREE_HOURS, 3 * 60],
  [TimeRange.PAST_ONE_DAY, 24 * 60],
  [TimeRange.PAST_TWO_DAYS, 2 * 24 * 60],
  [TimeRange.PAST_ONE_WEEK, 7 * 24 * 60],
  [TimeRange.PAST_TWO_WEEKS, 14 * 24 * 60],
  [TimeRange.PAST_ONE_MONTH, 30 * 24 * 60],
  [TimeRange.PAST_THREE_MONTHS, 90 * 24 * 60],
];

export const SECURITY_HUNT_TIME_RANGES: ReadonlyArray<TimeRange> =
  TIME_RANGE_LENGTH_IN_MINUTES.map((entry: [TimeRange, number]): TimeRange => {
    return entry[0];
  });

/*
 * A week: long enough to show what a hunt looks for, short enough to read
 * quickly. Saved from Events, a hunt keeps the window the page was on.
 */
export const DEFAULT_SECURITY_HUNT_TIME_RANGE: TimeRange =
  TimeRange.PAST_ONE_WEEK;

export function isSecurityHuntTimeRange(value: unknown): value is TimeRange {
  return SECURITY_HUNT_TIME_RANGES.includes(value as TimeRange);
}

/*
 * The window a hunt saved from a page on a fixed window (a zoom into the
 * chart, a range typed by hand) searches over: the shortest of the moving
 * windows that is at least as long, so it still holds what was on screen.
 */
export function getSecurityHuntTimeRangeForLength(
  lengthInMinutes: number,
): TimeRange {
  for (const [range, minutes] of TIME_RANGE_LENGTH_IN_MINUTES) {
    if (lengthInMinutes <= minutes) {
      return range;
    }
  }

  return TimeRange.PAST_THREE_MONTHS;
}

/*
 * A hunt's chips, as Events draws them: each facet key (a column, or
 * `attributes.<key>` for a source attribute; `!` before it when the values
 * are left out) and the values it names.
 */
export type SecurityHuntFilters = { [facetKey: string]: Array<string> };

/*
 * Limits. A hunt's search is what a person types in one line; its chips are
 * values clicked in a sidebar; it tells a team, not a company.
 */
export const SECURITY_HUNT_NAME_MAX_LENGTH: number = 100;
export const SECURITY_HUNT_DESCRIPTION_MAX_LENGTH: number = 2000;
export const SECURITY_HUNT_SEARCH_MAX_LENGTH: number = 2000;
export const SECURITY_HUNT_FILTER_VALUES_MAX: number = 50;
export const SECURITY_HUNT_FILTER_VALUE_MAX_LENGTH: number = 500;
export const SECURITY_HUNT_RECIPIENTS_MAX: number = 50;
// The most hunts one project keeps.
export const SECURITY_HUNTS_PER_PROJECT_MAX: number = 200;

/*
 * What is wrong with a hunt, in the words the form and the API both say.
 * Kept as `{ message }` objects so the Dashboard's string extractor reads
 * each as a translation key.
 */
export const SECURITY_HUNT_MESSAGES: {
  enterName: { message: string };
  nameTooLong: { message: string };
  descriptionTooLong: { message: string };
  enterSearch: { message: string };
  searchTooLong: { message: string };
  unknownFilter: { message: string };
  tooManyFilterValues: { message: string };
  filterValueTooLong: { message: string };
  unknownSchedule: { message: string };
  unknownTimeRange: { message: string };
  chooseRecipients: { message: string };
  tooManyRecipients: { message: string };
  tooManyHunts: { message: string };
  scheduleNeedsPerson: { message: string };
  oneHuntAtATime: { message: string };
  unknownLibraryHunt: { message: string };
} = {
  enterName: { message: "Enter a name for the hunt." },
  nameTooLong: { message: "A hunt's name is at most 100 characters." },
  descriptionTooLong: {
    message: "A hunt's description is at most 2,000 characters.",
  },
  enterSearch: {
    message:
      "Enter what the hunt searches for, so it does not find every event.",
  },
  searchTooLong: { message: "A hunt's search is at most 2,000 characters." },
  unknownFilter: {
    message: "One of the hunt's filters is not one Events offers.",
  },
  tooManyFilterValues: {
    message: "A hunt keeps at most 50 filter values.",
  },
  filterValueTooLong: {
    message: "A filter value is at most 500 characters.",
  },
  unknownSchedule: { message: "Choose how often the hunt runs." },
  unknownTimeRange: { message: "Choose how far back the hunt searches." },
  chooseRecipients: {
    message:
      "Choose who to tell when the hunt finds something: a person or a team.",
  },
  tooManyRecipients: {
    message: "A hunt tells at most 50 people and teams.",
  },
  tooManyHunts: {
    message:
      "A project keeps at most 200 hunts. Delete one you no longer use, then save this one.",
  },
  scheduleNeedsPerson: {
    message:
      "Only a person can set a hunt's schedule: its runs read what that person can read.",
  },
  oneHuntAtATime: {
    message: "Change the search or the schedule of one hunt at a time.",
  },
  // A hunt saved as one of the Hunt Library's names a starter the library has.
  unknownLibraryHunt: {
    message: "This hunt is not one the Hunt Library offers.",
  },
};

export type SecurityHuntField = "name" | "description" | "searchQuery";

export interface SecurityHuntProblem {
  field: SecurityHuntField;
  message: string;
}

/*
 * What is wrong with a hunt's name, description and search: none, or each
 * problem with its field. The search is the text, and the chips stand in
 * for it - a hunt saved from a sidebar click alone is a search too.
 */
export function getSecurityHuntProblems(data: {
  name?: string | undefined | null;
  description?: string | undefined | null;
  searchQuery?: string | undefined | null;
  filters?: SecurityHuntFilters | undefined | null;
}): Array<SecurityHuntProblem> {
  const problems: Array<SecurityHuntProblem> = [];
  const name: string = (data.name || "").trim();

  if (!name) {
    problems.push({
      field: "name",
      message: SECURITY_HUNT_MESSAGES.enterName.message,
    });
  } else if (name.length > SECURITY_HUNT_NAME_MAX_LENGTH) {
    problems.push({
      field: "name",
      message: SECURITY_HUNT_MESSAGES.nameTooLong.message,
    });
  }

  if ((data.description || "").length > SECURITY_HUNT_DESCRIPTION_MAX_LENGTH) {
    problems.push({
      field: "description",
      message: SECURITY_HUNT_MESSAGES.descriptionTooLong.message,
    });
  }

  const search: string = (data.searchQuery || "").trim();

  if (search.length > SECURITY_HUNT_SEARCH_MAX_LENGTH) {
    problems.push({
      field: "searchQuery",
      message: SECURITY_HUNT_MESSAGES.searchTooLong.message,
    });
  } else if (!search && countSecurityHuntFilterValues(data.filters) === 0) {
    problems.push({
      field: "searchQuery",
      message: SECURITY_HUNT_MESSAGES.enterSearch.message,
    });
  }

  return problems;
}

/*
 * A hunt's chips as kept: each key's values, the empty and the repeated
 * left out, and a key with none dropped. Anything that is not a list of
 * text reads as no chips (a value stored by hand, an old shape).
 */
export function readSecurityHuntFilters(value: unknown): SecurityHuntFilters {
  const filters: SecurityHuntFilters = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return filters;
  }

  for (const [key, values] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!key || !Array.isArray(values)) {
      continue;
    }

    const kept: Array<string> = [];

    for (const item of values) {
      if (typeof item === "string" && item.length > 0 && !kept.includes(item)) {
        kept.push(item);
      }
    }

    /*
     * Each key as the filters' own, as it was stored: assigned, one named
     * "__proto__" (no chip is, and getSecurityHuntFiltersProblem refuses
     * it as one) made its values the filters' prototype, so it was never
     * seen to refuse.
     */
    if (kept.length > 0) {
      writeOwnValue(filters, key, kept);
    }
  }

  return filters;
}

// How many values a hunt's chips name, in all.
export function countSecurityHuntFilterValues(
  filters: SecurityHuntFilters | undefined | null,
): number {
  let count: number = 0;

  for (const values of Object.values(readSecurityHuntFilters(filters))) {
    count += values.length;
  }

  return count;
}

// A hunt's chips as the Events page keeps them: key -> values.
export function securityHuntFiltersToMap(
  filters: SecurityHuntFilters | undefined | null,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(
    readSecurityHuntFilters(filters),
  )) {
    map.set(key, new Set<string>(values));
  }

  return map;
}

// The Events page's chips as a hunt keeps them.
export function securityHuntFiltersFromMap(
  map: Map<string, Set<string>>,
): SecurityHuntFilters {
  const filters: SecurityHuntFilters = {};

  // Each chip's key as the filters' own, as readSecurityHuntFilters reads them.
  for (const [key, values] of map.entries()) {
    writeOwnValue(filters, key, Array.from(values));
  }

  return readSecurityHuntFilters(filters);
}

/*
 * Whether two sets of chips are the same filters: the same keys, each with
 * the same values, in whatever order they were clicked.
 */
export function areSecurityHuntFiltersEqual(
  a: SecurityHuntFilters | undefined | null,
  b: SecurityHuntFilters | undefined | null,
): boolean {
  const left: SecurityHuntFilters = readSecurityHuntFilters(a);
  const right: SecurityHuntFilters = readSecurityHuntFilters(b);
  const leftKeys: Array<string> = Object.keys(left).sort();
  const rightKeys: Array<string> = Object.keys(right).sort();

  if (leftKeys.join("\n") !== rightKeys.join("\n")) {
    return false;
  }

  return leftKeys.every((key: string): boolean => {
    const leftValues: Array<string> = [...(left[key] || [])].sort();
    const rightValues: Array<string> = [...(right[key] || [])].sort();

    return (
      leftValues.length === rightValues.length &&
      leftValues.every((value: string, index: number): boolean => {
        return value === rightValues[index];
      })
    );
  });
}

/*
 * THE SCHEDULE'S RUNS.
 *
 * A run counts the events that ARRIVED since the run before it, whenever
 * they happened (#10488): an event that reached OneUptime late - a span
 * read when it ended, a flow read in whole windows, a cloud audit log that
 * lags, a batch a log shipper held - is counted by the first run after it
 * arrived, once, as a scheduled detection rule judges it (#10337). It
 * counts when it arrived within a day of when it happened
 * (Types/SecurityEvent/SecurityEventArrival): one later than that is stored
 * and searchable, but no run counts it.
 *
 * A run's window is when its events arrived: after where the run before
 * stopped (searchedUpToAt; when the schedule was set, for the first) and up
 * to SECURITY_HUNT_RUN_DELAY_IN_SECONDS behind the clock, as detection rules
 * read, so every event stamped by then is in the table. Both ends are whole
 * seconds, as an event's arrival is kept. A run the workers could not make
 * for a while (an outage, a failed run) reads what came in since, up to
 * SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES more than one interval.
 */
export const SECURITY_HUNT_RUN_DELAY_IN_SECONDS: number =
  DETECTION_EVALUATION_DELAY_IN_SECONDS;

export const SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES: number = 24 * 60;

/*
 * How soon a run that failed is tried again: at its next interval, or
 * within the hour when its interval is longer - a weekly hunt that failed
 * once would otherwise say nothing for a week.
 */
export const SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES: number = 60;

/*
 * When a run's events arrived: after `startTime`, up to and including
 * `endTime` (#10488). A run's history, its hunt's last find and the
 * notification keep it so, and the Events page opens on it
 * (getSecurityHuntRunArrival) with the times those events can have
 * happened in its time range (getSecurityHuntRunEventTimeRange).
 */
export interface SecurityHuntRunWindow {
  // Exclusive: what arrived by then, the run before counted.
  startTime: Date;
  // Inclusive.
  endTime: Date;
}

// Where a schedule set (or a search changed) now starts reading: from now on.
export function getSecurityHuntSearchStart(now: Date): Date {
  return OneUptimeDate.addRemoveSeconds(
    now,
    -SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  );
}

/*
 * The events a run made at `now` counts: those that arrived after where
 * the last one stopped (`searchedUpTo`), up to
 * SECURITY_HUNT_RUN_DELAY_IN_SECONDS before now, on whole seconds. Null
 * when the hunt does not run on its own, or there is nothing new to read.
 */
export function getSecurityHuntRunWindow(data: {
  schedule: SecurityHuntSchedule | string | undefined | null;
  searchedUpTo: Date | undefined | null;
  now: Date;
}): SecurityHuntRunWindow | null {
  const interval: number | null = getSecurityHuntIntervalInMinutes(
    data.schedule,
  );

  if (interval === null) {
    return null;
  }

  const endTime: Date = floorToSecond(getSecurityHuntSearchStart(data.now));
  const earliest: Date = OneUptimeDate.addRemoveMinutes(
    endTime,
    -(interval + SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES),
  );

  /*
   * What arrived after where the run before stopped: its last second is
   * the run before's, so an event that arrived then is counted once.
   */
  let startTime: Date = data.searchedUpTo
    ? floorToSecond(new Date(data.searchedUpTo))
    : OneUptimeDate.addRemoveMinutes(endTime, -interval);

  if (Number.isNaN(startTime.getTime())) {
    startTime = OneUptimeDate.addRemoveMinutes(endTime, -interval);
  }

  if (startTime.getTime() < earliest.getTime()) {
    startTime = earliest;
  }

  if (startTime.getTime() >= endTime.getTime()) {
    return null;
  }

  return { startTime, endTime };
}

// The events a run counted, as a read of what arrived names them.
export function getSecurityHuntRunArrival(
  window: SecurityHuntRunWindow,
): SecurityEventArrivalRange {
  return {
    arrivedAfter: floorToSecond(new Date(window.startTime)),
    arrivedUntil: floorToSecond(new Date(window.endTime)),
  };
}

/*
 * When the events a run counted can have happened: from a day before the
 * first of them arrived to the most a source's clock may run ahead of the
 * last (getArrivalEventTimeBounds). The Events page opens a run on this
 * window, with the run's arrivals as a filter, so every event it counted is
 * listed wherever in the day before it happened.
 */
export function getSecurityHuntRunEventTimeRange(
  window: SecurityHuntRunWindow,
): SecurityHuntRunWindow {
  const happened: { happenedAfter: Date; happenedBefore: Date } =
    getArrivalEventTimeBounds(getSecurityHuntRunArrival(window));

  return {
    startTime: happened.happenedAfter,
    endTime: happened.happenedBefore,
  };
}

/*
 * When a schedule is next due after a run made at `now`: one interval after
 * the time it was due (so a daily hunt keeps its hour), or one interval from
 * now when it ran later than that.
 */
export function getNextSecurityHuntRunAt(data: {
  schedule: SecurityHuntSchedule | string | undefined | null;
  dueAt: Date | undefined | null;
  now: Date;
}): Date | null {
  const interval: number | null = getSecurityHuntIntervalInMinutes(
    data.schedule,
  );

  if (interval === null) {
    return null;
  }

  if (data.dueAt) {
    const next: Date = OneUptimeDate.addRemoveMinutes(
      new Date(data.dueAt),
      interval,
    );

    if (next.getTime() > data.now.getTime()) {
      return next;
    }
  }

  return OneUptimeDate.addRemoveMinutes(data.now, interval);
}

// When a run that failed at `now` is tried again.
export function getSecurityHuntRetryAt(data: {
  schedule: SecurityHuntSchedule | string | undefined | null;
  now: Date;
}): Date | null {
  const interval: number | null = getSecurityHuntIntervalInMinutes(
    data.schedule,
  );

  if (interval === null) {
    return null;
  }

  return OneUptimeDate.addRemoveMinutes(
    data.now,
    Math.min(interval, SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES),
  );
}

/*
 * Why a run could not be made, in words the hunt's list says under its
 * name. Dashboard translation keys, like the problems above.
 */
export const SECURITY_HUNT_RUN_ERRORS: {
  schedulerCannotRead: { message: string };
  timedOut: { message: string };
  searchFailed: { message: string };
  watchlistMissing: { message: string };
} = {
  schedulerCannotRead: {
    message:
      "The person it runs as can no longer read security events in this project. Edit the hunt and save it to run it as you.",
  },
  timedOut: {
    message:
      "Its search took too long and was stopped. Narrow it with a field, such as user: or host:, rather than words alone.",
  },
  searchFailed: {
    message: "Its search could not be run. Open the hunt to check it.",
  },
  watchlistMissing: {
    message:
      "Its search reads a watchlist this project no longer has. Open the hunt to fix its search.",
  },
};

/*
 * RUN HISTORY.
 *
 * Every scheduled run that read events is kept as a row of its own
 * (SecurityHuntRun): when it ran, the window of events it searched, how
 * many its search found - or why it could not be made. A hunt's page lists
 * them, newest first (Run History), each run that found something with the
 * way to show what it found.
 *
 * A run with nothing new to read yet (its window empty) is no run: it read
 * nothing, and nothing is kept.
 *
 * The rows are kept SECURITY_HUNT_RUN_RETENTION_IN_DAYS: long enough to
 * answer "what did this hunt find last month", short enough that an hourly
 * hunt - 24 runs a day - does not grow without bound.
 */
export const SECURITY_HUNT_RUN_RETENTION_IN_DAYS: number = 90;

// What one run came to, as its row in the history says it.
export enum SecurityHuntRunResult {
  // Its search found events in its window.
  Found = "found",
  // It searched its window and found nothing.
  NothingFound = "nothing-found",
  // It could not be made (its error says why); its window is searched again.
  Failed = "failed",
}

export function getSecurityHuntRunResult(run: {
  eventCount?: number | undefined | null;
  error?: string | undefined | null;
}): SecurityHuntRunResult {
  if (run.error) {
    return SecurityHuntRunResult.Failed;
  }

  return (run.eventCount || 0) > 0
    ? SecurityHuntRunResult.Found
    : SecurityHuntRunResult.NothingFound;
}
