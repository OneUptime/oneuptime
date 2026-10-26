import API, { RequestOptions } from "../../../../Utils/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import LLMProviderHTTPException from "../../../../Server/Utils/LLM/LLMProviderHTTPException";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import LlmProviderTestFailure from "../../../../Server/Utils/LLM/LlmProviderTestFailure";
import logger from "../../../../Server/Utils/Logger";
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
 * "Can we make the model name optional? so it picks up default model from
 * the provider?" - an OpenAI-compatible provider (vLLM, LocalAI, LM Studio,
 * a gateway) was refused without a Model Name: "Model Name is required for
 * OpenAI-compatible providers". The person who set up a vLLM server serving
 * one model had to type its Hugging Face id again, exactly.
 *
 * Now a blank Model Name asks the server which models it serves - GET
 * <Base URL>/models, which every OpenAI-compatible server answers as OpenAI
 * does - and the request goes out for the first one it lists: the one model
 * vLLM serves (vLLM's own examples pick models.data[0] the same way). Pinned
 * here:
 *
 *   - where the list is asked for, beside the chat endpoint the same Base
 *     URL is sent to, however the Base URL was written;
 *   - which model of a list is taken: the first, passing over embedding
 *     models (LM Studio lists the one it ships with);
 *   - that the list is asked for the way the chat request is sent: the same
 *     key (and none for a keyless server), through the egress guard, pinned,
 *     with no redirects and a bounded body;
 *   - that the model is remembered for a conversation, per server, key and
 *     kind of provider, and forgotten when a request to it fails;
 *   - what is said when the server cannot name a model, and that nothing is
 *     sent to it then;
 *   - that a typed Model Name, and every other provider type, are as they
 *     were.
 */

type Spy = ReturnType<typeof jest.spyOn>;

const BASE_URL: string = "http://vllm.internal:8000/v1";
const MODELS_URL: string = "http://vllm.internal:8000/v1/models";
const CHAT_URL: string = "http://vllm.internal:8000/v1/chat/completions";
const SERVED_MODEL: string = "Qwen/Qwen3.8-27B";
const API_KEY: string = "sk-vllm-served-model-test";

interface SentRequest {
  url: string;
  data: JSONObject | undefined;
  headers: Record<string, string>;
  options: RequestOptions;
}

// What vLLM answers GET /v1/models with: the model it serves, then its LoRAs.
function vllmModelsList(...ids: Array<string>): JSONObject {
  return {
    object: "list",
    data: ids.map((id: string): JSONObject => {
      return {
        id: id,
        object: "model",
        created: 1793000000,
        owned_by: "vllm",
        root: id,
        parent: null,
        max_model_len: 32768,
      };
    }),
  };
}

function listModels(body: JSONObject | JSONArray): Spy {
  return jest.spyOn(API, "get").mockResolvedValue({
    jsonData: body,
  } as unknown as HTTPResponse<JSONObject>) as Spy;
}

function answerList(response: HTTPErrorResponse): Spy {
  return jest.spyOn(API, "get").mockResolvedValue(response) as Spy;
}

function answerChat(): Spy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  } as unknown as HTTPResponse<JSONObject>) as Spy;
}

function requestOf(spy: Spy, index: number = 0): SentRequest {
  const call: {
    url: { toString: () => string };
    data?: JSONObject | undefined;
    headers?: Record<string, string> | undefined;
    options?: RequestOptions | undefined;
  } = spy.mock.calls[index]![0] as {
    url: { toString: () => string };
    data?: JSONObject | undefined;
    headers?: Record<string, string> | undefined;
    options?: RequestOptions | undefined;
  };

  return {
    url: call.url.toString(),
    data: call.data,
    headers: call.headers || {},
    options: call.options || {},
  };
}

// An OpenAI-compatible provider at BASE_URL, with no Model Name.
function server(config: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
  return {
    llmType: LlmType.OpenAICompatible,
    baseUrl: BASE_URL,
    ...config,
  };
}

async function complete(
  config: LLMProviderConfig,
  extra: { maxTokens?: number; includeProviderErrorDetails?: boolean } = {},
): Promise<LLMCompletionResponse> {
  return await LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [{ role: "user", content: "Which incidents are active?" }],
    requestRetries: 0,
    ...extra,
  });
}

async function failureOf(
  config: LLMProviderConfig,
  extra: { includeProviderErrorDetails?: boolean } = {},
): Promise<Error> {
  try {
    await complete(config, extra);
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the completion to fail.");
}

// The models list URL LLMService asks for a provider whose Model Name is blank.
function modelsUrlFor(baseUrl: string): string {
  return LLMService.buildOpenAICompatibleModelsUrl(baseUrl);
}

// The chat URL LLMService posts to for a provider with a typed Model Name.
async function chatUrlFor(baseUrl: string): Promise<string> {
  const chat: Spy = answerChat();

  await complete(server({ baseUrl: baseUrl, modelName: "typed-model" }));

  const url: string = requestOf(chat, chat.mock.calls.length - 1).url;

  chat.mockRestore();

  return url;
}

function servedModelCacheKeys(): Array<string> {
  return Array.from(
    (
      LLMService as unknown as {
        servedModelCache: Map<string, unknown>;
      }
    ).servedModelCache.keys(),
  );
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearServedModelCache();
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where an OpenAI-compatible server lists its models", () => {
  test.each([
    ["http://vllm:8000/v1", "http://vllm:8000/v1/models"],
    // vLLM, LocalAI and the like serve the API under /v1.
    ["http://vllm:8000", "http://vllm:8000/v1/models"],
    ["http://vllm:8000/", "http://vllm:8000/v1/models"],
    ["http://vllm:8000/v1/", "http://vllm:8000/v1/models"],
    // The chat endpoint itself, pasted whole: the list is beside it.
    ["http://vllm:8000/v1/chat/completions", "http://vllm:8000/v1/models"],
    [
      "https://gateway.example.com/openai/v1",
      "https://gateway.example.com/openai/v1/models",
    ],
    ["HTTP://vllm:8000/v1", "http://vllm:8000/v1/models"],
    [
      "http://vllm:8000/v1?api-version=2",
      "http://vllm:8000/v1/models?api-version=2",
    ],
    ["  http://vllm:8000/v1  ", "http://vllm:8000/v1/models"],
  ])("%s lists them at %s", (baseUrl: string, expected: string) => {
    expect(modelsUrlFor(baseUrl)).toBe(expected);
  });

  test.each([
    "http://vllm:8000",
    "http://vllm:8000/v1/",
    "http://vllm:8000/v1/chat/completions",
    "https://gateway.example.com/openai/v1",
    "http://vllm:8000/v1?api-version=2",
  ])("beside the chat completions %s is sent to", async (baseUrl: string) => {
    const chatUrl: string = await chatUrlFor(baseUrl);

    expect(modelsUrlFor(baseUrl)).toBe(
      chatUrl.replace("/chat/completions", "/models"),
    );
  });
});

describe("the model a models list names first", () => {
  test("OpenAI's list: the first model's id", () => {
    expect(
      LLMService.getFirstListedModel(
        vllmModelsList(SERVED_MODEL, "another-model"),
      ),
    ).toBe(SERVED_MODEL);
  });

  test("vLLM's list: the model it serves, before its LoRA adapters", () => {
    expect(
      LLMService.getFirstListedModel({
        object: "list",
        data: [
          { id: "meta-llama/Llama-3.1-8B-Instruct", root: "meta-llama" },
          { id: "sql-lora", parent: "meta-llama/Llama-3.1-8B-Instruct" },
        ],
      }),
    ).toBe("meta-llama/Llama-3.1-8B-Instruct");
  });

  test("a bare list of models, and one of names", () => {
    expect(
      LLMService.getFirstListedModel([{ id: "local-model" }, { id: "b" }]),
    ).toBe("local-model");
    expect(LLMService.getFirstListedModel(["llama3.1:8b", "phi4"])).toBe(
      "llama3.1:8b",
    );
  });

  test("a {models: [...]} list, its models named by id, name or model", () => {
    expect(
      LLMService.getFirstListedModel({ models: [{ name: "llama3.1:8b" }] }),
    ).toBe("llama3.1:8b");
    expect(
      LLMService.getFirstListedModel({ models: [{ model: "phi4:latest" }] }),
    ).toBe("phi4:latest");
    expect(
      LLMService.getFirstListedModel({
        models: [{ id: "by-id", name: "by-name" }],
      }),
    ).toBe("by-id");
  });

  test("LM Studio's list: the chat model, not the embedding model it ships with", () => {
    expect(
      LLMService.getFirstListedModel({
        object: "list",
        data: [
          {
            id: "text-embedding-nomic-embed-text-v1.5",
            object: "model",
            owned_by: "organization_owner",
          },
          {
            id: "qwen2.5-7b-instruct",
            object: "model",
            owned_by: "organization_owner",
          },
        ],
      }),
    ).toBe("qwen2.5-7b-instruct");
  });

  test("a list of embedding models only: the first, as there is nothing else", () => {
    expect(
      LLMService.getFirstListedModel(
        vllmModelsList("BAAI/bge-m3-embed", "nomic-embed-text"),
      ),
    ).toBe("BAAI/bge-m3-embed");
  });

  test("passes over what is not a model id: blank, not text, or too long", () => {
    expect(
      LLMService.getFirstListedModel({
        data: [
          {},
          { id: "" },
          { id: "   " },
          { id: 7 },
          null,
          { id: "x".repeat(LLMService.MAX_SERVED_MODEL_NAME_LENGTH + 1) },
          { id: "  Qwen/Qwen3-8B  " },
        ],
      }),
    ).toBe("Qwen/Qwen3-8B");
  });

  test("a model id a vLLM server gives the path it loaded the model from is taken whole", () => {
    const path: string = `/models/huggingface/hub/models--meta-llama--Llama-3.1-8B-Instruct/snapshots/${"0e9e39f249a16976918f6564b8830bc894c89659"}`;

    expect(LLMService.getFirstListedModel(vllmModelsList(path))).toBe(path);
  });

  test.each([
    ["nothing", null],
    ["text", "<html>Not Found</html>"],
    ["a number", 42],
    ["an empty object", {}],
    ["an empty list", { object: "list", data: [] }],
    ["data that is not a list", { data: "models" }],
    ["models that are not a list", { models: { id: "a" } }],
    ["entries with no id", [{}, { object: "model" }]],
  ])("names none in %s", (_name: string, list: unknown) => {
    expect(LLMService.getFirstListedModel(list)).toBeNull();
  });
});

describe("a provider whose Model Name is blank", () => {
  test("asks its server which models it serves, then sends the request for the first", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    const response: LLMCompletionResponse = await complete(server());

    expect(list).toHaveBeenCalledTimes(1);
    expect(requestOf(list).url).toBe(MODELS_URL);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(requestOf(chat).url).toBe(CHAT_URL);
    expect(requestOf(chat).data!["model"]).toBe(SERVED_MODEL);
    // Asked first, sent second.
    expect(list.mock.invocationCallOrder[0]!).toBeLessThan(
      chat.mock.invocationCallOrder[0]!,
    );
    expect(response.content).toBe("OK");
    expect(response.modelName).toBe(SERVED_MODEL);
  });

  test("asks with the API key the request is sent with", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    await complete(server({ apiKey: API_KEY }));

    expect(requestOf(list).headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(requestOf(chat).headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  test("asks a keyless server with no Authorization header at all", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));

    answerChat();

    await complete(server());

    // vLLM started without --api-key refuses an empty bearer token.
    expect(Object.keys(requestOf(list).headers)).not.toContain("Authorization");
    expect(requestOf(list).headers["Accept"]).toBe("application/json");
  });

  test("asks through the egress guard, pinned, refusing redirects, reading a bounded list", async () => {
    const guard: Spy =
      DataSourceEgressGuard.assertUrlAllowedAndPin as unknown as Spy;
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));

    answerChat();

    await complete(server());

    expect(guard.mock.calls[0]![0]).toBe(MODELS_URL);
    // A project's provider gets the deployment's own policy.
    expect(guard.mock.calls[0]![1]).toEqual({ targetLabel: "LLM provider" });
    expect(requestOf(list).options.doNotFollowRedirects).toBe(true);
    expect(requestOf(list).options.maxContentLength).toBe(8 * 1024 * 1024);
    expect(requestOf(list).options.retryOnlyOnRetryableErrors).toBe(true);
  });

  test("a global provider's server may be at a private address, as its requests may", async () => {
    const guard: Spy =
      DataSourceEgressGuard.assertUrlAllowedAndPin as unknown as Spy;

    listModels(vllmModelsList(SERVED_MODEL));
    answerChat();

    await complete(server({ isGlobalProvider: true }));

    expect(guard.mock.calls[0]![0]).toBe(MODELS_URL);
    expect(guard.mock.calls[0]![1]).toEqual({
      targetLabel: "LLM provider",
      blockPrivateAddresses: false,
    });
  });

  test("a server at a refused address is never asked, and its address is never said", async () => {
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowedAndPin")
      .mockRejectedValue(
        new EgressGuardException(
          "LLM provider host vllm.internal resolves to 10.0.0.5, which is a private network address.",
          EgressFailureReason.AddressBlocked,
        ),
      );
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    const error: Error = await failureOf(server({ apiKey: API_KEY }));

    expect(error).toBeInstanceOf(EgressGuardException);
    expect(error.message).toBe(
      "OpenAICompatible API request failed: the LLM provider base URL points to an address OneUptime is not allowed to connect to.",
    );
    expect(error.message).not.toContain("vllm.internal");
    expect(error.message).not.toContain("10.0.0.5");
    expect(list).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  test("a Model Name of spaces is blank too", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    await complete(server({ modelName: "   " }));

    expect(list).toHaveBeenCalledTimes(1);
    expect(requestOf(chat).data!["model"]).toBe(SERVED_MODEL);
  });

  test("the request is shaped for the model the server named", async () => {
    // A gateway whose first model is a reasoning model.
    listModels(vllmModelsList("gpt-5.1", "gpt-4o"));
    const chat: Spy = answerChat();

    await complete(server({ apiKey: API_KEY }), { maxTokens: 100 });

    expect(requestOf(chat).data!["max_completion_tokens"]).toBe(100);
    expect(requestOf(chat).data!["max_tokens"]).toBeUndefined();
  });
});

describe("a typed Model Name, and the other providers, are as they were", () => {
  test("a typed Model Name is sent, and the server is not asked", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    const response: LLMCompletionResponse = await complete(
      server({ modelName: "meta-llama/Llama-3.1-8B-Instruct" }),
    );

    expect(list).not.toHaveBeenCalled();
    expect(requestOf(chat).data!["model"]).toBe(
      "meta-llama/Llama-3.1-8B-Instruct",
    );
    expect(response.modelName).toBe("meta-llama/Llama-3.1-8B-Instruct");
  });

  test("a typed Model Name is sent without the spaces around it", async () => {
    listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    await complete(server({ modelName: "  my-model  " }));

    expect(requestOf(chat).data!["model"]).toBe("my-model");
  });

  test.each([
    [LlmType.OpenAI, "gpt-5.1"],
    [LlmType.Groq, "llama-3.3-70b-versatile"],
    [LlmType.Mistral, "mistral-large-latest"],
  ])(
    "%s, left blank, uses its own default and asks nobody",
    async (llmType: LlmType, defaultModel: string) => {
      const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
      const chat: Spy = answerChat();

      const response: LLMCompletionResponse = await complete({
        llmType: llmType,
        apiKey: API_KEY,
      });

      expect(list).not.toHaveBeenCalled();
      expect(requestOf(chat).data!["model"]).toBe(defaultModel);
      expect(response.modelName).toBe(defaultModel);
    },
  );

  test("Anthropic, Azure OpenAI and Ollama say the model they asked for", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));

    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
    }) => {
      const url: string = options.url.toString();

      return {
        jsonData: url.includes("/api/chat")
          ? { message: { content: "OK" }, done: true }
          : url.includes("/v1/messages")
            ? {
                content: [{ type: "text", text: "OK" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }
            : {
                choices: [
                  { message: { content: "OK" }, finish_reason: "stop" },
                ],
              },
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);

    expect(
      (await complete({ llmType: LlmType.Anthropic, apiKey: API_KEY }))
        .modelName,
    ).toBe(LLMService.ANTHROPIC_DEFAULT_MODEL);
    expect(
      (
        await complete({
          llmType: LlmType.AzureOpenAI,
          apiKey: API_KEY,
          baseUrl: "https://contoso-ai.openai.azure.com/openai/v1",
        })
      ).modelName,
    ).toBe(LLMService.AZURE_OPENAI_DEFAULT_DEPLOYMENT);
    expect(
      (
        await complete({
          llmType: LlmType.Ollama,
          baseUrl: "http://ollama:11434",
        })
      ).modelName,
    ).toBe("llama3.1");
    expect(
      (
        await complete({
          llmType: LlmType.Ollama,
          baseUrl: "http://ollama:11434",
          modelName: "qwen3:32b",
        })
      ).modelName,
    ).toBe("qwen3:32b");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("the model a server listed is remembered", () => {
  test("a conversation asks once", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));
    const chat: Spy = answerChat();

    await complete(server());
    await complete(server());
    await complete(server());

    expect(list).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(requestOf(chat, 2).data!["model"]).toBe(SERVED_MODEL);
  });

  test("for five minutes, then the server is asked again", async () => {
    const start: number = Date.UTC(2026, 9, 26, 9, 0, 0);
    const now: Spy = jest.spyOn(Date, "now").mockReturnValue(start);
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));

    answerChat();

    await complete(server());

    now.mockReturnValue(start + 5 * 60 * 1000 - 1);
    await complete(server());
    expect(list).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + 5 * 60 * 1000);
    await complete(server());
    expect(list).toHaveBeenCalledTimes(2);
  });

  test("a failed request forgets it, so a server restarted with another model is followed at once", async () => {
    const list: Spy = jest
      .spyOn(API, "get")
      .mockResolvedValueOnce({
        jsonData: vllmModelsList("old-model"),
      } as unknown as HTTPResponse<JSONObject>)
      .mockResolvedValueOnce({
        jsonData: vllmModelsList("new-model"),
      } as unknown as HTTPResponse<JSONObject>) as Spy;
    const chat: Spy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce({
        jsonData: { choices: [{ message: { content: "OK" } }] },
      } as unknown as HTTPResponse<JSONObject>)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          404,
          {
            object: "error",
            message: "The model `old-model` does not exist.",
            type: "NotFoundError",
            code: 404,
          },
          {},
        ),
      )
      .mockResolvedValueOnce({
        jsonData: { choices: [{ message: { content: "OK" } }] },
      } as unknown as HTTPResponse<JSONObject>) as Spy;

    await complete(server());
    await expect(complete(server())).rejects.toBeInstanceOf(
      LLMProviderHTTPException,
    );
    await complete(server());

    expect(list).toHaveBeenCalledTimes(2);
    expect(requestOf(chat, 1).data!["model"]).toBe("old-model");
    expect(requestOf(chat, 2).data!["model"]).toBe("new-model");
  });

  test("each server, key and kind of provider has its own", async () => {
    const list: Spy = listModels(vllmModelsList(SERVED_MODEL));

    answerChat();

    await complete(server());
    // The same server, the same way: remembered.
    await complete(server());
    expect(list).toHaveBeenCalledTimes(1);

    await complete(server({ baseUrl: "http://other-vllm:8000/v1" }));
    expect(list).toHaveBeenCalledTimes(2);

    // A gateway can list each key's own models.
    await complete(server({ apiKey: "sk-team-a" }));
    await complete(server({ apiKey: "sk-team-b" }));
    expect(list).toHaveBeenCalledTimes(4);

    await complete(server({ apiKey: "sk-team-a" }));
    expect(list).toHaveBeenCalledTimes(4);

    // A global provider's lookup reaches what a project's may not.
    await complete(server({ isGlobalProvider: true }));
    expect(list).toHaveBeenCalledTimes(5);
  });

  test("keeps only a hash of the API key", async () => {
    listModels(vllmModelsList(SERVED_MODEL));
    answerChat();

    await complete(server({ apiKey: API_KEY }));

    const keys: Array<string> = servedModelCacheKeys();

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(API_KEY);
    expect(keys[0]).toContain(MODELS_URL);
  });

  test("holds at most 500 servers, letting the oldest go", async () => {
    const cache: {
      cacheServedModel: (key: string, modelName: string) => void;
    } = LLMService as unknown as {
      cacheServedModel: (key: string, modelName: string) => void;
    };

    for (let index: number = 0; index <= 500; index++) {
      cache.cacheServedModel(`server-${index}`, SERVED_MODEL);
    }

    const keys: Array<string> = servedModelCacheKeys();

    expect(keys).toHaveLength(500);
    expect(keys).not.toContain("server-0");
    expect(keys).toContain("server-500");
  });
});

describe("a server that cannot say which model to use", () => {
  test("an error answer says why first, in OneUptime's words, and nothing is sent", async () => {
    answerList(new HTTPErrorResponse(404, { detail: "Not Found" }, {}));
    const chat: Spy = answerChat();

    const error: Error = await failureOf(server());

    expect(error).toBeInstanceOf(LLMProviderHTTPException);
    expect((error as LLMProviderHTTPException).statusCode).toBe(404);
    expect((error as LLMProviderHTTPException).hint).toBe(
      "Model Name is empty, so the server was asked which models it serves, and it answered HTTP 404. Check the Base URL and the API Key, or type the name of a model it serves in Model Name.",
    );
    expect(chat).not.toHaveBeenCalled();
    /*
     * What the Test button says: what to do. FastAPI's {"detail": ...}
     * carries no message HTTPErrorResponse reads, so nothing follows it.
     */
    expect(
      LlmProviderTestFailure.describe(error, LlmType.OpenAICompatible),
    ).toBe(
      "Model Name is empty, so the server was asked which models it serves, and it answered HTTP 404. Check the Base URL and the API Key, or type the name of a model it serves in Model Name.",
    );
  });

  test("the server's own words follow, on a line of their own, when it says some", async () => {
    answerList(
      new HTTPErrorResponse(
        404,
        { error: { message: "Route /v2/models not found", code: 404 } },
        {},
      ),
    );

    const error: Error = await failureOf(
      server({ baseUrl: "http://vllm.internal:8000/v2" }),
    );

    expect(
      LlmProviderTestFailure.describe(error, LlmType.OpenAICompatible),
    ).toBe(
      "Model Name is empty, so the server was asked which models it serves, and it answered HTTP 404. Check the Base URL and the API Key, or type the name of a model it serves in Model Name.\nThe OpenAI-compatible server answered: Route /v2/models not found",
    );
  });

  test("a key the server refuses says so, with its status", async () => {
    answerList(
      new HTTPErrorResponse(
        401,
        { error: { message: "Invalid API key", type: "invalid_api_key" } },
        {},
      ),
    );

    const error: Error = await failureOf(server({ apiKey: "sk-wrong" }));
    const shown: string = LlmProviderTestFailure.describe(
      error,
      LlmType.OpenAICompatible,
    );

    expect(shown).toContain("answered HTTP 401");
    expect(shown).toContain("API Key");
    expect(shown).toContain(
      "The OpenAI-compatible server answered: Invalid API key",
    );
    expect(shown).not.toContain("sk-wrong");
  });

  test("with the server's error details withheld, the hint is still said", async () => {
    answerList(new HTTPErrorResponse(404, { detail: "Not Found" }, {}));

    const error: Error = await failureOf(server(), {
      includeProviderErrorDetails: false,
    });

    expect(error.message).toBe(
      "OpenAICompatible API request failed. Model Name is empty, so the server was asked which models it serves, and it answered HTTP 404. Check the Base URL and the API Key, or type the name of a model it serves in Model Name.",
    );
    expect(error.message).not.toContain("Not Found");
  });

  test("a list with no models asks for a Model Name, and nothing is sent", async () => {
    listModels({ object: "list", data: [] });
    const chat: Spy = answerChat();

    const error: Error = await failureOf(server());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Model Name is empty, and the server at the Base URL lists no models to use. Check the Base URL, or type the name of a model the server serves in Model Name.",
    );
    expect(chat).not.toHaveBeenCalled();
    // The Test button says it as it is.
    expect(
      LlmProviderTestFailure.describe(error, LlmType.OpenAICompatible),
    ).toBe(error.message);
  });

  test("a page that is not a models list is read as no models", async () => {
    // HTTPResponse keeps a body that is not JSON as {data: "<the text>"}.
    listModels({ data: "<!doctype html><title>Open WebUI</title>" });
    const chat: Spy = answerChat();

    const error: Error = await failureOf(server());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("lists no models");
    expect(chat).not.toHaveBeenCalled();
  });

  test("a failed lookup is not remembered: the next request asks again", async () => {
    const list: Spy = jest
      .spyOn(API, "get")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(503, { detail: "Loading model" }, {}),
      )
      .mockResolvedValueOnce({
        jsonData: vllmModelsList(SERVED_MODEL),
      } as unknown as HTTPResponse<JSONObject>) as Spy;
    const chat: Spy = answerChat();

    await expect(complete(server())).rejects.toBeInstanceOf(
      LLMProviderHTTPException,
    );
    await complete(server());

    expect(list).toHaveBeenCalledTimes(2);
    expect(requestOf(chat).data!["model"]).toBe(SERVED_MODEL);
  });
});
