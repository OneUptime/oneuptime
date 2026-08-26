import {
  LlmCostMetricNames,
  LlmInputTokenTypeValues,
  LlmOutputTokenTypeValues,
  LlmTokenDirection,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
  getLlmTokenDirection,
  getLlmTokenTypeValues,
} from "../../../Types/Telemetry/LlmMetricConventions";
import { describe, expect, test } from "@jest/globals";

describe("LlmMetricConventions", () => {
  describe("metric name lists", () => {
    test("token usage list leads with the OTel semantic convention", () => {
      expect(LlmTokenUsageMetricNames[0]).toBe("gen_ai.client.token.usage");
    });

    test("cost list leads with the gen_ai-namespaced spelling", () => {
      expect(LlmCostMetricNames[0]).toBe("gen_ai.client.cost");
    });

    test("token usage list covers the pre-convention spellings", () => {
      expect(LlmTokenUsageMetricNames).toEqual(
        expect.arrayContaining([
          "gen_ai.client.token.usage",
          "gen_ai.client.token.count",
          "llm.token.usage",
          "llm.usage.tokens",
        ]),
      );
    });

    test("cost list covers the LiteLLM gateway spellings", () => {
      expect(LlmCostMetricNames).toEqual(
        expect.arrayContaining(["litellm_spend_metric", "litellm.cost.total"]),
      );
    });

    test("no metric name appears in both lists", () => {
      const overlap: Array<string> = LlmTokenUsageMetricNames.filter(
        (name: string) => {
          return LlmCostMetricNames.includes(name);
        },
      );

      expect(overlap).toEqual([]);
    });

    test("neither list contains duplicates", () => {
      expect(new Set(LlmTokenUsageMetricNames).size).toBe(
        LlmTokenUsageMetricNames.length,
      );
      expect(new Set(LlmCostMetricNames).size).toBe(LlmCostMetricNames.length);
    });

    test("every metric name is a non-empty trimmed string", () => {
      for (const name of [...LlmTokenUsageMetricNames, ...LlmCostMetricNames]) {
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
        expect(name).toBe(name.trim());
      }
    });
  });

  describe("token type attribute keys", () => {
    test("leads with the OTel semantic convention key", () => {
      expect(LlmTokenTypeAttributeKeys[0]).toBe("gen_ai.token.type");
    });

    test("includes the pre-convention llm-namespaced key", () => {
      expect(LlmTokenTypeAttributeKeys).toContain("llm.token.type");
    });

    test("contains no duplicates", () => {
      expect(new Set(LlmTokenTypeAttributeKeys).size).toBe(
        LlmTokenTypeAttributeKeys.length,
      );
    });
  });

  describe("token type value lists", () => {
    test("input and output values never overlap", () => {
      const overlap: Array<string> = LlmInputTokenTypeValues.filter(
        (value: string) => {
          return LlmOutputTokenTypeValues.includes(value);
        },
      );

      expect(overlap).toEqual([]);
    });

    test("values are lowercase, so the normalizing comparison can match", () => {
      for (const value of [
        ...LlmInputTokenTypeValues,
        ...LlmOutputTokenTypeValues,
      ]) {
        expect(value).toBe(value.toLowerCase());
      }
    });

    test("cache token kinds are deliberately excluded from both", () => {
      for (const cacheKind of ["cache_read", "cache_creation", "cache_write"]) {
        expect(LlmInputTokenTypeValues).not.toContain(cacheKind);
        expect(LlmOutputTokenTypeValues).not.toContain(cacheKind);
      }
    });
  });

  describe("getLlmTokenDirection", () => {
    test.each([
      ["input", "input"],
      ["prompt", "input"],
      ["output", "output"],
      ["completion", "output"],
    ])("maps %s to %s", (value: string, expected: string) => {
      expect(getLlmTokenDirection(value)).toBe(expected);
    });

    test.each([
      ["INPUT", "input"],
      ["Output", "output"],
      ["  prompt  ", "input"],
      ["\tCOMPLETION\n", "output"],
    ])(
      "normalizes casing and surrounding whitespace: %s",
      (value: string, expected: string) => {
        expect(getLlmTokenDirection(value)).toBe(expected);
      },
    );

    test.each([
      "cache_read",
      "cache_creation",
      "reasoning",
      "total",
      "unknown",
    ])("returns null for the uncounted token kind %s", (value: string) => {
      expect(getLlmTokenDirection(value)).toBeNull();
    });

    test.each([
      ["empty string", ""],
      ["whitespace only", "   "],
    ])("returns null for %s", (_label: string, value: string) => {
      expect(getLlmTokenDirection(value)).toBeNull();
    });

    test("returns null for undefined and null", () => {
      expect(getLlmTokenDirection(undefined)).toBeNull();
      expect(getLlmTokenDirection(null)).toBeNull();
    });

    test("returns null for non-string values without throwing", () => {
      expect(getLlmTokenDirection(42 as unknown as string)).toBeNull();
      expect(getLlmTokenDirection({} as unknown as string)).toBeNull();
      expect(getLlmTokenDirection([] as unknown as string)).toBeNull();
      expect(getLlmTokenDirection(true as unknown as string)).toBeNull();
    });

    test("every declared input value resolves to input", () => {
      for (const value of LlmInputTokenTypeValues) {
        expect(getLlmTokenDirection(value)).toBe("input");
      }
    });

    test("every declared output value resolves to output", () => {
      for (const value of LlmOutputTokenTypeValues) {
        expect(getLlmTokenDirection(value)).toBe("output");
      }
    });
  });

  describe("getLlmTokenTypeValues", () => {
    test("returns the input list for input", () => {
      expect(getLlmTokenTypeValues("input")).toEqual(LlmInputTokenTypeValues);
    });

    test("returns the output list for output", () => {
      expect(getLlmTokenTypeValues("output")).toEqual(LlmOutputTokenTypeValues);
    });

    test("round-trips: every value it returns maps back to that direction", () => {
      const directions: Array<LlmTokenDirection> = ["input", "output"];

      for (const direction of directions) {
        for (const value of getLlmTokenTypeValues(direction)) {
          expect(getLlmTokenDirection(value)).toBe(direction);
        }
      }
    });
  });
});
