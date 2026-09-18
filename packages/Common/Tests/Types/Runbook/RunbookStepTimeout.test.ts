import { describe, expect, test } from "@jest/globals";
import {
  AGENT_CLAIM_TIMEOUT_BOUNDS,
  NON_NUMERIC_TIMEOUT_MESSAGE,
  willTimeoutBeClamped,
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
  MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
  MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
  STEP_EXECUTION_TIMEOUT_BOUNDS,
  TimeoutBounds,
  getTimeoutValidationError,
  resolveAgentClaimTimeoutInMs,
  resolveStepExecutionTimeoutInMs,
  resolveTimeoutInMs,
  secondsInputValueToTimeoutInMs,
  timeoutInMsToSecondsInputValue,
} from "../../../Types/Runbook/RunbookStepTimeout";

describe("Runbook step timeout bounds", () => {
  test("documented defaults stay put — the docs promise 30s execution and 2m claim", () => {
    expect(DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS).toBe(30_000);
    expect(DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS).toBe(120_000);
  });

  test("each bound set is internally consistent: min <= default <= max", () => {
    const boundSets: Array<TimeoutBounds> = [
      STEP_EXECUTION_TIMEOUT_BOUNDS,
      AGENT_CLAIM_TIMEOUT_BOUNDS,
    ];

    for (const bounds of boundSets) {
      expect(bounds.minInMs).toBeLessThanOrEqual(bounds.defaultInMs);
      expect(bounds.defaultInMs).toBeLessThanOrEqual(bounds.maxInMs);
      expect(bounds.minInMs).toBeGreaterThan(0);
    }
  });

  test("the exported bound objects mirror the individual constants", () => {
    expect(STEP_EXECUTION_TIMEOUT_BOUNDS).toEqual({
      defaultInMs: DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      minInMs: MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
      maxInMs: MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
    });
    expect(AGENT_CLAIM_TIMEOUT_BOUNDS).toEqual({
      defaultInMs: DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      minInMs: MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
      maxInMs: MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
    });
  });
});

describe("resolveTimeoutInMs", () => {
  const bounds: TimeoutBounds = {
    defaultInMs: 30_000,
    minInMs: 1_000,
    maxInMs: 60_000,
  };

  test("a value inside the range is used as configured", () => {
    expect(resolveTimeoutInMs(45_000, bounds)).toBe(45_000);
  });

  test("the boundaries themselves are accepted, not clamped away", () => {
    expect(resolveTimeoutInMs(bounds.minInMs, bounds)).toBe(bounds.minInMs);
    expect(resolveTimeoutInMs(bounds.maxInMs, bounds)).toBe(bounds.maxInMs);
  });

  test("unset values fall back to the default", () => {
    expect(resolveTimeoutInMs(undefined, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs(null, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs("", bounds)).toBe(30_000);
  });

  test("zero and negatives fall back to the default rather than disabling the timeout", () => {
    expect(resolveTimeoutInMs(0, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs(-1, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs(-999_999, bounds)).toBe(30_000);
  });

  test("junk values fall back to the default instead of throwing", () => {
    expect(resolveTimeoutInMs(NaN, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs(Infinity, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs(-Infinity, bounds)).toBe(30_000);
    expect(resolveTimeoutInMs("not a number", bounds)).toBe(30_000);
    expect(resolveTimeoutInMs({} as unknown as number, bounds)).toBe(30_000);
  });

  test("numeric strings are accepted — JSON step configs are not type-checked at rest", () => {
    expect(resolveTimeoutInMs("5000", bounds)).toBe(5_000);
    expect(resolveTimeoutInMs(" 5000 ", bounds)).toBe(5_000);
  });

  test("values below the minimum are raised to the minimum", () => {
    expect(resolveTimeoutInMs(1, bounds)).toBe(1_000);
    expect(resolveTimeoutInMs(999, bounds)).toBe(1_000);
  });

  test("values above the maximum are capped so one step cannot pin a Worker slot open", () => {
    expect(resolveTimeoutInMs(60_001, bounds)).toBe(60_000);
    expect(resolveTimeoutInMs(Number.MAX_SAFE_INTEGER, bounds)).toBe(60_000);
  });

  test("fractional milliseconds are rounded to whole milliseconds", () => {
    expect(resolveTimeoutInMs(5_000.4, bounds)).toBe(5_000);
    expect(resolveTimeoutInMs(5_000.6, bounds)).toBe(5_001);
  });

  test("a fractional value below the minimum still lands on the minimum", () => {
    expect(resolveTimeoutInMs(0.5, bounds)).toBe(1_000);
  });
});

describe("resolveStepExecutionTimeoutInMs", () => {
  test("defaults to 30 seconds when unset", () => {
    expect(resolveStepExecutionTimeoutInMs(undefined)).toBe(
      DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("honours a configured value", () => {
    expect(resolveStepExecutionTimeoutInMs(5 * 60_000)).toBe(300_000);
  });

  test("clamps to the execution bounds", () => {
    expect(resolveStepExecutionTimeoutInMs(1)).toBe(
      MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(resolveStepExecutionTimeoutInMs(999 * 60 * 60_000)).toBe(
      MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });
});

describe("resolveAgentClaimTimeoutInMs", () => {
  test("defaults to 2 minutes when unset", () => {
    expect(resolveAgentClaimTimeoutInMs(undefined)).toBe(
      DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
    );
  });

  test("honours a configured value", () => {
    expect(resolveAgentClaimTimeoutInMs(10 * 60_000)).toBe(600_000);
  });

  test("clamps to the claim bounds", () => {
    expect(resolveAgentClaimTimeoutInMs(10)).toBe(
      MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
    );
    expect(resolveAgentClaimTimeoutInMs(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
    );
  });

  test("execution and claim timeouts are resolved independently", () => {
    /*
     * A 45 minute execution timeout is legal; the same number as a claim
     * timeout is also legal. Resolving one must not leak the other's bounds.
     */
    expect(resolveStepExecutionTimeoutInMs(45 * 60_000)).toBe(2_700_000);
    expect(resolveAgentClaimTimeoutInMs(45 * 60_000)).toBe(2_700_000);
  });
});

describe("timeoutInMsToSecondsInputValue", () => {
  test("milliseconds render as seconds", () => {
    expect(timeoutInMsToSecondsInputValue(30_000)).toBe("30");
    expect(timeoutInMsToSecondsInputValue(120_000)).toBe("120");
  });

  test("unset values render as an empty field, which reads as 'use the default'", () => {
    expect(timeoutInMsToSecondsInputValue(undefined)).toBe("");
    expect(timeoutInMsToSecondsInputValue(null)).toBe("");
  });

  test("zero and negatives render as empty rather than as a literal 0", () => {
    expect(timeoutInMsToSecondsInputValue(0)).toBe("");
    expect(timeoutInMsToSecondsInputValue(-5_000)).toBe("");
  });

  test("non-numeric values render as empty", () => {
    expect(timeoutInMsToSecondsInputValue(NaN)).toBe("");
  });

  test("sub-second values keep their decimal instead of collapsing to 0", () => {
    expect(timeoutInMsToSecondsInputValue(500)).toBe("0.5");
    expect(timeoutInMsToSecondsInputValue(1_500)).toBe("1.5");
  });
});

describe("secondsInputValueToTimeoutInMs", () => {
  test("seconds are stored as milliseconds", () => {
    expect(secondsInputValueToTimeoutInMs("30")).toBe(30_000);
    expect(secondsInputValueToTimeoutInMs("120")).toBe(120_000);
  });

  test("a blank field means unset, not zero", () => {
    expect(secondsInputValueToTimeoutInMs("")).toBeUndefined();
    expect(secondsInputValueToTimeoutInMs("   ")).toBeUndefined();
  });

  test("zero, negatives and junk mean unset", () => {
    expect(secondsInputValueToTimeoutInMs("0")).toBeUndefined();
    expect(secondsInputValueToTimeoutInMs("-5")).toBeUndefined();
    expect(secondsInputValueToTimeoutInMs("abc")).toBeUndefined();
  });

  test("decimals are converted to whole milliseconds", () => {
    expect(secondsInputValueToTimeoutInMs("0.5")).toBe(500);
    expect(secondsInputValueToTimeoutInMs("1.25")).toBe(1_250);
    expect(secondsInputValueToTimeoutInMs("0.001")).toBe(1);
  });

  test("input that rounds down to zero milliseconds reports as unset, not as 0", () => {
    /*
     * A literal 0 in the step config would mean nothing — every consumer
     * treats it as "unset" anyway, so it must not be written in the first
     * place.
     */
    expect(secondsInputValueToTimeoutInMs("0.0004")).toBeUndefined();
    expect(secondsInputValueToTimeoutInMs("0.00001")).toBeUndefined();
  });

  test("never returns a value that resolution would treat as unusable", () => {
    const inputs: Array<string> = [
      "",
      "0",
      "-1",
      "abc",
      "0.0004",
      "0.5",
      "1",
      "30",
      "99999",
    ];

    for (const input of inputs) {
      const result: number | undefined = secondsInputValueToTimeoutInMs(input);
      if (result !== undefined) {
        expect(result).toBeGreaterThan(0);
        expect(isFinite(result)).toBe(true);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });

  test("surrounding whitespace is tolerated", () => {
    expect(secondsInputValueToTimeoutInMs(" 45 ")).toBe(45_000);
  });

  test("round-trips with the seconds renderer", () => {
    const values: Array<number> = [1_000, 30_000, 120_000, 500, 3_600_000];

    for (const ms of values) {
      expect(
        secondsInputValueToTimeoutInMs(timeoutInMsToSecondsInputValue(ms)),
      ).toBe(ms);
    }
  });
});

describe("getTimeoutValidationError", () => {
  const bounds: TimeoutBounds = {
    defaultInMs: 30_000,
    minInMs: 1_000,
    maxInMs: 3_600_000,
  };

  test("a blank field is valid — it means 'use the default'", () => {
    expect(getTimeoutValidationError("", bounds)).toBeNull();
    expect(getTimeoutValidationError("   ", bounds)).toBeNull();
  });

  test("in-range values are valid", () => {
    expect(getTimeoutValidationError("30", bounds)).toBeNull();
    expect(getTimeoutValidationError("1", bounds)).toBeNull();
    expect(getTimeoutValidationError("3600", bounds)).toBeNull();
  });

  test("non-numeric input is rejected", () => {
    expect(getTimeoutValidationError("abc", bounds)).toBe(
      NON_NUMERIC_TIMEOUT_MESSAGE,
    );
  });

  test("zero and negatives are rejected", () => {
    expect(getTimeoutValidationError("0", bounds)).toContain("greater than 0");
    expect(getTimeoutValidationError("-3", bounds)).toContain("greater than 0");
  });

  test("input that rounds down to zero milliseconds is rejected as zero, not as below-minimum", () => {
    /*
     * It falls back to the default rather than being clamped up to the
     * minimum, so telling the author "minimum is 1 second" would describe the
     * wrong outcome.
     */
    expect(getTimeoutValidationError("0.0004", bounds)).toContain(
      "greater than 0",
    );
  });

  test("below-minimum values report the minimum", () => {
    expect(getTimeoutValidationError("0.5", bounds)).toContain("Minimum is 1");
  });

  test("above-maximum values report the maximum", () => {
    expect(getTimeoutValidationError("3601", bounds)).toContain("Maximum is");
  });

  test("the minimum message is singular for a one-second floor", () => {
    expect(getTimeoutValidationError("0.5", bounds)).toBe(
      "Minimum is 1 second.",
    );
  });

  test("the minimum message is plural for a multi-second floor", () => {
    expect(
      getTimeoutValidationError("1", {
        defaultInMs: 30_000,
        minInMs: 5_000,
        maxInMs: 60_000,
      }),
    ).toBe("Minimum is 5 seconds.");
  });

  test("anything the validator accepts survives resolution unchanged", () => {
    /*
     * The editor's guard rails and the Worker's clamp have to agree: an input
     * the UI calls valid must not be silently rewritten at run time.
     */
    const acceptedInputs: Array<string> = ["1", "30", "120", "600", "3600"];

    for (const input of acceptedInputs) {
      expect(getTimeoutValidationError(input, bounds)).toBeNull();
      const inMs: number | undefined = secondsInputValueToTimeoutInMs(input);
      expect(resolveTimeoutInMs(inMs, bounds)).toBe(inMs);
    }
  });

  test("the clamp predicate agrees with what resolution actually does", () => {
    /*
     * The editor tells the author which of two things will happen to a rejected
     * value: clamped into range, or dropped for the default. That copy is only
     * trustworthy if the predicate matches the resolver, so check both against
     * the resolver's real output.
     */
    const inputs: Array<string> = [
      "",
      "0",
      "-5",
      "abc",
      "0.0004",
      "0.5",
      "1",
      "30",
      "3600",
      "3601",
      "99999",
    ];

    for (const input of inputs) {
      const inMs: number | undefined = secondsInputValueToTimeoutInMs(input);
      const resolved: number = resolveTimeoutInMs(inMs, bounds);
      const clampPredicted: boolean = willTimeoutBeClamped(input, bounds);

      if (clampPredicted) {
        // Claimed clamped: the value was usable and moved to a bound.
        expect(inMs).not.toBeUndefined();
        expect(resolved).not.toBe(inMs);
        expect([bounds.minInMs, bounds.maxInMs]).toContain(resolved);
      } else if (inMs === undefined) {
        // Claimed default: resolution really does hand back the default.
        expect(resolved).toBe(bounds.defaultInMs);
      } else {
        // Neither: the value was in range and survived untouched.
        expect(resolved).toBe(inMs);
      }
    }
  });

  test("in-range and unusable values are not advertised as clamped", () => {
    expect(willTimeoutBeClamped("", bounds)).toBe(false);
    expect(willTimeoutBeClamped("0", bounds)).toBe(false);
    expect(willTimeoutBeClamped("abc", bounds)).toBe(false);
    expect(willTimeoutBeClamped("0.0004", bounds)).toBe(false);
    expect(willTimeoutBeClamped("30", bounds)).toBe(false);
  });

  test("usable out-of-range values are advertised as clamped", () => {
    expect(willTimeoutBeClamped("0.5", bounds)).toBe(true);
    expect(willTimeoutBeClamped("3601", bounds)).toBe(true);
    expect(willTimeoutBeClamped("99999", bounds)).toBe(true);
  });

  test("anything the validator rejects is still made safe by resolution", () => {
    const rejectedInputs: Array<string> = ["0", "-10", "abc", "0.5", "999999"];

    for (const input of rejectedInputs) {
      expect(getTimeoutValidationError(input, bounds)).not.toBeNull();
      const resolved: number = resolveTimeoutInMs(
        secondsInputValueToTimeoutInMs(input),
        bounds,
      );
      expect(resolved).toBeGreaterThanOrEqual(bounds.minInMs);
      expect(resolved).toBeLessThanOrEqual(bounds.maxInMs);
    }
  });
});
