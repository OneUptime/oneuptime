import { describe, expect, test } from "@jest/globals";
import LlmMetricUsageUtil, {
  LlmMetricUsageRow,
} from "../../../Utils/Telemetry/LlmMetricUsage";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageGroup,
  LlmMetricUsageResponse,
} from "../../../Types/Telemetry/LlmMetricUsageApi";
import {
  LlmCostMetricNames,
  LlmMetricModelAttributeKeys,
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmMicroUsdCostMetricNames,
  LlmTokenUsageMetricNames,
  getLlmMetricTokenDirection,
} from "../../../Types/Telemetry/LlmMetricConventions";

/*
 * WHAT THE GENAI METRICS OF A RANGE ADD UP TO.
 *
 * LlmMetricUsageReader reads one row per metric, group and token type - the
 * usage its series added in the range - and LlmMetricUsageUtil folds those
 * rows into the Usage tab's and the budgets' figures. These pin the fold:
 * which rows are cost and in which unit, which token types are input and
 * output for each coding tool, and how groups are kept and ordered.
 */

function row(
  metric: string,
  value: number,
  extra?: { group?: string; tokenType?: string },
): LlmMetricUsageRow {
  return {
    metric: metric,
    group: extra?.group ?? "",
    tokenType: extra?.tokenType ?? "",
    value: value,
  };
}

function fold(
  rows: Array<LlmMetricUsageRow>,
  grouped: boolean = false,
): LlmMetricUsageResponse {
  return LlmMetricUsageUtil.fold(rows, { grouped: grouped });
}

describe("what a metric's points are", () => {
  test("every USD cost metric is USD", () => {
    for (const name of LlmCostMetricNames) {
      expect({ name, kind: LlmMetricUsageUtil.getKind(name) }).toEqual({
        name,
        kind: "usd",
      });
    }
  });

  test("Codex's micro-USD cost is micro-USD, never USD", () => {
    for (const name of LlmMicroUsdCostMetricNames) {
      expect(LlmMetricUsageUtil.getKind(name)).toBe("microusd");
    }
  });

  test("every token metric is tokens", () => {
    for (const name of LlmTokenUsageMetricNames) {
      expect(LlmMetricUsageUtil.getKind(name)).toBe("tokens");
    }
  });

  test("names are read without regard to case or surrounding space", () => {
    expect(LlmMetricUsageUtil.getKind(" CLAUDE_CODE.COST.USAGE ")).toBe("usd");
  });

  test("a metric the fold does not read is nothing", () => {
    expect(LlmMetricUsageUtil.getKind("http.server.duration")).toBeNull();
    expect(LlmMetricUsageUtil.getKind("gemini_cli.token.usage")).toBeNull();
    expect(LlmMetricUsageUtil.getKind("")).toBeNull();
  });

  test("the read asks for every cost and token metric, once each", () => {
    const names: Array<string> = LlmMetricUsageUtil.getMetricNames();

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        ...LlmCostMetricNames,
        ...LlmMicroUsdCostMetricNames,
        ...LlmTokenUsageMetricNames,
      ]),
    );
  });
});

describe("cost", () => {
  test("USD rows add up as dollars", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", 1.25),
      row("cursor.cost.usage", 0.75),
    ]);

    expect(usage.totals.costUsd).toBeCloseTo(2, 10);
    expect(usage.totals.hasCost).toBe(true);
  });

  test("a $3 Codex turn reported in millionths reads as $3, not $3,000,000", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("codex.turn.cost_microusd", 3_000_000),
    ]);

    expect(usage.totals.costUsd).toBeCloseTo(3, 10);
  });

  test("USD and micro-USD are scaled apart before they are added", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", 2),
      row("codex.turn.cost_microusd", 500_000),
    ]);

    expect(usage.totals.costUsd).toBeCloseTo(2.5, 10);
  });

  test("a cost metric whose points add up to 0 is read, not missing", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", 0),
    ]);

    expect(usage.totals.hasCost).toBe(true);
    expect(usage.totals.costUsd).toBe(0);
  });

  test("no cost rows: no cost", () => {
    const usage: LlmMetricUsageResponse = fold([]);

    expect(usage.totals.hasCost).toBe(false);
    expect(usage.totals.costUsd).toBe(0);
  });
});

describe("tokens, by each tool's token types", () => {
  test("the GenAI conventions' input and output (Gemini CLI, Copilot, SDKs)", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("gen_ai.client.token.usage", 1000, { tokenType: "input" }),
      row("gen_ai.client.token.usage", 200, { tokenType: "output" }),
    ]);

    expect(usage.totals.inputTokens).toBe(1000);
    expect(usage.totals.outputTokens).toBe(200);
    expect(usage.totals.hasTokens).toBe(true);
  });

  test("the pre-1.27 prompt and completion spellings", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("gen_ai.client.token.usage", 10, { tokenType: "prompt" }),
      row("gen_ai.client.token.usage", 4, { tokenType: "completion" }),
    ]);

    expect(usage.totals.inputTokens).toBe(10);
    expect(usage.totals.outputTokens).toBe(4);
  });

  /*
   * Claude Code's `input` leaves out the tokens read from and written to
   * the prompt cache; its monitoring docs count them apart. By the GenAI
   * conventions - and by its own spans' input count (LlmTokenUsage) -
   * they are input.
   */
  test("Claude Code's cacheRead and cacheCreation are input", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.token.usage", 1_200, { tokenType: "input" }),
      row("claude_code.token.usage", 90_000, { tokenType: "cacheRead" }),
      row("claude_code.token.usage", 6_000, { tokenType: "cacheCreation" }),
      row("claude_code.token.usage", 3_000, { tokenType: "output" }),
    ]);

    expect(usage.totals.inputTokens).toBe(97_200);
    expect(usage.totals.outputTokens).toBe(3_000);
  });

  test("another tool's cache kinds stay out: Cursor does not say its input leaves them out", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("cursor.token.usage", 500, { tokenType: "input" }),
      row("cursor.token.usage", 9_000, { tokenType: "cache_read" }),
      row("cursor.token.usage", 700, { tokenType: "cache_creation" }),
      row("cursor.token.usage", 80, { tokenType: "output" }),
    ]);

    expect(usage.totals.inputTokens).toBe(500);
    expect(usage.totals.outputTokens).toBe(80);
  });

  /*
   * Codex sends a total beside its parts, its cached input inside its
   * input, and its reasoning inside its output: each of those counted
   * would count tokens twice.
   */
  test("Codex's total, cached_input and reasoning_output are never added", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("codex.turn.token_usage", 5_000, { tokenType: "input" }),
      row("codex.turn.token_usage", 4_000, { tokenType: "cached_input" }),
      row("codex.turn.token_usage", 900, { tokenType: "output" }),
      row("codex.turn.token_usage", 600, { tokenType: "reasoning_output" }),
      row("codex.turn.token_usage", 5_900, { tokenType: "total" }),
    ]);

    expect(usage.totals.inputTokens).toBe(5_000);
    expect(usage.totals.outputTokens).toBe(900);
  });

  test("Claude Code's cache kinds count only on Claude Code's metric", () => {
    expect(
      getLlmMetricTokenDirection("claude_code.token.usage", "cacheRead"),
    ).toBe("input");
    expect(
      getLlmMetricTokenDirection("CLAUDE_CODE.TOKEN.USAGE", " CacheCreation "),
    ).toBe("input");
    expect(
      getLlmMetricTokenDirection("gen_ai.client.token.usage", "cacheRead"),
    ).toBeNull();
    expect(getLlmMetricTokenDirection("cursor.token.usage", "cacheRead")).toBe(
      null,
    );
  });

  test("a metric name never reaches the object prototype", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(getLlmMetricTokenDirection(name, "cacheRead")).toBeNull();
    }
  });

  test("a token row of no counted type counts nothing, and says no tokens", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("codex.turn.token_usage", 5_900, { tokenType: "total" }),
      row("gen_ai.client.token.usage", 10, { tokenType: "" }),
    ]);

    expect(usage.totals.inputTokens).toBe(0);
    expect(usage.totals.outputTokens).toBe(0);
    expect(usage.totals.hasTokens).toBe(false);
  });

  test("a token row is never cost, a cost row never tokens", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", 5, { tokenType: "input" }),
      row("claude_code.token.usage", 7, { tokenType: "input" }),
    ]);

    expect(usage.totals.costUsd).toBe(5);
    expect(usage.totals.inputTokens).toBe(7);
  });
});

describe("rows that are not numbers", () => {
  test("NaN and infinite values add nothing", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", Number.NaN),
      row("claude_code.cost.usage", Number.POSITIVE_INFINITY),
      row("claude_code.cost.usage", 1),
      row("claude_code.token.usage", Number.NaN, { tokenType: "input" }),
    ]);

    expect(usage.totals.costUsd).toBe(1);
    expect(usage.totals.inputTokens).toBe(0);
  });

  test("a row of a metric the fold does not read adds nothing", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("gemini_cli.token.usage", 1_000_000, { tokenType: "input" }),
    ]);

    expect(usage.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      hasCost: false,
      hasTokens: false,
    });
  });
});

describe("groups", () => {
  test("an ungrouped fold returns totals and no groups", () => {
    const usage: LlmMetricUsageResponse = fold([
      row("claude_code.cost.usage", 1, { group: "ana@example.com" }),
    ]);

    expect(usage.groups).toEqual([]);
    expect(usage.totals.costUsd).toBe(1);
  });

  test("each group adds up its own cost and tokens, and the totals add up all", () => {
    const usage: LlmMetricUsageResponse = fold(
      [
        row("claude_code.cost.usage", 4, { group: "ana@example.com" }),
        row("claude_code.token.usage", 100, {
          group: "ana@example.com",
          tokenType: "input",
        }),
        row("claude_code.token.usage", 900, {
          group: "ana@example.com",
          tokenType: "cacheRead",
        }),
        row("claude_code.cost.usage", 1, { group: "bo@example.com" }),
        row("codex.turn.cost_microusd", 2_000_000, { group: "bo@example.com" }),
      ],
      true,
    );

    expect(
      usage.groups.map((group: LlmMetricUsageGroup) => {
        return [group.key, group.costUsd, group.inputTokens];
      }),
    ).toEqual([
      ["ana@example.com", 4, 1000],
      ["bo@example.com", 3, 0],
    ]);
    expect(usage.totals.costUsd).toBeCloseTo(7, 10);
    expect(usage.totals.inputTokens).toBe(1000);
  });

  test("the unattributed group is kept: it is part of the total", () => {
    const usage: LlmMetricUsageResponse = fold(
      [
        row("cursor.cost.usage", 2, { group: "" }),
        row("cursor.cost.usage", 1, { group: "4471" }),
      ],
      true,
    );

    expect(
      usage.groups.map((group: LlmMetricUsageGroup): string => {
        return group.key;
      }),
    ).toEqual(["", "4471"]);
  });

  test("a group named with surrounding space is one group", () => {
    const usage: LlmMetricUsageResponse = fold(
      [
        row("cursor.cost.usage", 2, { group: "ana@example.com " }),
        row("cursor.cost.usage", 1, { group: "ana@example.com" }),
      ],
      true,
    );

    expect(usage.groups).toHaveLength(1);
    expect(usage.groups[0]!.costUsd).toBe(3);
  });

  test("groups rank by cost, then tokens, then name", () => {
    const usage: LlmMetricUsageResponse = fold(
      [
        row("claude_code.cost.usage", 1, { group: "b" }),
        row("claude_code.cost.usage", 1, { group: "a" }),
        row("claude_code.cost.usage", 5, { group: "c" }),
        row("claude_code.token.usage", 10, { group: "b", tokenType: "input" }),
      ],
      true,
    );

    expect(
      usage.groups.map((group: LlmMetricUsageGroup): string => {
        return group.key;
      }),
    ).toEqual(["c", "b", "a"]);
  });

  test("a group of rows that count nothing is not a group", () => {
    const usage: LlmMetricUsageResponse = fold(
      [row("codex.turn.token_usage", 9, { group: "x", tokenType: "total" })],
      true,
    );

    expect(usage.groups).toEqual([]);
  });

  test("truncated is carried through", () => {
    expect(
      LlmMetricUsageUtil.fold([], { grouped: true, truncated: true }).truncated,
    ).toBe(true);
    expect(LlmMetricUsageUtil.fold([]).truncated).toBe(false);
  });
});

describe("the keys a group is read from", () => {
  test("each dimension's keys, preferred first", () => {
    expect(
      LlmMetricUsageUtil.getGroupKeys(LlmMetricUsageDimension.Employee),
    ).toEqual(LlmMetricUserAttributeKeys);
    expect(LlmMetricUsageUtil.getGroupKeys(LlmMetricUsageDimension.Team)).toEqual(
      LlmMetricTeamAttributeKeys,
    );
    expect(
      LlmMetricUsageUtil.getGroupKeys(LlmMetricUsageDimension.Model),
    ).toEqual(LlmMetricModelAttributeKeys);
    expect(LlmMetricUsageUtil.getGroupKeys(LlmMetricUsageDimension.None)).toEqual(
      [],
    );
  });

  test("Cursor's email names a person before any id", () => {
    const keys: Array<string> = LlmMetricUsageUtil.getGroupKeys(
      LlmMetricUsageDimension.Employee,
    );

    expect(keys.indexOf("cursor.user.email")).toBeGreaterThan(-1);
    expect(keys.indexOf("cursor.user.email")).toBeLessThan(
      keys.indexOf("cursor.user.id"),
    );
    expect(keys.indexOf("resource.cursor.user.email")).toBeGreaterThan(-1);
  });

  test("the lists given out are copies the caller cannot change", () => {
    const keys: Array<string> = LlmMetricUsageUtil.getGroupKeys(
      LlmMetricUsageDimension.Employee,
    );
    keys.push("mutated");

    expect(
      LlmMetricUsageUtil.getGroupKeys(LlmMetricUsageDimension.Employee),
    ).not.toContain("mutated");
  });
});
