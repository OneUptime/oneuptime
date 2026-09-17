import API, { RequestOptions } from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import DataSourceEgressGuard, {
  EgressResolveFunction,
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * LlmProvider.baseUrl is writable by any ProjectMember, while reading the
 * provider's apiKey is restricted to Owner/Admin. So an unguarded outbound
 * request is a privilege escalation with two payouts: the decrypted key goes
 * out in the auth header of a request to a host the member chose, and the
 * provider's error body is reflected back through the LLM provider API, which
 * turns the same lever into a read primitive against the internal network.
 *
 * These tests assert that no request leaves for an internal address, that the
 * checked address is pinned into the socket, and that redirects are refused.
 * DNS is mocked so they are deterministic and offline.
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let lookupSpy: LookupSpy;

// Every API.post the service made, so tests can assert on "never sent".
const postCalls: Array<{ options?: RequestOptions | undefined }> = [];

function mockPostSuccess(): void {
  jest.spyOn(API, "post").mockImplementation(((options: {
    options?: RequestOptions | undefined;
  }) => {
    postCalls.push(options);

    return Promise.resolve({
      jsonData: {
        choices: [{ message: { content: "ok" } }],
        content: [{ type: "text", text: "ok" }],
        message: { content: "ok" },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    } as unknown as HTTPResponse<JSONObject>);
  }) as never);
}

function lastPostOptions(): RequestOptions {
  return postCalls[postCalls.length - 1]!.options as RequestOptions;
}

beforeEach(() => {
  postCalls.length = 0;
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;

  /*
   * Stand in for getaddrinfo: "localhost" is loopback, everything else is a
   * public address. Individual tests override this to model rebinding.
   */
  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname === "localhost") {
      return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    }

    return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  });

  mockPostSuccess();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService refuses internal LLM provider base URLs", () => {
  const blockedBaseUrls: Array<string> = [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://169.254.169.254",
    "http://169.254.169.254:80",
    "http://[::1]:11434",
    "http://0.0.0.0:11434",
  ];

  test.each(blockedBaseUrls)(
    "OpenAI-compatible provider at %s never posts",
    async (baseUrl: string) => {
      await expect(
        LLMService.getCompletion({
          llmProviderConfig: {
            llmType: LlmType.OpenAICompatible,
            apiKey: "sk-secret",
            modelName: "some-model",
            baseUrl,
          },
          messages: [{ role: "user", content: "hi" }],
        }),
      ).rejects.toThrow();

      expect(postCalls).toHaveLength(0);
    },
  );

  test("Ollama provider at a loopback base URL never posts", async () => {
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Ollama,
          modelName: "llama2",
          baseUrl: "http://127.0.0.1:11434",
        },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow();

    expect(postCalls).toHaveLength(0);
  });

  test("Anthropic provider repointed at the metadata endpoint never posts", async () => {
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Anthropic,
          apiKey: "sk-ant-secret",
          modelName: "claude-sonnet-4-20250514",
          baseUrl: "http://169.254.169.254/latest",
        },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow();

    expect(postCalls).toHaveLength(0);
  });

  test("Azure provider repointed at loopback never posts", async () => {
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.AzureOpenAI,
          apiKey: "azure-secret",
          modelName: "gpt-4o",
          baseUrl: "http://127.0.0.1/openai/deployments/gpt-4o",
        },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow();

    expect(postCalls).toHaveLength(0);
  });

  test("a public hostname that resolves to a private address never posts", async () => {
    // The DNS-rebinding shape: the name looks fine, the answer does not.
    lookupSpy.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    /*
     * Private ranges are only blocked under SaaS policy; this is the
     * documented switch that turns it on for a self-hosted install.
     */
    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    try {
      await expect(
        LLMService.getCompletion({
          llmProviderConfig: {
            llmType: LlmType.OpenAICompatible,
            apiKey: "sk-secret",
            modelName: "some-model",
            baseUrl: "https://ollama.attacker.example/v1",
          },
          messages: [{ role: "user", content: "hi" }],
        }),
      ).rejects.toThrow();
    } finally {
      delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    }

    expect(postCalls).toHaveLength(0);
  });
});

describe("LLMService pins and refuses redirects on allowed providers", () => {
  test("a public provider posts with redirects disabled and pinned agents", async () => {
    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        apiKey: "sk-secret",
        modelName: "some-model",
        baseUrl: "https://gateway.example.com/v1",
      },
      messages: [{ role: "user", content: "hi" }],
    });

    const options: RequestOptions = lastPostOptions();

    expect(options.doNotFollowRedirects).toBe(true);
    expect(options.httpAgent).toBeDefined();
    expect(options.httpsAgent).toBeDefined();
  });

  test("the pinned agent dials the address that was validated", async () => {
    lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Anthropic,
        apiKey: "sk-ant-secret",
        modelName: "claude-sonnet-4-20250514",
        baseUrl: "https://api.anthropic.com/v1",
      },
      messages: [{ role: "user", content: "hi" }],
    });

    const options: RequestOptions = lastPostOptions();

    const lookup: (
      hostname: string,
      lookupOptions: { all?: boolean },
      callback: (error: Error | null, address: string, family?: number) => void,
    ) => void = (
      options.httpsAgent as unknown as {
        options: {
          lookup: (
            hostname: string,
            lookupOptions: { all?: boolean },
            callback: (
              error: Error | null,
              address: string,
              family?: number,
            ) => void,
          ) => void;
        };
      }
    ).options.lookup;

    const dialed: string = await new Promise((resolve: (v: string) => void) => {
      lookup(
        "api.anthropic.com",
        { all: false },
        (_error: Error | null, address: string) => {
          resolve(address);
        },
      );
    });

    expect(dialed).toBe("93.184.216.34");
  });

  test("the guard resolves once per completion, not once per retry", async () => {
    /*
     * postOpenAIChatCompletion re-posts when the provider rejects a generation
     * parameter. Re-resolving per attempt would add a fresh rebind window
     * between attempts.
     */
    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        apiKey: "sk-secret",
        modelName: "some-model",
        baseUrl: "https://gateway.example.com/v1",
      },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });
});

describe("DataSourceEgressGuard self-hosted policy for LLM providers", () => {
  const resolveToPrivate: EgressResolveFunction = (): Promise<
    Array<ResolvedAddress>
  > => {
    return Promise.resolve([{ address: "10.0.0.5", family: 4 }]);
  };

  test("a self-hosted Ollama on a private address is still reachable", async () => {
    // The documented deployment: blockPrivateAddresses off (no billing).
    await expect(
      DataSourceEgressGuard.assertUrlAllowed("http://ollama.internal:11434", {
        blockPrivateAddresses: false,
        resolveFunction: resolveToPrivate,
        targetLabel: "LLM provider",
      }),
    ).resolves.toBeDefined();
  });

  test("but loopback and link-local are blocked even self-hosted", async () => {
    await expect(
      DataSourceEgressGuard.assertUrlAllowed("http://127.0.0.1:11434", {
        blockPrivateAddresses: false,
        targetLabel: "LLM provider",
      }),
    ).rejects.toThrow();

    await expect(
      DataSourceEgressGuard.assertUrlAllowed("http://169.254.169.254/", {
        blockPrivateAddresses: false,
        targetLabel: "LLM provider",
      }),
    ).rejects.toThrow();
  });
});
