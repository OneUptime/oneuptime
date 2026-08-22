import {
  LlmCostCatalogUtil,
  LlmModelPrice,
  LlmModelPricingCatalog,
} from "../../../Types/Telemetry/LlmCostCatalog";
import { describe, expect, test } from "@jest/globals";

describe("LlmModelPricingCatalog", () => {
  test("every entry has a lowercase prefix and non-negative prices", () => {
    for (const entry of LlmModelPricingCatalog) {
      expect(entry.modelPrefix).toBe(entry.modelPrefix.toLowerCase());
      expect(entry.modelPrefix.trim()).toBe(entry.modelPrefix);
      expect(entry.modelPrefix.length).toBeGreaterThan(0);
      expect(entry.inputPricePerMillionTokensInUSD).toBeGreaterThanOrEqual(0);
      expect(entry.outputPricePerMillionTokensInUSD).toBeGreaterThanOrEqual(0);
    }
  });

  test("prefixes are unique — a duplicate would make the match ambiguous", () => {
    const prefixes: Array<string> = LlmModelPricingCatalog.map(
      (entry: LlmModelPrice) => {
        return entry.modelPrefix;
      },
    );

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("LlmCostCatalogUtil.findPriceForModel", () => {
  test("exact model name matches", () => {
    const price: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("gpt-4o");

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4o");
  });

  test("dated snapshot resolves via prefix", () => {
    const price: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("gpt-4o-2024-08-06");

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4o");
  });

  test("longest prefix wins: gpt-4o-mini does not price as gpt-4o", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4o-mini-2024-07-18",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4o-mini");
  });

  test("longest prefix wins: gpt-4-turbo does not price as gpt-4", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4-turbo-2024-04-09",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4-turbo");
  });

  test("gpt-5 variants disambiguate by longest prefix", () => {
    expect(LlmCostCatalogUtil.findPriceForModel("gpt-5")!.modelPrefix).toBe(
      "gpt-5",
    );
    expect(
      LlmCostCatalogUtil.findPriceForModel("gpt-5-mini-2026-01-01")!
        .modelPrefix,
    ).toBe("gpt-5-mini");
    expect(
      LlmCostCatalogUtil.findPriceForModel("gpt-5-nano")!.modelPrefix,
    ).toBe("gpt-5-nano");
  });

  test("matching is case-insensitive and trims whitespace", () => {
    const price: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("  GPT-4o-Mini  ");

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4o-mini");
  });

  test("Anthropic dated model ids resolve", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "claude-3-5-sonnet-20241022",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("claude-3-5-sonnet");
  });

  test("Bedrock model id with provider namespace resolves", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("claude-3-5-sonnet");
  });

  test("Bedrock cross-region inference profile id resolves", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "us.anthropic.claude-3-5-haiku-20241022-v1:0",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("claude-3-5-haiku");
  });

  test("OpenRouter-style provider/model path resolves", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "anthropic/claude-3-opus",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("claude-3-opus");
  });

  test("Google models/ path prefix resolves", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "models/gemini-2.5-pro",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gemini-2.5-pro");
  });

  test("dots inside real model names are not treated as routing prefixes", () => {
    // "gpt-4.1" contains a dot; nothing before it is a routing token.
    const price: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("gpt-4.1-2025-04-14");

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4.1");
  });

  test("o1-pro does not price as o1 — a 10x price difference", () => {
    expect(LlmCostCatalogUtil.findPriceForModel("o1-pro")!.modelPrefix).toBe(
      "o1-pro",
    );
    expect(
      LlmCostCatalogUtil.findPriceForModel("o1-pro-2025-03-19")!.modelPrefix,
    ).toBe("o1-pro");
  });

  test("gemini flash-lite does not price as flash", () => {
    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gemini-2.5-flash-lite",
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gemini-2.5-flash-lite");
  });

  test("unknown model returns null, never a guess", () => {
    expect(
      LlmCostCatalogUtil.findPriceForModel("totally-unknown-model-9000"),
    ).toBeNull();
  });

  test("empty and malformed inputs return null", () => {
    expect(LlmCostCatalogUtil.findPriceForModel("")).toBeNull();
    expect(LlmCostCatalogUtil.findPriceForModel("   ")).toBeNull();
    expect(
      LlmCostCatalogUtil.findPriceForModel(undefined as unknown as string),
    ).toBeNull();
    expect(
      LlmCostCatalogUtil.findPriceForModel(null as unknown as string),
    ).toBeNull();
  });

  test("a bare routing token does not match anything", () => {
    expect(LlmCostCatalogUtil.findPriceForModel("anthropic.")).toBeNull();
    expect(LlmCostCatalogUtil.findPriceForModel("us.anthropic.")).toBeNull();
    expect(LlmCostCatalogUtil.findPriceForModel("models/")).toBeNull();
  });
});

describe("LlmCostCatalogUtil.computeCostInUSD", () => {
  test("computes input + output priced independently", () => {
    // gpt-4o: $2.50/M input, $10/M output.
    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(cost).toBe(2.5 + 5);
  });

  test("small token counts produce exact fractional cost", () => {
    // gpt-4o-mini: $0.15/M input, $0.60/M output.
    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 120,
    });

    expect(cost).toBeCloseTo(0.000147, 9);
  });

  test("float noise is trimmed to 8 decimal places", () => {
    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "claude-3-5-sonnet-20241022",
      inputTokens: 3,
      outputTokens: 7,
    });

    // 3 * 3/1M + 7 * 15/1M = 0.000009 + 0.000105 = 0.000114
    expect(cost).toBe(0.000114);
  });

  test("input-only usage (embeddings) is priceable", () => {
    // text-embedding-3-small: $0.02/M input, $0 output.
    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "text-embedding-3-small",
      inputTokens: 2_000_000,
      outputTokens: 0,
    });

    expect(cost).toBe(0.04);
  });

  test("output-only usage is priceable", () => {
    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 100_000,
    });

    expect(cost).toBe(1);
  });

  test("zero tokens returns null — nothing to price", () => {
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBeNull();
  });

  test("unknown model returns null even with tokens", () => {
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "my-custom-finetune",
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBeNull();
  });

  test("negative and non-finite token counts are treated as zero", () => {
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "gpt-4o",
        inputTokens: -50,
        outputTokens: NaN,
      }),
    ).toBeNull();

    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "gpt-4o",
      inputTokens: -50,
      outputTokens: 100_000,
    });

    expect(cost).toBe(1);
  });

  test("empty model returns null", () => {
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "",
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBeNull();
  });
});

describe("LlmCostCatalogUtil.findPriceForModel — project price overrides", () => {
  test("an override prices a model the built-in catalog does not know", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "my-custom-finetune",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "my-custom-finetune-v3",
      overrides,
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("my-custom-finetune");
    expect(price!.inputPricePerMillionTokensInUSD).toBe(1);
    expect(price!.outputPricePerMillionTokensInUSD).toBe(2);
  });

  test("a project entry beats the built-in entry on a prefix-length tie", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4o-2024-08-06",
      overrides,
    );

    expect(price).not.toBeNull();
    // Built-in gpt-4o is $2.50/M input — the negotiated override must win.
    expect(price!.inputPricePerMillionTokensInUSD).toBe(1.25);
    expect(price!.outputPricePerMillionTokensInUSD).toBe(5);
  });

  test("a longer built-in prefix still beats a shorter override", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4o-mini-2024-07-18",
      overrides,
    );

    expect(price).not.toBeNull();
    // Built-in gpt-4o-mini (longer prefix) wins over the gpt-4o override.
    expect(price!.modelPrefix).toBe("gpt-4o-mini");
    expect(price!.inputPricePerMillionTokensInUSD).toBe(0.15);
  });

  test("a longer override prefix beats a shorter built-in", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o-mini-2024",
        inputPricePerMillionTokensInUSD: 0.1,
        outputPricePerMillionTokensInUSD: 0.4,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4o-mini-2024-07-18",
      overrides,
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("gpt-4o-mini-2024");
    expect(price!.inputPricePerMillionTokensInUSD).toBe(0.1);
  });

  test("override prefixes are normalized: case and whitespace", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "  My-Custom-Model  ",
        inputPricePerMillionTokensInUSD: 3,
        outputPricePerMillionTokensInUSD: 6,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "my-custom-model-v2",
      overrides,
    );

    expect(price).not.toBeNull();
    expect(price!.modelPrefix).toBe("my-custom-model");
  });

  test("overrides match vendor-decorated model ids via normalization", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "claude-3-5-sonnet",
        inputPricePerMillionTokensInUSD: 2,
        outputPricePerMillionTokensInUSD: 10,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      overrides,
    );

    expect(price).not.toBeNull();
    expect(price!.inputPricePerMillionTokensInUSD).toBe(2);
  });

  test("unpriceable override entries are ignored, not matched", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 1,
      },
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: -5,
        outputPricePerMillionTokensInUSD: 1,
      },
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: NaN,
        outputPricePerMillionTokensInUSD: 1,
      },
    ];

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      "gpt-4o",
      overrides,
    );

    // The invalid overrides are dropped; the built-in catalog entry wins.
    expect(price).not.toBeNull();
    expect(price!.inputPricePerMillionTokensInUSD).toBe(2.5);
  });

  test("an empty override list behaves exactly like no overrides", () => {
    const withEmpty: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("gpt-4o", []);
    const without: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel("gpt-4o");

    expect(withEmpty).toEqual(without);
  });

  test("overrides do not make an unknown model match", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "my-custom-finetune",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
    ];

    expect(
      LlmCostCatalogUtil.findPriceForModel(
        "totally-unknown-model-9000",
        overrides,
      ),
    ).toBeNull();
  });
});

describe("LlmCostCatalogUtil.computeCostInUSD — project price overrides", () => {
  test("cost is computed from the override's prices", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "my-custom-finetune",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
    ];

    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "my-custom-finetune-v3",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      projectPriceOverrides: overrides,
    });

    expect(cost).toBe(1 + 1);
  });

  test("a zero-price override yields cost 0, not null — free is not unpriceable", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "llama-self-hosted",
        inputPricePerMillionTokensInUSD: 0,
        outputPricePerMillionTokensInUSD: 0,
      },
    ];

    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "llama-self-hosted-70b",
      inputTokens: 1000,
      outputTokens: 1000,
      projectPriceOverrides: overrides,
    });

    expect(cost).toBe(0);
  });

  test("an override tie-win changes the computed cost", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const cost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      projectPriceOverrides: overrides,
    });

    // Built-in would be 2.5 + 10 = 12.5; the override prices it at 6.25.
    expect(cost).toBe(6.25);
  });
});
