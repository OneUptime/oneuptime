import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
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
