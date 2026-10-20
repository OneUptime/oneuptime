import {
  EXTERNAL_CALENDAR_FUTURE_DAYS,
  EXTERNAL_CALENDAR_MAX_EVENTS,
  EXTERNAL_CALENDAR_MAX_TITLE_LENGTH,
  EXTERNAL_CALENDAR_PAST_DAYS,
  ExternalCalendarReadError,
} from "../../../../Types/ScheduledMaintenance/ExternalCalendar";
import {
  PreparedExternalCalendarText,
  cleanExternalCalendarTitle,
  prepareExternalCalendarText,
} from "./ExternalCalendarText";
import moment from "moment-timezone";
import path from "path";
import { Worker } from "worker_threads";

/*
 * A calendar's events, worked out from its text: every repeating event
 * (RRULE, RDATE, EXDATE, and the occurrences a RECURRENCE-ID moves or calls
 * off) once for each time it happens in the window, in its own time zone
 * (VTIMEZONE), all-day events as dates.
 *
 * The text is untrusted, so the work is fenced in three ways:
 *
 *   1. ExternalCalendarText drops every line this never reads, and any too
 *      long to be a title, a time or a rule, in one linear pass;
 *   2. ical.js runs in a worker thread (ExternalCalendarExpansionWorker.cjs)
 *      with a memory cap, a step budget for repeating events, and a time
 *      limit after which it is terminated - a rule written never to match,
 *      on which ical.js never returns, costs a thread for the limit and
 *      nothing else;
 *   3. what the worker answers is checked field by field before anything
 *      is kept.
 *
 * Kept: the events of the window (EXTERNAL_CALENDAR_PAST_DAYS back,
 * EXTERNAL_CALENDAR_FUTURE_DAYS ahead), at most EXTERNAL_CALENDAR_MAX_EVENTS
 * of them - those nearest now when there are more - sorted by start.
 */

// How long the worker may take before it is terminated.
export const EXTERNAL_CALENDAR_EXPANSION_TIME_LIMIT_IN_MS: number = 10 * 1000;

// Recurrence steps for the whole calendar, and for one repeating event.
export const EXTERNAL_CALENDAR_MAX_RECURRENCE_STEPS: number = 200000;
export const EXTERNAL_CALENDAR_MAX_RECURRENCE_STEPS_PER_EVENT: number = 50000;

// The most occurrences the worker sends back, before the window is applied exactly.
export const EXTERNAL_CALENDAR_MAX_RAW_OCCURRENCES: number = 20000;

// The worker's heap, in megabytes.
export const EXTERNAL_CALENDAR_WORKER_MEMORY_IN_MB: number = 192;

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

export const EXTERNAL_CALENDAR_WORKER_PATH: string = path.join(
  __dirname,
  "ExternalCalendarExpansionWorker.cjs",
);

export interface ExternalCalendarWindow {
  start: Date;
  end: Date;
}

export interface ExternalCalendarEventToKeep {
  title: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
}

export type ExternalCalendarExpansionResult =
  | {
      ok: true;
      events: Array<ExternalCalendarEventToKeep>;
      // Events of the window the calendar holds, kept or not.
      eventsInWindow: number;
      // More than EXTERNAL_CALENDAR_MAX_EVENTS, or a limit cut the reading short.
      hasMoreEvents: boolean;
      // Repeating events left out: too many steps, or a rule ical.js refused.
      skippedSeries: number;
    }
  | {
      ok: false;
      error:
        | ExternalCalendarReadError.NotACalendar
        | ExternalCalendarReadError.TooComplex;
    };

export interface ExternalCalendarExpansionOptions {
  now: Date;
  // Tests shorten these.
  timeLimitInMs?: number | undefined;
  maxSteps?: number | undefined;
  maxStepsPerEvent?: number | undefined;
  maxRawOccurrences?: number | undefined;
  maxEvents?: number | undefined;
}

// A time as the worker sends it (see the worker's header).
type RawTime =
  | { kind: "instant"; ms: number }
  | { kind: "date"; year: number; month: number; day: number }
  | {
      kind: "wall";
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
      tzid: string | null;
    };

interface RawOccurrence {
  uid: string;
  title: string;
  isPrivate: boolean;
  start: RawTime;
  end: RawTime;
}

interface WorkerSuccess {
  ok: true;
  calendarTimezone: string | null;
  occurrences: Array<RawOccurrence>;
  skippedSeries: number;
  hitStepLimit: boolean;
  hitOccurrenceLimit: boolean;
}

type WorkerAnswer = WorkerSuccess | { ok: false; reason: "NotACalendar" };

// Why the worker did not answer.
enum WorkerFailure {
  TimedOut = "TimedOut",
  Crashed = "Crashed",
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWholeNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export default class ExternalCalendarExpansion {
  // The window of events kept, around `now`: whole days in UTC.
  public static getWindow(now: Date): ExternalCalendarWindow {
    const today: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return {
      start: new Date(today - EXTERNAL_CALENDAR_PAST_DAYS * MILLISECONDS_PER_DAY),
      end: new Date(
        today + (EXTERNAL_CALENDAR_FUTURE_DAYS + 1) * MILLISECONDS_PER_DAY,
      ),
    };
  }

  public static async expand(
    text: string,
    options: ExternalCalendarExpansionOptions,
  ): Promise<ExternalCalendarExpansionResult> {
    const prepared: PreparedExternalCalendarText | null =
      prepareExternalCalendarText(text);

    if (!prepared) {
      return { ok: false, error: ExternalCalendarReadError.NotACalendar };
    }

    const window: ExternalCalendarWindow = this.getWindow(options.now);

    const answer: WorkerAnswer | WorkerFailure = await this.runWorker(
      {
        text: prepared.text,
        // A day wider each side: times with no zone are compared as UTC there.
        windowStartMs: window.start.getTime() - MILLISECONDS_PER_DAY,
        windowEndMs: window.end.getTime() + MILLISECONDS_PER_DAY,
        maxSteps: options.maxSteps ?? EXTERNAL_CALENDAR_MAX_RECURRENCE_STEPS,
        maxStepsPerSeries:
          options.maxStepsPerEvent ??
          EXTERNAL_CALENDAR_MAX_RECURRENCE_STEPS_PER_EVENT,
        maxOccurrences:
          options.maxRawOccurrences ?? EXTERNAL_CALENDAR_MAX_RAW_OCCURRENCES,
      },
      options.timeLimitInMs ?? EXTERNAL_CALENDAR_EXPANSION_TIME_LIMIT_IN_MS,
    );

    if (answer === WorkerFailure.TimedOut || answer === WorkerFailure.Crashed) {
      return { ok: false, error: ExternalCalendarReadError.TooComplex };
    }

    if (!answer.ok) {
      return { ok: false, error: ExternalCalendarReadError.NotACalendar };
    }

    return this.toEvents({
      answer: answer,
      window: window,
      now: options.now,
      maxEvents: options.maxEvents ?? EXTERNAL_CALENDAR_MAX_EVENTS,
    });
  }

  /*
   * Runs the worker on `input`, terminating it after `timeLimitInMs`. Any
   * answer that is not one of the worker's two shapes counts as a crash.
   */
  private static async runWorker(
    input: {
      text: string;
      windowStartMs: number;
      windowEndMs: number;
      maxSteps: number;
      maxStepsPerSeries: number;
      maxOccurrences: number;
    },
    timeLimitInMs: number,
  ): Promise<WorkerAnswer | WorkerFailure> {
    return await new Promise<WorkerAnswer | WorkerFailure>(
      (resolve: (value: WorkerAnswer | WorkerFailure) => void) => {
        let isSettled: boolean = false;
        let worker: Worker;

        try {
          worker = new Worker(EXTERNAL_CALENDAR_WORKER_PATH, {
            workerData: input,
            resourceLimits: {
              maxOldGenerationSizeMb: EXTERNAL_CALENDAR_WORKER_MEMORY_IN_MB,
              maxYoungGenerationSizeMb: 32,
              stackSizeMb: 4,
            },
            stdout: true,
            stderr: true,
          });
        } catch {
          resolve(WorkerFailure.Crashed);
          return;
        }

        const settle: (value: WorkerAnswer | WorkerFailure) => void = (
          value: WorkerAnswer | WorkerFailure,
        ): void => {
          if (isSettled) {
            return;
          }

          isSettled = true;
          clearTimeout(timer);
          resolve(value);
          // Its answer is in; whatever it is still doing is not wanted.
          worker.terminate().catch(() => {
            // Already gone.
          });
        };

        const timer: NodeJS.Timeout = setTimeout(() => {
          settle(WorkerFailure.TimedOut);
        }, timeLimitInMs);

        worker.once("message", (message: unknown) => {
          settle(this.readWorkerAnswer(message) ?? WorkerFailure.Crashed);
        });

        worker.once("error", () => {
          settle(WorkerFailure.Crashed);
        });

        worker.once("exit", () => {
          settle(WorkerFailure.Crashed);
        });
      },
    );
  }

  // The worker's answer, if it has one of the two shapes; null otherwise.
  public static readWorkerAnswer(message: unknown): WorkerAnswer | null {
    if (!message || typeof message !== "object") {
      return null;
    }

    const value: Record<string, unknown> = message as Record<string, unknown>;

    if (value["ok"] === false) {
      return value["reason"] === "NotACalendar"
        ? { ok: false, reason: "NotACalendar" }
        : null;
    }

    if (value["ok"] !== true || !Array.isArray(value["occurrences"])) {
      return null;
    }

    const occurrences: Array<RawOccurrence> = [];

    for (const item of value["occurrences"] as Array<unknown>) {
      const occurrence: RawOccurrence | null = this.readOccurrence(item);

      if (occurrence) {
        occurrences.push(occurrence);
      }
    }

    const timezone: unknown = value["calendarTimezone"];

    return {
      ok: true,
      calendarTimezone:
        typeof timezone === "string" && timezone.length <= 100
          ? timezone
          : null,
      occurrences: occurrences,
      skippedSeries: isFiniteNumber(value["skippedSeries"])
        ? Math.max(0, Math.floor(value["skippedSeries"]))
        : 0,
      hitStepLimit: value["hitStepLimit"] === true,
      hitOccurrenceLimit: value["hitOccurrenceLimit"] === true,
    };
  }

  private static readOccurrence(value: unknown): RawOccurrence | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const item: Record<string, unknown> = value as Record<string, unknown>;
    const start: RawTime | null = this.readTime(item["start"]);
    const end: RawTime | null = this.readTime(item["end"]);

    if (!start || !end) {
      return null;
    }

    return {
      uid: typeof item["uid"] === "string" ? item["uid"].slice(0, 1000) : "",
      title: typeof item["title"] === "string" ? item["title"] : "",
      isPrivate: item["isPrivate"] === true,
      start: start,
      end: end,
    };
  }

  private static readTime(value: unknown): RawTime | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const time: Record<string, unknown> = value as Record<string, unknown>;

    if (time["kind"] === "instant") {
      return isFiniteNumber(time["ms"])
        ? { kind: "instant", ms: time["ms"] }
        : null;
    }

    const year: unknown = time["year"];
    const month: unknown = time["month"];
    const day: unknown = time["day"];

    if (
      !isWholeNumberInRange(year, 1, 9999) ||
      !isWholeNumberInRange(month, 1, 12) ||
      !isWholeNumberInRange(day, 1, 31)
    ) {
      return null;
    }

    if (time["kind"] === "date") {
      return { kind: "date", year: year, month: month, day: day };
    }

    if (time["kind"] !== "wall") {
      return null;
    }

    const hour: unknown = time["hour"];
    const minute: unknown = time["minute"];
    const second: unknown = time["second"];

    if (
      !isWholeNumberInRange(hour, 0, 23) ||
      !isWholeNumberInRange(minute, 0, 59) ||
      !isWholeNumberInRange(second, 0, 60)
    ) {
      return null;
    }

    const tzid: unknown = time["tzid"];

    return {
      kind: "wall",
      year: year,
      month: month,
      day: day,
      hour: hour,
      minute: minute,
      second: Math.min(second, 59),
      tzid: typeof tzid === "string" && tzid.length <= 200 ? tzid : null,
    };
  }

  /*
   * The IANA zone a TZID names, or null: "America/New_York" as it is, and
   * the old Mozilla prefixes (/mozilla.org/20050126_1/America/New_York) cut
   * off. Windows names ("W. Europe Standard Time") come with a VTIMEZONE in
   * every calendar that uses them, so ical.js has already placed those.
   */
  public static resolveTimezone(tzid: string | null): string | null {
    if (!tzid) {
      return null;
    }

    const trimmed: string = tzid.trim();

    if (moment.tz.zone(trimmed)) {
      return trimmed;
    }

    const parts: Array<string> = trimmed.split("/").filter((part: string) => {
      return part.length > 0;
    });

    for (let index: number = 1; index < parts.length; index++) {
      const candidate: string = parts.slice(index).join("/");

      if (moment.tz.zone(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /*
   * A time as an instant. A wall clock is read in its TZID's zone, or the
   * calendar's own (X-WR-TIMEZONE), or UTC; a date is midnight UTC of that
   * day.
   */
  public static toInstant(
    time: RawTime,
    calendarTimezone: string | null,
  ): Date | null {
    if (time.kind === "instant") {
      const date: Date = new Date(time.ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (time.kind === "date") {
      return new Date(Date.UTC(time.year, time.month - 1, time.day));
    }

    const zone: string =
      this.resolveTimezone(time.tzid) ||
      this.resolveTimezone(calendarTimezone) ||
      "UTC";

    const instant: moment.Moment = moment.tz(
      [
        time.year,
        time.month - 1,
        time.day,
        time.hour,
        time.minute,
        time.second,
      ],
      zone,
    );

    return instant.isValid() ? instant.toDate() : null;
  }

  private static toEvents(data: {
    answer: WorkerSuccess;
    window: ExternalCalendarWindow;
    now: Date;
    maxEvents: number;
  }): ExternalCalendarExpansionResult {
    const windowStart: number = data.window.start.getTime();
    const windowEnd: number = data.window.end.getTime();

    // One per event and start: a calendar can hold the same event twice.
    const byKey: Map<string, ExternalCalendarEventToKeep> = new Map();

    for (const occurrence of data.answer.occurrences) {
      const isAllDay: boolean = occurrence.start.kind === "date";

      const startsAt: Date | null = this.toInstant(
        occurrence.start,
        data.answer.calendarTimezone,
      );

      if (!startsAt) {
        continue;
      }

      let endsAt: Date | null = this.toInstant(
        occurrence.end,
        data.answer.calendarTimezone,
      );

      if (isAllDay) {
        // An all-day event lasts whole days, at least one.
        if (
          occurrence.end.kind !== "date" ||
          !endsAt ||
          endsAt.getTime() <= startsAt.getTime()
        ) {
          endsAt = new Date(startsAt.getTime() + MILLISECONDS_PER_DAY);
        }
      } else if (!endsAt || endsAt.getTime() < startsAt.getTime()) {
        endsAt = startsAt;
      }

      if (startsAt.getTime() >= windowEnd || endsAt.getTime() <= windowStart) {
        // A moment event exactly at the window's start still belongs to it.
        if (
          !(
            startsAt.getTime() === endsAt.getTime() &&
            startsAt.getTime() >= windowStart &&
            startsAt.getTime() < windowEnd
          )
        ) {
          continue;
        }
      }

      const title: string = occurrence.isPrivate
        ? ""
        : cleanExternalCalendarTitle(
            occurrence.title,
            EXTERNAL_CALENDAR_MAX_TITLE_LENGTH,
          );

      byKey.set(`${occurrence.uid}|${startsAt.getTime()}|${title}`, {
        title: title,
        startsAt: startsAt,
        endsAt: endsAt,
        isAllDay: isAllDay,
      });
    }

    const inWindow: Array<ExternalCalendarEventToKeep> = Array.from(
      byKey.values(),
    );

    const now: number = data.now.getTime();

    // How far an event is from now: none while it is on.
    const distance: (event: ExternalCalendarEventToKeep) => number = (
      event: ExternalCalendarEventToKeep,
    ): number => {
      if (event.startsAt.getTime() > now) {
        return event.startsAt.getTime() - now;
      }

      if (event.endsAt.getTime() < now) {
        return now - event.endsAt.getTime();
      }

      return 0;
    };

    const kept: Array<ExternalCalendarEventToKeep> =
      inWindow.length > data.maxEvents
        ? [...inWindow]
            .sort(
              (
                first: ExternalCalendarEventToKeep,
                second: ExternalCalendarEventToKeep,
              ): number => {
                return distance(first) - distance(second);
              },
            )
            .slice(0, data.maxEvents)
        : inWindow;

    kept.sort(
      (
        first: ExternalCalendarEventToKeep,
        second: ExternalCalendarEventToKeep,
      ): number => {
        return (
          first.startsAt.getTime() - second.startsAt.getTime() ||
          first.endsAt.getTime() - second.endsAt.getTime() ||
          first.title.localeCompare(second.title)
        );
      },
    );

    return {
      ok: true,
      events: kept,
      eventsInWindow: inWindow.length,
      hasMoreEvents:
        inWindow.length > data.maxEvents ||
        data.answer.hitStepLimit ||
        data.answer.hitOccurrenceLimit,
      skippedSeries: data.answer.skippedSeries,
    };
  }
}
