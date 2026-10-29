import {
  PACKAGES_ROOT,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import AiTokenCount, {
  AiTokenWeight,
  CACHE_READ_TOKEN_WEIGHT,
  CACHE_WRITE_TOKEN_WEIGHT,
} from "Common/Types/AI/AiTokenCount";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import API from "Common/Utils/API";
import LLMService, {
  LLMMessage,
  LLMProviderConfig,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import LLMPromptCacheKey from "Common/Server/Utils/LLM/LLMPromptCacheKey";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import stubLLMEgressGuard from "Common/Tests/Server/Utils/AI/StubLLMEgressGuard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import path from "path";

/*
 * Issue #5073: the docs of how OneUptime counts AI tokens, and of its use of
 * Anthropic's prompt caching, held to the code that makes each claim true:
 *
 *  - AI SRE → Cost controls → "How tokens are counted": the weights it names
 *    are AiTokenCount's, and the AI Logs it sends readers to are where the
 *    Dashboard shows the count;
 *  - the LLM provider guide's Anthropic section: OneUptime marks the system
 *    prompt, the tools and the conversation for the cache, sends a request
 *    again without the markers when a gateway refuses them and remembers it,
 *    and sends nothing of the kind to OpenAI or Azure OpenAI.
 *
 * The translations are held line for line to these English pages by
 * AiDocsTranslations.
 */

const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);
const AI_SRE: string = path.join(CONTENT_DIR, "ai/ai-sre.md");
const LLM_PROVIDER: string = path.join(CONTENT_DIR, "ai/llm-provider.md");
const LLM_LOGS_TABLE: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogsTable.tsx",
);
// The words of the facts under the count, read as source (it is React-free).
const LLM_LOG_TOKENS: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogTokens.ts",
);

const HEADING: string = "### How tokens are counted";
const ANCHOR: string = "/docs/ai/ai-sre#how-tokens-are-counted";

// How the page writes a weight, and the weight it means.
const WEIGHT_WORDS: Array<{ words: string; weight: AiTokenWeight }> = [
  {
    words: "counts as a tenth of a token",
    weight: { numerator: 1, denominator: 10 },
  },
  {
    words: "as one and a quarter",
    weight: { numerator: 5, denominator: 4 },
  },
];

// Line breaks read as one space, so a claim may wrap anywhere.
function flat(markdown: string): string {
  return markdown.split("\n").join(" ").replace(/\s+/g, " ").trim();
}

function section(): string {
  return flat(getSection(read(AI_SRE), HEADING));
}

function anthropicSection(): string {
  return flat(getSection(read(LLM_PROVIDER), "### Anthropic"));
}

describe("AI SRE: how tokens are counted", () => {
  it("is a section of Cost controls, before the project's own daily limits", () => {
    const headings: Array<string> = getHeadings(read(AI_SRE));

    expect(headings).toContain(HEADING);
    expect(headings.indexOf(HEADING)).toBeGreaterThan(
      headings.indexOf("## Cost controls"),
    );
    expect(headings.indexOf(HEADING)).toBeLessThan(
      headings.indexOf("### The project's own daily limits"),
    );
  });

  it("names the weights AiTokenCount counts with", () => {
    const text: string = section();

    expect(
      WEIGHT_WORDS.map((entry: { weight: AiTokenWeight }) => {
        return entry.weight;
      }),
    ).toEqual([CACHE_READ_TOKEN_WEIGHT, CACHE_WRITE_TOKEN_WEIGHT]);

    for (const entry of WEIGHT_WORDS) {
      expect(text).toContain(entry.words);
    }

    // What the words say, the code does.
    expect(AiTokenCount.count({ totalTokens: 10, cachedInputTokens: 10 })).toBe(
      1,
    );
    expect(AiTokenCount.count({ totalTokens: 4, cacheCreationTokens: 4 })).toBe(
      5,
    );
    expect(AiTokenCount.count({ totalTokens: 7 })).toBe(7);
  });

  it("says every token limit, the AI Logs and the AI credits count this way", () => {
    const text: string = section();

    expect(text).toContain("Every token limit on this page");
    expect(text).toContain("the AI Logs");
    expect(text).toContain("on OneUptime Cloud, the AI credits");
  });

  it("sends readers to the AI Logs, where the count and the cache line are shown", () => {
    const text: string = section();
    const table: string = read(LLM_LOGS_TABLE);
    const facts: string = read(LLM_LOG_TOKENS);

    expect(text).toContain("**Project Settings → AI → AI Logs**");
    expect(table).toContain('title: "Tokens Used"');
    expect(table).toContain("AiTokenCount.getBreakdown(item)");
    expect(table).toContain("getLlmLogCacheFacts(");

    /*
     * "under them, how many tokens it used in all and how many of them came
     * from the cache or went into it": the facts the column states.
     */
    expect(text).toContain("how many tokens it used in all");
    expect(text).toContain("came from the cache or went into it");
    expect(facts).toContain('other: "{{count}} tokens"');
    expect(facts).toContain('other: "{{count}} from cache"');
    expect(facts).toContain('other: "{{count}} written to cache"');
  });

  it("is what the provider guide's Anthropic section links to", () => {
    expect(anthropicSection()).toContain(`(${ANCHOR})`);
  });
});

describe("the provider guide's Anthropic section, against LLMService", () => {
  type PostSpy = ReturnType<typeof jest.spyOn>;

  const TOOLS: Array<LLMToolDefinition> = [
    {
      name: "query_logs",
      description: "Search logs.",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  const CONVERSATION: Array<LLMMessage> = [
    { role: "system", content: "You are OneUptime AI." },
    { role: "user", content: "Why is checkout failing?" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "toolu_1", name: "query_logs", arguments: {} }],
    },
    { role: "tool", toolCallId: "toolu_1", content: "3 errors" },
  ];

  const ANTHROPIC: LLMProviderConfig = {
    llmType: LlmType.Anthropic,
    apiKey: "sk-ant-test",
    modelName: "claude-sonnet-5-5",
  };

  function reply(): HTTPResponse<JSONObject> {
    return {
      jsonData: {
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    } as unknown as HTTPResponse<JSONObject>;
  }

  function bodyOf(spy: PostSpy, index: number): string {
    return JSON.stringify(
      (spy.mock.calls[index]![0] as { data: JSONObject }).data,
    );
  }

  function markers(body: string): number {
    return body.split('"cache_control"').length - 1;
  }

  beforeEach(() => {
    stubLLMEgressGuard();
    LLMService.clearRequestAdaptationCache();
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says OneUptime uses Anthropic's prompt caching for the system prompt, the tools and the conversation", async () => {
    expect(anthropicSection()).toContain(
      "OneUptime uses Anthropic's prompt caching.",
    );
    expect(anthropicSection()).toContain(
      "sends the system prompt, the tools and the conversation so far again, and OneUptime marks them for the cache",
    );

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: CONVERSATION,
      tools: TOOLS,
    });

    const body: JSONObject = (spy.mock.calls[0]![0] as { data: JSONObject })
      .data;

    expect(
      ((body["system"] as Array<JSONObject>)[0] as JSONObject)["cache_control"],
    ).toBeDefined();
    expect(
      ((body["tools"] as Array<JSONObject>)[0] as JSONObject)["cache_control"],
    ).toBeDefined();
    expect(markers(JSON.stringify(body["messages"]))).toBeGreaterThan(0);
  });

  it("prices a cache read and a cache write as the weights AiTokenCount counts them with", () => {
    const text: string = anthropicSection();

    // A read at a tenth of the price or less: counted as a tenth.
    expect(text).toContain(
      "a call pays a tenth of the price or less for what the calls before it sent",
    );
    expect(CACHE_READ_TOKEN_WEIGHT).toEqual({ numerator: 1, denominator: 10 });

    // A write at a quarter more: counted as one and a quarter.
    expect(text).toContain(
      "and a quarter more than the price for what is new, which it writes to the cache",
    );
    expect(CACHE_WRITE_TOKEN_WEIGHT).toEqual({ numerator: 5, denominator: 4 });
  });

  it("says a gateway that refuses the markers gets the request again without them, remembered for the provider", async () => {
    expect(anthropicSection()).toContain(
      "If a gateway in front of Claude refuses the cache markers, OneUptime sends the request again without them and remembers that for the provider.",
    );

    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "cache_control: Extra inputs are not permitted",
        },
      },
      {},
    );

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: CONVERSATION,
      tools: TOOLS,
    });
    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: CONVERSATION,
      tools: TOOLS,
    });

    // Two refusals, the request that worked, then the next call: one request.
    expect(spy).toHaveBeenCalledTimes(4);
    expect(markers(bodyOf(spy, 2))).toBe(0);
    expect(markers(bodyOf(spy, 3))).toBe(0);
  });

  it("says OpenAI and Azure OpenAI cache a repeated prompt on their own: OneUptime sends them no marker", async () => {
    expect(section()).toContain(
      "OpenAI and Azure OpenAI cache a repeated prompt on their own.",
    );

    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue({
      jsonData: {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      },
    } as unknown as HTTPResponse<JSONObject>) as PostSpy;

    for (const config of [
      { llmType: LlmType.OpenAI, apiKey: "sk-test", modelName: "gpt-5.1" },
      {
        llmType: LlmType.AzureOpenAI,
        apiKey: "azure-key",
        baseUrl: "https://contoso.openai.azure.com/openai/v1",
        modelName: "gpt-5.1",
      },
    ] as Array<LLMProviderConfig>) {
      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: CONVERSATION,
        tools: TOOLS,
      });
    }

    expect(spy).toHaveBeenCalledTimes(2);
    expect(markers(bodyOf(spy, 0))).toBe(0);
    expect(markers(bodyOf(spy, 1))).toBe(0);
  });

  it("names Claude in Microsoft Foundry among the providers it caches for, and it does", async () => {
    expect(section()).toContain(
      "With Anthropic, Claude in Microsoft Foundry included, OneUptime marks the system prompt, the tools and the conversation for the cache",
    );

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.AzureOpenAI,
        apiKey: "azure-key",
        baseUrl: "https://contoso.services.ai.azure.com/anthropic/v1",
        modelName: "claude-sonnet-5-5",
      },
      messages: CONVERSATION,
      tools: TOOLS,
    });

    expect(markers(bodyOf(spy, 0))).toBe(4);
  });
});

/*
 * Cache weights per model and OpenAI's prompt_cache_key (the follow-ups of
 * #5111 that #5273 listed): how tokens are counted names the shares the
 * code counts each model's cache at, and the provider guide's OpenAI section
 * says what OneUptime tells OpenAI about its prompt cache.
 */
describe("AI SRE: a cached token counts at the call's model's prices", () => {
  it("names the shares AiTokenCount counts each model's cache at", () => {
    const text: string = section();

    expect(text).toContain(
      "counts for what the call's model charges for it next to a fresh token",
    );

    // "on Claude and on OpenAI's current models a read counts as a tenth of a token"
    expect(text).toContain(
      "on Claude and on OpenAI's current models a read counts as a tenth of a token",
    );
    for (const model of ["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5.1"]) {
      expect({
        model,
        read: AiTokenCount.getCacheWeights(model).read,
      }).toEqual({ model, read: { numerator: 1, denominator: 10 } });
    }

    // "(a twentieth on Claude Opus 5.5 and Sonnet 5.5, half on gpt-4o)"
    expect(text).toContain(
      "(a twentieth on Claude Opus 5.5 and Sonnet 5.5, half on gpt-4o)",
    );
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
      expect({
        model,
        read: AiTokenCount.getCacheWeights(model).read,
      }).toEqual({ model, read: { numerator: 1, denominator: 20 } });
    }
    expect(AiTokenCount.getCacheWeights("gpt-4o").read).toEqual({
      numerator: 1,
      denominator: 2,
    });

    // "a write to Anthropic's cache, or to OpenAI's from GPT-5.6, as one and a quarter"
    expect(text).toContain(
      "a write to Anthropic's cache, or to OpenAI's from GPT-5.6, as one and a quarter",
    );
    for (const model of ["claude-sonnet-4-5", "gpt-5.6-terra", "gpt-6.1-sol"]) {
      expect({
        model,
        write: AiTokenCount.getCacheWeights(model).write,
      }).toEqual({ model, write: { numerator: 5, denominator: 4 } });
    }

    // "A model OneUptime has no cache price for counts a read as a tenth of a token and a write as one and a quarter."
    expect(text).toContain(
      "A model OneUptime has no cache price for counts a read as a tenth of a token and a write as one and a quarter.",
    );
    expect(AiTokenCount.getCacheWeights("prod-fast")).toEqual({
      read: CACHE_READ_TOKEN_WEIGHT,
      write: CACHE_WRITE_TOKEN_WEIGHT,
      isModelPriced: false,
    });
  });

  it("the AI Logs read each row's model, so a row counts at its model's prices", () => {
    const table: string = read(LLM_LOGS_TABLE);

    expect(table).toContain("modelName: true");
    expect(table).toContain("AiTokenCount.getBreakdown(item)");
  });
});

describe("the provider guide's OpenAI section, against LLMService", () => {
  type PostSpy = ReturnType<typeof jest.spyOn>;

  function openAiSection(): string {
    return flat(getSection(read(LLM_PROVIDER), "### OpenAI"));
  }

  const OPENAI: LLMProviderConfig = {
    llmType: LlmType.OpenAI,
    apiKey: "sk-test",
    modelName: "gpt-5.1",
  };

  function reply(): HTTPResponse<JSONObject> {
    return {
      jsonData: {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      },
    } as unknown as HTTPResponse<JSONObject>;
  }

  function bodyOf(spy: PostSpy, index: number): JSONObject {
    return (spy.mock.calls[index]![0] as { data: JSONObject }).data;
  }

  beforeEach(() => {
    stubLLMEgressGuard();
    LLMService.clearRequestAdaptationCache();
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says OneUptime sends one prompt_cache_key for each project and kind of AI work, and does", async () => {
    expect(openAiSection()).toContain(
      "one prompt cache for each project and kind of AI work, sent as `prompt_cache_key`, so no project's prompts share a cache with another's",
    );

    const projectA: ObjectID = new ObjectID(
      "6f1d2c3b-4a59-4e8f-9a7b-1c2d3e4f5a6b",
    );
    const projectB: ObjectID = new ObjectID(
      "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    );

    expect(
      LLMPromptCacheKey.build({ projectId: projectA, feature: "AI Chat" }),
    ).not.toBe(
      LLMPromptCacheKey.build({ projectId: projectB, feature: "AI Chat" }),
    );
    expect(
      LLMPromptCacheKey.build({ projectId: projectA, feature: "AI Chat" }),
    ).not.toBe(
      LLMPromptCacheKey.build({
        projectId: projectA,
        feature: "AI Incident Investigation",
      }),
    );

    const key: string = LLMPromptCacheKey.build({
      projectId: projectA,
      feature: "AI Chat",
    });
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: key,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(key);
  });

  it("says a server that refuses the field gets the request again without it, remembered for the provider", async () => {
    expect(openAiSection()).toContain(
      "If the server at the provider's **Base URL** refuses the field, OneUptime sends the request again without it and remembers that for the provider.",
    );

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error: {
              message:
                "Unrecognized request argument supplied: prompt_cache_key",
              type: "invalid_request_error",
              param: null,
              code: null,
            },
          },
          {},
        ),
      )
      .mockResolvedValue(reply()) as PostSpy;

    for (let call: number = 0; call < 2; call++) {
      await LLMService.getCompletion({
        llmProviderConfig: {
          ...OPENAI,
          baseUrl: "https://openai-proxy.example.com/v1",
        },
        messages: [{ role: "user", content: "hi" }],
        promptCacheKey: "0123456789abcdef0123456789abcdef",
      });
    }

    // The refusal, the request that worked, then the next call: one request.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(bodyOf(spy, 1)).not.toHaveProperty("prompt_cache_key");
    expect(bodyOf(spy, 2)).not.toHaveProperty("prompt_cache_key");
  });

  it("links to how cached tokens are counted", () => {
    expect(openAiSection()).toContain(`(${ANCHOR})`);
  });
});
