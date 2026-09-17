import {
  DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
  DEFAULT_MONITOR_RETRY_COUNT,
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_RETRY_COUNT,
  clampMonitorRequestTimeoutInMs,
  clampMonitorRetryCount,
} from "../../../Types/Monitor/MonitorStep";
import { describe, expect, test } from "@jest/globals";

/*
 * clampMonitorRequestTimeoutInMs constrains a per-step request timeout to the
 * range the probe accepts. It has three decision points:
 *   1. a falsy value (0 / NaN and, defensively, null / undefined) -> DEFAULT
 *   2. a non-positive value (value <= 0) -> DEFAULT
 *   3. a value above the cap (value > MAX) -> MAX
 * anything else passes through unchanged. These tests walk each branch, both
 * boundaries and the defensive coercions the callers can hand it.
 *
 * Note: with the current config DEFAULT and MAX happen to share the value
 * 60000, so every assertion checks the constant that names the branch under
 * test rather than the bare number, keeping the intent readable even if the
 * two constants diverge later.
 */

describe("clampMonitorRequestTimeoutInMs", () => {
  describe("invalid / non-positive inputs fall back to the default", () => {
    test("zero returns the default (caught by the falsy check)", () => {
      const result: number = clampMonitorRequestTimeoutInMs(0);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("negative zero returns the default", () => {
      const result: number = clampMonitorRequestTimeoutInMs(-0);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("NaN returns the default (NaN is falsy)", () => {
      const result: number = clampMonitorRequestTimeoutInMs(NaN);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("a small negative value returns the default (value <= 0 branch)", () => {
      const result: number = clampMonitorRequestTimeoutInMs(-1);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("a negative fraction returns the default", () => {
      const result: number = clampMonitorRequestTimeoutInMs(-0.5);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("a large negative value returns the default, not a clamp", () => {
      const result: number = clampMonitorRequestTimeoutInMs(-999999);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("negative Infinity returns the default", () => {
      const result: number = clampMonitorRequestTimeoutInMs(-Infinity);
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    /*
     * The signature is typed as number, but real callers (JSON / DB rows,
     * loosely typed UI state) can hand it a missing value. The falsy guard is
     * what protects the probe here, so exercise it explicitly.
     */
    test("undefined coerced through the signature returns the default", () => {
      const result: number = clampMonitorRequestTimeoutInMs(
        undefined as unknown as number,
      );
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("null coerced through the signature returns the default", () => {
      const result: number = clampMonitorRequestTimeoutInMs(
        null as unknown as number,
      );
      expect(result).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });
  });

  describe("in-range values pass through unchanged", () => {
    test("the smallest positive integer is returned as-is", () => {
      const result: number = clampMonitorRequestTimeoutInMs(1);
      expect(result).toBe(1);
    });

    test("a fractional millisecond value is preserved", () => {
      const result: number = clampMonitorRequestTimeoutInMs(1500.75);
      expect(result).toBe(1500.75);
    });

    test("a typical mid-range timeout is returned unchanged", () => {
      const result: number = clampMonitorRequestTimeoutInMs(30000);
      expect(result).toBe(30000);
    });

    test("a value just below the cap is not clamped", () => {
      const justUnder: number = MAX_MONITOR_REQUEST_TIMEOUT_IN_MS - 1;
      const result: number = clampMonitorRequestTimeoutInMs(justUnder);
      expect(result).toBe(justUnder);
    });
  });

  describe("the upper boundary", () => {
    test("a value exactly at the cap is returned, not clamped (> is strict)", () => {
      const result: number = clampMonitorRequestTimeoutInMs(
        MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
      );
      expect(result).toBe(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("one millisecond over the cap is clamped down to the cap", () => {
      const result: number = clampMonitorRequestTimeoutInMs(
        MAX_MONITOR_REQUEST_TIMEOUT_IN_MS + 1,
      );
      expect(result).toBe(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });
  });

  describe("values well above the cap are clamped", () => {
    test("a value far above the cap is clamped to the cap", () => {
      const result: number = clampMonitorRequestTimeoutInMs(
        MAX_MONITOR_REQUEST_TIMEOUT_IN_MS * 10,
      );
      expect(result).toBe(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });

    test("positive Infinity is clamped to the cap", () => {
      const result: number = clampMonitorRequestTimeoutInMs(Infinity);
      expect(result).toBe(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS);
    });
  });

  describe("purity and stability", () => {
    test("the same input always yields the same output", () => {
      const first: number = clampMonitorRequestTimeoutInMs(45000);
      const second: number = clampMonitorRequestTimeoutInMs(45000);
      expect(first).toBe(second);
      expect(first).toBe(45000);
    });

    test("the exported cap is a positive finite number", () => {
      expect(Number.isFinite(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS)).toBe(true);
      expect(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS).toBeGreaterThan(0);
    });

    test("the clamped result never exceeds the cap across a sweep", () => {
      const samples: Array<number> = [
        -5000,
        0,
        1,
        500,
        60000,
        60001,
        250000,
        Infinity,
        NaN,
      ];
      for (const sample of samples) {
        const result: number = clampMonitorRequestTimeoutInMs(sample);
        expect(result).toBeLessThanOrEqual(MAX_MONITOR_REQUEST_TIMEOUT_IN_MS);
        expect(result).toBeGreaterThan(0);
      }
    });
  });
});

/*
 * clampMonitorRetryCount constrains how many times a probe retries a step. Its
 * guard differs from the timeout clamp in one behaviour that matters: the lower
 * bound is `value < 0`, NOT `value <= 0`. Zero is therefore a VALID retry count
 * (retry never) and must pass through unchanged, whereas only genuinely invalid
 * inputs (undefined / null / NaN / negative) fall back to the default. These
 * tests pin exactly that zero-is-valid distinction plus the usual boundary and
 * defensive-coercion cases.
 */
describe("clampMonitorRetryCount", () => {
  describe("invalid inputs fall back to the default", () => {
    test("NaN returns the default", () => {
      expect(clampMonitorRetryCount(NaN)).toBe(DEFAULT_MONITOR_RETRY_COUNT);
    });

    test("a negative value returns the default (not a clamp to zero)", () => {
      expect(clampMonitorRetryCount(-1)).toBe(DEFAULT_MONITOR_RETRY_COUNT);
    });

    test("negative Infinity returns the default", () => {
      expect(clampMonitorRetryCount(-Infinity)).toBe(
        DEFAULT_MONITOR_RETRY_COUNT,
      );
    });

    test("undefined coerced through the signature returns the default", () => {
      expect(clampMonitorRetryCount(undefined as unknown as number)).toBe(
        DEFAULT_MONITOR_RETRY_COUNT,
      );
    });

    test("null coerced through the signature returns the default", () => {
      expect(clampMonitorRetryCount(null as unknown as number)).toBe(
        DEFAULT_MONITOR_RETRY_COUNT,
      );
    });
  });

  describe("zero is a valid retry count", () => {
    test("zero passes through unchanged (retry never)", () => {
      // The whole point of `< 0` rather than `<= 0`: 0 is a real choice.
      expect(clampMonitorRetryCount(0)).toBe(0);
    });

    test("negative zero also passes through as a numeric zero", () => {
      /*
       * -0 < 0 is false, so -0 is not treated as invalid and passes through.
       * It stays -0 (toBe uses Object.is, under which -0 !== 0), which is still
       * numerically zero — assert that rather than the Object.is identity.
       */
      const result: number = clampMonitorRetryCount(-0);
      expect(result === 0).toBe(true);
      expect(Math.abs(result)).toBe(0);
    });
  });

  describe("in-range and boundary values", () => {
    test("a value between 0 and the cap is returned unchanged", () => {
      expect(clampMonitorRetryCount(1)).toBe(1);
      expect(clampMonitorRetryCount(2)).toBe(2);
    });

    test("a value exactly at the cap is returned, not clamped", () => {
      expect(clampMonitorRetryCount(MAX_MONITOR_RETRY_COUNT)).toBe(
        MAX_MONITOR_RETRY_COUNT,
      );
    });

    test("one over the cap is clamped down to the cap", () => {
      expect(clampMonitorRetryCount(MAX_MONITOR_RETRY_COUNT + 1)).toBe(
        MAX_MONITOR_RETRY_COUNT,
      );
    });

    test("positive Infinity is clamped to the cap", () => {
      expect(clampMonitorRetryCount(Infinity)).toBe(MAX_MONITOR_RETRY_COUNT);
    });
  });

  describe("stability and invariants", () => {
    test("the exported cap and default are non-negative finite numbers", () => {
      expect(Number.isFinite(MAX_MONITOR_RETRY_COUNT)).toBe(true);
      expect(MAX_MONITOR_RETRY_COUNT).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_MONITOR_RETRY_COUNT).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_MONITOR_RETRY_COUNT).toBeLessThanOrEqual(
        MAX_MONITOR_RETRY_COUNT,
      );
    });

    test("across a sweep the result is always within [0, cap]", () => {
      const samples: Array<number> = [
        -100,
        -1,
        0,
        1,
        2,
        3,
        4,
        1000,
        Infinity,
        NaN,
      ];
      for (const sample of samples) {
        const result: number = clampMonitorRetryCount(sample);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(MAX_MONITOR_RETRY_COUNT);
      }
    });
  });
});
