import { mockRouter } from "./Helpers";
import stubLLMEgressGuard from "../Utils/AI/StubLLMEgressGuard";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosStatic,
  InternalAxiosRequestConfig,
} from "axios";

/*
 * WHAT TEST LLM PROVIDER SAYS, provider by provider.
 *
 * The route, LLMService and the API client run for real; only the network is
 * faked, at axios, answering the way each provider answers: OpenAI,
 * Anthropic, Ollama and Azure OpenAI / Microsoft Foundry - a provider that
 * works, a wrong API key, a model it does not have, and a Base URL nothing
 * answers at. What the route answers is what the Test dialog shows (the
 * Dashboard shows a failure's message in the dialog's red alert).
 *
 * A failure says what went wrong and what to check, in OneUptime's words,
 * then what the provider answered, in its own (LlmProviderTestFailure). It
 * used to show the provider's error body as JSON.
 */

jest.mock("axios", () => {
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import Encryption from "../../../Server/Utils/Encryption";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Sleep from "../../../Types/Sleep";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  DASHBOARD_TEST_ROUTE,
  dashboardTestBody,
} from "../../Helpers/LlmProviderTestRequest";

type MockedFn = ReturnType<typeof jest.fn>;

const mockedAxios: jest.MockedFunction<AxiosStatic> =
  axios as unknown as jest.MockedFunction<AxiosStatic>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_TOOL: string = "connection_test_ping";

const CONNECTED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

const NO_ANSWER_ADVICE: string =
  "Check the Base URL, and that the OneUptime server can reach it.";

interface ProviderCase {
  name: string;
  row: StoredRow;
  // The address the probe goes to, as the provider is configured.
  requestUrl: string;
  // The header that carries the key, and its value, when there is one.
  keyHeader?: [string, string] | undefined;
  // A reply in which the model called the probe tool.
  calledTheTool: JSONObject;
}

let apiKeys: Record<string, string>;

const OPENAI_TOOL_REPLY: JSONObject = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: PROBE_TOOL, arguments: "{}" },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
};

function cases(): Array<ProviderCase> {
  return [
    {
      name: "OpenAI",
      row: {
        llmType: LlmType.OpenAI,
        apiKey: apiKeys["openai"],
        modelName: "gpt-5.1",
      },
      requestUrl: "https://api.openai.com/v1/chat/completions",
      keyHeader: ["Authorization", "Bearer sk-proj-customer-key"],
      calledTheTool: OPENAI_TOOL_REPLY,
    },
    {
      name: "Anthropic",
      row: {
        llmType: LlmType.Anthropic,
        apiKey: apiKeys["anthropic"],
        modelName: "claude-sonnet-5-5",
      },
      requestUrl: "https://api.anthropic.com/v1/messages",
      keyHeader: ["x-api-key", "sk-ant-customer-key"],
      calledTheTool: {
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "tool_use", id: "toolu_1", name: PROBE_TOOL, input: {} },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 40, output_tokens: 12 },
      },
    },
    {
      name: "Ollama",
      row: {
        llmType: LlmType.Ollama,
        baseUrl: "http://ollama.example.com:11434",
        modelName: "llama3.1",
      },
      requestUrl: "http://ollama.example.com:11434/api/chat",
      calledTheTool: {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: PROBE_TOOL, arguments: {} } }],
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 60,
        eval_count: 12,
      },
    },
    {
      name: "Azure OpenAI / Microsoft Foundry",
      row: {
        llmType: LlmType.AzureOpenAI,
        apiKey: apiKeys["azure"],
        baseUrl: "https://contoso-ai.openai.azure.com/openai/v1",
        modelName: "gpt-5.1",
      },
      requestUrl:
        "https://contoso-ai.openai.azure.com/openai/v1/chat/completions",
      keyHeader: ["api-key", "azure-customer-key"],
      calledTheTool: OPENAI_TOOL_REPLY,
    },
  ];
}

function caseNamed(name: string): ProviderCase {
  return cases().find((providerCase: ProviderCase): boolean => {
    return providerCase.name === name;
  })!;
}

// The customer's provider, of the given kind, in their project.
function useProvider(providerCase: ProviderCase): void {
  useInMemoryTable(LlmProviderService, [
    {
      _id: PROVIDER_ID,
      projectId: PROJECT_ID.toString(),
      name: providerCase.name,
      isGlobalLlm: false,
      isDefault: true,
      version: 1,
      ...providerCase.row,
    },
  ]);
}

function answer(data: JSONObject): void {
  mockedAxios.mockImplementation((async (): Promise<AxiosResponse> => {
    return {
      status: 200,
      statusText: "OK",
      data: data,
      headers: {},
      config: { headers: new AxiosHeaders() },
    } as AxiosResponse;
  }) as never);
}

function refuse(status: number, data: JSONObject): void {
  mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_REQUEST",
      config as InternalAxiosRequestConfig,
      undefined,
      {
        status: status,
        statusText: "Error",
        data: data,
        headers: {},
        config: { headers: new AxiosHeaders() },
      } as AxiosResponse,
    );
  }) as never);
}

function failToConnect(code: string, message: string): void {
  mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
    throw new AxiosError(message, code, config as InternalAxiosRequestConfig);
  }) as never);
}

async function pressTest(): Promise<void> {
  await mockRouter.match("post", DASHBOARD_TEST_ROUTE).handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: dashboardTestBody(PROVIDER_ID),
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );
}

// What the dialog shows: the verdict, or the failure in its red alert.
function dialogSays(): { success: boolean; message: string } {
  const verdicts: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as MockedFn
  ).mock.calls as Array<Array<unknown>>;
  const failures: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as MockedFn
  ).mock.calls as Array<Array<unknown>>;

  expect(verdicts.length + failures.length).toBe(1);

  if (verdicts[0]) {
    const verdict: JSONObject = verdicts[0][2] as JSONObject;
    return {
      success: verdict["success"] === true,
      message: verdict["message"] as string,
    };
  }

  const failure: Exception = failures[0]![2] as Exception;

  /*
   * Every failure of the provider is answered as bad data (HTTP 400), as it
   * always was; a refusal - who may test, the plan - is answered otherwise.
   * The dialog shows either in the server's words alone: they already end
   * with what to do.
   */
  expect(failure).toBeInstanceOf(BadDataException);
  expect(failure.code).toBe(ExceptionCode.BadDataException);
  expect(failure.code).toBe(400);

  return {
    success: false,
    message: failure.message,
  };
}

function requestsSent(): Array<AxiosRequestConfig> {
  return mockedAxios.mock.calls.map(
    (call: Array<unknown>): AxiosRequestConfig => {
      return call[0] as AxiosRequestConfig;
    },
  );
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  new LlmProviderAPI();

  apiKeys = {
    openai: await Encryption.encrypt("sk-proj-customer-key"),
    anthropic: await Encryption.encrypt("sk-ant-customer-key"),
    azure: await Encryption.encrypt("azure-customer-key"),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  LLMService.clearRequestAdaptationCache();
  stubLLMEgressGuard();
  jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockResolvedValue({
    ...customDomainCaller({
      permissions: [Permission.ProjectMember],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  });
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
});

describe("a provider that works: the dialog says the connection works, tool calling included", () => {
  test.each([
    "OpenAI",
    "Anthropic",
    "Ollama",
    "Azure OpenAI / Microsoft Foundry",
  ])("%s", async (name: string) => {
    const providerCase: ProviderCase = caseNamed(name);
    useProvider(providerCase);
    answer(providerCase.calledTheTool);

    await pressTest();

    expect(dialogSays()).toEqual({ success: true, message: CONNECTED });

    // One request, to the provider's own address, with its own key.
    const sent: Array<AxiosRequestConfig> = requestsSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url?.toString()).toBe(providerCase.requestUrl);

    if (providerCase.keyHeader) {
      const [header, value] = providerCase.keyHeader;
      expect((sent[0]!.headers as Record<string, string>)[header]).toBe(value);
    }
  });
});

describe("a wrong API key: the dialog says the key was not accepted, then the provider's words", () => {
  test("OpenAI", async () => {
    useProvider(caseNamed("OpenAI"));
    refuse(401, {
      error: {
        message: "Incorrect API key provided: sk-proj-****-key.",
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key",
      },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.\nOpenAI answered: Incorrect API key provided: sk-proj-****-key.",
    });
  });

  test("Anthropic", async () => {
    useProvider(caseNamed("Anthropic"));
    refuse(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "Anthropic did not accept the API key (HTTP 401). Check the provider's API Key.\nAnthropic answered: invalid x-api-key",
    });
  });

  test("Azure OpenAI / Microsoft Foundry: Azure's own advice leads", async () => {
    useProvider(caseNamed("Azure OpenAI / Microsoft Foundry"));
    refuse(401, {
      error: {
        code: "401",
        message:
          "Access denied due to invalid subscription key or wrong API endpoint.",
      },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "Azure did not accept the API key. Copy KEY 1 or KEY 2 from the Keys and Endpoint page of the same resource the Base URL points to.\nAzure answered: Access denied due to invalid subscription key or wrong API endpoint.",
    });
  });

  test("the key itself is never in what the dialog says", async () => {
    useProvider(caseNamed("OpenAI"));
    refuse(401, {
      error: { message: "Incorrect API key provided: sk-proj-****-key." },
    });

    await pressTest();

    expect(dialogSays().message).not.toContain("sk-proj-customer-key");
  });
});

describe("a model the provider does not have: the dialog says to check the Model Name", () => {
  test("OpenAI", async () => {
    useProvider(caseNamed("OpenAI"));
    refuse(404, {
      error: {
        message:
          "The model `gpt-9` does not exist or you do not have access to it.",
        type: "invalid_request_error",
        param: null,
        code: "model_not_found",
      },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "OpenAI found no such model, or nothing at the Base URL (HTTP 404). Check the Model Name and the Base URL.\nOpenAI answered: The model `gpt-9` does not exist or you do not have access to it.",
    });
  });

  test("Anthropic", async () => {
    useProvider(caseNamed("Anthropic"));
    refuse(404, {
      type: "error",
      error: { type: "not_found_error", message: "model: claude-9" },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "Anthropic found no such model, or nothing at the Base URL (HTTP 404). Check the Model Name and the Base URL.\nAnthropic answered: model: claude-9",
    });
  });

  test("Ollama: a model that was never pulled", async () => {
    useProvider(caseNamed("Ollama"));
    refuse(404, {
      error: 'model "llama9" not found, try pulling it first',
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        'Ollama found no such model, or nothing at the Base URL (HTTP 404). Check the Model Name and the Base URL.\nOllama answered: model "llama9" not found, try pulling it first',
    });
  });

  test("Azure OpenAI / Microsoft Foundry: a deployment the resource does not have", async () => {
    useProvider(caseNamed("Azure OpenAI / Microsoft Foundry"));
    refuse(404, {
      error: {
        code: "DeploymentNotFound",
        message: "The API deployment for this resource does not exist.",
      },
    });

    await pressTest();

    const said: { success: boolean; message: string } = dialogSays();
    expect(said.success).toBe(false);
    // Azure's advice first: the deployment, by the provider's Model Name.
    expect(
      said.message.startsWith("This resource has no deployment named"),
    ).toBe(true);
    expect(said.message).toContain("gpt-5.1");
    expect(
      said.message.endsWith(
        "\nAzure answered: The API deployment for this resource does not exist.",
      ),
    ).toBe(true);
  });
});

describe("a Base URL nothing answers at: the dialog says OneUptime could not reach the provider", () => {
  test.each([
    "OpenAI",
    "Anthropic",
    "Ollama",
    "Azure OpenAI / Microsoft Foundry",
  ])("%s, a refused connection", async (name: string) => {
    useProvider(caseNamed(name));
    failToConnect("ECONNREFUSED", "connect ECONNREFUSED 203.0.113.10:443");

    await pressTest();

    const provider: string =
      name === "Azure OpenAI / Microsoft Foundry" ? "Azure" : name;

    expect(dialogSays()).toEqual({
      success: false,
      message: `OneUptime could not reach ${provider}: the LLM provider refused the connection. ${NO_ANSWER_ADVICE}`,
    });
  });

  test("a host name that does not resolve", async () => {
    useProvider(caseNamed("Ollama"));
    failToConnect("ENOTFOUND", "getaddrinfo ENOTFOUND ollama.example.com");

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message: `OneUptime could not reach Ollama: the LLM provider's host name could not be resolved. ${NO_ANSWER_ADVICE}`,
    });
  });

  test("the address is never in what the dialog says", async () => {
    useProvider(caseNamed("Ollama"));
    failToConnect("ECONNREFUSED", "connect ECONNREFUSED 203.0.113.10:11434");

    await pressTest();

    const said: string = dialogSays().message;
    expect(said).not.toContain("203.0.113.10");
    expect(said).not.toContain("ollama.example.com");
  });

  test("a Base URL OneUptime may not connect to (the real egress guard)", async () => {
    jest.restoreAllMocks();
    jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        ...customDomainCaller({
          permissions: [Permission.ProjectOwner],
          projectId: PROJECT_ID,
        }),
        ...ON_HIGHEST_PLAN,
      });

    useProvider({
      ...caseNamed("Ollama"),
      row: {
        llmType: LlmType.Ollama,
        baseUrl: "http://127.0.0.1:11434",
        modelName: "llama3.1",
      },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message: `OneUptime could not reach Ollama: the LLM provider base URL points to an address OneUptime is not allowed to connect to. ${NO_ANSWER_ADVICE}`,
    });
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});

describe("the provider's other answers", () => {
  test("limits and credits (429): the dialog says to check the account, then the provider's words", async () => {
    useProvider(caseNamed("OpenAI"));
    refuse(429, {
      error: {
        message: "You exceeded your current quota.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      },
    });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "OpenAI is limiting requests from this API key, or its quota or credits ran out (HTTP 429). Check the account's limits and billing, then test again.\nOpenAI answered: You exceeded your current quota.",
    });
  });

  test("a model that answers in words instead of calling the tool: connected, with the warning", async () => {
    useProvider(caseNamed("OpenAI"));
    answer({
      choices: [
        {
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop",
        },
      ],
    });

    await pressTest();

    const said: { success: boolean; message: string } = dialogSays();
    expect(said.success).toBe(true);
    expect(
      said.message.startsWith(
        "Connection successful, but tool calling could not be verified",
      ),
    ).toBe(true);
  });
});

/*
 * A provider whose Model Name is blank leaves the model to the server: an
 * OpenAI-compatible server is asked which models it serves and the first is
 * used, every other provider uses its default. The person pressing Test is
 * told which model answered, so they know what AI features will use - and,
 * when the server cannot name one, what to check.
 */
describe("a blank Model Name: the dialog says which model answered", () => {
  const SERVED_MODEL: string = "Qwen/Qwen3.8-27B";
  const VLLM_BASE_URL: string = "http://vllm.example.com:8000/v1";

  const VLLM: ProviderCase = {
    name: "Self-hosted vLLM",
    row: {
      llmType: LlmType.OpenAICompatible,
      baseUrl: VLLM_BASE_URL,
    },
    requestUrl: `${VLLM_BASE_URL}/chat/completions`,
    calledTheTool: OPENAI_TOOL_REPLY,
  };

  // The server's models list for GET .../models, the reply for the rest.
  function serve(models: JSONObject, reply: JSONObject): void {
    mockedAxios.mockImplementation((async (
      config: AxiosRequestConfig,
    ): Promise<AxiosResponse> => {
      const isModelsList: boolean =
        String(config.method).toLowerCase() === "get" &&
        String(config.url).endsWith("/models");

      return {
        status: 200,
        statusText: "OK",
        data: isModelsList ? models : reply,
        headers: {},
        config: { headers: new AxiosHeaders() },
      } as AxiosResponse;
    }) as never);
  }

  beforeEach(() => {
    LLMService.clearServedModelCache();
  });

  test("an OpenAI-compatible server: asked for its models, the first answered, and the dialog names it", async () => {
    useProvider(VLLM);
    serve(
      {
        object: "list",
        data: [{ id: SERVED_MODEL, object: "model", owned_by: "vllm" }],
      },
      OPENAI_TOOL_REPLY,
    );

    await pressTest();

    expect(dialogSays()).toEqual({
      success: true,
      message: `${CONNECTED} Model Name is empty, so it used ${SERVED_MODEL}, the first model the server lists.`,
    });

    // The list first, then the probe - for the listed model - and nothing else.
    const sent: Array<AxiosRequestConfig> = requestsSent();
    expect(sent).toHaveLength(2);
    expect(String(sent[0]!.method).toLowerCase()).toBe("get");
    expect(sent[0]!.url?.toString()).toBe(`${VLLM_BASE_URL}/models`);
    expect(sent[1]!.url?.toString()).toBe(VLLM.requestUrl);
    expect(JSON.parse(JSON.stringify(sent[1]!.data))["model"]).toBe(
      SERVED_MODEL,
    );
    // A keyless server is sent no Authorization header, asked or tested.
    for (const request of sent) {
      expect(
        Object.keys((request.headers || {}) as Record<string, string>),
      ).not.toContain("Authorization");
    }
  });

  test("OpenAI: its default answered, and the dialog says so", async () => {
    useProvider({
      ...caseNamed("OpenAI"),
      row: { llmType: LlmType.OpenAI, apiKey: apiKeys["openai"] },
    });
    answer(OPENAI_TOOL_REPLY);

    await pressTest();

    expect(dialogSays()).toEqual({
      success: true,
      message: `${CONNECTED} Model Name is empty, so it used gpt-5.1, the provider's default.`,
    });
    // No models list: OpenAI has a default of its own.
    expect(requestsSent()).toHaveLength(1);
  });

  test("a typed Model Name: the verdict as it always was", async () => {
    useProvider({
      ...VLLM,
      row: { ...VLLM.row, modelName: "meta-llama/Llama-3.1-8B-Instruct" },
    });
    answer(OPENAI_TOOL_REPLY);

    await pressTest();

    expect(dialogSays()).toEqual({ success: true, message: CONNECTED });
    expect(requestsSent()).toHaveLength(1);
  });

  test("a model that answers in words: the warning, then which model it was", async () => {
    useProvider(VLLM);
    serve(
      { object: "list", data: [{ id: SERVED_MODEL }] },
      {
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
      },
    );

    await pressTest();

    const said: { success: boolean; message: string } = dialogSays();
    expect(said.success).toBe(true);
    expect(
      said.message.startsWith(
        "Connection successful, but tool calling could not be verified",
      ),
    ).toBe(true);
    expect(
      said.message.endsWith(
        `Model Name is empty, so it used ${SERVED_MODEL}, the first model the server lists.`,
      ),
    ).toBe(true);
  });

  test("a server with no models list: what to check, and no test prompt sent", async () => {
    useProvider(VLLM);
    refuse(404, { error: { message: "Not Found", code: 404 } });

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "Model Name is empty, so the server was asked which models it serves, and it answered HTTP 404. Check the Base URL and the API Key, or type the name of a model it serves in Model Name.\nThe OpenAI-compatible server answered: Not Found",
    });

    /*
     * Only the models list was asked for - once per try, with the tool
     * offered and then without - and no test prompt was posted.
     */
    expect(requestsSent()).toHaveLength(2);
    for (const request of requestsSent()) {
      expect(String(request.method).toLowerCase()).toBe("get");
      expect(request.url?.toString()).toBe(`${VLLM_BASE_URL}/models`);
    }
  });

  test("a server that lists no models: asked to type one", async () => {
    useProvider(VLLM);
    serve({ object: "list", data: [] }, OPENAI_TOOL_REPLY);

    await pressTest();

    expect(dialogSays()).toEqual({
      success: false,
      message:
        "Model Name is empty, and the server at the Base URL lists no models to use. Check the Base URL, or type the name of a model the server serves in Model Name.",
    });
    for (const request of requestsSent()) {
      expect(String(request.method).toLowerCase()).toBe("get");
    }
  });
});
