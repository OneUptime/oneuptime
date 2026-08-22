import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { LlmModelPrice } from "../../../../Types/Telemetry/LlmCostCatalog";
import { describe, expect, test } from "@jest/globals";

type Attrs = Dictionary<AttributeType | Array<AttributeType>>;

describe("LlmSpanUtil.extract", () => {
  test("non-LLM span returns empty/default fields", () => {
    const attrs: Attrs = {
      "http.method": "GET",
      "http.route": "/api/users",
      "db.system": "postgresql",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.isLlmSpan).toBe(false);
    expect(fields.llmSystem).toBe("");
    expect(fields.llmTotalTokens).toBe(0);
    expect(fields.llmCost).toBe(0);
  });

  test("empty attributes returns defaults", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({});
    expect(fields).toEqual(LlmSpanUtil.empty());
  });

  test("OTel GenAI conventions (chat completion)", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.usage.input_tokens": 1200,
      "gen_ai.usage.output_tokens": 350,
      "gen_ai.usage.cost": 0.0185,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmSystem).toBe("openai");
    expect(fields.llmOperation).toBe("chat");
    expect(fields.llmRequestModel).toBe("gpt-4o");
    expect(fields.llmResponseModel).toBe("gpt-4o-2024-08-06");
    expect(fields.llmInputTokens).toBe(1200);
    expect(fields.llmOutputTokens).toBe(350);
    // total derived from input + output when not reported.
    expect(fields.llmTotalTokens).toBe(1550);
    expect(fields.llmCost).toBe(0.0185);
  });

  test("explicit total_tokens is preferred over derived sum", () => {
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-opus-4-8",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
      "gen_ai.usage.total_tokens": 999,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmTotalTokens).toBe(999);
  });

  test("OpenLLMetry legacy prompt/completion token aliases", () => {
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4-6",
      "gen_ai.usage.prompt_tokens": 80,
      "gen_ai.usage.completion_tokens": 20,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmInputTokens).toBe(80);
    expect(fields.llmOutputTokens).toBe(20);
    expect(fields.llmTotalTokens).toBe(100);
  });

  test("OpenInference (llm.* + llm.token_count.*) conventions", () => {
    const attrs: Attrs = {
      "openinference.span.kind": "LLM",
      "llm.system": "openai",
      "llm.model_name": "gpt-4o-mini",
      "llm.token_count.prompt": 500,
      "llm.token_count.completion": 120,
      "llm.token_count.total": 620,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmSystem).toBe("openai");
    expect(fields.llmOperation).toBe("LLM");
    expect(fields.llmRequestModel).toBe("gpt-4o-mini");
    expect(fields.llmInputTokens).toBe(500);
    expect(fields.llmOutputTokens).toBe(120);
    expect(fields.llmTotalTokens).toBe(620);
  });

  test("numeric token values reported as strings are coerced", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": "42",
      "gen_ai.usage.output_tokens": "8",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmInputTokens).toBe(42);
    expect(fields.llmOutputTokens).toBe(8);
    expect(fields.llmTotalTokens).toBe(50);
  });

  test("agent + tool spans are detected", () => {
    const agentAttrs: Attrs = {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "research-agent",
    };
    const agentFields: LlmSpanFields = LlmSpanUtil.extract(agentAttrs);
    expect(agentFields.isLlmSpan).toBe(true);
    expect(agentFields.llmAgentName).toBe("research-agent");
    expect(agentFields.llmOperation).toBe("invoke_agent");

    const toolAttrs: Attrs = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "web_search",
    };
    const toolFields: LlmSpanFields = LlmSpanUtil.extract(toolAttrs);
    expect(toolFields.isLlmSpan).toBe(true);
    expect(toolFields.llmToolName).toBe("web_search");
  });

  test("response model is used as request model fallback", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
    };
    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmRequestModel).toBe("gpt-4o-2024-08-06");
    expect(fields.llmResponseModel).toBe("gpt-4o-2024-08-06");
  });

  test("bare gen_ai-namespaced attribute still flags as LLM span", () => {
    const attrs: Attrs = {
      "gen_ai.request.temperature": 0.7,
    };
    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(true);
  });

  test("array-valued attributes do not break string/number extraction", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 10,
    };
    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmInputTokens).toBe(10);
  });
});

describe("LlmSpanUtil.extract — cost fallback from the pricing catalog", () => {
  test("SDK-reported cost always wins over the catalog", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
      // Catalog would say $12.50; the SDK (negotiated rate) says less.
      "gen_ai.usage.cost": 9.99,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(9.99);
  });

  test("an explicitly reported zero cost wins — no catalog estimate", () => {
    // A gateway fronting a free/local model reports cost 0; that 0 is real.
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 500_000,
      "gen_ai.usage.cost": 0,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(0);
  });

  test("a reported zero cost as a string also wins", () => {
    const attrs: Attrs = {
      "gen_ai.system": "meta",
      "gen_ai.request.model": "llama-3.1-8b-instant",
      "gen_ai.usage.input_tokens": 100_000,
      "gen_ai.usage.cost": "0",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(0);
  });

  test("LiteLLM's v1 cost breakdown key is read as reported cost", () => {
    /*
     * LiteLLM's otel callback reports cost under gen_ai.cost.*, not
     * gen_ai.usage.cost — its total must win over the catalog estimate.
     */
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
      "gen_ai.cost.total_cost": 7.25,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(7.25);
  });

  test("LiteLLM's OTel v2 cost key is read as reported cost", () => {
    const attrs: Attrs = {
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
      "litellm.cost.total": 6.5,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(6.5);
  });

  test("a malformed reported cost falls back to the catalog", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 0,
      "gen_ai.usage.cost": "not-a-number",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(2.5);
  });

  test("cost is computed from tokens when the SDK reports none", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 100_000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    // 1M * $2.50/M + 0.1M * $10/M = $3.50
    expect(fields.llmCost).toBe(3.5);
  });

  test("response model is priced in preference to the request model", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      // Alias requested; cheaper mini snapshot actually served.
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.response.model": "gpt-4o-mini-2024-07-18",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 0,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    // Priced as gpt-4o-mini ($0.15/M input), not gpt-4o ($2.50/M).
    expect(fields.llmCost).toBe(0.15);
  });

  test("request model prices the call when no response model exists", () => {
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-3-5-sonnet-20241022",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 0,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(3);
  });

  test("unknown model leaves cost at zero — no guessing", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "my-private-finetune",
      "gen_ai.usage.input_tokens": 5000,
      "gen_ai.usage.output_tokens": 5000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(0);
  });

  test("no tokens leaves cost at zero even for a known model", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(0);
  });

  test("no model leaves cost at zero even with tokens", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": 42,
      "gen_ai.usage.output_tokens": 8,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(0);
  });

  test("Bedrock-decorated model id is priced via normalization", () => {
    const attrs: Attrs = {
      "gen_ai.system": "aws.bedrock",
      "gen_ai.request.model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 0,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmCost).toBe(3);
  });

  test("tool spans without tokens are not priced", () => {
    const attrs: Attrs = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "web_search",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmCost).toBe(0);
  });
});

describe("LlmSpanUtil.extract — conversation id", () => {
  test("gen_ai.conversation.id is extracted", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.conversation.id": "conv-1234",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmConversationId).toBe("conv-1234");
  });

  test("session.id (OpenInference / Langfuse) is the fallback", () => {
    const attrs: Attrs = {
      "llm.model_name": "gpt-4o",
      "session.id": "sess-abc",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmConversationId).toBe("sess-abc");
  });

  test("OpenLLMetry association property is recognized", () => {
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "traceloop.association.properties.session_id": "chat-42",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmConversationId).toBe("chat-42");
  });

  test("the semconv key wins when multiple conventions are present", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.conversation.id": "conv-semconv",
      "session.id": "sess-openinference",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmConversationId).toBe("conv-semconv");
  });

  test("absent conversation id yields an empty string", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.llmConversationId).toBe("");
  });

  test("a non-LLM RUM span with session.id gets no conversation id", () => {
    /*
     * "session.id" is a generic OTel key browser/RUM spans carry — it is
     * already denormalized into the sessionId column. It must only become a
     * conversation id on LLM spans, never on the RUM fleet.
     */
    const attrs: Attrs = {
      "http.method": "GET",
      "http.route": "/checkout",
      "session.id": "rum-session-123",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);
    expect(fields.isLlmSpan).toBe(false);
    expect(fields.llmConversationId).toBe("");
  });
});

describe("LlmSpanUtil.extract — project price overrides", () => {
  test("an override prices a custom model the catalog does not know", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "my-custom-finetune",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
    ];

    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "my-custom-finetune-v3",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 500_000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs, overrides);

    expect(fields.isLlmSpan).toBe(true);
    // 1M * $1/M + 0.5M * $2/M = 2.
    expect(fields.llmCost).toBe(2);
  });

  test("an override beats the built-in catalog on a prefix-length tie", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs, overrides);

    // Built-in gpt-4o would price this at 2.5 + 10 = 12.5.
    expect(fields.llmCost).toBe(6.25);
  });

  test("a longer built-in prefix still beats a shorter override", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o-mini-2024-07-18",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs, overrides);

    // Built-in gpt-4o-mini: 0.15 + 0.6 = 0.75.
    expect(fields.llmCost).toBe(0.75);
  });

  test("an SDK-reported cost still wins over any override", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1.25,
        outputPricePerMillionTokensInUSD: 5,
      },
    ];

    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 1_000_000,
      "gen_ai.usage.cost": 0.42,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs, overrides);

    expect(fields.llmCost).toBe(0.42);
  });

  test("a zero-price override marks the span free rather than unpriced", () => {
    const overrides: Array<LlmModelPrice> = [
      {
        modelPrefix: "llama-self-hosted",
        inputPricePerMillionTokensInUSD: 0,
        outputPricePerMillionTokensInUSD: 0,
      },
    ];

    const attrs: Attrs = {
      "gen_ai.system": "ollama",
      "gen_ai.request.model": "llama-self-hosted-70b",
      "gen_ai.usage.input_tokens": 5000,
      "gen_ai.usage.output_tokens": 5000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs, overrides);

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmCost).toBe(0);
  });

  test("without overrides an unknown model still costs zero", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "my-custom-finetune-v3",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 500_000,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmCost).toBe(0);
  });
});
