import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../Server/Utils/Logger";
import {
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
  LlmProviderFieldNeed,
  LlmProviderTypeCopy,
  getLlmProviderDefaultModel,
  needsApiKey,
  needsBaseUrl,
  needsModelName,
  takesApiKey,
} from "../../../../UI/Components/AI/LlmProviderFormCopy";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The LLM provider form's account of each provider (Common/UI/Components/
 * AI/LlmProviderFormCopy) against what LLMService does with a provider of
 * that type:
 *
 *   - a field the form requires is one the server refuses to run without;
 *     a field it does not ask for (Ollama's API key) is one the server never
 *     sends; an optional one runs both ways;
 *   - the model the form says a blank Model Name gets is the model the
 *     server asks the provider for - for an OpenAI-compatible server, the
 *     first model it lists;
 *   - the address the form says a blank Base URL gets is where the server
 *     sends the request.
 *
 * The form used to say none of this per provider: one API Key help listed
 * every provider that needs one, and one Model Name help listed examples.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

// The model an OpenAI-compatible server in these tests serves.
const SERVED_MODEL: string = "meta-llama/Llama-3.1-8B-Instruct";

/*
 * What an OpenAI-compatible server answers GET /models with: a blank Model
 * Name asks it which models it serves.
 */
function listModels(data: Array<JSONObject>): PostSpy {
  return jest.spyOn(API, "get").mockResolvedValue({
    jsonData: { object: "list", data: data },
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

interface SentRequest {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

const API_KEY: string = "sk-form-test";

// Where a provider with no address of its own is reached, in these tests.
const BASE_URLS: Partial<Record<LlmType, string>> = {
  [LlmType.AzureOpenAI]: "https://contoso-ai.openai.azure.com/openai/v1",
  [LlmType.Ollama]: "http://ollama:11434",
  [LlmType.OpenAICompatible]: "http://vllm:8000/v1",
};

// A reply each wire accepts as a finished answer.
function replyFor(type: LlmType, baseUrl?: string | undefined): JSONObject {
  if (
    type === LlmType.Anthropic ||
    (type === LlmType.AzureOpenAI && baseUrl?.includes("/anthropic"))
  ) {
    return {
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }

  if (type === LlmType.Ollama) {
    return { message: { content: "OK" }, done: true };
  }

  return {
    choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function replyWith(body: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: body,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

function sent(spy: PostSpy): SentRequest {
  const call: {
    url: URL;
    data: JSONObject;
    headers: Record<string, string>;
  } = spy.mock.calls[0]![0] as {
    url: URL;
    data: JSONObject;
    headers: Record<string, string>;
  };

  return {
    url: call.url.toString(),
    data: call.data,
    headers: call.headers,
  };
}

// Everything a provider of the type can be given, less what is left out.
function configFor(
  type: LlmType,
  leaveOut: Array<"apiKey" | "baseUrl" | "modelName"> = [],
): LLMProviderConfig {
  const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];
  const config: LLMProviderConfig = { llmType: type };

  if (!leaveOut.includes("apiKey")) {
    config.apiKey = API_KEY;
  }

  if (!leaveOut.includes("baseUrl") && BASE_URLS[type]) {
    config.baseUrl = BASE_URLS[type];
  }

  // A model only where the form requires one: else the blank is the test.
  if (
    !leaveOut.includes("modelName") &&
    copy.modelName === LlmProviderFieldNeed.Required
  ) {
    config.modelName = SERVED_MODEL;
  }

  return config;
}

async function complete(config: LLMProviderConfig): Promise<void> {
  await LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [{ role: "user", content: "Which incidents are active?" }],
  });
}

async function refusalOf(config: LLMProviderConfig): Promise<string> {
  const spy: PostSpy = replyWith(replyFor(config.llmType, config.baseUrl));

  try {
    await complete(config);
  } catch (error) {
    expect(spy).not.toHaveBeenCalled();
    return (error as Error).message;
  }

  throw new Error(`${config.llmType} ran without what the form requires.`);
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  LLMService.clearServedModelCache();
  listModels([{ id: SERVED_MODEL, object: "model" }]);
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the form's providers", () => {
  test("are every provider type, each once, the most used first", () => {
    expect([...LLM_PROVIDER_TYPES].sort()).toEqual(
      [...Object.values(LlmType)].sort(),
    );
    expect(new Set(LLM_PROVIDER_TYPES).size).toBe(LLM_PROVIDER_TYPES.length);
    expect(LLM_PROVIDER_TYPES.slice(0, 2)).toEqual([
      LlmType.OpenAI,
      LlmType.Anthropic,
    ]);
  });

  test.each(LLM_PROVIDER_TYPES)(
    "%s has a card title, a line saying what it is, and a name to start from",
    (type: LlmType) => {
      const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];

      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description).toMatch(/\.$/);
      expect(copy.defaultName.length).toBeGreaterThan(0);
      expect(copy.modelNameHint.length).toBeGreaterThan(0);
    },
  );

  test("the needs the form reads follow the copy", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];

      expect({
        type,
        takesApiKey: takesApiKey(type),
        needsApiKey: needsApiKey(type),
        needsBaseUrl: needsBaseUrl(type),
        needsModelName: needsModelName(type),
      }).toEqual({
        type,
        takesApiKey: copy.apiKey !== LlmProviderFieldNeed.NotUsed,
        needsApiKey: copy.apiKey === LlmProviderFieldNeed.Required,
        needsBaseUrl: copy.baseUrl === LlmProviderFieldNeed.Required,
        needsModelName: copy.modelName === LlmProviderFieldNeed.Required,
      });
    }

    // No provider picked yet, or one this version does not know: nothing.
    for (const value of [undefined, null, "", "NotAProvider", 3]) {
      expect(takesApiKey(value)).toBe(false);
      expect(needsBaseUrl(value)).toBe(false);
    }
  });
});

describe("a field the form requires is one the server will not run without", () => {
  test.each(
    LLM_PROVIDER_TYPES.filter((type: LlmType) => {
      return needsApiKey(type);
    }),
  )("%s: the API Key", async (type: LlmType) => {
    expect(await refusalOf(configFor(type, ["apiKey"]))).toMatch(
      /API key is required/,
    );
  });

  test.each(
    LLM_PROVIDER_TYPES.filter((type: LlmType) => {
      return needsBaseUrl(type);
    }),
  )("%s: the Base URL", async (type: LlmType) => {
    expect(await refusalOf(configFor(type, ["baseUrl"]))).toMatch(
      /base URL is required/i,
    );
  });

  test("no provider's Model Name: every one runs with it blank", async () => {
    for (const type of LLM_PROVIDER_TYPES) {
      expect({ type, needsModelName: needsModelName(type) }).toEqual({
        type,
        needsModelName: false,
      });

      const config: LLMProviderConfig = configFor(type, ["modelName"]);
      const spy: PostSpy = replyWith(replyFor(type, config.baseUrl));

      await complete(config);

      expect({ type, model: sent(spy).data["model"] }).toEqual({
        type,
        model:
          getLlmProviderDefaultModel({
            llmType: type,
            baseUrl: config.baseUrl,
          }) || SERVED_MODEL,
      });

      spy.mockRestore();
    }
  });

  test("the providers it requires them of are the ones the docs list", () => {
    expect(
      LLM_PROVIDER_TYPES.filter((type: LlmType) => {
        return needsApiKey(type);
      }),
    ).toEqual([
      LlmType.OpenAI,
      LlmType.Anthropic,
      LlmType.AzureOpenAI,
      LlmType.Groq,
      LlmType.Mistral,
    ]);
    expect(
      LLM_PROVIDER_TYPES.filter((type: LlmType) => {
        return needsBaseUrl(type);
      }),
    ).toEqual([LlmType.AzureOpenAI, LlmType.Ollama, LlmType.OpenAICompatible]);
    expect(
      LLM_PROVIDER_TYPES.filter((type: LlmType) => {
        return needsModelName(type);
      }),
    ).toEqual([]);
  });
});

describe("a field the form does not require, the server runs without", () => {
  test.each(LLM_PROVIDER_TYPES)(
    "%s runs with only what the form requires",
    async (type: LlmType) => {
      const leaveOut: Array<"apiKey" | "baseUrl" | "modelName"> = [];

      if (!needsApiKey(type)) {
        leaveOut.push("apiKey");
      }

      if (!needsBaseUrl(type)) {
        leaveOut.push("baseUrl");
      }

      const config: LLMProviderConfig = configFor(type, leaveOut);
      const spy: PostSpy = replyWith(replyFor(type, config.baseUrl));

      await complete(config);

      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  test("Ollama, which the form never asks for a key, is never sent one", async () => {
    expect(takesApiKey(LlmType.Ollama)).toBe(false);

    const spy: PostSpy = replyWith(replyFor(LlmType.Ollama));

    // Even a key saved before the form stopped asking for one.
    await complete(configFor(LlmType.Ollama));

    expect(JSON.stringify(sent(spy).headers)).not.toContain(API_KEY);
    expect(JSON.stringify(sent(spy).data)).not.toContain(API_KEY);
  });

  test("an OpenAI-compatible server is sent the key only when it has one", async () => {
    let spy: PostSpy = replyWith(replyFor(LlmType.OpenAICompatible));

    await complete(configFor(LlmType.OpenAICompatible, ["apiKey"]));

    expect(sent(spy).headers["Authorization"]).toBeUndefined();

    jest.restoreAllMocks();
    stubLLMEgressGuard();
    const list: PostSpy = listModels([{ id: SERVED_MODEL }]);
    spy = replyWith(replyFor(LlmType.OpenAICompatible));

    await complete(configFor(LlmType.OpenAICompatible));

    expect(sent(spy).headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    // Asking which models it serves, too.
    expect(
      (list.mock.calls[0]![0] as { headers: Record<string, string> }).headers[
        "Authorization"
      ],
    ).toBe(`Bearer ${API_KEY}`);
  });
});

describe("what the form says a blank field gets is what the server uses", () => {
  test.each(
    LLM_PROVIDER_TYPES.filter((type: LlmType) => {
      return Boolean(LLM_PROVIDER_TYPE_COPY[type].defaultModel);
    }),
  )("%s: the model a blank Model Name asks for", async (type: LlmType) => {
    const config: LLMProviderConfig = configFor(type);
    const spy: PostSpy = replyWith(replyFor(type, config.baseUrl));

    await complete(config);

    expect(sent(spy).data["model"]).toBe(
      LLM_PROVIDER_TYPE_COPY[type].defaultModel,
    );
    expect(getLlmProviderDefaultModel({ llmType: type })).toBe(
      LLM_PROVIDER_TYPE_COPY[type].defaultModel,
    );
  });

  test("Anthropic's is the model LLMService defaults to", () => {
    expect(LLM_PROVIDER_TYPE_COPY[LlmType.Anthropic].defaultModel).toBe(
      LLMService.ANTHROPIC_DEFAULT_MODEL,
    );
    expect(LLM_PROVIDER_TYPE_COPY[LlmType.AzureOpenAI].defaultModel).toBe(
      LLMService.AZURE_OPENAI_DEFAULT_DEPLOYMENT,
    );
  });

  test("a Claude deployment in Foundry is asked for Anthropic's default, and its page says so", async () => {
    const baseUrl: string =
      "https://contoso-ai.services.ai.azure.com/anthropic";
    const spy: PostSpy = replyWith(replyFor(LlmType.AzureOpenAI, baseUrl));

    await complete({
      llmType: LlmType.AzureOpenAI,
      apiKey: API_KEY,
      baseUrl: baseUrl,
    });

    expect(sent(spy).url).toBe(
      "https://contoso-ai.services.ai.azure.com/anthropic/v1/messages",
    );
    expect(sent(spy).data["model"]).toBe(
      getLlmProviderDefaultModel({
        llmType: LlmType.AzureOpenAI,
        baseUrl: baseUrl,
      }),
    );
    expect(
      getLlmProviderDefaultModel({
        llmType: LlmType.AzureOpenAI,
        baseUrl: BASE_URLS[LlmType.AzureOpenAI],
      }),
    ).toBe(LLMService.AZURE_OPENAI_DEFAULT_DEPLOYMENT);
  });

  test("an OpenAI-compatible server has no default model to name: it says what it does instead", () => {
    expect(
      LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].defaultModel,
    ).toBeUndefined();
    expect(
      getLlmProviderDefaultModel({ llmType: LlmType.OpenAICompatible }),
    ).toBeUndefined();
    expect(
      LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].defaultModelLabel,
    ).toBe("First model the server lists");
    expect(LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].modelNameHint).toBe(
      "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
    );
  });

  test("an OpenAI-compatible server: a blank Model Name gets the first model it lists, as its hint says", async () => {
    jest.restoreAllMocks();
    stubLLMEgressGuard();

    // LM Studio lists the embedding model it ships with beside the chat one.
    const list: PostSpy = listModels([
      { id: "text-embedding-nomic-embed-text-v1.5", object: "model" },
      { id: "qwen2.5-7b-instruct", object: "model" },
      { id: "llama-3.2-3b-instruct", object: "model" },
    ]);
    const spy: PostSpy = replyWith(replyFor(LlmType.OpenAICompatible));

    await complete(configFor(LlmType.OpenAICompatible, ["apiKey"]));

    expect(
      (list.mock.calls[0]![0] as { url: URL }).url.toString(),
    ).toBe("http://vllm:8000/v1/models");
    expect(sent(spy).data["model"]).toBe("qwen2.5-7b-instruct");
  });

  test("only a provider with no default model of its own says what it does instead", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];

      expect({ type, label: Boolean(copy.defaultModelLabel) }).toEqual({
        type,
        label: !copy.defaultModel,
      });
    }
  });

  test.each(
    LLM_PROVIDER_TYPES.filter((type: LlmType) => {
      return Boolean(LLM_PROVIDER_TYPE_COPY[type].defaultBaseUrl);
    }),
  )("%s: where a blank Base URL sends the request", async (type: LlmType) => {
    const spy: PostSpy = replyWith(replyFor(type));

    await complete(configFor(type, ["baseUrl"]));

    expect(
      sent(spy).url.startsWith(
        `${LLM_PROVIDER_TYPE_COPY[type].defaultBaseUrl}/`,
      ),
    ).toBe(true);
  });

  test("only a provider with an address of its own names one", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];

      expect({ type, named: Boolean(copy.defaultBaseUrl) }).toEqual({
        type,
        named: copy.baseUrl === LlmProviderFieldNeed.Optional,
      });
      // One with none says what address to give instead.
      expect({ type, hint: Boolean(copy.baseUrlHint) }).toEqual({
        type,
        hint: copy.baseUrl === LlmProviderFieldNeed.Required,
      });
    }
  });
});
