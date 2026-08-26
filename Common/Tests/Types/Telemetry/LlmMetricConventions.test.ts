import {
  LlmCostMetricNames,
  LlmInputTokenTypeValues,
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmMicroUsdCostMetricNames,
  LlmOutputTokenTypeValues,
  LlmTokenDirection,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
  MICRO_USD_TO_USD,
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

/*
 * Coding-agent vendor metric names.
 *
 * The bug class: every major AI coding agent now exports OpenTelemetry
 * natively, and every one of them namespaces its metrics under its own vendor
 * prefix rather than gen_ai.*. A name this module does not know is a name the
 * query never selects, so a whole fleet of agents can be exporting into
 * OneUptime and report exactly $0 of spend — a silent zero, which is the
 * worst kind: no error, no gap in a chart, just a number that looks fine and
 * is wrong.
 */
describe("LlmMetricConventions — coding-agent vendor metric names", () => {
  test.each([
    ["claude_code.token.usage", "Anthropic Claude Code CLI"],
    ["cursor.token.usage", "Cursor Enterprise OTel export"],
    ["codex.turn.token_usage", "OpenAI Codex CLI"],
  ])("token metric %s (%s) is recognized", (name: string) => {
    expect(LlmTokenUsageMetricNames).toContain(name);
  });

  /*
   * ---------------------------------------------------------------------
   * The DOUBLE-COUNT hazard, pinned.
   * ---------------------------------------------------------------------
   *
   * LlmMetricQuery.buildTokenQuery issues ONE query with
   * `name: new Includes(LlmTokenUsageMetricNames)` and groups only by the
   * token-TYPE attribute keys — never by metric name. So if a single emitter
   * contributes TWO names to this list, both of its emissions come back as
   * separate rows and reduceTokenRows adds them together. The result is a
   * project reporting exactly 2x its real tokens: no error, no gap in the
   * chart, just a number that looks plausible and is wrong.
   *
   * Google Gemini CLI is the concrete case. It emits `gemini_cli.token.usage`
   * AND the semantic-convention `gen_ai.client.token.usage` for the same
   * tokens (both are listed in its metric table in
   * Docs/Content/en/telemetry/gemini-cli-and-copilot.md), so the vendor name
   * must stay OUT. Nothing is lost — the semconv name it also emits is in the
   * list, so its tokens are counted, once.
   *
   * The other three vendor names were audited against the same docs and do
   * NOT overlap a semconv metric: Claude Code and Cursor publish only their
   * own vendor-namespaced metrics, and Codex's gen_ai.* usage attributes live
   * on SPANS rather than metrics.
   *
   * The list is pinned exactly rather than by `toContain` so that ADDING a
   * name — the way this bug arrives — fails here and makes whoever adds it
   * check for an overlapping semconv emission first.
   */
  test("Gemini CLI's vendor token metric is deliberately NOT recognized", () => {
    expect(LlmTokenUsageMetricNames).not.toContain("gemini_cli.token.usage");
  });

  test("the token metric list is exactly this set, in this order", () => {
    expect(LlmTokenUsageMetricNames).toEqual([
      "gen_ai.client.token.usage",
      "gen_ai.client.token.count",
      "llm.token.usage",
      "llm.usage.tokens",
      "claude_code.token.usage",
      "cursor.token.usage",
      "codex.turn.token_usage",
    ]);
  });

  test("no emitter contributes two names to the token list", () => {
    /*
     * The property the pinned list above protects, stated directly. Each
     * entry names one emitter; two names mapping to the same emitter is the
     * double count. Keep this map in step with the list when a genuinely
     * non-overlapping vendor name is added.
     */
    const emitterByMetricName: Record<string, string> = {
      "gen_ai.client.token.usage": "otel-semconv",
      "gen_ai.client.token.count": "otel-semconv-pre-1.27",
      "llm.token.usage": "openinference",
      "llm.usage.tokens": "openllmetry",
      "claude_code.token.usage": "claude-code",
      "cursor.token.usage": "cursor",
      "codex.turn.token_usage": "codex",
    };

    // Every recognized name is accounted for — no unattributed additions.
    expect(Object.keys(emitterByMetricName).sort()).toEqual(
      [...LlmTokenUsageMetricNames].sort(),
    );

    const emitters: Array<string> = LlmTokenUsageMetricNames.map(
      (name: string) => {
        return emitterByMetricName[name]!;
      },
    );

    expect(new Set(emitters).size).toBe(emitters.length);
  });

  test.each([
    ["claude_code.cost.usage", "Anthropic Claude Code CLI"],
    ["cursor.cost.usage", "Cursor Enterprise OTel export"],
  ])("USD cost metric %s (%s) is recognized", (name: string) => {
    expect(LlmCostMetricNames).toContain(name);
  });

  test("the semantic convention still leads the token list", () => {
    // Vendor names are appended, never prepended — semconv stays preferred.
    expect(LlmTokenUsageMetricNames[0]).toBe("gen_ai.client.token.usage");
  });

  test("Codex cost is NOT in the USD list", () => {
    /*
     * The million-fold error. codex.turn.cost_microusd reports MILLIONTHS of
     * a dollar; summed alongside genuinely-USD metrics a $3 turn becomes
     * $3,000,000 and trips every configured cost budget at once.
     */
    expect(LlmCostMetricNames).not.toContain("codex.turn.cost_microusd");
  });

  test("Codex cost is in the micro-USD list", () => {
    expect(LlmMicroUsdCostMetricNames).toContain("codex.turn.cost_microusd");
  });

  test("the USD and micro-USD cost lists are disjoint", () => {
    const overlap: Array<string> = LlmCostMetricNames.filter((name: string) => {
      return LlmMicroUsdCostMetricNames.includes(name);
    });

    expect(overlap).toEqual([]);
  });

  test("the micro-USD list never overlaps the token list either", () => {
    const overlap: Array<string> = LlmMicroUsdCostMetricNames.filter(
      (name: string) => {
        return LlmTokenUsageMetricNames.includes(name);
      },
    );

    expect(overlap).toEqual([]);
  });

  test("no cost metric name is duplicated across the three lists", () => {
    const all: Array<string> = [
      ...LlmTokenUsageMetricNames,
      ...LlmCostMetricNames,
      ...LlmMicroUsdCostMetricNames,
    ];

    expect(new Set(all).size).toBe(all.length);
  });

  test("every micro-USD name is a non-empty trimmed string", () => {
    for (const name of LlmMicroUsdCostMetricNames) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
    }
  });

  test("MICRO_USD_TO_USD is exactly one millionth", () => {
    /*
     * Pinned as a literal rather than as 1/1_000_000 so a dropped or added
     * zero fails here loudly. Everything downstream multiplies by this.
     */
    expect(MICRO_USD_TO_USD).toBe(0.000001);
    expect(MICRO_USD_TO_USD).toBe(1e-6);
    expect(1_000_000 * MICRO_USD_TO_USD).toBe(1);
  });
});

/*
 * Vendor token-type spellings.
 *
 * Two failure modes are pinned here. First, a token-type KEY the fold does
 * not recognize means every datapoint from that emitter is dropped as
 * "direction unknown" — tokens silently vanish. Second, a token-type VALUE
 * that is wrongly recognized double-counts: Codex's `total` is a superset of
 * its siblings and `reasoning_output` is a subset of `output`, and both
 * arrive ALONGSIDE the datapoints they overlap.
 */
describe("LlmMetricConventions — coding-agent token type spellings", () => {
  test.each([
    ["type", "Claude Code (bare)"],
    ["cursor.token.type", "Cursor"],
    ["token_type", "Codex"],
  ])("token type key %s (%s) is recognized", (key: string) => {
    expect(LlmTokenTypeAttributeKeys).toContain(key);
  });

  test("the bare 'type' key never outranks a namespaced one", () => {
    /*
     * The bounded-risk argument for accepting a key as generic as `type`:
     * it is only ever consulted for rows that already matched an LLM metric
     * NAME, and it sorts after every namespaced spelling, so an emitter that
     * carries both is read from the namespaced one.
     */
    const bare: number = LlmTokenTypeAttributeKeys.indexOf("type");
    const semconv: number =
      LlmTokenTypeAttributeKeys.indexOf("gen_ai.token.type");

    expect(bare).toBeGreaterThan(semconv);
    expect(bare).toBeGreaterThan(
      LlmTokenTypeAttributeKeys.indexOf("llm.token.type"),
    );
  });

  test("the token type key list still contains no duplicates", () => {
    expect(new Set(LlmTokenTypeAttributeKeys).size).toBe(
      LlmTokenTypeAttributeKeys.length,
    );
  });

  test.each(["input", "output"])(
    "the plain %s value is already covered — no vendor value needed",
    (value: string) => {
      expect(getLlmTokenDirection(value)).not.toBeNull();
    },
  );

  /*
   * Every excluded literal, spelled exactly as its vendor emits it. These
   * MUST map to null; a change that starts counting any of them inflates
   * metric-sourced totals against the span-sourced ones they stand in for,
   * or double-counts outright.
   */
  test.each([
    // Claude Code — camelCase, which is easy to miss when eyeballing a list.
    "cacheRead",
    "cacheCreation",
    // Cursor.
    "cache_read",
    "cache_creation",
    // Codex.
    "cached_input",
    "cache_write_input",
    // Codex: a SUPERSET of its siblings, emitted alongside them.
    "total",
    // Codex: a SUBSET of `output`, emitted alongside it.
    "reasoning_output",
  ])("the excluded token kind %s maps to null", (value: string) => {
    expect(getLlmTokenDirection(value)).toBeNull();
  });

  test.each(["CacheRead", "  cacheCreation  ", "TOTAL", "Reasoning_Output"])(
    "the excluded kind %s stays excluded after case/whitespace normalization",
    (value: string) => {
      expect(getLlmTokenDirection(value)).toBeNull();
    },
  );

  test("no excluded kind leaked into either value list", () => {
    for (const excluded of [
      "cacheread",
      "cachecreation",
      "cache_read",
      "cache_creation",
      "cached_input",
      "cache_write_input",
      "total",
      "reasoning_output",
    ]) {
      expect(LlmInputTokenTypeValues).not.toContain(excluded);
      expect(LlmOutputTokenTypeValues).not.toContain(excluded);
    }
  });
});

/*
 * Metric-side identity keys. These exist so metric-sourced spend can be
 * grouped by employee at all; the risk they carry is the same one the span
 * side documents — grouping the wrong human's spend under an engineer's name.
 */
describe("LlmMetricConventions — metric identity attribute keys", () => {
  test("the user list leads with the key the coding agents emit natively", () => {
    expect(LlmMetricUserAttributeKeys[0]).toBe("user.email");
  });

  test("the user list covers the coding-agent and Cursor spellings", () => {
    /*
     * Two tiers, bare first then resource-prefixed, written out as literals.
     *
     * The resource tier is not decoration. OtelMetricsIngestService flattens
     * resource attributes through
     * `TelemetryUtil.getAttributes({ items, prefixKeysWithString: "resource" })`
     * exactly as the traces service does, so a fleet that stamps identity on
     * the resource — the only thing OTEL_RESOURCE_ATTRIBUTES can do, and what
     * Cursor documents for cursor.user.id — arrives here as
     * `resource.user.email`. A bare-key-only list matches none of it and
     * every per-employee metric rollup is silently empty.
     */
    expect(LlmMetricUserAttributeKeys).toEqual([
      "user.email",
      "user.id",
      "user.account_uuid",
      "user.account_id",
      "cursor.user.id",
      "resource.user.email",
      "resource.user.id",
      "resource.user.account_uuid",
      "resource.user.account_id",
      "resource.cursor.user.id",
    ]);
  });

  test("the team list leads with team.id", () => {
    expect(LlmMetricTeamAttributeKeys[0]).toBe("team.id");
  });

  test("the team list covers the OTEL_RESOURCE_ATTRIBUTES spellings", () => {
    /*
     * Both spellings of each, and the resource one is the spelling that
     * actually arrives: OTEL_RESOURCE_ATTRIBUTES=team.id=platform reaches the
     * query layer as `resource.team.id`, never `team.id`.
     */
    expect(LlmMetricTeamAttributeKeys).toEqual([
      "team.id",
      "team",
      "cost_center",
      "department",
      "cursor.team.id",
      "resource.team.id",
      "resource.team",
      "resource.cost_center",
      "resource.department",
      "resource.cursor.team.id",
    ]);
  });

  test("the bare tier still leads, so the scoped filter keys are unchanged", () => {
    /*
     * LlmMetricQuery exports METRIC_USER_ATTRIBUTE_KEY /
     * METRIC_TEAM_ATTRIBUTE_KEY as element zero of these lists and uses them
     * as the single map-filter key for scoped queries. If the resource tier
     * ever led, every scoped query would silently filter on the wrong key.
     */
    expect(LlmMetricUserAttributeKeys[0]).toBe("user.email");
    expect(LlmMetricTeamAttributeKeys[0]).toBe("team.id");
  });

  test("neither identity list carries a downstream-customer key", () => {
    /*
     * The same exclusion the span side enforces: gen_ai.user and llm.user
     * carry the CALLER'S customer, not the employee. Grouping metric spend by
     * one of those would manufacture a phantom employee per customer.
     */
    for (const customerKey of [
      "gen_ai.user",
      "llm.user",
      "litellm.metadata.user_api_key_end_user_id",
    ]) {
      expect(LlmMetricUserAttributeKeys).not.toContain(customerKey);
      expect(LlmMetricTeamAttributeKeys).not.toContain(customerKey);
    }
  });

  test("the two identity lists are disjoint", () => {
    const overlap: Array<string> = LlmMetricUserAttributeKeys.filter(
      (key: string) => {
        return LlmMetricTeamAttributeKeys.includes(key);
      },
    );

    expect(overlap).toEqual([]);
  });

  test("neither identity list collides with a token type key", () => {
    /*
     * They are both used as groupBy attribute keys against the same rows; a
     * key that means "which employee" in one list and "which side of the
     * exchange" in the other would classify tokens by person.
     */
    for (const key of [
      ...LlmMetricUserAttributeKeys,
      ...LlmMetricTeamAttributeKeys,
    ]) {
      expect(LlmTokenTypeAttributeKeys).not.toContain(key);
    }
  });

  test("neither identity list contains duplicates", () => {
    expect(new Set(LlmMetricUserAttributeKeys).size).toBe(
      LlmMetricUserAttributeKeys.length,
    );
    expect(new Set(LlmMetricTeamAttributeKeys).size).toBe(
      LlmMetricTeamAttributeKeys.length,
    );
  });
});
