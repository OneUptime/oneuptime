import { describe, expect, test } from "@jest/globals";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import {
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
  LlmProviderTokenType,
} from "../../../Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "../../../Types/ObjectID";
import {
  LLM_PROVIDER_USAGE_DIMENSIONS,
  LlmProviderUsageDimension,
  LlmProviderUsageDimensionKey,
  LlmProviderUsageSummary,
  buildProviderMetricQuery,
  foldProviderUsage,
  getProviderLabel,
  getProviderUsageDimension,
  startOfUtcDay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmProviderUsageQuery";

/*
 * Usage > Provider accounts reads the three metrics a provider connection
 * keeps and folds them into one row per group. What a reader relies on:
 *
 *   - a range starts at its first day's UTC midnight, since providers
 *     report whole days stamped there;
 *   - input and output tokens add up, cache reads and writes do not (input
 *     already counts them);
 *   - a cost is marked estimated only when an estimate is in it;
 *   - a provider's correction never leaves a group below nothing, and a
 *     group with nothing in it is not listed;
 *   - biggest cost first, then most tokens;
 *   - providers are named as the product names them.
 */

const MODEL: LlmProviderUsageDimension = getProviderUsageDimension("model");

function row(
  value: number,
  attributes: Record<string, string>,
): AggregatedModel {
  return {
    timestamp: new Date("2026-10-19T00:00:00.000Z"),
    value,
    attributes,
  } as unknown as AggregatedModel;
}

function fold(data: {
  dimension?: LlmProviderUsageDimension;
  costRows?: Array<AggregatedModel>;
  tokenRows?: Array<AggregatedModel>;
  requestRows?: Array<AggregatedModel>;
}): LlmProviderUsageSummary {
  return foldProviderUsage({
    dimension: data.dimension || MODEL,
    costRows: data.costRows || [],
    tokenRows: data.tokenRows || [],
    requestRows: data.requestRows || [],
  });
}

describe("the range read", () => {
  test("starts at the first day's UTC midnight and ends when asked", () => {
    const projectId: ObjectID = new ObjectID(
      "2b9d5d8e-1c44-4f0a-8f7e-6d3c2b1a0f9e",
    );
    const start: Date = new Date("2026-10-17T14:35:00.000Z");
    const end: Date = new Date("2026-10-20T09:00:00.000Z");

    const query: Record<string, unknown> = buildProviderMetricQuery({
      projectId,
      metricName: LLM_PROVIDER_COST_METRIC_NAME,
      startTime: start,
      endTime: end,
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(projectId);
    expect(query["name"]).toBe("oneuptime.llm.provider.cost");

    const time: InBetween<Date> = query["time"] as InBetween<Date>;

    expect(time).toBeInstanceOf(InBetween);
    expect(time.startValue.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(time.endValue).toBe(end);
  });

  test("midnight stays midnight", () => {
    expect(
      startOfUtcDay(new Date("2026-10-17T00:00:00.000Z")).toISOString(),
    ).toBe("2026-10-17T00:00:00.000Z");
    expect(
      startOfUtcDay(new Date("2026-10-17T23:59:59.999Z")).toISOString(),
    ).toBe("2026-10-17T00:00:00.000Z");
  });
});

describe("one row per group", () => {
  test("cost, tokens and requests of a model land on its row", () => {
    const summary: LlmProviderUsageSummary = fold({
      costRows: [
        row(12.5, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5" }),
        row(2.25, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5" }),
      ],
      tokenRows: [
        row(1000, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Input,
        }),
        row(300, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Output,
        }),
      ],
      requestRows: [row(42, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5" })],
    });

    expect(summary.rows).toEqual([
      {
        key: "gpt-5",
        costUsd: 14.75,
        costIncludesEstimate: false,
        inputTokens: 1000,
        outputTokens: 300,
        requests: 42,
      },
    ]);
  });

  test("cache reads and writes add nothing: input already counts them", () => {
    const summary: LlmProviderUsageSummary = fold({
      tokenRows: [
        row(1000, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "claude-sonnet-4-5",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Input,
        }),
        row(800, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "claude-sonnet-4-5",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.CacheRead,
        }),
        row(200, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "claude-sonnet-4-5",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.CacheWrite,
        }),
      ],
    });

    expect(summary.rows[0]).toMatchObject({
      inputTokens: 1000,
      outputTokens: 0,
    });
  });

  test("a cost is an estimate only when an estimated amount is in it", () => {
    const summary: LlmProviderUsageSummary = fold({
      costRows: [
        row(3, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "amazon.nova-pro",
          [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "true",
        }),
        row(0, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5",
          [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "true",
        }),
        row(5, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5",
          [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "false",
        }),
      ],
    });

    expect(
      summary.rows.map(
        (item: { key: string; costIncludesEstimate: boolean }) => {
          return [item.key, item.costIncludesEstimate];
        },
      ),
    ).toEqual([
      ["gpt-5", false],
      ["amazon.nova-pro", true],
    ]);
    expect(summary.totals.costIncludesEstimate).toBe(true);
  });

  test("a correction never leaves a group below nothing, and an empty group is not listed", () => {
    const summary: LlmProviderUsageSummary = fold({
      costRows: [
        row(4, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5" }),
        row(-6, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-5" }),
        row(0, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "o3" }),
      ],
      requestRows: [row(Number.NaN, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "o3" })],
    });

    expect(summary.rows).toEqual([]);
    expect(summary.totals.costUsd).toBe(0);
  });

  test("biggest cost first, then most tokens, then by name", () => {
    const summary: LlmProviderUsageSummary = fold({
      costRows: [
        row(1, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "small" }),
        row(9, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "big" }),
      ],
      tokenRows: [
        row(50, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "tokens-b",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Input,
        }),
        row(50, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "tokens-a",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Input,
        }),
        row(500, {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "tokens-many",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: LlmProviderTokenType.Output,
        }),
      ],
    });

    expect(
      summary.rows.map((item: { key: string }): string => {
        return item.key;
      }),
    ).toEqual(["big", "small", "tokens-many", "tokens-a", "tokens-b"]);
  });

  test("usage the provider did not name is its own group", () => {
    const summary: LlmProviderUsageSummary = fold({
      dimension: getProviderUsageDimension("person"),
      costRows: [
        row(2, { [LLM_PROVIDER_PERSON_ATTRIBUTE]: "ada@example.com" }),
        row(1, {}),
      ],
    });

    expect(
      summary.rows.map((item: { key: string }): string => {
        return item.key;
      }),
    ).toEqual(["ada@example.com", ""]);
  });

  test("the totals add every group, cost to the cent", () => {
    const summary: LlmProviderUsageSummary = fold({
      costRows: [
        row(0.333333, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "a" }),
        row(0.333333, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "b" }),
        row(0.333333, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "c" }),
      ],
      requestRows: [
        row(5, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "a" }),
        row(7, { [LLM_PROVIDER_MODEL_ATTRIBUTE]: "c" }),
      ],
    });

    expect(summary.totals).toEqual({
      key: "",
      costUsd: 1,
      costIncludesEstimate: false,
      inputTokens: 0,
      outputTokens: 0,
      requests: 12,
    });
  });
});

describe("the groupings and the names", () => {
  test("model, person, provider, project, API key and connection", () => {
    expect(
      LLM_PROVIDER_USAGE_DIMENSIONS.map(
        (dimension: LlmProviderUsageDimension): string => {
          return `${dimension.key} ${dimension.attributeKey}`;
        },
      ),
    ).toEqual([
      "model gen_ai.request.model",
      "person user.email",
      "provider gen_ai.provider.name",
      "project oneuptime.llm.provider.project",
      "apiKey oneuptime.llm.provider.api_key",
      "connection oneuptime.llm.connection.name",
    ]);
  });

  test("an unknown grouping falls back to the model", () => {
    expect(
      getProviderUsageDimension("nonsense" as LlmProviderUsageDimensionKey).key,
    ).toBe("model");
  });

  test.each([
    ["openai", "OpenAI"],
    ["anthropic", "Anthropic"],
    ["aws.bedrock", "Amazon Bedrock"],
    ["gcp.vertex_ai", "Google Vertex AI"],
    ["someone.else", "someone.else"],
  ])("%s is shown as %s", (genAiName: string, label: string) => {
    expect(getProviderLabel(genAiName)).toBe(label);
  });
});
