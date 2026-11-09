import { JSONObject } from "../../../../../Types/JSON";
import {
  LlmConnectionKind,
  getLlmConnectionDefinition,
} from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionPendingWindow,
  LlmConnectionPullState,
  LlmUsageRecord,
} from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../../Types/LlmObservability/LlmConnectionTest";
import {
  LlmConnectionSettings,
  LlmConnectorCallOptions,
  LlmProviderAccountConnector,
  LlmUsageFetchResult,
  LlmUsageWindow,
  getSecretValues,
  readSetting,
} from "../../LlmConnectorTypes";
import LlmConnectorTestResults, {
  LLM_CONNECTION_TEST_DAYS,
} from "../../LlmConnectorTestResults";
import LlmProviderError from "../../LlmProviderError";
import { readCount, readObject, readText } from "../../LlmProviderHttp";
import LlmUsageDays from "../../LlmUsageDays";
import CursorAdminClient, {
  CURSOR_MAX_DAILY_USAGE_MEMBERS,
  CursorMember,
  CursorUsageEventsPage,
} from "./CursorAdminClient";

/*
 * A Cursor team, read with an Admin API key: every usage event - one per
 * model request, with who made it, the model, its tokens and what Cursor
 * charged - added up by hour, person, model and service account, and how
 * many of the team's members used Cursor in the past 7 days. Never what
 * anyone asked it: the Admin API has no conversations.
 *
 * HOW A READ GOES. Cursor adds its usage up by the hour and asks to be read
 * at most once an hour, 60 usage-event requests a minute, so a team's month
 * can take more requests than one run makes. Reads are by the hour and can
 * stop part way:
 *
 *   - the connection keeps the hour ranges still to read (pendingWindows):
 *     the first read queues the backfill, each later one the hours since
 *     the last plus CURSOR_REREAD_HOURS before them (Cursor's aggregation
 *     lands late), and once a UTC day is over - after 06:00 - the whole of
 *     it again;
 *   - a read takes the newest range and reads it newest first, a piece at
 *     a time - up to a day, shorter when Cursor reports many pages - each
 *     piece read in full, every page, before it counts. A request or time
 *     bound ends the read between pieces; what it read in full is written,
 *     and the rest follows a minute later;
 *   - the hour in progress waits for the next read: Cursor has not added
 *     it up yet.
 *
 * Its people are counted once a UTC day (and on the first read): the
 * members who are not removed, and those of them Cursor marks active on
 * any of the past 7 days.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// The hours before the newest read again on every read.
export const CURSOR_REREAD_HOURS: number = 3;
// A UTC day is read again in full once this many hours of the next have passed.
export const CURSOR_SETTLE_AFTER_HOURS: number = 6;
// The days a member's activity is looked for, before today.
export const CURSOR_ACTIVE_DAYS: number = 7;
// A piece of a range is at most a day, and at most this many pages.
export const CURSOR_MAX_PIECE_HOURS: number = 24;
export const CURSOR_MAX_PAGES_PER_PIECE: number = 25;
/*
 * An hour with more pages than this - 100,000 requests - is more than a
 * read can take in: it is left out, and the read says so.
 */
export const CURSOR_MAX_PAGES_PER_HOUR: number = 100;
// One read's bounds, inside the read job's 9 minutes.
export const CURSOR_READ_MAX_REQUESTS: number = 200;
export const CURSOR_READ_MAX_DURATION_MS: number = 4 * 60 * 1000;
// A test adds up at most this many pages of events.
export const CURSOR_TEST_MAX_PAGES: number = 5;
const MAX_PENDING_WINDOWS: number = 8;

export interface CursorReadPlan {
  // What this read reads: the newest range still to read.
  window: LlmUsageWindow;
  // Every range still to read, newest first; the window is the first.
  pending: Array<LlmUsageWindow>;
  // The end of the newest hour queued so far.
  queuedThrough: Date;
  // The last UTC day queued to be read again once over (ISO).
  settledDay: string | undefined;
  // Whether this read counts the team's people.
  countMembers: boolean;
  // The UTC day of the read ("YYYY-MM-DD").
  today: string;
}

export interface CursorEventsRead {
  records: Array<LlmUsageRecord>;
  // [coveredStart, window end) was read in full.
  coveredStart: Date;
  // The whole window was read.
  complete: boolean;
  warnings: Array<string>;
}

export interface CursorPeople {
  members: number;
  activeMembers?: number | undefined;
  // Both were read: the day's count is done.
  counted: boolean;
}

function backfillDays(): number {
  return (
    getLlmConnectionDefinition(LlmConnectionProvider.Cursor)?.backfillDays || 30
  );
}

export default class CursorConnector implements LlmProviderAccountConnector {
  public provider: LlmConnectionProvider = LlmConnectionProvider.Cursor;
  public kind: LlmConnectionKind.ProviderAccount =
    LlmConnectionKind.ProviderAccount;

  public validateSettings(settings: LlmConnectionSettings): void {
    CursorAdminClient.validateApiKey(readSetting(settings.secrets, "apiKey"));
  }

  public static startOfHour(date: Date): Date {
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
  }

  // Ranges as one list: clipped, merged where they touch, newest first.
  public static mergeWindows(
    windows: Array<LlmUsageWindow>,
    bounds?: LlmUsageWindow | undefined,
  ): Array<LlmUsageWindow> {
    const clipped: Array<LlmUsageWindow> = windows
      .map((window: LlmUsageWindow): LlmUsageWindow => {
        const start: number = bounds
          ? Math.max(window.startDay.getTime(), bounds.startDay.getTime())
          : window.startDay.getTime();
        const end: number = bounds
          ? Math.min(window.endDay.getTime(), bounds.endDay.getTime())
          : window.endDay.getTime();

        return { startDay: new Date(start), endDay: new Date(end) };
      })
      .filter((window: LlmUsageWindow): boolean => {
        return window.endDay.getTime() > window.startDay.getTime();
      })
      .sort((a: LlmUsageWindow, b: LlmUsageWindow): number => {
        return a.startDay.getTime() - b.startDay.getTime();
      });

    const merged: Array<LlmUsageWindow> = [];

    for (const window of clipped) {
      const last: LlmUsageWindow | undefined = merged[merged.length - 1];

      if (last && window.startDay.getTime() <= last.endDay.getTime()) {
        if (window.endDay.getTime() > last.endDay.getTime()) {
          last.endDay = window.endDay;
        }

        continue;
      }

      merged.push({ startDay: window.startDay, endDay: window.endDay });
    }

    return merged.reverse();
  }

  // The ranges with a read part taken out.
  public static subtractWindow(
    windows: Array<LlmUsageWindow>,
    cut: LlmUsageWindow,
  ): Array<LlmUsageWindow> {
    const left: Array<LlmUsageWindow> = [];

    for (const window of windows) {
      const overlaps: boolean =
        cut.startDay.getTime() < window.endDay.getTime() &&
        cut.endDay.getTime() > window.startDay.getTime() &&
        cut.endDay.getTime() > cut.startDay.getTime();

      if (!overlaps) {
        left.push(window);
        continue;
      }

      if (window.startDay.getTime() < cut.startDay.getTime()) {
        left.push({ startDay: window.startDay, endDay: cut.startDay });
      }

      if (cut.endDay.getTime() < window.endDay.getTime()) {
        left.push({ startDay: cut.endDay, endDay: window.endDay });
      }
    }

    return CursorConnector.mergeWindows(left);
  }

  private static readTime(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const time: number = Date.parse(value);
    return Number.isFinite(time) ? new Date(time) : null;
  }

  public static readPendingWindows(
    pending: Array<LlmConnectionPendingWindow> | undefined,
  ): Array<LlmUsageWindow> {
    const windows: Array<LlmUsageWindow> = [];

    for (const range of pending || []) {
      const start: Date | null = CursorConnector.readTime(range.start);
      const end: Date | null = CursorConnector.readTime(range.end);

      if (start && end) {
        windows.push({ startDay: start, endDay: end });
      }
    }

    return windows;
  }

  /*
   * What the next read covers, from where the last one got to. Pure: the
   * runner plans with it before the read, and the read plans again with
   * the same "now" to know what is left after it.
   */
  public static plan(data: {
    now: Date;
    state: LlmConnectionPullState;
    backfillDays: number;
  }): CursorReadPlan {
    const end: Date = CursorConnector.startOfHour(data.now);
    const today: Date = LlmUsageDays.startOfUtcDay(data.now);
    const earliest: Date = LlmUsageDays.addDays(
      today,
      -(Math.max(1, data.backfillDays) - 1),
    );
    const queuedThrough: Date | null = CursorConnector.readTime(
      data.state.windowEnd,
    );

    let pending: Array<LlmUsageWindow> = CursorConnector.readPendingWindows(
      data.state.pendingWindows,
    );

    if (
      !queuedThrough ||
      queuedThrough.getTime() > end.getTime() ||
      queuedThrough.getTime() < earliest.getTime()
    ) {
      // Never read, or nothing it read is still kept: every day again.
      pending = [{ startDay: earliest, endDay: end }];
    } else if (queuedThrough.getTime() < end.getTime()) {
      pending.push({
        startDay: new Date(
          queuedThrough.getTime() - CURSOR_REREAD_HOURS * HOUR_MS,
        ),
        endDay: end,
      });
    }

    // Yesterday, once more, when Cursor has had the time to settle it.
    const yesterday: Date = LlmUsageDays.addDays(today, -1);
    const settled: Date | null = CursorConnector.readTime(
      data.state.settledDay,
    );
    let settledDay: string | undefined = settled
      ? settled.toISOString()
      : undefined;

    if (
      data.now.getTime() >=
        today.getTime() + CURSOR_SETTLE_AFTER_HOURS * HOUR_MS &&
      yesterday.getTime() >= earliest.getTime() &&
      (!settled || settled.getTime() < yesterday.getTime())
    ) {
      pending.push({ startDay: yesterday, endDay: today });
      settledDay = yesterday.toISOString();
    }

    pending = CursorConnector.mergeWindows(pending, {
      startDay: earliest,
      endDay: end,
    }).slice(0, MAX_PENDING_WINDOWS);

    if (pending.length === 0) {
      // Everything is read: "Read now" reads the last few hours again.
      pending = CursorConnector.mergeWindows(
        [
          {
            startDay: new Date(end.getTime() - CURSOR_REREAD_HOURS * HOUR_MS),
            endDay: end,
          },
        ],
        { startDay: earliest, endDay: end },
      );
    }

    return {
      window: pending[0] || { startDay: end, endDay: end },
      pending,
      queuedThrough: end,
      settledDay,
      countMembers: data.state.membersDay !== LlmUsageDays.toIsoDate(data.now),
      today: LlmUsageDays.toIsoDate(data.now),
    };
  }

  public planUsageWindow(data: {
    now: Date;
    state: LlmConnectionPullState;
    backfillDays: number;
  }): LlmUsageWindow {
    return CursorConnector.plan(data).window;
  }

  /*
   * Usage events added up by hour, model, person and service account. An
   * event's input counts its cache reads and writes (Cursor gives them
   * apart, as Anthropic does); its cost is what Cursor charged for it
   * (chargedCents, which its dashboard totals add up), or the model's cost
   * when the event has no charge. Events outside the range given, or with
   * no time, are left out and counted.
   */
  public static toRecords(
    events: Array<JSONObject>,
    range?: { startMs: number; endMs: number } | undefined,
  ): { records: Array<LlmUsageRecord>; skipped: number } {
    const records: Map<string, LlmUsageRecord> = new Map();
    const skipped: number = CursorConnector.addEvents(records, events, range);

    return { records: CursorConnector.recordsOf(records), skipped };
  }

  // Added-up records, their cost rounded the way it was charged.
  public static recordsOf(
    records: Map<string, LlmUsageRecord>,
  ): Array<LlmUsageRecord> {
    return Array.from(records.values()).map(
      (record: LlmUsageRecord): LlmUsageRecord => {
        return {
          ...record,
          costUsd: Math.round((record.costUsd || 0) * 1e8) / 1e8,
        };
      },
    );
  }

  // Merges one set of added-up records into another.
  public static mergeRecords(
    into: Map<string, LlmUsageRecord>,
    from: Map<string, LlmUsageRecord>,
  ): void {
    for (const [key, record] of from) {
      const existing: LlmUsageRecord | undefined = into.get(key);

      if (!existing) {
        into.set(key, { ...record });
        continue;
      }

      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.cacheReadTokens += record.cacheReadTokens;
      existing.cacheWriteTokens += record.cacheWriteTokens;
      existing.requests = (existing.requests || 0) + (record.requests || 0);
      existing.costUsd = (existing.costUsd || 0) + (record.costUsd || 0);
    }
  }

  // Adds events to records; returns how many were left out.
  public static addEvents(
    records: Map<string, LlmUsageRecord>,
    events: Array<JSONObject>,
    range?: { startMs: number; endMs: number } | undefined,
  ): number {
    let skipped: number = 0;

    for (const event of events) {
      const time: number = Number(
        typeof event["timestamp"] === "number"
          ? event["timestamp"]
          : readText(event["timestamp"]) || NaN,
      );

      if (
        !Number.isFinite(time) ||
        time <= 0 ||
        (range && (time < range.startMs || time >= range.endMs))
      ) {
        skipped++;
        continue;
      }

      const hour: Date = new Date(Math.floor(time / HOUR_MS) * HOUR_MS);
      const model: string = readText(event["model"]);
      const person: string = readText(event["userEmail"]);
      const apiKey: string =
        readText(event["serviceAccountName"]) ||
        readText(event["serviceAccountId"]);
      const tokens: JSONObject = readObject(event["tokenUsage"]);
      const cacheRead: number = readCount(tokens["cacheReadTokens"]);
      const cacheWrite: number = readCount(tokens["cacheWriteTokens"]);
      const charged: unknown = event["chargedCents"];
      const cents: number =
        typeof charged === "number" && Number.isFinite(charged)
          ? readCount(charged)
          : readCount(tokens["totalCents"]);

      const key: string = JSON.stringify([
        hour.getTime(),
        model,
        person,
        apiKey,
      ]);
      const record: LlmUsageRecord = records.get(key) || {
        day: hour,
        model,
        person,
        project: "",
        apiKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requests: 0,
        costUsd: 0,
      };

      record.inputTokens +=
        readCount(tokens["inputTokens"]) + cacheRead + cacheWrite;
      record.outputTokens += readCount(tokens["outputTokens"]);
      record.cacheReadTokens += cacheRead;
      record.cacheWriteTokens += cacheWrite;
      record.requests = (record.requests || 0) + 1;
      record.costUsd = (record.costUsd || 0) + cents / 100;
      records.set(key, record);
    }

    return skipped;
  }

  private static formatHour(date: Date): string {
    return `${date.toISOString().substring(0, 13)}:00 UTC`;
  }

  /*
   * A range's usage events, newest first, a piece at a time. A piece counts
   * once every page of it is read and Cursor's total stayed the same while
   * they were (an event arriving mid-way shifts the pages: the piece is read
   * again, once). The bounds end the read between pieces; a failure after
   * some pieces ends it there too, but a refused key - or a failure before
   * anything was read - is the read's failure.
   */
  public static async readEvents(data: {
    client: CursorAdminClient;
    window: LlmUsageWindow;
    maxRequests: number;
    deadlineMs: number;
    clock: () => number;
  }): Promise<CursorEventsRead> {
    const warnings: Array<string> = [];
    // What the pieces read in full add up to.
    const records: Map<string, LlmUsageRecord> = new Map();
    const windowStart: number = data.window.startDay.getTime();
    let pieceEnd: number = data.window.endDay.getTime();
    let pieceHours: number = Math.max(
      1,
      Math.min(
        CURSOR_MAX_PIECE_HOURS,
        Math.ceil((pieceEnd - windowStart) / HOUR_MS),
      ),
    );
    let rereadsLeft: number = 1;
    let stopped: boolean = false;
    let skipped: number = 0;

    const outOfTime: () => boolean = (): boolean => {
      return (
        data.client.getRequestCount() >= data.maxRequests ||
        data.clock() >= data.deadlineMs
      );
    };

    const fail: (error: unknown) => void = (error: unknown): void => {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "usage events request",
        providerTitle: "Cursor",
      });

      if (
        failure.kind === LlmConnectionFailureKind.Authentication ||
        failure.kind === LlmConnectionFailureKind.Permission ||
        pieceEnd === data.window.endDay.getTime()
      ) {
        throw failure;
      }

      warnings.push(
        `The read stopped at ${CursorConnector.formatHour(new Date(pieceEnd))} and goes on in a minute: ${failure.message}`,
      );
      stopped = true;
    };

    while (pieceEnd > windowStart && !stopped) {
      if (outOfTime()) {
        stopped = true;
        break;
      }

      const pieceStart: number = Math.max(
        windowStart,
        pieceEnd - pieceHours * HOUR_MS,
      );
      // Both of Cursor's bounds are inclusive.
      const range: { startMs: number; endMs: number } = {
        startMs: pieceStart,
        endMs: pieceEnd - 1,
      };

      let first: CursorUsageEventsPage;

      try {
        first = await data.client.getUsageEventsPage({ ...range, page: 1 });
      } catch (error) {
        fail(error);
        break;
      }

      const pieceSpan: number = Math.ceil((pieceEnd - pieceStart) / HOUR_MS);

      if (first.pages > CURSOR_MAX_PAGES_PER_PIECE && pieceSpan > 1) {
        // A busy stretch: shorter pieces, so each fits in a read.
        pieceHours = Math.max(
          1,
          Math.floor((pieceSpan * CURSOR_MAX_PAGES_PER_PIECE) / first.pages),
        );
        continue;
      }

      if (first.pages > CURSOR_MAX_PAGES_PER_HOUR) {
        warnings.push(
          `Cursor reported ${first.total} requests in the hour from ${CursorConnector.formatHour(new Date(pieceStart))}, more than a read takes in, so that hour was left out.`,
        );
        pieceEnd = pieceStart;
        continue;
      }

      if (first.pages - 1 > data.maxRequests - data.client.getRequestCount()) {
        // Not enough requests left for the rest of it: the next read's.
        stopped = true;
        break;
      }

      // The piece's own records: kept only once all of it is read.
      const piece: Map<string, LlmUsageRecord> = new Map();
      const pieceRange: { startMs: number; endMs: number } = {
        startMs: pieceStart,
        endMs: pieceEnd,
      };
      let pieceSkipped: number = CursorConnector.addEvents(
        piece,
        first.events,
        pieceRange,
      );
      let changed: boolean = false;

      for (let page: number = 2; page <= first.pages; page++) {
        if (data.clock() >= data.deadlineMs) {
          stopped = true;
          break;
        }

        let next: CursorUsageEventsPage;

        try {
          next = await data.client.getUsageEventsPage({ ...range, page });
        } catch (error) {
          fail(error);
          break;
        }

        if (next.total !== first.total) {
          changed = true;
          break;
        }

        pieceSkipped += CursorConnector.addEvents(
          piece,
          next.events,
          pieceRange,
        );
      }

      if (stopped) {
        break;
      }

      if (changed) {
        if (rereadsLeft > 0) {
          rereadsLeft--;
          continue;
        }

        warnings.push(
          `Cursor's events for the hours to ${CursorConnector.formatHour(new Date(pieceEnd))} kept changing while they were read; they are read again in a minute.`,
        );
        stopped = true;
        break;
      }

      CursorConnector.mergeRecords(records, piece);
      skipped += pieceSkipped;
      pieceEnd = pieceStart;

      if (
        first.pages <= CURSOR_MAX_PAGES_PER_PIECE / 4 &&
        pieceHours < CURSOR_MAX_PIECE_HOURS
      ) {
        pieceHours = Math.min(CURSOR_MAX_PIECE_HOURS, pieceHours * 2);
      }
    }

    if (skipped > 0) {
      warnings.push(
        `${skipped} usage events had no time in the hours they were asked for, and were left out.`,
      );
    }

    return {
      records: CursorConnector.recordsOf(records),
      coveredStart: new Date(pieceEnd),
      complete: pieceEnd <= windowStart,
      warnings,
    };
  }

  /*
   * The team's members who are not removed, and those of them Cursor marks
   * active on any of the CURSOR_ACTIVE_DAYS UTC days before today. A key
   * the members request refuses fails the read; anything else the people
   * cannot be counted for is a warning, and they are counted next time.
   */
  public static async countPeople(data: {
    client: CursorAdminClient;
    now: Date;
    warnings: Array<string>;
  }): Promise<CursorPeople | undefined> {
    let listed: Array<CursorMember>;

    try {
      listed = await data.client.listMembers();
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        (error.kind === LlmConnectionFailureKind.Authentication ||
          error.kind === LlmConnectionFailureKind.Permission)
      ) {
        throw error;
      }

      data.warnings.push(
        `The team's members could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }

    const members: Array<CursorMember> = listed.filter(
      (member: CursorMember): boolean => {
        return !member.isRemoved;
      },
    );
    const emails: Set<string> = new Set<string>(
      members
        .map((member: CursorMember): string => {
          return member.email.toLowerCase();
        })
        .filter(Boolean),
    );
    const today: number = LlmUsageDays.startOfUtcDay(data.now).getTime();

    try {
      const active: { emails: Set<string>; complete: boolean } =
        await data.client.listActiveEmails({
          startMs: today - CURSOR_ACTIVE_DAYS * DAY_MS,
          endMs: today - 1,
        });

      if (!active.complete) {
        data.warnings.push(
          `Only the first ${CURSOR_MAX_DAILY_USAGE_MEMBERS} members' days were read, so some members who use Cursor may not be counted.`,
        );
      }

      return {
        members: members.length,
        activeMembers: Array.from(emails).filter((email: string): boolean => {
          return active.emails.has(email);
        }).length,
        counted: true,
      };
    } catch (error) {
      data.warnings.push(
        `How many members used Cursor could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { members: members.length, counted: false };
    }
  }

  public async fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult> {
    const clock: () => number = options.clock || Date.now;
    const deadlineMs: number = clock() + CURSOR_READ_MAX_DURATION_MS;
    const now: Date = options.now ? options.now() : new Date();
    const state: LlmConnectionPullState = options.state || {};
    const plan: CursorReadPlan = CursorConnector.plan({
      now,
      state,
      backfillDays: backfillDays(),
    });
    const client: CursorAdminClient = new CursorAdminClient({
      apiKey: readSetting(settings.secrets, "apiKey"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      sleep: options.sleep,
      clock,
      waitUntilMs: deadlineMs,
    });
    const warnings: Array<string> = [];

    // First, so a refused key fails the read before any usage is asked for.
    const people: CursorPeople | undefined = plan.countMembers
      ? await CursorConnector.countPeople({ client, now, warnings })
      : undefined;

    // Whole hours: records are kept by the hour they belong to.
    const hours: LlmUsageWindow = {
      startDay: CursorConnector.startOfHour(window.startDay),
      endDay: CursorConnector.startOfHour(window.endDay),
    };
    const read: CursorEventsRead = await CursorConnector.readEvents({
      client,
      window: hours,
      maxRequests: CURSOR_READ_MAX_REQUESTS,
      deadlineMs,
      clock,
    });
    warnings.push(...read.warnings);

    const covered: LlmUsageWindow = {
      startDay: read.coveredStart,
      endDay: hours.endDay,
    };
    const left: Array<LlmUsageWindow> = CursorConnector.subtractWindow(
      plan.pending,
      covered,
    );
    const membersDay: string | undefined = people?.counted
      ? plan.today
      : state.membersDay;

    return {
      records: read.records,
      requestCount: client.getRequestCount(),
      warnings,
      bucket: "hour",
      coveredWindow: covered,
      complete: left.length === 0,
      nextState: {
        windowEnd: plan.queuedThrough.toISOString(),
        ...(left.length > 0
          ? {
              pendingWindows: left.map(
                (range: LlmUsageWindow): LlmConnectionPendingWindow => {
                  return {
                    start: range.startDay.toISOString(),
                    end: range.endDay.toISOString(),
                  };
                },
              ),
            }
          : {}),
        ...(plan.settledDay ? { settledDay: plan.settledDay } : {}),
        ...(membersDay ? { membersDay } : {}),
      },
      ...(people
        ? {
            members: people.members,
            ...(people.activeMembers !== undefined
              ? { activeMembers: people.activeMembers }
              : {}),
          }
        : {}),
    };
  }

  /*
   * The key reads the team (its members), and the team's last 7 days of
   * usage: added up when they fit in CURSOR_TEST_MAX_PAGES pages, else
   * counted - Cursor gives the total of a range with its first page.
   */
  public async testConnection(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): Promise<LlmConnectionTestResult> {
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();

    try {
      this.validateSettings(settings);

      const client: CursorAdminClient = new CursorAdminClient({
        apiKey: readSetting(settings.secrets, "apiKey"),
        transport: options.transport,
        requestTimeoutInMs: options.requestTimeoutInMs,
        sleep: options.sleep,
        clock: options.clock,
      });

      const members: number = (await client.listMembers()).filter(
        (member: CursorMember): boolean => {
          return !member.isRemoved;
        },
      ).length;

      const range: { startMs: number; endMs: number } = {
        startMs: now.getTime() - LLM_CONNECTION_TEST_DAYS * DAY_MS,
        endMs: now.getTime(),
      };
      const first: CursorUsageEventsPage = await client.getUsageEventsPage({
        ...range,
        page: 1,
      });

      if (first.pages <= CURSOR_TEST_MAX_PAGES) {
        const events: Array<JSONObject> = [...first.events];

        for (let page: number = 2; page <= first.pages; page++) {
          events.push(
            ...(await client.getUsageEventsPage({ ...range, page })).events,
          );
        }

        const result: LlmConnectionTestResult =
          LlmConnectorTestResults.fromUsage({
            provider: this.provider,
            records: CursorConnector.toRecords(events).records,
            days: LLM_CONNECTION_TEST_DAYS,
            durationMs: Date.now() - startedAt,
          });

        return { ...result, counts: { ...result.counts, members } };
      }

      // A busy team: its requests counted, not added up.
      return {
        provider: this.provider,
        status: first.total > 0 ? "pass" : "warn",
        message: `Connected. Found ${first.total} requests in the last ${LLM_CONNECTION_TEST_DAYS} days.`,
        counts: {
          days: LLM_CONNECTION_TEST_DAYS,
          requests: first.total,
          members,
        },
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return LlmConnectorTestResults.fromError({
        provider: this.provider,
        error,
        secretValues: getSecretValues(settings),
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
