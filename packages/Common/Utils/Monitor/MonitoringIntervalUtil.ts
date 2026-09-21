/*
 * How often a monitor is probed: the canonical reading of
 * `Monitor.monitoringInterval` (and `MonitorTemplate.monitoringInterval`).
 *
 * WHY IT LIVES IN Common
 *
 * The column is free-text ShortText and is supposed to hold a 5-field cron
 * expression, but nothing ever validated it. Four places have an opinion
 * about what a stored value MEANS and they must not disagree:
 *
 *   - the write hooks (MonitorService / MonitorTemplateService) — which now
 *     normalize on save, so the column converges on canonical cron;
 *   - the claim query (MonitorProbeService.claimMonitorProbesForProbing) —
 *     which derives `nextPingAt` and is the thing that actually schedules
 *     the probe;
 *   - the telemetry-monitor worker and the over-time criteria evaluator —
 *     which need the cadence to size their evaluation windows;
 *   - the data migration that cleans the rows written before any of this.
 *
 * It is isomorphic (no server-only imports) because the dashboard needs the
 * same reading to render a stored value, and pure and TOTAL — it never
 * throws. Policy (reject / rewrite / leave alone) belongs to the caller:
 * the write hook throws, the scheduler falls back, the migration skips.
 * Same reason RescanIntervalUtil and ScanTargetUtil sit in Common.
 *
 * WHAT WENT WRONG, so the next person does not undo it
 *
 * A monitor storing "5m" was not a cron expression, so cron-parser threw,
 * and the claim query caught that and fell back to a hard-coded "one minute
 * from now". A monitor configured for five minutes was probed every ~75
 * seconds — four times the requested rate — silently, for as long as the row
 * existed. 103 monitors across 10 projects were in that state. Most of them
 * got there by copying OUR OWN Terraform examples, which passed the dropdown
 * LABEL ("Every 5 minutes") where the API wanted the VALUE ("*\/5 * * * *").
 *
 * THE INTERPRETIVE RULE THIS ENCODES
 *
 * A bare duration in THIS column is always a CADENCE, never a clock
 * position: "5m" means "every five minutes", not "at five past". That is
 * unambiguous here because the column's only consumer is a polling
 * schedule. Do not lift this parser somewhere a duration could mean an
 * offset. Note CronTime.ts spells out the same cadence-shaped constants.
 */

import CronTab from "../CronTab";

export enum MonitoringIntervalNormalizationStatus {
  /*
   * Null, undefined or blank. A legitimate state: the monitor is not probed
   * on a schedule (Manual monitors, and ~4,177 rows in production).
   */
  Empty = "Empty",
  /* Already a valid cron expression. Returned byte-identical. */
  AlreadyCanonical = "AlreadyCanonical",
  /* Understood, and rewritten to canonical cron. */
  Normalized = "Normalized",
  /* Not understood. The caller decides what that means. */
  Unrecognized = "Unrecognized",
}

export interface MonitoringIntervalNormalization {
  status: MonitoringIntervalNormalizationStatus;
  /* The canonical cron expression, or null for Empty / Unrecognized. */
  cron: string | null;
  /* The value as it was handed to us, for error messages and logs. */
  input: string | null;
}

/*
 * Cadences that divide their unit evenly.
 *
 * A 7-minute step fires at :00, :07 ... :56 and then :00 again — a four-minute
 * gap at every hour wrap. It is NOT "every 7 minutes", so storing it as the
 * normalization of "every 7 minutes" would be storing a lie. We only accept
 * n where the unit divides evenly; everything else is Unrecognized and the
 * caller can tell the user to write the cron they actually want.
 */
const minutesDivideEvenly: (n: number) => boolean = (n: number): boolean => {
  return n >= 2 && n <= 59 && 60 % n === 0;
};

const hoursDivideEvenly: (n: number) => boolean = (n: number): boolean => {
  return n >= 2 && n <= 23 && 24 % n === 0;
};

/*
 * Labels the dashboard dropdown offers, mirrored here because Common cannot
 * import from the App package. MonitoringIntervalLabelParity.test.ts fails
 * if MonitorIntervalDropdownOptions.ts and this list ever drift apart — that
 * test is the link, not this comment.
 */
const DASHBOARD_DROPDOWN_LABELS: Record<string, string> = {
  "every minute": "* * * * *",
  "every 2 minutes": "*/2 * * * *",
  "every 5 minutes": "*/5 * * * *",
  "every 10 minutes": "*/10 * * * *",
  "every 15 minutes": "*/15 * * * *",
  "every 30 minutes": "*/30 * * * *",
  "every hour": "0 * * * *",
  "every 2 hours": "0 */2 * * *",
  "every 3 hours": "0 */3 * * *",
  "every 6 hours": "0 */6 * * *",
  "every 12 hours": "0 */12 * * *",
  "every day": "0 0 * * *",
};

/*
 * Bare adverbs, which carry no number to run through the grammar.
 */
const ADVERB_LABELS: Record<string, string> = {
  minutely: "* * * * *",
  hourly: "0 * * * *",
  daily: "0 0 * * *",
  nightly: "0 0 * * *",
  weekly: "0 0 * * 0",
  monthly: "0 0 1 * *",
  yearly: "0 0 1 1 *",
  annually: "0 0 1 1 *",
};

/*
 * The unit vocabulary the duration grammar accepts. Seconds are deliberately
 * absent: the claim loop runs once a minute, so a sub-minute cadence cannot
 * be honoured and accepting one would promise a rate we never deliver.
 */
/*
 * Numbers written as words. "Every Five Minutes" is in the production
 * census, so the grammar has to read these; the range stops where a cadence
 * stops being plausible rather than trying to be a general number parser.
 */
const SPELLED_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  sixty: 60,
};

const DIGITS_ONLY: RegExp = /^\d+$/u;

const MINUTE_UNITS: ReadonlyArray<string> = [
  "m",
  "min",
  "mins",
  "minute",
  "minutes",
];
const HOUR_UNITS: ReadonlyArray<string> = ["h", "hr", "hrs", "hour", "hours"];
const DAY_UNITS: ReadonlyArray<string> = ["d", "day", "days"];
const WEEK_UNITS: ReadonlyArray<string> = ["w", "week", "weeks"];

export default class MonitoringIntervalUtil {
  /*
   * Lowercase, collapse any run of whitespace (including the non-breaking
   * space that survives a copy-paste out of our docs) to one space, and drop
   * wrapping quotes and a trailing period. Lookup keys are built this way so
   * "EVERY  5   MINUTES." and "every 5 minutes" are the same key.
   *
   * toLowerCase, not toLocaleLowerCase: in a Turkish locale the latter maps
   * "I" to a dotless i and the table would stop matching.
   */
  private static toLookupKey(value: string): string {
    return value
      .replace(/[\s\u00a0]+/g, " ")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/\.+$/, "")
      .trim()
      .toLowerCase();
  }

  /*
   * The preset labels we ship, keyed for lookup. Built by iterating
   * CronTab.PRESETS rather than retyping them, so a preset added there is
   * understood here without anyone remembering to update this file.
   */
  private static buildLabelTable(): Record<string, string> {
    const table: Record<string, string> = {};

    for (const preset of CronTab.PRESETS) {
      table[MonitoringIntervalUtil.toLookupKey(preset.label)] = preset.value;
    }

    /*
     * The dashboard's own labels win where the two lists disagree on
     * wording, because that is what an operator sees on screen and what
     * they are most likely to paste into an API call.
     */
    for (const [label, cron] of Object.entries(DASHBOARD_DROPDOWN_LABELS)) {
      table[label] = cron;
    }

    for (const [label, cron] of Object.entries(ADVERB_LABELS)) {
      table[label] = cron;
    }

    return table;
  }

  private static labelTable: Record<string, string> | null = null;

  private static getLabelTable(): Record<string, string> {
    if (!MonitoringIntervalUtil.labelTable) {
      MonitoringIntervalUtil.labelTable =
        MonitoringIntervalUtil.buildLabelTable();
    }

    return MonitoringIntervalUtil.labelTable;
  }

  /*
   * "5m", "every 5 minutes", "2 hrs", "1 day" -> cron, or null.
   *
   * A missing count means one ("every minute", "hourly" handled above;
   * "minute" and "m" land here). The divisor guards above decide whether a
   * count is expressible as a cron step at all.
   */
  private static fromDurationGrammar(key: string): string | null {
    /*
     * A digit may sit flush against its unit ("5m"); a spelled-out number
     * needs a separator or "fiveminutes" would parse. Hence the two
     * alternatives rather than one `\s*`.
     */
    const match: RegExpMatchArray | null = key.match(
      /^(every\s+)?(?:(\d+)\s*|([a-z]+)\s+)?([a-z]+)$/,
    );

    if (!match) {
      return null;
    }

    const hasEveryPrefix: boolean = Boolean(match[1]);
    const digitCount: string | undefined = match[2];
    const wordCount: string | undefined = match[3];
    const unit: string = match[4]!;
    const rawCount: string | undefined = digitCount ?? wordCount;

    let count: number;

    if (rawCount === undefined) {
      /*
       * A bare unit with no count and no "every" is not a cadence, it is a
       * noun: "minutes" tells us nothing. Require one or the other, so
       * "every minute" and "1 minute" are read and "minutes" is refused.
       */
      if (!hasEveryPrefix) {
        return null;
      }

      count = 1;
    } else if (DIGITS_ONLY.test(rawCount)) {
      count = parseInt(rawCount, 10);
    } else {
      /*
       * Spelled-out numbers: "Every Five Minutes" is a real production
       * value, so the grammar has to read words as well as digits.
       */
      const spelled: number | undefined = SPELLED_NUMBERS[rawCount];

      if (spelled === undefined) {
        return null;
      }

      count = spelled;
    }

    if (!Number.isFinite(count) || count < 1) {
      return null;
    }

    if (MINUTE_UNITS.includes(unit)) {
      if (count === 1) {
        return "* * * * *";
      }

      if (count === 60) {
        return "0 * * * *";
      }

      return minutesDivideEvenly(count) ? `*/${count} * * * *` : null;
    }

    if (HOUR_UNITS.includes(unit)) {
      if (count === 1) {
        return "0 * * * *";
      }

      if (count === 24) {
        return "0 0 * * *";
      }

      return hoursDivideEvenly(count) ? `0 */${count} * * *` : null;
    }

    if (DAY_UNITS.includes(unit)) {
      return count === 1 ? "0 0 * * *" : null;
    }

    if (WEEK_UNITS.includes(unit)) {
      return count === 1 ? "0 0 * * 0" : null;
    }

    return null;
  }

  /**
   * Read a stored (or inbound) monitoring interval.
   *
   * Never throws. Never guesses at something it does not understand — an
   * unrecognized value comes back as Unrecognized with a null cron, and the
   * caller decides whether that is a 400, a log line, or a skipped row.
   */
  public static normalize(
    value: string | null | undefined,
  ): MonitoringIntervalNormalization {
    if (value === null || value === undefined || typeof value !== "string") {
      return {
        status: MonitoringIntervalNormalizationStatus.Empty,
        cron: null,
        input: null,
      };
    }

    const collapsed: string = value.replace(/[\s\u00a0]+/g, " ").trim();

    if (collapsed === "") {
      return {
        status: MonitoringIntervalNormalizationStatus.Empty,
        cron: null,
        input: value,
      };
    }

    /*
     * Valid cron first, and on the RAW value.
     *
     * This is what keeps the ~4,700 rows that were always correct on an
     * identical code path, byte for byte. It also means anything cron-parser
     * accepts but this hand-rolled grammar does not — "@hourly", six-field
     * expressions, step/range combinations nobody here anticipated — is
     * passed through untouched rather than being "corrected" into something
     * else. A normalizer that disagrees with the runtime parser would
     * reintroduce this very bug in mirror image.
     */
    if (CronTab.isValid(collapsed)) {
      return {
        status:
          collapsed === value
            ? MonitoringIntervalNormalizationStatus.AlreadyCanonical
            : MonitoringIntervalNormalizationStatus.Normalized,
        cron: collapsed,
        input: value,
      };
    }

    const key: string = MonitoringIntervalUtil.toLookupKey(collapsed);

    const fromLabel: string | undefined =
      MonitoringIntervalUtil.getLabelTable()[key];

    if (fromLabel) {
      return {
        status: MonitoringIntervalNormalizationStatus.Normalized,
        cron: fromLabel,
        input: value,
      };
    }

    /*
     * "every-1-min" and friends: treat a hyphen or underscore as a space and
     * try the label table and the grammar again. Done after the plain
     * lookup so a legitimate cron is never mangled by it.
     */
    const looseKey: string = key.replace(/[-_]+/g, " ").replace(/\s+/g, " ");

    const fromLooseLabel: string | undefined =
      MonitoringIntervalUtil.getLabelTable()[looseKey];

    if (fromLooseLabel) {
      return {
        status: MonitoringIntervalNormalizationStatus.Normalized,
        cron: fromLooseLabel,
        input: value,
      };
    }

    const fromGrammar: string | null =
      MonitoringIntervalUtil.fromDurationGrammar(key) ||
      MonitoringIntervalUtil.fromDurationGrammar(looseKey);

    if (fromGrammar) {
      return {
        status: MonitoringIntervalNormalizationStatus.Normalized,
        cron: fromGrammar,
        input: value,
      };
    }

    return {
      status: MonitoringIntervalNormalizationStatus.Unrecognized,
      cron: null,
      input: value,
    };
  }

  /**
   * The cron this value means, or null if it is empty or not understood.
   *
   * The convenience form for read paths that only want a schedule and have
   * their own fallback for "no schedule".
   */
  public static toCronOrNull(value: string | null | undefined): string | null {
    return MonitoringIntervalUtil.normalize(value).cron;
  }

  /**
   * The canonical cron for a recognised cadence label, for building error
   * messages that tell the caller what to write instead.
   */
  public static getSuggestedCronForMessage(): string {
    return "*/5 * * * *";
  }
}
