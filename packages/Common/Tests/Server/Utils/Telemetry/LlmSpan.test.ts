import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { LlmModelPrice } from "../../../../Types/Telemetry/LlmCostCatalog";
import {
  LlmEndUserAttributeKeys,
  LlmTeamAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserIdAttributeKeys,
  RESOURCE_ATTRIBUTE_KEY_PREFIX,
  withResourcePrefixedKeys,
} from "../../../../Types/Telemetry/LlmConventions";
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

/*
 * Employee identity extraction.
 *
 * The class of bug this block prevents is WRONG INTERNAL CHARGEBACK, in three
 * flavours, each of which is silent — the columns are populated, the
 * dashboards render, and the numbers are simply attributed to the wrong
 * person:
 *
 *   1. Preference-order drift. Every list here is ordered preferred-first and
 *      the extractor returns the FIRST present key. If someone reorders a
 *      list (or the getString loop stops short-circuiting), a span carrying
 *      both the semconv key and a vendor fallback flips to the fallback and
 *      the same human shows up under two different ids.
 *   2. Customer/employee conflation. gen_ai.user, llm.user and LiteLLM's
 *      end_user_id carry the CALLER'S OWN CUSTOMER. Mapping one into the
 *      employee columns turns a support bot's 40k customers into 40k phantom
 *      employees and zeroes out the engineer who actually owns the spend.
 *   3. Gate erosion. user.id / user.email / team.id are GENERIC OTel keys
 *      that RUM and plain HTTP spans carry. If the isLlmSpan gate is dropped,
 *      the columns and their skip indexes get stamped onto the entire span
 *      fleet — the highest-volume class there is — to serve a reader that
 *      only ever queries LLM rows.
 *   4. Tier omission. Ingest flattens RESOURCE attributes with a "resource."
 *      prefix, so identity set once per process — which is the only thing
 *      OTEL_RESOURCE_ATTRIBUTES can do, and what Cursor documents for
 *      cursor.user.id — arrives as `resource.user.id`, never `user.id`. A
 *      list of bare keys alone matches nothing at all, and every column is
 *      silently empty.
 */

/*
 * The FULL expected key order, written out as literals ON PURPOSE.
 *
 * Two tiers, in this order and no other: every SPAN spelling first, then the
 * same list again resource-prefixed. A span attribute describes one call and
 * a resource attribute describes the whole process, so the span attribute is
 * the more specific statement and has to win when both are present.
 */
const EXPECTED_USER_ID_KEY_ORDER: Array<string> = [
  "user.id",
  "enduser.id",
  "litellm.metadata.user_api_key_user_id",
  "metadata.user_api_key_user_id",
  "traceloop.association.properties.user_id",
  "langfuse.user.id",
  "user.account_uuid",
  "user.account_id",
  "cursor.user.id",
  "resource.user.id",
  "resource.enduser.id",
  "resource.litellm.metadata.user_api_key_user_id",
  "resource.metadata.user_api_key_user_id",
  "resource.traceloop.association.properties.user_id",
  "resource.langfuse.user.id",
  "resource.user.account_uuid",
  "resource.user.account_id",
  "resource.cursor.user.id",
];

const EXPECTED_USER_EMAIL_KEY_ORDER: Array<string> = [
  "user.email",
  "litellm.metadata.user_api_key_user_email",
  "metadata.user_api_key_user_email",
  "traceloop.association.properties.user_email",
  "enduser.email",
  "resource.user.email",
  "resource.litellm.metadata.user_api_key_user_email",
  "resource.metadata.user_api_key_user_email",
  "resource.traceloop.association.properties.user_email",
  "resource.enduser.email",
];

const EXPECTED_TEAM_KEY_ORDER: Array<string> = [
  "team.id",
  "team",
  "cost_center",
  "department",
  "litellm.metadata.user_api_key_team_id",
  "litellm.team.id",
  "metadata.user_api_key_team_id",
  "cursor.team.id",
  "resource.team.id",
  "resource.team",
  "resource.cost_center",
  "resource.department",
  "resource.litellm.metadata.user_api_key_team_id",
  "resource.litellm.team.id",
  "resource.metadata.user_api_key_team_id",
  "resource.cursor.team.id",
];

describe("LlmSpanUtil.extract — employee identity", () => {
  /*
   * Every recognized key, on its own, populates its column. A key that is
   * listed but never read is worse than one that is absent: the list is the
   * documentation, and a reader trusts it.
   */
  test.each(LlmUserIdAttributeKeys)(
    "user id key %s is recognized on its own",
    (key: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        [key]: "employee-value",
      };

      expect(LlmSpanUtil.extract(attrs).llmUserId).toBe("employee-value");
    },
  );

  test.each(LlmUserEmailAttributeKeys)(
    "user email key %s is recognized on its own",
    (key: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        [key]: "engineer@example.com",
      };

      expect(LlmSpanUtil.extract(attrs).llmUserEmail).toBe(
        "engineer@example.com",
      );
    },
  );

  test.each(LlmTeamAttributeKeys)(
    "team key %s is recognized on its own",
    (key: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        [key]: "platform",
      };

      expect(LlmSpanUtil.extract(attrs).llmTeam).toBe("platform");
    },
  );

  /*
   * LiteLLM proxy, DEFAULT configuration.
   *
   * This block exists because we shipped the wrong spelling once. The
   * "litellm."-namespaced attributes only appear under LiteLLM's opt-in
   * OpenTelemetry v2 mode (LITELLM_OTEL_V2, which defaults to false). The
   * default `otel` callback stamps its metadata with a bare "metadata."
   * prefix instead — every key in METRIC_METADATA_KEYS, assigned as
   * `common_attrs[f"metadata.{key}"]` in
   * litellm/integrations/opentelemetry.py.
   *
   * The consequence of recognizing only the v2 spelling was silent and total:
   * a stock LiteLLM proxy issuing one virtual key per employee — the exact
   * architecture our AI-gateway guide recommends as the cleanest chargeback
   * setup — produced no attribution at all, with every gateway dollar landing
   * in the Unattributed row and nothing anywhere to explain why.
   *
   * The end-user assertions are the other half: LiteLLM carries the DOWNSTREAM
   * CUSTOMER in the sibling key user_api_key_end_user_id (and, in v2, in the
   * dedicated litellm.end_user.id). Those must never reach an employee column,
   * or a SaaS customer's id gets billed to an engineer.
   */
  test("a default LiteLLM proxy attributes the key owner, not nobody", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "metadata.user_api_key_user_id": "user_42",
      "metadata.user_api_key_user_email": "engineer@example.com",
      "metadata.user_api_key_team_id": "team_platform",
    });

    expect(fields.llmUserId).toBe("user_42");
    expect(fields.llmUserEmail).toBe("engineer@example.com");
    expect(fields.llmTeam).toBe("team_platform");
  });

  test("a LiteLLM v2 proxy attributes the key owner too", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4",
      "litellm.metadata.user_api_key_user_id": "user_42",
      "litellm.metadata.user_api_key_user_email": "engineer@example.com",
      "litellm.team.id": "team_platform",
    });

    expect(fields.llmUserId).toBe("user_42");
    expect(fields.llmUserEmail).toBe("engineer@example.com");
    expect(fields.llmTeam).toBe("team_platform");
  });

  test.each([
    ["metadata.user_api_key_end_user_id", "v1 default spelling"],
    ["litellm.metadata.user_api_key_end_user_id", "v2 metadata spelling"],
    ["litellm.end_user.id", "v2 dedicated attribute"],
  ])(
    "LiteLLM's downstream customer never becomes the employee (%s — %s)",
    (key: string) => {
      const fields: LlmSpanFields = LlmSpanUtil.extract({
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o",
        [key]: "customer_abc",
      });

      expect(fields.llmUserId).toBe("");
      expect(fields.llmUserEmail).toBe("");
      expect(fields.llmTeam).toBe("");
    },
  );

  test("the key owner is billed even when a customer id rides along", () => {
    /*
     * The realistic shape: a SaaS product routing its own customers' traffic
     * through a per-engineer virtual key. Both ids are present on one span and
     * they must land in different places — the employee in the identity
     * columns, the customer nowhere near them.
     */
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "metadata.user_api_key_user_id": "user_42",
      "metadata.user_api_key_end_user_id": "customer_abc",
    });

    expect(fields.llmUserId).toBe("user_42");
    expect(fields.llmUserEmail).toBe("");
  });

  /*
   * Preference order, pinned to LITERAL key strings in a LITERAL order.
   *
   * The obvious way to write this — derive the fixture and the expectation
   * from the array under test — is worse than no test at all: it passes under
   * ANY reordering of the array, so it certifies a property it cannot
   * actually check while looking like it does. The literal constants above
   * are the expectation; the toEqual tests below bolt each constant to its
   * exported array, and the behavioural tests drive the extractor from the
   * constant. Reorder the array and the toEqual fails; break the extractor's
   * first-match-wins loop and the behavioural test fails.
   */
  test("the user id list is exactly this order", () => {
    expect(LlmUserIdAttributeKeys).toEqual(EXPECTED_USER_ID_KEY_ORDER);
  });

  test("the user email list is exactly this order", () => {
    expect(LlmUserEmailAttributeKeys).toEqual(EXPECTED_USER_EMAIL_KEY_ORDER);
  });

  test("the team list is exactly this order", () => {
    expect(LlmTeamAttributeKeys).toEqual(EXPECTED_TEAM_KEY_ORDER);
  });

  /*
   * For each key, a span carrying it plus every key after it must resolve to
   * that key. Driven off the literal orders above, so a single reorder
   * anywhere fails.
   */
  test.each(
    EXPECTED_USER_ID_KEY_ORDER.map((key: string, index: number) => {
      return [key, index] as [string, number];
    }),
  )("user id key %s beats every key after it", (key: string, index: number) => {
    const attrs: Attrs = { "gen_ai.system": "openai" };

    for (const lower of EXPECTED_USER_ID_KEY_ORDER.slice(index)) {
      attrs[lower] = `value-of-${lower}`;
    }

    expect(LlmSpanUtil.extract(attrs).llmUserId).toBe(`value-of-${key}`);
  });

  test.each(
    EXPECTED_USER_EMAIL_KEY_ORDER.map((key: string, index: number) => {
      return [key, index] as [string, number];
    }),
  )(
    "user email key %s beats every key after it",
    (key: string, index: number) => {
      const attrs: Attrs = { "gen_ai.system": "openai" };

      for (const lower of EXPECTED_USER_EMAIL_KEY_ORDER.slice(index)) {
        attrs[lower] = `${lower}@example.com`;
      }

      expect(LlmSpanUtil.extract(attrs).llmUserEmail).toBe(
        `${key}@example.com`,
      );
    },
  );

  test.each(
    EXPECTED_TEAM_KEY_ORDER.map((key: string, index: number) => {
      return [key, index] as [string, number];
    }),
  )("team key %s beats every key after it", (key: string, index: number) => {
    const attrs: Attrs = { "gen_ai.system": "openai" };

    for (const lower of EXPECTED_TEAM_KEY_ORDER.slice(index)) {
      attrs[lower] = `team-${lower}`;
    }

    expect(LlmSpanUtil.extract(attrs).llmTeam).toBe(`team-${key}`);
  });

  test("the semconv key beats the vendor fallback on a realistic gateway span", () => {
    /*
     * A LiteLLM-proxied call from a Claude Code session carries all three
     * spellings at once. user.id is the key an organization can standardize
     * on across every emitter, so it has to win.
     */
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4-6",
      "user.id": "u-semconv",
      "litellm.metadata.user_api_key_user_id": "u-litellm",
      "user.account_uuid": "u-claude-code",
    };

    expect(LlmSpanUtil.extract(attrs).llmUserId).toBe("u-semconv");
  });

  test("a full coding-agent span populates all three identity columns", () => {
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-opus-4-8",
      "user.email": "ada@example.com",
      "user.account_uuid": "acct-9f2",
      cost_center: "RD-114",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 20,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmUserId).toBe("acct-9f2");
    expect(fields.llmUserEmail).toBe("ada@example.com");
    expect(fields.llmTeam).toBe("RD-114");
  });

  /*
   * THE exclusion. These keys carry the caller's own downstream customer, not
   * the employee. A span carrying only them must leave the employee columns
   * empty — silently mapping them would produce chargeback that is wrong
   * rather than merely imprecise.
   */
  test.each(LlmEndUserAttributeKeys)(
    "downstream-customer key %s never populates the employee columns",
    (key: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o",
        [key]: "customer-9001",
      };

      const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

      expect(fields.isLlmSpan).toBe(true);
      expect(fields.llmUserId).toBe("");
      expect(fields.llmUserEmail).toBe("");
    },
  );

  test("a span carrying ONLY customer-identity keys yields empty identity", () => {
    const attrs: Attrs = {
      "gen_ai.user": "customer-1",
      "llm.user": "customer-1",
      "litellm.metadata.user_api_key_end_user_id": "customer-1",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    // The llm./gen_ai. namespaces still mark it as an LLM span...
    expect(fields.isLlmSpan).toBe(true);
    // ...but nobody internal is charged for it.
    expect(fields.llmUserId).toBe("");
    expect(fields.llmUserEmail).toBe("");
    expect(fields.llmTeam).toBe("");
  });

  test("the employee wins when both humans are on the same span", () => {
    /*
     * The realistic SaaS shape: an internal service calls OpenAI on behalf of
     * a customer, passing the customer through as the `user` request param.
     * The engineer's team owns the bill.
     */
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "user.id": "employee-42",
      "gen_ai.user": "customer-9001",
      "litellm.metadata.user_api_key_user_id": "employee-42",
      "litellm.metadata.user_api_key_end_user_id": "customer-9001",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmUserId).toBe("employee-42");
  });

  /*
   * The isLlmSpan gate. user.id / user.email / team.id are generic keys the
   * RUM and HTTP fleet carries; those spans must stay untouched.
   */
  test("a non-LLM RUM span with user.id gets no identity columns", () => {
    const attrs: Attrs = {
      "http.method": "GET",
      "http.route": "/checkout",
      "user.id": "rum-user-123",
      "user.email": "shopper@example.com",
      "team.id": "frontend",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.isLlmSpan).toBe(false);
    expect(fields.llmUserId).toBe("");
    expect(fields.llmUserEmail).toBe("");
    expect(fields.llmTeam).toBe("");
  });

  test("a non-LLM backend span with a full identity set stays empty", () => {
    const attrs: Attrs = {
      "db.system": "postgresql",
      "enduser.id": "svc-account",
      cost_center: "RD-114",
      department: "platform",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.isLlmSpan).toBe(false);
    expect(fields).toEqual(LlmSpanUtil.empty());
  });

  test("absent identity yields empty strings, not undefined", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmUserId).toBe("");
    expect(fields.llmUserEmail).toBe("");
    expect(fields.llmTeam).toBe("");
  });

  /*
   * Whitespace-only values. An emitter that stamps an unset env var produces
   * "" or "   "; treating that as a real identity would create a phantom
   * employee whose name is a space and would shadow the genuine fallback key
   * further down the list.
   */
  test("a whitespace-only value yields an empty string, not whitespace", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "user.id": "   ",
      "user.email": "\t\n",
      "team.id": " ",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmUserId).toBe("");
    expect(fields.llmUserEmail).toBe("");
    expect(fields.llmTeam).toBe("");
  });

  test("a whitespace-only preferred key falls through to the next key", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "user.id": "   ",
      "enduser.id": "employee-7",
    };

    expect(LlmSpanUtil.extract(attrs).llmUserId).toBe("employee-7");
  });

  /*
   * Array-valued attributes. OTLP array values arrive as JS arrays; String()
   * on one would produce a comma-joined string that looks like a legitimate
   * id ("a,b") and would be indexed as one.
   */
  test("an array-valued identity attribute is ignored, not stringified", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "user.id": ["u-1", "u-2"],
      "user.email": ["a@example.com"],
      "team.id": ["platform"],
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmUserId).toBe("");
    expect(fields.llmUserEmail).toBe("");
    expect(fields.llmTeam).toBe("");
  });

  test("an array-valued preferred key falls through to the next key", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "user.email": ["not", "a", "person"],
      "traceloop.association.properties.user_email": "grace@example.com",
    };

    expect(LlmSpanUtil.extract(attrs).llmUserEmail).toBe("grace@example.com");
  });

  test("a numeric identity value is coerced to its string form", () => {
    // Cursor's user id is an opaque integer, not a string.
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "cursor.user.id": 90210,
    };

    expect(LlmSpanUtil.extract(attrs).llmUserId).toBe("90210");
  });

  test("identity does not change cost, tokens or LLM detection", () => {
    /*
     * A guard on the blast radius: adding identity must not perturb any
     * pre-existing column. Same span, with and without the identity keys.
     */
    const base: Attrs = {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 1_000_000,
      "gen_ai.usage.output_tokens": 100_000,
    };

    const withIdentity: Attrs = {
      ...base,
      "user.id": "employee-42",
      "user.email": "ada@example.com",
      "team.id": "platform",
    };

    const before: LlmSpanFields = LlmSpanUtil.extract(base);
    const after: LlmSpanFields = LlmSpanUtil.extract(withIdentity);

    expect({
      ...after,
      llmUserId: "",
      llmUserEmail: "",
      llmTeam: "",
    }).toEqual(before);
  });
});

/*
 * RESOURCE-attribute identity.
 *
 * The failure this block exists to catch is total and silent. All three OTLP
 * ingest services flatten resource attributes through
 * `TelemetryUtil.getAttributes({ items, prefixKeysWithString: "resource" })`,
 * so nothing an operator sets on the resource ever reaches the extractor
 * under its bare name. Concretely:
 *
 *   OTEL_RESOURCE_ATTRIBUTES=team.id=platform,cost_center=RD-114
 *
 * — the mechanism the coding-agent docs present as THE way to attribute spend
 * to a cost centre — produces `resource.team.id` and `resource.cost_center`.
 * Against a bare-key-only list that matches nothing, every team column is
 * empty, and the AI / LLM Usage view shows a tidy, complete, entirely blank
 * team breakdown. Cursor is the same story: it documents cursor.user.id and
 * cursor.team.id as RESOURCE attributes.
 *
 * OtelTracesIngestService already hit this trap once with session replay and
 * fixed it the same way — see its `sessionIdAttributeKeys`, whose comment
 * notes that reading only the bare key "would look correct in a unit test and
 * fail in production". These tests are the unit tests that would not have
 * looked correct.
 */
describe("LlmSpanUtil.extract — resource-prefixed identity", () => {
  test.each([
    ["resource.user.id", "employee-42"],
    ["resource.user.email", "ada@example.com"],
    ["resource.team.id", "platform"],
    ["resource.cost_center", "RD-114"],
    ["resource.cursor.user.id", "90210"],
    ["resource.cursor.team.id", "team-7"],
    ["resource.enduser.id", "svc-account"],
    ["resource.department", "research"],
  ])(
    "resource attribute %s is extracted, not ignored",
    (key: string, value: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": "claude-sonnet-4-6",
        [key]: value,
      };

      const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

      const populated: string =
        fields.llmUserId || fields.llmUserEmail || fields.llmTeam;

      expect(populated).toBe(value);
    },
  );

  test("OTEL_RESOURCE_ATTRIBUTES team attribution reaches the team column", () => {
    /*
     * The literal shape a Claude Code / Gemini CLI fleet produces once the
     * operator sets OTEL_RESOURCE_ATTRIBUTES and the CLI stamps the signed-in
     * account onto the resource too.
     */
    const attrs: Attrs = {
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-opus-4-8",
      "resource.team.id": "platform",
      "resource.cost_center": "RD-114",
      "resource.user.email": "ada@example.com",
      "resource.user.account_uuid": "acct-9f2",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 20,
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.llmTeam).toBe("platform");
    expect(fields.llmUserEmail).toBe("ada@example.com");
    expect(fields.llmUserId).toBe("acct-9f2");
  });

  /*
   * Tier precedence. A span attribute describes ONE call; a resource
   * attribute describes the whole process. When both are present the span
   * attribute is the more specific statement and must win — otherwise a
   * process-wide default would mask the per-call override that was set
   * deliberately to correct it.
   */
  test.each([
    ["user.id", "resource.user.id"],
    ["cursor.user.id", "resource.user.id"],
    ["user.account_id", "resource.user.id"],
  ])(
    "span attribute %s beats resource attribute %s",
    (spanKey: string, resourceKey: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        [spanKey]: "from-span",
        [resourceKey]: "from-resource",
      };

      expect(LlmSpanUtil.extract(attrs).llmUserId).toBe("from-span");
    },
  );

  test("a span-level email beats a resource-level email", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "user.email": "span@example.com",
      "resource.user.email": "resource@example.com",
    };

    expect(LlmSpanUtil.extract(attrs).llmUserEmail).toBe("span@example.com");
  });

  test("a span-level team beats a resource-level team", () => {
    const attrs: Attrs = {
      "gen_ai.system": "openai",
      "cursor.team.id": "span-team",
      "resource.team.id": "resource-team",
    };

    expect(LlmSpanUtil.extract(attrs).llmTeam).toBe("span-team");
  });

  test("the resource tier is a suffix block, never interleaved", () => {
    /*
     * Pinned as a structural relation as well as by the literal orders above:
     * every bare key precedes every resource key. If someone "tidies" the
     * lists by grouping each key next to its own resource twin, a vendor
     * span attribute would start losing to a resource attribute of a
     * more-preferred key, silently changing which value lands in the column.
     */
    for (const list of [
      LlmUserIdAttributeKeys,
      LlmUserEmailAttributeKeys,
      LlmTeamAttributeKeys,
      LlmEndUserAttributeKeys,
    ]) {
      const firstResourceIndex: number = list.findIndex((key: string) => {
        return key.startsWith(RESOURCE_ATTRIBUTE_KEY_PREFIX);
      });

      expect(firstResourceIndex).toBe(list.length / 2);

      for (const key of list.slice(firstResourceIndex)) {
        expect(key.startsWith(RESOURCE_ATTRIBUTE_KEY_PREFIX)).toBe(true);
      }
    }
  });

  /*
   * The EXCLUSION has to cover the resource tier too. The employee lists now
   * carry both spellings, so if the end-user list stopped at the bare ones,
   * `resource.gen_ai.user` — a downstream CUSTOMER id — could be appended to
   * an employee list and every exclusion test would still pass.
   */
  test.each([
    "resource.gen_ai.user",
    "resource.llm.user",
    "resource.litellm.metadata.user_api_key_end_user_id",
  ])(
    "resource-prefixed customer key %s never populates the employee columns",
    (key: string) => {
      const attrs: Attrs = {
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o",
        [key]: "customer-9001",
      };

      const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

      expect(fields.isLlmSpan).toBe(true);
      expect(fields.llmUserId).toBe("");
      expect(fields.llmUserEmail).toBe("");
      expect(fields.llmTeam).toBe("");
    },
  );

  test("the exclusion list itself covers the resource tier", () => {
    for (const key of [
      "resource.gen_ai.user",
      "resource.llm.user",
      "resource.litellm.metadata.user_api_key_end_user_id",
    ]) {
      expect(LlmEndUserAttributeKeys).toContain(key);
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
      expect(LlmTeamAttributeKeys).not.toContain(key);
    }
  });

  test("no employee key is also an end-user key, in either tier", () => {
    for (const key of LlmEndUserAttributeKeys) {
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
      expect(LlmTeamAttributeKeys).not.toContain(key);
    }
  });

  test("the isLlmSpan gate still applies to resource-level identity", () => {
    /*
     * A browser RUM fleet sets user.id on the resource for every single span
     * it emits. Widening the lists must not widen the gate.
     */
    const attrs: Attrs = {
      "http.method": "GET",
      "http.route": "/checkout",
      "resource.user.id": "rum-user-123",
      "resource.user.email": "shopper@example.com",
      "resource.team.id": "frontend",
    };

    const fields: LlmSpanFields = LlmSpanUtil.extract(attrs);

    expect(fields.isLlmSpan).toBe(false);
    expect(fields).toEqual(LlmSpanUtil.empty());
  });
});

/*
 * withResourcePrefixedKeys itself. It is the one function standing between an
 * operator's OTEL_RESOURCE_ATTRIBUTES and a populated column, so its shape is
 * worth pinning directly rather than only through the lists it produces.
 */
describe("withResourcePrefixedKeys", () => {
  test("appends the prefixed block after the bare block, order preserved", () => {
    expect(withResourcePrefixedKeys(["a.b", "c"])).toEqual([
      "a.b",
      "c",
      "resource.a.b",
      "resource.c",
    ]);
  });

  test("does not mutate its input", () => {
    const input: Array<string> = ["a.b"];

    withResourcePrefixedKeys(input);

    expect(input).toEqual(["a.b"]);
  });

  test("the prefix is the string ingest actually stamps", () => {
    /*
     * TelemetryUtil.getAttributes is called with
     * prefixKeysWithString: "resource" and joins with a dot, so the key that
     * arrives is "resource.<key>". A prefix without the dot would match
     * nothing and no other test here would notice.
     */
    expect(RESOURCE_ATTRIBUTE_KEY_PREFIX).toBe("resource.");
  });

  test("an empty list stays empty", () => {
    expect(withResourcePrefixedKeys([])).toEqual([]);
  });
});
