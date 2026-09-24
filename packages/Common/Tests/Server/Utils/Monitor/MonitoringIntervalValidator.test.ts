import MonitoringIntervalValidator from "../../../../Server/Utils/Monitor/MonitoringIntervalValidator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The write-time policy for Monitor.monitoringInterval. The column was free
 * text with no validation at all, which is how 103 monitors across 10
 * projects ended up holding a human cadence ("5m", "Every 5 minutes") that
 * the scheduler could not read — and silently probed four times too often.
 *
 * The policy has to hold two lines at once:
 *   - refuse values nobody can act on, so the column stops accumulating them;
 *   - never refuse a value the RUNTIME parser would happily have scheduled,
 *     because a validator that disagrees with the scheduler is this same bug
 *     in mirror image.
 */

describe("MonitoringIntervalValidator.validateAndNormalize", () => {
  describe("canonicalizes what it understands", () => {
    test.each([
      ["5m", "*/5 * * * *"],
      ["Every 5 minutes", "*/5 * * * *"],
      ["Every 5 Minutes", "*/5 * * * *"],
      ["Every Five Minutes", "*/5 * * * *"],
      ["1 minute", "* * * * *"],
      ["Every 1 minute", "* * * * *"],
      ["Every 2 minutes", "*/2 * * * *"],
      ["5 minutes", "*/5 * * * *"],
      ["1 day", "0 0 * * *"],
      ["every-1-min", "* * * * *"],
    ])("%j is stored as %j", (input: string, expected: string) => {
      expect(MonitoringIntervalValidator.validateAndNormalize(input)).toBe(
        expected,
      );
    });

    test("already-canonical cron is stored byte-identical", () => {
      for (const cron of [
        "* * * * *",
        "*/5 * * * *",
        "0 */6 * * *",
        "0 0 * * 0",
      ]) {
        expect(MonitoringIntervalValidator.validateAndNormalize(cron)).toBe(
          cron,
        );
      }
    });
  });

  describe("empty means no schedule, and is always legal", () => {
    /*
     * A Manual monitor is never probed. ~4,177 production rows are in this
     * state and must not start throwing on an unrelated edit.
     */
    test.each([null, undefined, "", "   "])(
      "%j is accepted and stored as null",
      (value: string | null | undefined) => {
        expect(
          MonitoringIntervalValidator.validateAndNormalize(value),
        ).toBeNull();
      },
    );
  });

  describe("never refuses what the scheduler could run", () => {
    test("accepts a cron-parser shortcut the isomorphic grammar does not know", () => {
      /*
       * The isomorphic normalizer reports "@hourly" as Unrecognized, but
       * cron-parser — the thing that actually computes nextPingAt — reads it
       * fine. The validator must defer to the runtime parser, and must pass
       * the value through UNCHANGED rather than rewriting it.
       */
      expect(MonitoringIntervalValidator.validateAndNormalize("@hourly")).toBe(
        "@hourly",
      );
    });

    test.each(["@daily", "@weekly", "@monthly", "@yearly"])(
      "accepts %j unchanged",
      (shortcut: string) => {
        expect(MonitoringIntervalValidator.validateAndNormalize(shortcut)).toBe(
          shortcut,
        );
      },
    );

    test("accepts exotic but valid cron", () => {
      for (const cron of [
        "3-59/5 * * * *",
        "0,15,30,45 * * * *",
        "0 9 * * 1-5",
      ]) {
        expect(MonitoringIntervalValidator.validateAndNormalize(cron)).toBe(
          cron,
        );
      }
    });
  });

  describe("refuses what it cannot honour", () => {
    test.each(["banana", "asap", "soon", "not a cron", "every 7 minutes"])(
      "%j throws BadDataException",
      (input: string) => {
        expect(() => {
          return MonitoringIntervalValidator.validateAndNormalize(input);
        }).toThrow(BadDataException);
      },
    );

    test("the error message names a cron the caller can copy", () => {
      /*
       * The whole reason these rows exist is that we never told anyone what
       * this field wanted. An error that only says "invalid" repeats the
       * mistake.
       */
      let message: string = "";

      try {
        MonitoringIntervalValidator.validateAndNormalize("banana");
      } catch (err) {
        message = (err as BadDataException).message;
      }

      expect(message).toContain("banana");
      expect(message).toContain("*/5 * * * *");
      expect(message.toLowerCase()).toContain("cron");
    });

    test("refuses a sub-minute schedule the probe fleet cannot deliver", () => {
      /*
       * cron-parser accepts 6-field per-second expressions. Without an
       * explicit floor an API client would ask for a per-second probe and
       * silently receive a per-minute one — the exact shape of the bug this
       * file exists to close, just in the other direction.
       */
      expect(() => {
        return MonitoringIntervalValidator.validateAndNormalize("* * * * * *");
      }).toThrow(BadDataException);

      expect(() => {
        return MonitoringIntervalValidator.validateAndNormalize(
          "*/30 * * * * *",
        );
      }).toThrow(BadDataException);
    });

    test("the fastest supported schedule is still accepted", () => {
      expect(
        MonitoringIntervalValidator.validateAndNormalize("* * * * *"),
      ).toBe("* * * * *");
    });
  });

  describe("idempotence", () => {
    test("validating a stored value again changes nothing", () => {
      for (const input of [
        "5m",
        "Every 5 minutes",
        "1 day",
        "*/5 * * * *",
        "@hourly",
      ]) {
        const once: string | null =
          MonitoringIntervalValidator.validateAndNormalize(input);
        expect(MonitoringIntervalValidator.validateAndNormalize(once)).toBe(
          once,
        );
      }
    });
  });

  describe("normalizeForRead", () => {
    test("is total — a row written before this validator existed is not an exception", () => {
      expect(MonitoringIntervalValidator.normalizeForRead("5m")).toBe(
        "*/5 * * * *",
      );
      expect(MonitoringIntervalValidator.normalizeForRead("banana")).toBeNull();
      expect(MonitoringIntervalValidator.normalizeForRead(null)).toBeNull();

      expect(() => {
        return MonitoringIntervalValidator.normalizeForRead("🙂");
      }).not.toThrow();
    });
  });
});
