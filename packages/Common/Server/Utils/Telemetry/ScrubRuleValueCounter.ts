import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ScrubRuleValueCountService, {
  ScrubRuleValueCountEntry,
  ScrubRuleValueCountService as ScrubRuleValueCountServiceClass,
} from "../../Services/ScrubRuleValueCountService";
import logger from "../Logger";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "./TelemetryFanInWriter";

/*
 * THE SCRUB RULE COUNTER: HOW MANY VALUES EACH RULE CHANGED (#10366).
 *
 * The scrub engines tell it, once a record is scrubbed, how many values
 * each rule changed in it, with the record's service and service.version
 * (ScrubEngine/ScrubValueTally). It adds them up in memory, a key per
 * project, rule, kind of record, service, version and hour, and writes
 * them to ClickHouse (Models/AnalyticsModels/ScrubRuleValueCount) through
 * the telemetry fan-in writer every FLUSH_INTERVAL_MS - many records' counts
 * one row, never a row a value.
 *
 * It sits on the per-record ingest path, so it does no IO per value: a map
 * bump, and a write on a timer that never holds the process up (unref).
 * FAIL QUIETLY: a write that fails is logged and its counts let go - never
 * retried, never thrown - since a counter is never worth a record, and
 * losing a few seconds of counts when a process stops is acceptable. Past
 * MAX_PENDING_KEYS distinct keys, a new key's counts wait for the next
 * write rather than grow the map without bound.
 */

export type ScrubRuleValueSignal = "log" | "trace";

export const FLUSH_INTERVAL_MS: number = 15 * 1000;

// The most distinct keys kept between writes.
export const MAX_PENDING_KEYS: number = 50_000;

interface PendingCount {
  entry: ScrubRuleValueCountEntry;
}

const pending: Map<string, PendingCount> = new Map<string, PendingCount>();
let timer: ReturnType<typeof setInterval> | null = null;
let flushing: Promise<void> | null = null;

function startOfHour(moment: Date): Date {
  const hour: Date = new Date(moment.getTime());

  hour.setUTCMinutes(0, 0, 0);

  return hour;
}

function startTimer(): void {
  if (timer) {
    return;
  }

  timer = setInterval((): void => {
    void ScrubRuleValueCounter.flush();
  }, FLUSH_INTERVAL_MS);

  // Never the reason a process stays up.
  if (typeof timer === "object" && timer && "unref" in timer) {
    timer.unref();
  }
}

export default class ScrubRuleValueCounter {
  /*
   * One record's counts: the values each rule changed in it. Counts of a
   * rule with no id, or of no project, are not kept.
   */
  public static add(data: {
    projectId: string;
    signal: ScrubRuleValueSignal;
    serviceId: string;
    serviceVersion: string;
    counts: ReadonlyArray<[string, number]>;
    now?: Date | undefined;
  }): void {
    if (!ObjectID.isValidUUID(data.projectId)) {
      return;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const hour: Date = startOfHour(now);

    for (const [scrubRuleId, count] of data.counts) {
      if (!ObjectID.isValidUUID(scrubRuleId) || !(count > 0)) {
        continue;
      }

      const key: string = [
        data.projectId,
        scrubRuleId,
        data.signal,
        data.serviceId,
        data.serviceVersion,
        hour.getTime(),
      ].join("|");
      const existing: PendingCount | undefined = pending.get(key);

      if (existing) {
        existing.entry.valueCount += count;
        existing.entry.lastChangedAt = now;
        continue;
      }

      if (pending.size >= MAX_PENDING_KEYS) {
        continue;
      }

      pending.set(key, {
        entry: {
          projectId: data.projectId,
          scrubRuleId,
          signal: data.signal,
          serviceId: data.serviceId,
          serviceVersion: data.serviceVersion,
          hour,
          valueCount: count,
          lastChangedAt: now,
        },
      });
    }

    if (pending.size > 0) {
      startTimer();
    }
  }

  // What is waiting to be written: for a test.
  public static getPendingEntries(): Array<ScrubRuleValueCountEntry> {
    return Array.from(pending.values()).map(
      (item: PendingCount): ScrubRuleValueCountEntry => {
        return { ...item.entry };
      },
    );
  }

  // Forget what is waiting, and stop the timer: for a test.
  public static reset(): void {
    pending.clear();

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /*
   * Write what is waiting: one submission of every key's rows. Safe to
   * call at any time, and never throws; counts added while it writes wait
   * for the next.
   */
  public static async flush(): Promise<void> {
    if (flushing) {
      return flushing;
    }

    if (pending.size === 0) {
      return;
    }

    const entries: Array<ScrubRuleValueCountEntry> = Array.from(
      pending.values(),
    ).map((item: PendingCount): ScrubRuleValueCountEntry => {
      return item.entry;
    });

    pending.clear();

    flushing = (async (): Promise<void> => {
      const rows: Array<JSONObject> =
        ScrubRuleValueCountServiceClass.toRows(entries);

      if (rows.length === 0) {
        return;
      }

      try {
        const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
          ScrubRuleValueCountService,
          rows,
        );

        await submission.flushed;
      } catch (error) {
        logger.warn(
          `ScrubRuleValueCounter: ${rows.length} scrub rule count row(s) were not written; those values are not counted.`,
        );
        logger.warn(error);
      }
    })();

    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }
}
