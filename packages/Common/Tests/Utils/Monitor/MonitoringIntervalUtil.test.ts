import MonitoringIntervalUtil, {
  MonitoringIntervalNormalization,
  MonitoringIntervalNormalizationStatus,
} from "../../../Utils/Monitor/MonitoringIntervalUtil";
import CronTab from "../../../Utils/CronTab";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * Monitor.monitoringInterval is free-text and was never validated. Rows
 * accumulated holding a human cadence ("5m", "Every 5 minutes") where a cron
 * expression was expected. cron-parser threw on those, the claim query
 * caught the throw and fell back to "one minute from now", and a monitor
 * configured for five minutes was probed every ~75 seconds — four times the
 * requested rate, silently, for as long as the row existed.
 *
 * 103 monitors across 10 projects were in that state. The ten distinct bad
 * values below are the REAL production census, not invented examples, and
 * every one of them is asserted individually.
 */

function normalize(value: string | null | undefined): string | null {
  return MonitoringIntervalUtil.toCronOrNull(value);
}

describe("MonitoringIntervalUtil", () => {
  describe("the production census — every bad value found in the wild", () => {
    /*
     * SELECT "monitoringInterval", count(*) FROM "Monitor"
     *   WHERE "deletedAt" IS NULL AND "monitoringInterval" is not cron
     * 103 rows, 10 distinct values, 10 projects.
     */
    const PRODUCTION_VALUES: Array<[string, string, number]> = [
      ["Every 5 minutes", "*/5 * * * *", 35],
      ["5m", "*/5 * * * *", 19],
      ["1 minute", "* * * * *", 18],
      ["Every 5 Minutes", "*/5 * * * *", 14],
      ["Every 1 minute", "* * * * *", 6],
      ["Every 2 minutes", "*/2 * * * *", 4],
      ["5 minutes", "*/5 * * * *", 3],
      ["1 day", "0 0 * * *", 2],
      ["every-1-min", "* * * * *", 1],
      ["Every Five Minutes", "*/5 * * * *", 1],
    ];

    test.each(PRODUCTION_VALUES)(
      "reads %j as %j (%i monitors in production)",
      (input: string, expectedCron: string) => {
        expect(normalize(input)).toBe(expectedCron);
      },
    );

    test("every production value now yields a parseable cron", () => {
      for (const [input] of PRODUCTION_VALUES) {
        const cron: string | null = normalize(input);

        /*
         * "Every Five Minutes" spells its number out, which the duration
         * grammar cannot read. It is covered by the exact-label table; if
         * that entry is ever dropped this assertion is what catches it.
         */
        expect(cron).not.toBeNull();
        expect(CronTab.isValid(cron as string)).toBe(true);
      }
    });

    test("the customer's value is five minutes apart, not one", () => {
      /*
       * The regression in one line: "5m" must not mean "every minute".
       */
      expect(normalize("5m")).toBe("*/5 * * * *");
      expect(normalize("5m")).not.toBe("* * * * *");
    });
  });

  describe("valid cron is returned untouched", () => {
    const VALID: Array<string> = [
      "* * * * *",
      "*/2 * * * *",
      "*/5 * * * *",
      "*/10 * * * *",
      "*/15 * * * *",
      "*/30 * * * *",
      "0 * * * *",
      "0 */6 * * *",
      "0 0 * * *",
      "0 0 * * 0",
      "0 9 * * 1",
      "3-59/5 * * * *",
      "0,15,30,45 * * * *",
    ];

    test.each(VALID)("%j passes through byte-identical", (cron: string) => {
      const result: MonitoringIntervalNormalization =
        MonitoringIntervalUtil.normalize(cron);

      expect(result.status).toBe(
        MonitoringIntervalNormalizationStatus.AlreadyCanonical,
      );
      expect(result.cron).toBe(cron);
    });

    test("cron-parser shortcuts are never REWRITTEN into something else", () => {
      /*
       * "@hourly" is a deliberate seam between the two parsers. The
       * isomorphic validator here is a hand-rolled 5-field check and does
       * not know it; cron-parser, which actually schedules the probe, does.
       *
       * What matters is that this util never GUESSES: it reports
       * Unrecognized with a null cron rather than rewriting "@hourly" into
       * "0 * * * *". The server validator's cron-parser fallback is what
       * accepts it on write, and resolveNextPingAt's raw-parse-first order
       * is what honours it at runtime — both covered in their own suites.
       * If this util ever started rewriting it, a stored value would change
       * under the customer for no behavioural gain.
       */
      const result: MonitoringIntervalNormalization =
        MonitoringIntervalUtil.normalize("@hourly");

      expect(result.status).toBe(
        MonitoringIntervalNormalizationStatus.Unrecognized,
      );
      expect(result.cron).toBeNull();
    });
  });

  describe("empty is a legitimate state, never an error", () => {
    /*
     * ~4,177 production rows are NULL or blank. A Manual monitor is never
     * probed; treating that as invalid would break every one of them.
     */
    test.each([null, undefined, "", "   ", "\t\n"])(
      "%j is Empty with a null cron",
      (value: string | null | undefined) => {
        const result: MonitoringIntervalNormalization =
          MonitoringIntervalUtil.normalize(value);

        expect(result.status).toBe(MonitoringIntervalNormalizationStatus.Empty);
        expect(result.cron).toBeNull();
      },
    );
  });

  describe("label tolerance", () => {
    test("is case-insensitive", () => {
      expect(normalize("EVERY 5 MINUTES")).toBe("*/5 * * * *");
      expect(normalize("every 5 minutes")).toBe("*/5 * * * *");
      expect(normalize("Every 5 Minutes")).toBe("*/5 * * * *");
    });

    test("collapses runs of whitespace, including a non-breaking space", () => {
      expect(normalize("Every  5   minutes")).toBe("*/5 * * * *");
      expect(normalize("  Every 5 minutes  ")).toBe("*/5 * * * *");
      // U+00A0 survives a copy-paste out of rendered docs.
      expect(normalize("Every 5 minutes")).toBe("*/5 * * * *");
    });

    test("strips wrapping quotes and a trailing period", () => {
      expect(normalize('"Every 5 minutes"')).toBe("*/5 * * * *");
      expect(normalize("'5m'")).toBe("*/5 * * * *");
      expect(normalize("Every 5 minutes.")).toBe("*/5 * * * *");
    });

    test("reads hyphenated and underscored forms", () => {
      expect(normalize("every-1-min")).toBe("* * * * *");
      expect(normalize("every_5_minutes")).toBe("*/5 * * * *");
    });

    test("covers every label the shared preset list offers", () => {
      /*
       * The table is built by iterating CronTab.PRESETS, so a preset added
       * there is understood here without anyone editing the util. This
       * asserts that wiring rather than the individual labels.
       */
      for (const preset of CronTab.PRESETS) {
        expect(normalize(preset.label)).toBe(preset.value);
      }
    });
  });

  describe("duration grammar", () => {
    test.each([
      ["1m", "* * * * *"],
      ["1 min", "* * * * *"],
      ["minutely", "* * * * *"],
      ["2m", "*/2 * * * *"],
      ["10 mins", "*/10 * * * *"],
      ["15 minutes", "*/15 * * * *"],
      ["30m", "*/30 * * * *"],
      ["60m", "0 * * * *"],
      ["1h", "0 * * * *"],
      ["hourly", "0 * * * *"],
      ["2 hours", "0 */2 * * *"],
      ["6h", "0 */6 * * *"],
      ["12 hrs", "0 */12 * * *"],
      ["24h", "0 0 * * *"],
      ["1d", "0 0 * * *"],
      ["daily", "0 0 * * *"],
      ["1 week", "0 0 * * 0"],
      ["weekly", "0 0 * * 0"],
    ])("reads %j as %j", (input: string, expected: string) => {
      expect(normalize(input)).toBe(expected);
    });
  });

  describe("refuses to store a lie", () => {
    /*
     * "*_/7 * * * *" fires at :00, :07 ... :56 and then :00 — a four-minute
     * gap at every hour wrap. It is NOT "every 7 minutes", so normalizing
     * "every 7 minutes" to it would store something false. Better to refuse
     * and let the caller write the cron they actually mean.
     */
    test.each([
      "7m",
      "every 7 minutes",
      "13 minutes",
      "5 hours",
      "7h",
      "2 days",
      "3 weeks",
    ])(
      "%j is Unrecognized rather than silently approximated",
      (input: string) => {
        const result: MonitoringIntervalNormalization =
          MonitoringIntervalUtil.normalize(input);

        expect(result.status).toBe(
          MonitoringIntervalNormalizationStatus.Unrecognized,
        );
        expect(result.cron).toBeNull();
      },
    );

    test("sub-minute cadences are not invented", () => {
      /*
       * The claim loop ticks once a minute, so a per-second cadence is a
       * promise the probe fleet cannot keep.
       */
      for (const input of ["30s", "1s", "10 seconds", "1 sec"]) {
        expect(normalize(input)).toBeNull();
      }
    });
  });

  describe("genuine nonsense stays Unrecognized", () => {
    test.each([
      "banana",
      "asap",
      "not a cron",
      "soon",
      "-1m",
      "0m",
      "every",
      "minutes",
    ])("%j", (input: string) => {
      expect(normalize(input)).toBeNull();
    });
  });

  describe("totality", () => {
    /*
     * It runs in a write hook, on the scheduler hot path and inside a
     * migration. A throw in any of those is worse than a null.
     */
    test("never throws, whatever it is handed", () => {
      const hostile: Array<unknown> = [
        null,
        undefined,
        "",
        "🙂",
        "*".repeat(5000),
        "{{ variable }}",
        "; DROP TABLE Monitor; --",
        " ",
        12345,
        {},
        [],
      ];

      for (const value of hostile) {
        expect(() => {
          return MonitoringIntervalUtil.normalize(value as string);
        }).not.toThrow();
      }
    });

    test("is idempotent — normalizing its own output changes nothing", () => {
      const inputs: Array<string> = [
        "5m",
        "Every 5 minutes",
        "1 day",
        "every-1-min",
        "*/5 * * * *",
      ];

      for (const input of inputs) {
        const once: string | null = normalize(input);
        expect(once).not.toBeNull();
        expect(normalize(once)).toBe(once);
      }
    });
  });
});
