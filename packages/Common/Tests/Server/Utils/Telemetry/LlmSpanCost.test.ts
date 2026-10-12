import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { LlmModelPrice } from "../../../../Types/Telemetry/LlmCostCatalog";
import { LlmAnswerIssue } from "../../../../Types/Telemetry/LlmAnswerIssue";
import { SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import { describe, expect, test } from "@jest/globals";

/*
 * What an AI call is stored with: its tokens and its cost, for the models
 * people run today.
 *
 *  - Claude Code's traces beta used to arrive with no tokens and a cost of
 *    $0: its claude_code.llm_request span names its model (gen_ai.system,
 *    gen_ai.request.model) but writes its usage under input_tokens,
 *    output_tokens, cache_read_tokens and cache_creation_tokens. It now gets
 *    its tokens (cached ones counted in the input, as the GenAI conventions
 *    count them) and a cost at its model's list prices, cache prices
 *    included.
 *  - Claude Opus 4.5 and later used to be charged Opus 4's $15 / $75.
 *  - Spans that already report gen_ai.usage.* keep the tokens they had.
 */

type Attrs = Dictionary<AttributeType | Array<AttributeType>>;

/*
 * A claude_code.llm_request span as Claude Code's monitoring docs list its
 * attributes (code.claude.com/docs/en/monitoring-usage, read 2026-10-12):
 * the standard attributes, span.type, model and its GenAI copies, the usage
 * block's four counts, and the response's id and stop reason.
 */
function claudeCodeLlmRequest(extra: Attrs = {}): Attrs {
  return {
    "span.type": "llm_request",
    "session.id": "1d5c6a5e-session",
    "user.email": "jdoe@example.com",
    "user.id": "c0ffee",
    "organization.id": "org-1",
    "terminal.type": "vscode",
    model: "claude-opus-4-8",
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": "claude-opus-4-8",
    query_source_safe: "repl_main_thread",
    speed: "normal",
    "llm_request.context": "interaction",
    duration_ms: 8412,
    ttft_ms: 1204,
    input_tokens: 12,
    output_tokens: 640,
    cache_read_tokens: 48_000,
    cache_creation_tokens: 2_100,
    request_id: "req_011CVzexample",
    "gen_ai.response.id": "req_011CVzexample",
    attempt: 1,
    success: "true",
    "response.has_tool_call": "true",
    stop_reason: "tool_use",
    "gen_ai.response.finish_reasons": ["tool_use"],
    ...extra,
  };
}

/*
 * Claude Opus 4.8: $5 input, $0.50 cache hit, $6.25 5-minute cache write,
 * $25 output, per million tokens.
 */
const OPUS_4_8_COST: number =
  (12 * 5 + 48_000 * 0.5 + 2_100 * 6.25 + 640 * 25) / 1_000_000;

describe("a Claude Code traces beta span gets its tokens and a cost", () => {
  test("its tokens, counted as the GenAI conventions count them", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(claudeCodeLlmRequest());

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmSystem).toBe("anthropic");
    expect(fields.llmRequestModel).toBe("claude-opus-4-8");
    expect(fields.llmInputTokens).toBe(50_112);
    expect(fields.llmOutputTokens).toBe(640);
    expect(fields.llmTotalTokens).toBe(50_752);
  });

  test("its cost: the uncached input, the cache reads and writes and the output, each at its price", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(claudeCodeLlmRequest());

    expect(fields.llmCost).toBe(Math.round(OPUS_4_8_COST * 1e8) / 1e8);
    expect(fields.llmCost).toBe(0.053185);
  });

  test("the employee who ran it is read too, as on any AI call", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(claudeCodeLlmRequest());

    expect(fields.llmUserEmail).toBe("jdoe@example.com");
    expect(fields.llmConversationId).toBe("1d5c6a5e-session");
  });

  test("Claude Code on Amazon Bedrock and Google Cloud names its model their way", () => {
    for (const model of [
      "us.anthropic.claude-opus-4-8",
      "global.anthropic.claude-opus-4-8",
      "claude-opus-4-8@20260801",
    ]) {
      const fields: LlmSpanFields = LlmSpanUtil.extract(
        claudeCodeLlmRequest({
          model: model,
          "gen_ai.request.model": model,
        }),
      );

      expect({ model, cost: fields.llmCost }).toEqual({
        model,
        cost: 0.053185,
      });
    }
  });

  /*
   * 12 uncached input, 48,000 cache reads, 2,100 cache writes and 640 output
   * tokens at each model's official prices.
   */
  test.each([
    ["claude-opus-4-5-20251101", 0.053185],
    ["claude-opus-4-1-20250805", 0.159555],
    ["claude-sonnet-4-5-20250929", 0.031911],
    ["claude-haiku-4-5-20251001", 0.010637],
    ["claude-fable-5-1", 0.07037],
    ["claude-opus-5-5", 0.032948],
    ["claude-sonnet-5-5", 0.016474],
  ])(
    "a Claude Code call to %p costs $%p",
    (model: string, cost: number) => {
      const fields: LlmSpanFields = LlmSpanUtil.extract(
        claudeCodeLlmRequest({
          model: model,
          "gen_ai.request.model": model,
        }),
      );

      expect(fields.llmCost).toBe(cost);
    },
  );

  test("a project's own price for the model wins, and charges every input token", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "claude-opus-4-8",
        inputPricePerMillionTokensInUSD: 4,
        outputPricePerMillionTokensInUSD: 20,
      },
    ];

    const fields: LlmSpanFields = LlmSpanUtil.extract(
      claudeCodeLlmRequest(),
      overrides,
    );

    // (50,112 x $4 + 640 x $20) per million.
    expect(fields.llmCost).toBe(0.213248);
  });

  test("a reported cost still wins over the estimate", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      claudeCodeLlmRequest({ "gen_ai.usage.cost": 0.042 }),
    );

    expect(fields.llmCost).toBe(0.042);
    expect(fields.llmInputTokens).toBe(50_112);
  });

  test("a model the catalog does not know yet keeps its tokens and costs 0", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      claudeCodeLlmRequest({
        model: "claude-opus-4-9",
        "gen_ai.request.model": "claude-opus-4-9",
      }),
    );

    expect(fields.llmInputTokens).toBe(50_112);
    expect(fields.llmCost).toBe(0);
  });

  test("the answer checks read its output count: a tool call is not an empty answer, 0 tokens after end_turn is", () => {
    expect(
      LlmSpanUtil.extract(claudeCodeLlmRequest(), undefined, {
        statusCode: SpanStatus.Ok,
      }).llmIssues,
    ).toEqual([]);

    expect(
      LlmSpanUtil.extract(
        claudeCodeLlmRequest({
          output_tokens: 0,
          stop_reason: "end_turn",
          "gen_ai.response.finish_reasons": ["end_turn"],
          "response.has_tool_call": "false",
        }),
        undefined,
        { statusCode: SpanStatus.Ok },
      ).llmIssues,
    ).toEqual([LlmAnswerIssue.Empty]);
  });

  test("a failed request is a failed call, not an empty one", () => {
    expect(
      LlmSpanUtil.extract(
        claudeCodeLlmRequest({
          success: "false",
          status_code: 529,
          error: "Overloaded",
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          "gen_ai.response.finish_reasons": [],
          stop_reason: "",
        }),
        undefined,
        { statusCode: SpanStatus.Error },
      ).llmIssues,
    ).toEqual([LlmAnswerIssue.Failed]);
  });
});

describe("Claude Code's bare keys are read only where they can mean nothing else", () => {
  test("a span that names no model or provider is not made an AI call by them", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "http.route": "/api/tokenize",
      input_tokens: 1_000,
      output_tokens: 10,
    });

    expect(fields.isLlmSpan).toBe(false);
    expect(fields.llmInputTokens).toBe(0);
    expect(fields.llmCost).toBe(0);
  });

  test("an AI tool span with no model is not priced from them", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "tokenize",
      input_tokens: 1_000,
      output_tokens: 10,
    });

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmInputTokens).toBe(0);
    expect(fields.llmCost).toBe(0);
  });

  test("a span with gen_ai.usage.* keeps them: the bare keys are a fallback only", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      claudeCodeLlmRequest({
        "gen_ai.usage.input_tokens": 2_000,
        "gen_ai.usage.output_tokens": 100,
      }),
    );

    expect(fields.llmInputTokens).toBe(2_000);
    expect(fields.llmOutputTokens).toBe(100);
    // 2,000 x $5 + 100 x $25 per million.
    expect(fields.llmCost).toBe(0.0125);
  });
});

describe("spans that report gen_ai.usage.* keep the tokens they had", () => {
  test.each([
    [
      "the GenAI conventions",
      {
        "gen_ai.usage.input_tokens": 1_200,
        "gen_ai.usage.output_tokens": 350,
      },
      [1_200, 350, 1_550],
    ],
    [
      "a reported total",
      {
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.total_tokens": 999,
      },
      [100, 50, 999],
    ],
    [
      "OpenLLMetry's legacy keys",
      {
        "gen_ai.usage.prompt_tokens": 80,
        "gen_ai.usage.completion_tokens": 20,
      },
      [80, 20, 100],
    ],
    [
      "OpenInference",
      {
        "llm.token_count.prompt": 500,
        "llm.token_count.completion": 120,
        "llm.token_count.total": 620,
      },
      [500, 120, 620],
    ],
    [
      "a cache count inside the input count",
      {
        "gen_ai.usage.input_tokens": 10_000,
        "gen_ai.usage.output_tokens": 20,
        "gen_ai.usage.cache_read.input_tokens": 9_000,
      },
      [10_000, 20, 10_020],
    ],
  ])(
    "%s",
    (_name: string, usage: Attrs, expected: Array<number>) => {
      const fields: LlmSpanFields = LlmSpanUtil.extract({
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o",
        ...usage,
      });

      expect([
        fields.llmInputTokens,
        fields.llmOutputTokens,
        fields.llmTotalTokens,
      ]).toEqual(expected);
    },
  );
});

describe("the cost of a call to a current model", () => {
  function costOf(model: string, usage: Attrs): number {
    return LlmSpanUtil.extract({
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": model,
      ...usage,
    }).llmCost;
  }

  test("Claude Opus 4.5, 4.6, 4.7 and 4.8 at $5 / $25, not Opus 4's $15 / $75", () => {
    for (const model of [
      "claude-opus-4-5-20251101",
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "us.anthropic.claude-opus-4-5-20251101-v1:0",
      "anthropic/claude-opus-4.7",
    ]) {
      expect({
        model,
        cost: costOf(model, {
          "gen_ai.usage.input_tokens": 1_000_000,
          "gen_ai.usage.output_tokens": 1_000_000,
        }),
      }).toEqual({ model, cost: 30 });
    }
  });

  test("Claude Opus 4 itself still at $15 / $75", () => {
    expect(
      costOf("claude-opus-4-20250514", {
        "gen_ai.usage.input_tokens": 1_000_000,
        "gen_ai.usage.output_tokens": 1_000_000,
      }),
    ).toBe(90);
  });

  test("the Claude 5 family at its own prices", () => {
    const million: Attrs = {
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
    };

    expect(costOf("claude-fable-5-1", million)).toBe(60);
    expect(costOf("claude-opus-5-5", million)).toBe(24);
    expect(costOf("claude-sonnet-5-5", million)).toBe(12);
    expect(costOf("claude-opus-5", million)).toBe(30);
    expect(costOf("claude-sonnet-5", million)).toBe(12);
  });

  test("a conventions span's cache reads pay the cache price", () => {
    // 1,000,000 input of which 900,000 cache reads on Claude Sonnet 4.5.
    expect(
      costOf("claude-sonnet-4-5", {
        "gen_ai.usage.input_tokens": 1_000_000,
        "gen_ai.usage.cache_read.input_tokens": 900_000,
      }),
    ).toBe(0.57);
  });

  test("an input count that left its cache out pays for the cache as well", () => {
    // OpenLLMetry's older Anthropic path: input_tokens without the cache.
    expect(
      costOf("claude-sonnet-4-5", {
        "gen_ai.usage.input_tokens": 100_000,
        "gen_ai.usage.cache_read_input_tokens": 900_000,
      }),
    ).toBe(0.57);
  });
});
