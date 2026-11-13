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
 * TEST LLM PROVIDER SHOWS WHAT IT SENT AND WHAT CAME BACK (issue #7080).
 *
 * An admin whose provider fails the test used to get the verdict alone, and
 * nothing to look at: not the request, not the provider's raw answer, not
 * its headers. The route now answers with every request the test sent the
 * provider - URL, headers, body - and what came back - status, headers,
 * body - or why nothing did, beside the verdict; a failed test included.
 *
 * The route, LLMService and the API client run for real; only the network is
 * faked, at axios. What this pins:
 *
 *  - a pass carries the one request and its 200, the probe tool in the body;
 *  - a failure carries both attempts (the tool offer, then the plain prompt)
 *    with their statuses, headers and the provider's raw error body - on the
 *    exception the route answers with, so they reach the dialog;
 *  - a provider nothing answers at carries the requests with why;
 *  - the API key never leaves the server: not in a header, not in a body
 *    the provider echoed, not anywhere in what is sent back.
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
import BadDataExceptionWithDetails from "../../../Types/Exception/BadDataExceptionWithDetails";
import { JSONObject } from "../../../Types/JSON";
import {
  LLMProviderExchange,
  readLLMProviderExchanges,
} from "../../../Types/LLM/LLMProviderExchange";
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

const OPENAI_KEY: string = "sk-proj-customer-secret-key-1234";
const ANTHROPIC_KEY: string = "sk-ant-customer-secret-key-5678";

const OPENAI_TOOL_REPLY: JSONObject = {
  id: "chatcmpl-1",
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

let encryptedKeys: Record<string, string>;

function useProvider(row: StoredRow): void {
  useInMemoryTable(LlmProviderService, [
    {
      _id: PROVIDER_ID,
      projectId: PROJECT_ID.toString(),
      name: "The customer's provider",
      isGlobalLlm: false,
      isDefault: true,
      version: 1,
      ...row,
    },
  ]);
}

function useOpenAI(): void {
  useProvider({
    llmType: LlmType.OpenAI,
    apiKey: encryptedKeys["openai"],
    modelName: "gpt-4o",
  });
}

function reply(
  status: number,
  data: JSONObject | string,
  headers: Record<string, string | Array<string>> = {},
): AxiosResponse {
  return {
    status: status,
    statusText: status < 400 ? "OK" : "Error",
    data: data,
    headers: headers,
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
}

function answer(
  data: JSONObject,
  headers: Record<string, string | Array<string>> = {},
): void {
  mockedAxios.mockImplementation((async (): Promise<AxiosResponse> => {
    return reply(200, data, headers);
  }) as never);
}

function refuse(
  status: number,
  data: JSONObject | string,
  headers: Record<string, string | Array<string>> = {},
): void {
  mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_REQUEST",
      config as InternalAxiosRequestConfig,
      undefined,
      reply(status, data, headers),
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

function passBody(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as MockedFn
  ).mock.calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  return calls[0]![2] as JSONObject;
}

function failure(): BadDataExceptionWithDetails {
  const calls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as MockedFn
  ).mock.calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();

  const error: unknown = calls[0]![2];

  // Still bad data, at 400, as it always was: only details are added.
  expect(error).toBeInstanceOf(BadDataException);
  expect(error).toBeInstanceOf(BadDataExceptionWithDetails);

  return error as BadDataExceptionWithDetails;
}

// The exchanges as the dialog reads them off the answer.
function exchangesOf(body: JSONObject): Array<LLMProviderExchange> {
  const exchanges: Array<LLMProviderExchange> = readLLMProviderExchanges(
    body["exchanges"],
  );
  // Nothing lost in the reading: what was sent is what is shown.
  expect(exchanges).toHaveLength((body["exchanges"] as Array<unknown>).length);
  return exchanges;
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  new LlmProviderAPI();

  encryptedKeys = {
    openai: await Encryption.encrypt(OPENAI_KEY),
    anthropic: await Encryption.encrypt(ANTHROPIC_KEY),
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

describe("a test that passes shows the request and the provider's answer", () => {
  test("one exchange: POST to the provider, the probe in the body, HTTP 200 and the reply", async () => {
    useOpenAI();
    answer(OPENAI_TOOL_REPLY, {
      "content-type": "application/json",
      "x-request-id": "req_abc123",
      "openai-processing-ms": "312",
    });

    await pressTest();

    const body: JSONObject = passBody();
    expect(body["success"]).toBe(true);

    const exchanges: Array<LLMProviderExchange> = exchangesOf(body);
    expect(exchanges).toHaveLength(1);

    const exchange: LLMProviderExchange = exchanges[0]!;
    expect(exchange.method).toBe("POST");
    expect(exchange.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(exchange.statusCode).toBe(200);
    expect(exchange.error).toBeUndefined();
    expect(exchange.durationMs).toBeGreaterThanOrEqual(0);

    // The request body as sent: the model, the prompt and the probe tool.
    const requestBody: JSONObject = exchange.requestBody as JSONObject;
    expect(requestBody["model"]).toBe("gpt-4o");
    expect(JSON.stringify(requestBody["tools"])).toContain(PROBE_TOOL);
    expect(JSON.stringify(requestBody["messages"])).toContain(
      "connection test",
    );

    // The provider's answer as it came: its headers and its body.
    expect(exchange.responseHeaders).toMatchObject({
      "content-type": "application/json",
      "x-request-id": "req_abc123",
      "openai-processing-ms": "312",
    });
    expect(exchange.responseBody).toEqual(OPENAI_TOOL_REPLY);
  });

  test("the request's headers are shown, the key in them masked to its ends", async () => {
    useOpenAI();
    answer(OPENAI_TOOL_REPLY);

    await pressTest();

    const exchange: LLMProviderExchange = exchangesOf(passBody())[0]!;

    expect(exchange.requestHeaders["Authorization"]).toBe("Bearer sk-p…1234");
    expect(exchange.requestHeaders["Content-Type"]).toBe("application/json");
  });

  test("Anthropic: the x-api-key header is masked too", async () => {
    useProvider({
      llmType: LlmType.Anthropic,
      apiKey: encryptedKeys["anthropic"],
      modelName: "claude-sonnet-4-5",
    });
    answer({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: PROBE_TOOL, input: {} },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 60, output_tokens: 12 },
    });

    await pressTest();

    const exchange: LLMProviderExchange = exchangesOf(passBody())[0]!;
    expect(exchange.url).toBe("https://api.anthropic.com/v1/messages");
    expect(exchange.requestHeaders["x-api-key"]).toBe("sk-a…5678");
    expect(JSON.stringify(passBody())).not.toContain(ANTHROPIC_KEY);
  });

  test("a cookie the provider sets is never shown", async () => {
    useOpenAI();
    answer(OPENAI_TOOL_REPLY, {
      "set-cookie": ["__cf_bm=very-private-cookie; path=/"],
    });

    await pressTest();

    const exchange: LLMProviderExchange = exchangesOf(passBody())[0]!;
    expect(exchange.responseHeaders!["set-cookie"]).toBe("[redacted]");
    expect(JSON.stringify(passBody())).not.toContain("very-private-cookie");
  });
});

describe("a test that fails shows every request and the provider's raw answer", () => {
  const BAD_KEY_BODY: JSONObject = {
    error: {
      message: "Incorrect API key provided: sk-proj-****-1234.",
      type: "invalid_request_error",
      param: null,
      code: "invalid_api_key",
    },
  };

  test("a wrong key: both attempts, each HTTP 401 with the provider's error body and headers", async () => {
    useOpenAI();
    refuse(401, BAD_KEY_BODY, {
      "content-type": "application/json",
      "x-request-id": "req_401",
    });

    await pressTest();

    const error: BadDataExceptionWithDetails = failure();

    // The verdict is what it always was.
    expect(error.message).toBe(
      "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.\nOpenAI answered: Incorrect API key provided: sk-proj-****-1234.",
    );

    const exchanges: Array<LLMProviderExchange> = exchangesOf(error.details);

    // The tool offer, then the plain prompt it fell back to.
    expect(exchanges).toHaveLength(2);
    expect(JSON.stringify(exchanges[0]!.requestBody)).toContain(PROBE_TOOL);
    expect(JSON.stringify(exchanges[1]!.requestBody)).not.toContain(PROBE_TOOL);

    for (const exchange of exchanges) {
      expect(exchange.statusCode).toBe(401);
      expect(exchange.responseBody).toEqual(BAD_KEY_BODY);
      expect(exchange.responseHeaders).toMatchObject({
        "x-request-id": "req_401",
      });
    }
  });

  test("a server error that is not JSON: the body is shown as the text it was", async () => {
    useOpenAI();
    refuse(502, "<html><body>Bad Gateway</body></html>", {
      "content-type": "text/html",
    });

    await pressTest();

    const exchanges: Array<LLMProviderExchange> = exchangesOf(
      failure().details,
    );

    expect(exchanges.length).toBeGreaterThan(0);
    expect(exchanges[0]!.statusCode).toBe(502);
    expect(JSON.stringify(exchanges[0]!.responseBody)).toContain("Bad Gateway");
  });

  test("a provider that echoes the key back: the key is masked in its body too", async () => {
    useOpenAI();
    refuse(401, {
      error: { message: `Incorrect API key provided: ${OPENAI_KEY}.` },
    });

    await pressTest();

    const error: BadDataExceptionWithDetails = failure();
    expect(JSON.stringify(error.details)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(error.details)).toContain("sk-p…1234");
  });

  test("nothing answers at the Base URL: the requests, no status, and why", async () => {
    useProvider({
      llmType: LlmType.OpenAICompatible,
      apiKey: encryptedKeys["openai"],
      baseUrl: "http://llm.internal.example:8000/v1",
      modelName: "chat-large",
    });
    failToConnect("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.5:8000");

    await pressTest();

    const exchanges: Array<LLMProviderExchange> = exchangesOf(
      failure().details,
    );

    expect(exchanges.length).toBeGreaterThan(0);

    for (const exchange of exchanges) {
      expect(exchange.url).toBe(
        "http://llm.internal.example:8000/v1/chat/completions",
      );
      expect(exchange.statusCode).toBeUndefined();
      expect(exchange.responseBody).toBeUndefined();
      expect(exchange.error).toBeTruthy();
    }
  });

  test("the key is nowhere in what a failed test sends back", async () => {
    useOpenAI();
    refuse(401, BAD_KEY_BODY);

    await pressTest();

    const error: BadDataExceptionWithDetails = failure();
    expect(JSON.stringify(error.details)).not.toContain(OPENAI_KEY);
    expect(error.message).not.toContain(OPENAI_KEY);
  });
});

describe("a fallback that passes shows the request that failed too", () => {
  test("tools refused with a 400, the plain prompt answered: both requests are shown", async () => {
    useOpenAI();

    mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
      const sent: JSONObject = (
        typeof config.data === "string" ? JSON.parse(config.data) : config.data
      ) as JSONObject;

      if (sent["tools"]) {
        throw new AxiosError(
          "Request failed with status code 400",
          "ERR_BAD_REQUEST",
          config as InternalAxiosRequestConfig,
          undefined,
          reply(400, {
            error: { message: "Unrecognized request argument: tools" },
          }),
        );
      }

      return reply(200, {
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      });
    }) as never);

    await pressTest();

    const body: JSONObject = passBody();
    expect(body["success"]).toBe(true);
    expect(body["supportsToolCalling"]).toBe(false);

    const exchanges: Array<LLMProviderExchange> = exchangesOf(body);
    const statuses: Array<number | undefined> = exchanges.map(
      (exchange: LLMProviderExchange) => {
        return exchange.statusCode;
      },
    );

    expect(statuses[0]).toBe(400);
    expect(statuses[statuses.length - 1]).toBe(200);
    expect(JSON.stringify(exchanges[0]!.responseBody)).toContain(
      "Unrecognized request argument: tools",
    );
  });
});

describe("a blank Model Name: the model list request is shown first", () => {
  test("GET /models, then the chat request with the model it picked", async () => {
    useProvider({
      llmType: LlmType.OpenAICompatible,
      apiKey: encryptedKeys["openai"],
      baseUrl: "http://llm.internal.example:8000/v1",
      modelName: "",
    });

    mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
      if ((config.method || "").toLowerCase() === "get") {
        return reply(200, { data: [{ id: "served-model" }] });
      }

      return reply(200, OPENAI_TOOL_REPLY);
    }) as never);

    await pressTest();

    const exchanges: Array<LLMProviderExchange> = exchangesOf(passBody());

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]!.method).toBe("GET");
    expect(exchanges[0]!.url).toBe(
      "http://llm.internal.example:8000/v1/models",
    );
    expect(exchanges[0]!.responseBody).toEqual({
      data: [{ id: "served-model" }],
    });
    expect(exchanges[0]!.requestHeaders["Authorization"]).toBe(
      "Bearer sk-p…1234",
    );
    expect(exchanges[1]!.method).toBe("POST");
    expect((exchanges[1]!.requestBody as JSONObject)["model"]).toBe(
      "served-model",
    );
  });
});
