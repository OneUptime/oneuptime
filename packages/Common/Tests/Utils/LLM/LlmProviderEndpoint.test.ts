import LlmProviderEndpoint, {
  AzureOpenAIRequestEndpoint,
  SplitBaseUrl,
} from "../../../Utils/LLM/LlmProviderEndpoint";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4476: Microsoft Foundry (Azure AI Foundry) as OneUptime's LLM
 * provider. The Azure portal and the Foundry portal show the same endpoint
 * in several shapes - the resource's endpoint, its v1 API, a deployment, a
 * deployment's whole Target URI - and each must reach the endpoint it names
 * rather than have the API path appended a second time. The same holds for
 * Claude in Foundry on the Anthropic wire. These pin every shape to the URL
 * it produces; LLMServiceAzureFoundry.test.ts holds LLMService to sending to
 * exactly these URLs.
 */

const DEFAULT_API_VERSION: string =
  LlmProviderEndpoint.AZURE_OPENAI_DEFAULT_API_VERSION;

function azure(baseUrl: string): AzureOpenAIRequestEndpoint {
  return LlmProviderEndpoint.resolveAzureOpenAI(baseUrl);
}

describe("the default api-version a deployment URL is sent with", () => {
  test("is Azure OpenAI's newest generally available dated version, as it has been", () => {
    expect(DEFAULT_API_VERSION).toBe("2024-10-21");
  });
});

describe("an Azure OpenAI Base URL that is the resource's endpoint goes to the v1 API", () => {
  test.each([
    [
      "https://contoso.openai.azure.com",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.openai.azure.com/",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.services.ai.azure.com",
      "https://contoso.services.ai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.cognitiveservices.azure.com/",
      "https://contoso.cognitiveservices.azure.com/openai/v1/chat/completions",
    ],
    // The /openai root, without a version.
    [
      "https://contoso.openai.azure.com/openai",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.openai.azure.com/openai/",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
  ])("%s", (baseUrl: string, requestUrl: string) => {
    expect(azure(baseUrl)).toEqual({ requestUrl, usesV1Api: true });
  });
});

describe("an Azure OpenAI Base URL that is the v1 API keeps it, with no dated api-version", () => {
  test.each([
    [
      "https://contoso.openai.azure.com/openai/v1",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.openai.azure.com/openai/v1/",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      "https://contoso.services.ai.azure.com/openai/v1",
      "https://contoso.services.ai.azure.com/openai/v1/chat/completions",
    ],
    // The whole v1 endpoint, pasted from a code sample.
    [
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    ],
    // A gateway that serves the v1 API under the same path.
    [
      "https://contoso-apim.azure-api.net/openai/v1",
      "https://contoso-apim.azure-api.net/openai/v1/chat/completions",
    ],
  ])("%s", (baseUrl: string, requestUrl: string) => {
    expect(azure(baseUrl)).toEqual({ requestUrl, usesV1Api: true });
  });

  test("an api-version the v1 API takes, such as preview, is kept as written", () => {
    expect(
      azure("https://contoso.openai.azure.com/openai/v1?api-version=preview"),
    ).toEqual({
      requestUrl:
        "https://contoso.openai.azure.com/openai/v1/chat/completions?api-version=preview",
      usesV1Api: true,
    });
  });

  test("the v1 path is recognized in any case", () => {
    expect(azure("https://contoso.openai.azure.com/OpenAI/V1").usesV1Api).toBe(
      true,
    );
  });
});

describe("an Azure OpenAI Base URL that names a deployment is sent as it always was", () => {
  test("a deployment URL gets /chat/completions and the default api-version", () => {
    expect(
      azure("https://contoso.openai.azure.com/openai/deployments/gpt-4o"),
    ).toEqual({
      requestUrl: `https://contoso.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=${DEFAULT_API_VERSION}`,
      usesV1Api: false,
    });
  });

  test("a trailing slash does not double up", () => {
    expect(
      azure("https://contoso.openai.azure.com/openai/deployments/gpt-4o/")
        .requestUrl,
    ).toBe(
      `https://contoso.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=${DEFAULT_API_VERSION}`,
    );
  });

  test("an api-version in the Base URL wins over the default", () => {
    expect(
      azure(
        "https://contoso.openai.azure.com/openai/deployments/o3-mini?api-version=2024-12-01-preview",
      ),
    ).toEqual({
      requestUrl:
        "https://contoso.openai.azure.com/openai/deployments/o3-mini/chat/completions?api-version=2024-12-01-preview",
      usesV1Api: false,
    });
  });

  test("a slash before the query does not end up inside the path twice", () => {
    expect(
      azure(
        "https://contoso.openai.azure.com/openai/deployments/o3-mini/?api-version=2024-12-01-preview",
      ).requestUrl,
    ).toBe(
      "https://contoso.openai.azure.com/openai/deployments/o3-mini/chat/completions?api-version=2024-12-01-preview",
    );
  });

  test("a deployment's whole Target URI, copied from the Foundry portal, is the same endpoint", () => {
    const targetUri: string =
      "https://contoso.cognitiveservices.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-01-01-preview";

    expect(azure(targetUri)).toEqual({
      requestUrl: targetUri,
      usesV1Api: false,
    });
  });

  test("a Target URI without an api-version gets the default", () => {
    expect(
      azure(
        "https://contoso.openai.azure.com/openai/deployments/gpt-4o/chat/completions",
      ).requestUrl,
    ).toBe(
      `https://contoso.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=${DEFAULT_API_VERSION}`,
    );
  });

  test("other query parameters a gateway needs are kept next to the api-version", () => {
    expect(
      azure(
        "https://contoso-apim.azure-api.net/aoai/deployments/gpt-4o?subscription=prod",
      ).requestUrl,
    ).toBe(
      `https://contoso-apim.azure-api.net/aoai/deployments/gpt-4o/chat/completions?subscription=prod&api-version=${DEFAULT_API_VERSION}`,
    );
  });

  test("a gateway's own path is trusted, and still gets the api-version a deployment URL gets", () => {
    expect(azure("https://gateway.internal.example/llm/azure")).toEqual({
      requestUrl: `https://gateway.internal.example/llm/azure/chat/completions?api-version=${DEFAULT_API_VERSION}`,
      usesV1Api: false,
    });
  });

  test("a path that merely ends in v1, not Azure's /openai/v1, is not taken for the v1 API", () => {
    expect(azure("https://gateway.internal.example/v1")).toEqual({
      requestUrl: `https://gateway.internal.example/v1/chat/completions?api-version=${DEFAULT_API_VERSION}`,
      usesV1Api: false,
    });
  });
});

describe("an Azure OpenAI Base URL is read the way it is typed", () => {
  test("spaces around it are ignored", () => {
    expect(azure("  https://contoso.openai.azure.com/openai/v1  ")).toEqual({
      requestUrl: "https://contoso.openai.azure.com/openai/v1/chat/completions",
      usesV1Api: true,
    });
  });

  test("an upper-case scheme is lower-cased", () => {
    expect(azure("HTTPS://contoso.openai.azure.com").requestUrl).toBe(
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    );
  });

  test("a #fragment is dropped: no browser sends one, and the path would land inside it", () => {
    expect(azure("https://contoso.openai.azure.com/openai/v1#keys")).toEqual({
      requestUrl: "https://contoso.openai.azure.com/openai/v1/chat/completions",
      usesV1Api: true,
    });
  });

  test("a port is kept", () => {
    expect(azure("https://10.0.0.12:8443").requestUrl).toBe(
      "https://10.0.0.12:8443/openai/v1/chat/completions",
    );
  });

  test("an empty query is not sent", () => {
    expect(azure("https://contoso.openai.azure.com/openai/v1?").requestUrl).toBe(
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    );
  });
});

describe("an Anthropic Base URL reaches the Messages API", () => {
  test.each([
    // Anthropic's own API, the default.
    ["", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/messages"],
    // Claude in Microsoft Foundry: the Base URL Foundry shows.
    [
      "https://contoso.services.ai.azure.com/anthropic",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    [
      "https://contoso.services.ai.azure.com/anthropic/",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    // The API version included.
    [
      "https://contoso.services.ai.azure.com/anthropic/v1",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    // A deployment's Target URI, pasted whole.
    [
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    // The Foundry resource's endpoint alone.
    [
      "https://contoso.services.ai.azure.com",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    [
      "https://contoso.services.ai.azure.com/",
      "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    ],
    // A gateway that takes the SDKs' base URL.
    [
      "https://gateway.example.com/v1/acct/gw/anthropic",
      "https://gateway.example.com/v1/acct/gw/anthropic/v1/messages",
    ],
    // A gateway at its root keeps what it has always been sent.
    ["http://litellm:4000", "http://litellm:4000/messages"],
    ["http://litellm:4000/v1", "http://litellm:4000/v1/messages"],
  ])("%p", (baseUrl: string, requestUrl: string) => {
    expect(
      LlmProviderEndpoint.resolveAnthropicMessagesUrl(baseUrl || undefined),
    ).toBe(requestUrl);
  });

  test("a query stays after the path instead of swallowing it", () => {
    expect(
      LlmProviderEndpoint.resolveAnthropicMessagesUrl(
        "https://gateway.example.com/v1?team=sre",
      ),
    ).toBe("https://gateway.example.com/v1/messages?team=sre");
  });

  test("only a Foundry resource's host gets the Claude path when the Base URL is the host alone", () => {
    expect(
      LlmProviderEndpoint.resolveAnthropicMessagesUrl(
        "https://contoso.openai.azure.com",
      ),
    ).toBe("https://contoso.openai.azure.com/messages");
    expect(
      LlmProviderEndpoint.resolveAnthropicMessagesUrl(
        "https://contoso.services.ai.azure.us",
      ),
    ).toBe("https://contoso.services.ai.azure.us/anthropic/v1/messages");
  });
});

describe("a Base URL in parts", () => {
  test("separates the origin, the host, the path and the query", () => {
    expect(
      LlmProviderEndpoint.splitBaseUrl(
        "HTTPS://user@Contoso.OpenAI.Azure.com:443/openai/v1/?api-version=preview#x",
      ),
    ).toEqual({
      origin: "https://user@Contoso.OpenAI.Azure.com:443",
      host: "contoso.openai.azure.com",
      path: "/openai/v1",
      query: "?api-version=preview",
    } as SplitBaseUrl);
  });

  test("a Base URL with no scheme keeps its text as the path", () => {
    expect(
      LlmProviderEndpoint.splitBaseUrl("contoso.openai.azure.com/"),
    ).toEqual({
      origin: "",
      host: "",
      path: "contoso.openai.azure.com",
      query: "",
    } as SplitBaseUrl);
  });

  test("tells a Foundry resource's host from others", () => {
    expect(
      LlmProviderEndpoint.isFoundryHost("contoso.services.ai.azure.com"),
    ).toBe(true);
    expect(LlmProviderEndpoint.isFoundryHost("contoso.openai.azure.com")).toBe(
      false,
    );
    expect(
      LlmProviderEndpoint.isFoundryHost("services.ai.azure.com.example.org"),
    ).toBe(false);
  });
});
