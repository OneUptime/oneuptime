import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import LlmType from "../../../../Types/LLM/LlmType";
import Sleep from "../../../../Types/Sleep";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
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
import { SpyInstance } from "jest-mock";
import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosStatic,
  InternalAxiosRequestConfig,
} from "axios";
import dns from "dns";

/*
 * An investigation whose LLM provider timed out used to tell the whole project
 * where the provider lives: "Request failed to
 * http://203.0.113.10:8443/v1/chat/completions. timeout of 120000ms
 * exceeded". API builds that sentence for any request that gets no response,
 * and LLMService passed it on, so it reached AIRun.errorMessage (the
 * investigation panel), chat replies and LlmLog. For the global provider that
 * is the address of an LLM server tenants were never given.
 *
 * These tests drive LLMService through the real API client over a mocked
 * transport, so the message under test is the one API really builds, and
 * check that what comes out says what went wrong but never where.
 */

jest.mock("axios", () => {
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

const mockedAxios: jest.MockedFunction<AxiosStatic> =
  axios as unknown as jest.MockedFunction<AxiosStatic>;

const PROVIDER_HOST: string = "203.0.113.10";
const PROVIDER_PORT: string = "8443";

interface ProviderCase {
  name: string;
  providerName: string;
  config: LLMProviderConfig;
  // Everything that identifies where the provider is.
  addressParts: Array<string>;
  defaultTimeoutInSeconds: number;
}

const providerCases: Array<ProviderCase> = [
  {
    name: "OpenAI-compatible",
    providerName: "OpenAICompatible",
    config: {
      llmType: LlmType.OpenAICompatible,
      baseUrl: `http://${PROVIDER_HOST}:${PROVIDER_PORT}`,
      modelName: "some-model",
    },
    addressParts: [
      `http://${PROVIDER_HOST}:${PROVIDER_PORT}`,
      PROVIDER_HOST,
      PROVIDER_PORT,
    ],
    defaultTimeoutInSeconds: 120,
  },
  {
    name: "Azure OpenAI",
    providerName: "Azure OpenAI",
    config: {
      llmType: LlmType.AzureOpenAI,
      apiKey: "azure-key",
      baseUrl:
        "https://private-resource.openai.azure.com/openai/deployments/dep",
      modelName: "dep",
    },
    addressParts: ["https://", "private-resource", "openai.azure.com"],
    defaultTimeoutInSeconds: 120,
  },
  {
    name: "Anthropic",
    providerName: "Anthropic",
    config: {
      llmType: LlmType.Anthropic,
      apiKey: "anthropic-key",
      baseUrl: "https://llm-gateway.internal.example/v1",
      modelName: "claude-x",
    },
    addressParts: ["https://", "llm-gateway", "internal.example"],
    defaultTimeoutInSeconds: 120,
  },
  {
    name: "Ollama",
    providerName: "Ollama",
    config: {
      llmType: LlmType.Ollama,
      baseUrl: "http://ollama.internal.example:11434",
      modelName: "llama-x",
    },
    addressParts: ["http://", "ollama.internal.example", "11434"],
    defaultTimeoutInSeconds: 300,
  },
];

const openAICompatibleCase: ProviderCase = providerCases[0]!;

/*
 * Every request the mocked transport sees fails the way axios fails a request
 * that gets no response: an AxiosError carrying the request config, so API
 * reads the real request URL off it.
 */
function failTransport(data: { code: string; message: string }): void {
  mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
    throw new AxiosError(
      data.message,
      data.code,
      config as InternalAxiosRequestConfig,
    );
  }) as never);
}

async function getCompletionError(providerCase: ProviderCase): Promise<Error> {
  try {
    await LLMService.getCompletion({
      llmProviderConfig: providerCase.config,
      messages: [{ role: "user", content: "hello" }],
      // One attempt: these tests are about the message, not the ladder.
      requestRetries: 0,
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the completion to fail.");
}

function expectNoAddress(message: string, addressParts: Array<string>): void {
  for (const part of addressParts) {
    expect(message).not.toContain(part);
  }
}

let loggerErrorSpy: SpyInstance<typeof logger.error>;

function silenceErrorLog(): void {
  loggerErrorSpy = jest
    .spyOn(logger, "error")
    .mockImplementation((): void => {});
}

beforeEach(() => {
  stubLLMEgressGuard();
  jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
  silenceErrorLog();
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
});

describe("LLMService reports an unreachable provider without its address", () => {
  test("the timeout from the investigation panel no longer shows the provider URL", async () => {
    failTransport({
      code: "ECONNABORTED",
      message: "timeout of 120000ms exceeded",
    });

    const error: Error = await getCompletionError(openAICompatibleCase);

    expect(error.message).toBe(
      "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.",
    );
    expectNoAddress(error.message, openAICompatibleCase.addressParts);
  });

  test.each(providerCases)(
    "$name: a timeout names neither the URL nor the host",
    async (providerCase: ProviderCase) => {
      failTransport({
        code: "ECONNABORTED",
        message: `timeout of ${providerCase.defaultTimeoutInSeconds * 1000}ms exceeded`,
      });

      const error: Error = await getCompletionError(providerCase);

      expect(error.message).toBe(
        `${providerCase.providerName} API request failed: the LLM provider did not respond within ${providerCase.defaultTimeoutInSeconds} seconds.`,
      );
      expectNoAddress(error.message, providerCase.addressParts);
    },
  );

  test.each(providerCases)(
    "$name: a refused connection names neither the URL nor the address it dialed",
    async (providerCase: ProviderCase) => {
      // Node puts the dialed address in the socket error's own message.
      failTransport({
        code: "ECONNREFUSED",
        message: `connect ECONNREFUSED ${PROVIDER_HOST}:${PROVIDER_PORT}`,
      });

      const error: Error = await getCompletionError(providerCase);

      expect(error.message).toBe(
        `${providerCase.providerName} API request failed: the LLM provider refused the connection.`,
      );
      expectNoAddress(error.message, [
        ...providerCase.addressParts,
        PROVIDER_HOST,
        PROVIDER_PORT,
      ]);
    },
  );

  test.each([
    {
      code: "ECONNRESET",
      message: "socket hang up",
      expected: "the LLM provider closed the connection before responding",
    },
    {
      code: "ETIMEDOUT",
      message: `connect ETIMEDOUT ${PROVIDER_HOST}:${PROVIDER_PORT}`,
      expected: "the connection to the LLM provider timed out",
    },
    {
      code: "ENOTFOUND",
      message: `getaddrinfo ENOTFOUND ${PROVIDER_HOST}`,
      expected: "the LLM provider's host name could not be resolved",
    },
    {
      code: "EHOSTUNREACH",
      message: `connect EHOSTUNREACH ${PROVIDER_HOST}:${PROVIDER_PORT}`,
      expected: "the LLM provider could not be reached over the network",
    },
    {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      message: `Hostname/IP does not match certificate's altnames: IP: ${PROVIDER_HOST} is not in the cert's list: `,
      expected:
        "a secure connection to the LLM provider could not be established",
    },
    {
      code: "ERR_NETWORK",
      message: "Network Error",
      expected: "the LLM provider could not be reached",
    },
  ])(
    "$code is described as: $expected",
    async (failure: { code: string; message: string; expected: string }) => {
      failTransport({ code: failure.code, message: failure.message });

      const error: Error = await getCompletionError(openAICompatibleCase);

      expect(error.message).toBe(
        `OpenAICompatible API request failed: ${failure.expected}.`,
      );
      expectNoAddress(error.message, openAICompatibleCase.addressParts);
    },
  );

  test("the error stays an APIException and does not carry the transport error", async () => {
    /*
     * Keeping the type keeps the HTTP status and error class every caller
     * already relies on. Dropping the AxiosError matters because it holds the
     * request URL and headers, the provider's API key among them.
     */
    failTransport({
      code: "ECONNREFUSED",
      message: `connect ECONNREFUSED ${PROVIDER_HOST}:${PROVIDER_PORT}`,
    });

    const error: Error = await getCompletionError(providerCases[2]!);

    expect(error).toBeInstanceOf(APIException);
    expect((error as APIException).error).toBeNull();
  });

  test("the operator still gets the original error, URL included, in the server log", async () => {
    failTransport({
      code: "ECONNABORTED",
      message: "timeout of 120000ms exceeded",
    });

    await getCompletionError(openAICompatibleCase);

    const loggedMessages: Array<string> = loggerErrorSpy.mock.calls.map(
      (call: Parameters<typeof logger.error>) => {
        return String(call[0]);
      },
    );

    expect(
      loggedMessages.some((message: string) => {
        return (
          message.includes(
            `http://${PROVIDER_HOST}:${PROVIDER_PORT}/v1/chat/completions`,
          ) && message.includes("timeout of 120000ms exceeded")
        );
      }),
    ).toBe(true);
  });

  test("a provider that answers with an error still reports it in its own words", async () => {
    /*
     * Only a request that got no response is rewritten. An error status is
     * the provider explaining what is wrong with the request (a bad key, an
     * unknown model), and the operator needs that text.
     */
    mockedAxios.mockImplementation((async (config: AxiosRequestConfig) => {
      throw new AxiosError(
        "Request failed with status code 401",
        "ERR_BAD_REQUEST",
        config as InternalAxiosRequestConfig,
        undefined,
        {
          status: 401,
          statusText: "Unauthorized",
          data: { error: { message: "Incorrect API key provided" } },
          headers: {},
          config: { headers: new AxiosHeaders() },
        } as AxiosResponse,
      );
    }) as never);

    const error: Error = await getCompletionError(openAICompatibleCase);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("OpenAICompatible API error");
    expect(error.message).toContain("Incorrect API key provided");
  });
});

describe("LLMService reports an egress refusal without the provider's host", () => {
  test("a refused address keeps the guard's reason but not the address", async () => {
    // The real guard: a literal loopback address needs no DNS.
    jest.restoreAllMocks();
    silenceErrorLog();

    const error: Error = await getCompletionError({
      ...providerCases[3]!,
      config: {
        llmType: LlmType.Ollama,
        baseUrl: "http://127.0.0.1:11434",
        modelName: "llama-x",
      },
    });

    expect(error).toBeInstanceOf(EgressGuardException);
    expect((error as EgressGuardException).reason).toBe(
      EgressFailureReason.AddressBlocked,
    );
    expect(error.message).toBe(
      "Ollama API request failed: the LLM provider base URL points to an address OneUptime is not allowed to connect to.",
    );
    expectNoAddress(error.message, ["127.0.0.1", "11434"]);
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  test("a host name that does not resolve is not named", async () => {
    // The real guard, over a resolver that knows no such host.
    jest.restoreAllMocks();
    silenceErrorLog();
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(
        Object.assign(
          new Error("getaddrinfo ENOTFOUND llm-gateway.internal.example"),
          { code: "ENOTFOUND" },
        ) as never,
      );

    const error: Error = await getCompletionError(providerCases[2]!);

    expect(error).toBeInstanceOf(EgressGuardException);
    expect(error.message).toMatch(/^Anthropic API request failed: /);
    expectNoAddress(error.message, providerCases[2]!.addressParts);
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  test.each([
    {
      reason: EgressFailureReason.Unreachable,
      guardMessage: `LLM provider host ${PROVIDER_HOST} could not be reached.`,
      expected: "the LLM provider could not be reached",
    },
    {
      reason: EgressFailureReason.ResolutionFailed,
      guardMessage: `Could not resolve llm provider host ${PROVIDER_HOST}: getaddrinfo EAI_AGAIN ${PROVIDER_HOST}`,
      expected: "the LLM provider's host name could not be resolved",
    },
    {
      reason: EgressFailureReason.InvalidTarget,
      guardMessage: `Invalid llm provider URL: http://${PROVIDER_HOST}:${PROVIDER_PORT}/v1/chat/completions`,
      expected: "the LLM provider base URL is not a valid http or https URL",
    },
  ])(
    "$reason is described as: $expected",
    async (refusal: {
      reason: EgressFailureReason;
      guardMessage: string;
      expected: string;
    }) => {
      jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowedAndPin")
        .mockRejectedValue(
          new EgressGuardException(refusal.guardMessage, refusal.reason),
        );

      const error: Error = await getCompletionError(openAICompatibleCase);

      expect(error).toBeInstanceOf(EgressGuardException);
      expect((error as EgressGuardException).reason).toBe(refusal.reason);
      expect(error.message).toBe(
        `OpenAICompatible API request failed: ${refusal.expected}.`,
      );
      expectNoAddress(error.message, openAICompatibleCase.addressParts);
    },
  );
});
