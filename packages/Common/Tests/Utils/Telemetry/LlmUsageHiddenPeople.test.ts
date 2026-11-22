import { describe, expect, test } from "@jest/globals";
import {
  LLM_USAGE_HIDDEN_GROUP_KEY,
  LlmUsageDimension,
  LlmUsageFigures,
  LlmUsageGroup,
  LlmUsageResponse,
  isLlmUsageHiddenGroup,
} from "../../../Types/Telemetry/LlmUsageApi";
import LlmMetricUsageUtil, {
  LlmMetricUsageRow,
} from "../../../Utils/Telemetry/LlmMetricUsage";
import LlmUsageUtil, {
  LlmUsageSpanRow,
} from "../../../Utils/Telemetry/LlmUsage";

/*
 * AI SPEND IS NEVER A PLACEHOLDER'S (#10435).
 *
 * An AI call's user, email and team are scrubbed like its other
 * attributes, so a project with an Email scrub rule filed every call under
 * one "[REDACTED]" person, and the breakdown by employee put the whole bill
 * on them. What a rule left - "[REDACTED]", a mask, a Hash rule's token -
 * is nobody's name: the read files such a call under its id when a rule
 * left that whole (LlmUsageReader), and the rest under the one group of
 * usage whose person or team was hidden, which the Usage tab says is
 * hidden. That group is a real bucket of spend: every breakdown still adds
 * up to the totals.
 */

const APP: string = "checkout-api";
const CODER: string = "claude-code";

function call(
  group: string | undefined,
  costUsd: number,
  calls: number,
): LlmUsageSpanRow {
  return {
    service: APP,
    isTotal: group === undefined,
    group: group ?? "",
    calls,
    erroredCalls: 0,
    inputTokens: 1000 * calls,
    outputTokens: 100 * calls,
    totalTokens: 0,
    costUsd,
  };
}

function costMetric(
  value: number,
  group?: string | undefined,
): LlmMetricUsageRow {
  return {
    metric: "claude_code.cost.usage",
    service: CODER,
    isTotal: group === undefined,
    group: group ?? "",
    groupAttribute: group === undefined ? "" : "user.email",
    tokenType: "",
    value,
  };
}

function fold(
  dimension: LlmUsageDimension,
  spanRows: Array<LlmUsageSpanRow>,
  metricRows: Array<LlmMetricUsageRow> = [],
): LlmUsageResponse {
  return LlmUsageUtil.fold({
    spanRows,
    metricRows,
    options: { dimension },
  });
}

function costs(groups: Array<LlmUsageGroup>): Array<[string, number]> {
  return groups.map((group: LlmUsageGroup): [string, number] => {
    return [group.key, Math.round(group.costUsd * 100) / 100];
  });
}

describe("the person a call is filed under", () => {
  test.each([
    "[REDACTED]",
    "j***@***.com",
    "[HASHED:3f9a1c0e7b2d4a68]",
    "[HASHED:8c87b489]",
    "auth0|[REDACTED]",
  ])("%s is the hidden group, never a person", (value: string) => {
    expect(
      LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Employee, value),
    ).toBe(LLM_USAGE_HIDDEN_GROUP_KEY);
    expect(
      LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Team, value),
    ).toBe(LLM_USAGE_HIDDEN_GROUP_KEY);
  });

  test("a person and a team are themselves, and none is none", () => {
    expect(
      LlmMetricUsageUtil.normalizeGroup(
        LlmUsageDimension.Employee,
        " ana@example.com ",
      ),
    ).toBe("ana@example.com");
    expect(
      LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Team, "payments"),
    ).toBe("payments");
    expect(
      LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Employee, ""),
    ).toBe("");
  });

  test("a model or a provider is never hidden as a person is", () => {
    expect(
      LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Model, "chat-***"),
    ).toBe("chat-***");
  });

  test("the hidden group is known by its key", () => {
    expect(isLlmUsageHiddenGroup(LLM_USAGE_HIDDEN_GROUP_KEY)).toBe(true);
    expect(isLlmUsageHiddenGroup("")).toBe(false);
    expect(isLlmUsageHiddenGroup("ana@example.com")).toBe(false);
    expect(isLlmUsageHiddenGroup(undefined)).toBe(false);
  });
});

describe("the breakdown by employee", () => {
  test("a hashed person's spend and a redacted one's are one hidden group, never attributed to a person", () => {
    const usage: LlmUsageResponse = fold(
      LlmUsageDimension.Employee,
      [
        call(undefined, 110, 110),
        call("ana@example.com", 40, 40),
        // As the read files them: what a rule left, past an id left whole.
        call(LLM_USAGE_HIDDEN_GROUP_KEY, 60, 60),
        call("", 10, 10),
      ],
      [
        costMetric(30),
        // A coding tool's metrics whose user.email the customer's pipeline hashed.
        costMetric(30, "[HASHED:3f9a1c0e7b2d4a68]"),
      ],
    );

    expect(costs(usage.groups)).toEqual([
      [LLM_USAGE_HIDDEN_GROUP_KEY, 90],
      ["ana@example.com", 40],
      ["", 10],
    ]);
    expect(
      usage.groups.some((group: LlmUsageGroup): boolean => {
        return group.key.startsWith("[HASHED:");
      }),
    ).toBe(false);
  });

  test("the hidden group is a real bucket: the breakdown still adds up to the totals", () => {
    const usage: LlmUsageResponse = fold(LlmUsageDimension.Employee, [
      call(undefined, 100, 100),
      call("ana@example.com", 30, 30),
      call(LLM_USAGE_HIDDEN_GROUP_KEY, 70, 70),
    ]);

    expect(
      usage.groups.reduce((total: number, figures: LlmUsageFigures): number => {
        return total + figures.costUsd;
      }, 0),
    ).toBeCloseTo(usage.totals.costUsd, 10);
    expect(
      usage.groups.reduce((total: number, figures: LlmUsageFigures): number => {
        return total + figures.calls;
      }, 0),
    ).toBe(usage.totals.calls);
  });
});
