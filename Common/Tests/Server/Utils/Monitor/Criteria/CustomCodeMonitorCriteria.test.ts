import CustomCodeMonitoringCriteria from "../../../../../Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse, {
  CustomCodeMonitorResult,
} from "../../../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet is the
 * evaluator that turns a custom-code / synthetic monitor's response into a
 * breach message (truthy string) or a "no breach" verdict (null). It only
 * understands three CheckOns exposed by the custom-code criteria UI:
 * ExecutionTime, Error and ResultValue. Every other CheckOn falls through to
 * null. The numeric / string / empty comparisons themselves are delegated to
 * CompareCriteria, so these tests focus on the routing, threshold coercion and
 * precedence rules this class owns, plus the edge cases each branch exposes.
 */
function buildResponse(input: {
  result?: CustomCodeMonitorResult | undefined;
  scriptError?: string | undefined;
  executionTimeInMS?: number | undefined;
}): CustomCodeMonitorResponse {
  return {
    result: input.result,
    scriptError: input.scriptError,
    logMessages: [],
    capturedMetrics: [],
    /*
     * executionTimeInMS is typed as a required number, but production data can
     * legitimately arrive undefined (e.g. a script that never started). The
     * cast lets us exercise the `executionTimeInMS || 0` fallback in the
     * source without loosening the response type everywhere.
     */
    executionTimeInMS: input.executionTimeInMS as number,
  };
}

function evaluate(
  monitorResponse: CustomCodeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
    monitorResponse,
    criteriaFilter,
  });
}

describe("CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("CheckOn.ExecutionTime (numeric comparison)", () => {
    test("execution above threshold → met with an Execution Time message", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "ok", executionTimeInMS: 1500 }),
        {
          checkOn: CheckOn.ExecutionTime,
          filterType: FilterType.GreaterThan,
          value: 1000,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Execution Time");
      expect(result).toContain("greater than");
    });

    test("execution below threshold → not met", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 500 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: 1000,
          },
        ),
      ).toBeNull();
    });

    test("execution equal to threshold with GreaterThan → not met (strict)", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 1000 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: 1000,
          },
        ),
      ).toBeNull();
    });

    test("GreaterThanOrEqualTo is met exactly at the boundary", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 1000 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: 1000,
          },
        ),
      ).toBeTruthy();
    });

    test("LessThanOrEqualTo is met exactly at the boundary", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 1000 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.LessThanOrEqualTo,
            value: 1000,
          },
        ),
      ).toBeTruthy();
    });

    test("EqualTo matches an exact execution time", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 750 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.EqualTo,
            value: 750,
          },
        ),
      ).toBeTruthy();
    });

    test("NotEqualTo is met when the times differ", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 749 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.NotEqualTo,
            value: 750,
          },
        ),
      ).toBeTruthy();
    });

    test("a string threshold is coerced to a number (parseInt)", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 1500 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: "1000",
          },
        ),
      ).toBeTruthy();
    });

    test("a threshold of 0 is honored (not dropped as falsy)", async () => {
      expect(
        await evaluate(buildResponse({ result: "ok", executionTimeInMS: 5 }), {
          checkOn: CheckOn.ExecutionTime,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("a missing executionTimeInMS is treated as 0", async () => {
      /* undefined execution time → 0, which is < 100 → met. */
      const result: string | null = await evaluate(
        buildResponse({ result: "ok", executionTimeInMS: undefined }),
        {
          checkOn: CheckOn.ExecutionTime,
          filterType: FilterType.LessThan,
          value: 100,
        },
      );

      expect(result).toBeTruthy();
    });

    test("a missing executionTimeInMS (0) is not greater than 0", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: undefined }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ),
      ).toBeNull();
    });

    test("an undefined threshold makes the comparison a no-op → not met", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 5000 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: undefined,
          },
        ),
      ).toBeNull();
    });

    test("a non-numeric string threshold is discarded (NaN guard) → not met", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 5000 }),
          {
            checkOn: CheckOn.ExecutionTime,
            filterType: FilterType.GreaterThan,
            value: "not-a-number",
          },
        ),
      ).toBeNull();
    });
  });

  describe("CheckOn.Error (empty / not-empty and string comparison)", () => {
    test("IsEmpty is met when there is no scriptError", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "ok", scriptError: undefined }),
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Error");
      expect(result).toContain("empty");
    });

    test("IsEmpty is not met when a scriptError is present", async () => {
      expect(
        await evaluate(buildResponse({ result: "ok", scriptError: "Boom" }), {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsEmpty,
          value: undefined,
        }),
      ).toBeNull();
    });

    test("IsNotEmpty is met and echoes the error value", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "ok", scriptError: "Boom" }),
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Error");
      expect(result).toContain("Boom");
    });

    test("IsNotEmpty is not met when there is no scriptError", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", scriptError: undefined }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.IsNotEmpty,
            value: undefined,
          },
        ),
      ).toBeNull();
    });

    test("an empty-string scriptError counts as NOT empty", async () => {
      /*
       * compareEmptyAndNotEmpty only treats null / undefined as empty, so an
       * empty string is reported as "not empty" (with an empty value).
       */
      expect(
        await evaluate(buildResponse({ result: "ok", scriptError: "" }), {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        }),
      ).toBeTruthy();
    });

    test("an empty-string scriptError is therefore not met by IsEmpty", async () => {
      expect(
        await evaluate(buildResponse({ result: "ok", scriptError: "" }), {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsEmpty,
          value: undefined,
        }),
      ).toBeNull();
    });

    test("Contains matches a substring of the scriptError", async () => {
      const result: string | null = await evaluate(
        buildResponse({
          result: "ok",
          scriptError: "TypeError: x is undefined",
        }),
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.Contains,
          value: "TypeError",
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("contains");
    });

    test("Contains is not met when the substring is absent", async () => {
      expect(
        await evaluate(
          buildResponse({
            result: "ok",
            scriptError: "TypeError: x is undefined",
          }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.Contains,
            value: "SyntaxError",
          },
        ),
      ).toBeNull();
    });

    test("NotContains is met when the substring is absent", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", scriptError: "Timeout after 30s" }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.NotContains,
            value: "TypeError",
          },
        ),
      ).toBeTruthy();
    });

    test("StartsWith matches the leading text", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", scriptError: "TypeError: boom" }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.StartsWith,
            value: "TypeError",
          },
        ),
      ).toBeTruthy();
    });

    test("EndsWith matches the trailing text", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", scriptError: "failed: boom" }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.EndsWith,
            value: "boom",
          },
        ),
      ).toBeTruthy();
    });

    test("EqualTo matches an exact error string", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "ok", scriptError: "boom" }),
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.EqualTo,
          value: "boom",
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("equal to");
    });

    test("NotEqualTo is met when the error strings differ", async () => {
      expect(
        await evaluate(buildResponse({ result: "ok", scriptError: "boom" }), {
          checkOn: CheckOn.Error,
          filterType: FilterType.NotEqualTo,
          value: "bang",
        }),
      ).toBeTruthy();
    });

    test("a string filter with no scriptError falls through to null", async () => {
      /*
       * The string-comparison block requires scriptError to be a string, so a
       * Contains filter against an absent error is a no-op (and IsEmpty /
       * IsNotEmpty did not fire either) → null.
       */
      expect(
        await evaluate(
          buildResponse({ result: "ok", scriptError: undefined }),
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.Contains,
            value: "TypeError",
          },
        ),
      ).toBeNull();
    });

    test("IsNotEmpty truncates a very long error to 500 chars plus an ellipsis", async () => {
      const longError: string = "e".repeat(600);

      const result: string | null = await evaluate(
        buildResponse({ result: "ok", scriptError: longError }),
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result!.endsWith("...")).toBe(true);
      /* The full 600-char body must not be echoed verbatim. */
      expect(result).not.toContain(longError);
    });
  });

  describe("CheckOn.ResultValue (empty / numeric / string precedence)", () => {
    test("numeric result above a numeric threshold → met", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: 42 }),
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: 40,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Result Value");
      expect(result).toContain("greater than");
    });

    test("numeric result below a numeric threshold → not met", async () => {
      expect(
        await evaluate(buildResponse({ result: 42 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.LessThan,
          value: 40,
        }),
      ).toBeNull();
    });

    test("numeric result at the boundary with GreaterThanOrEqualTo → met", async () => {
      expect(
        await evaluate(buildResponse({ result: 40 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 40,
        }),
      ).toBeTruthy();
    });

    test("numeric result with EqualTo → met on an exact match", async () => {
      expect(
        await evaluate(buildResponse({ result: 42 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.EqualTo,
          value: 42,
        }),
      ).toBeTruthy();
    });

    test("numeric result with a string threshold uses parseFloat (decimals kept)", async () => {
      expect(
        await evaluate(buildResponse({ result: 40.6 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: "40.5",
        }),
      ).toBeTruthy();
    });

    test("string result with EqualTo → met on an exact match", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "success" }),
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.EqualTo,
          value: "success",
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("equal to");
    });

    test("string result with Contains → met on a substring", async () => {
      expect(
        await evaluate(buildResponse({ result: "healthy: true" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.Contains,
          value: "healthy",
        }),
      ).toBeTruthy();
    });

    test("string result with NotContains → met when absent", async () => {
      expect(
        await evaluate(buildResponse({ result: "error state" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.NotContains,
          value: "ok",
        }),
      ).toBeTruthy();
    });

    test("string result with StartsWith → met", async () => {
      expect(
        await evaluate(buildResponse({ result: "prefix-abc" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.StartsWith,
          value: "prefix",
        }),
      ).toBeTruthy();
    });

    test("string result with EndsWith → met", async () => {
      expect(
        await evaluate(buildResponse({ result: "abc-suffix" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.EndsWith,
          value: "suffix",
        }),
      ).toBeTruthy();
    });

    test("IsEmpty is met when the result is undefined", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: undefined }),
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("empty");
    });

    test("IsEmpty is met when the result is null", async () => {
      expect(
        await evaluate(buildResponse({ result: null }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsEmpty,
          value: undefined,
        }),
      ).toBeTruthy();
    });

    test("IsEmpty is NOT met when the result is 0 (a real value)", async () => {
      /* 0 is a legitimate result, not "empty" — only null/undefined are. */
      expect(
        await evaluate(buildResponse({ result: 0 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsEmpty,
          value: undefined,
        }),
      ).toBeNull();
    });

    test("IsNotEmpty is met and echoes a present result", async () => {
      const result: string | null = await evaluate(
        buildResponse({ result: "data" }),
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("data");
    });

    test("IsNotEmpty is not met when the result is undefined", async () => {
      expect(
        await evaluate(buildResponse({ result: undefined }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        }),
      ).toBeNull();
    });

    test("empty/not-empty takes precedence over the numeric comparison", async () => {
      /*
       * A numeric result with IsNotEmpty short-circuits into the not-empty
       * message before any threshold comparison is attempted.
       */
      const result: string | null = await evaluate(
        buildResponse({ result: 42 }),
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
      expect(result).toContain("not empty");
    });

    test("a boolean result is reported by IsNotEmpty but is not numerically comparable", async () => {
      expect(
        await evaluate(buildResponse({ result: true }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        }),
      ).toBeTruthy();

      /*
       * GreaterThan on a boolean result matches neither the numeric nor the
       * string branch, so it falls through to null.
       */
      expect(
        await evaluate(buildResponse({ result: true }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });

    test("a numeric result with an unmatched string filter → not met", async () => {
      /*
       * Contains is not a numeric comparator, and a number is not a string, so
       * neither branch fires → null.
       */
      expect(
        await evaluate(buildResponse({ result: 42 }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.Contains,
          value: "4",
        }),
      ).toBeNull();
    });

    test("a numeric-looking string result is not compared numerically", async () => {
      /*
       * "42" is a string, so it goes through compareCriteriaStrings, which has
       * no GreaterThan handling → null (no lexicographic-as-numeric surprise).
       */
      expect(
        await evaluate(buildResponse({ result: "42" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: "40",
        }),
      ).toBeNull();
    });

    test("a string result with an undefined threshold → not met", async () => {
      expect(
        await evaluate(buildResponse({ result: "success" }), {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.EqualTo,
          value: undefined,
        }),
      ).toBeNull();
    });
  });

  describe("unhandled CheckOns", () => {
    test("a non custom-code CheckOn returns null", async () => {
      expect(
        await evaluate(buildResponse({ result: 100, executionTimeInMS: 100 }), {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });

    test("CheckOn.ResponseTime is not handled by the custom-code evaluator", async () => {
      expect(
        await evaluate(
          buildResponse({ result: "ok", executionTimeInMS: 5000 }),
          {
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 10,
          },
        ),
      ).toBeNull();
    });
  });
});
