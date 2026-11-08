import { describe, expect, test } from "@jest/globals";
import {
  LLM_PROVIDER_AZURE_AI_INFERENCE,
  LLM_PROVIDER_AZURE_OPENAI,
  LLM_PROVIDER_EXACT_HOSTS,
  LLM_PROVIDER_OPENAI,
  LlmProviderDefinition,
  LlmProviders,
  getAzureLlmHostSuffixes,
  getAzureLlmProviderOfAddress,
  getLlmEndpointHost,
  getLlmProviderOfAddress,
  getLlmProviderStoredValues,
  getLlmProviderTitle,
  normalizeLlmProvider,
} from "../../../Types/Telemetry/LlmProviders";
import { LlmConnectionCatalog } from "../../../Types/LlmObservability/LlmConnectionCatalog";

/*
 * ONE NAME PER AI PROVIDER.
 *
 * The same Azure OpenAI deployment reached OneUptime as az.ai.openai (older
 * SDKs and Semantic Kernel), azure.ai.openai (the conventions and
 * OpenLLMetry), azure_openai, and "openai" - the OpenAI SDKs' own
 * instrumentations call every endpoint "openai", Azure's included. These
 * pin the one name each is stored under, the title the product shows, and
 * the spellings a filter on a provider matches.
 */

describe("the conventions' names", () => {
  test("the GenAI conventions' well-known gen_ai.provider.name values are all known", () => {
    for (const name of [
      "anthropic",
      "aws.bedrock",
      "azure.ai.inference",
      "azure.ai.openai",
      "cohere",
      "deepseek",
      "gcp.gemini",
      "gcp.gen_ai",
      "gcp.vertex_ai",
      "groq",
      "ibm.watsonx.ai",
      "mistral_ai",
      "openai",
      "perplexity",
      "x_ai",
    ]) {
      expect(normalizeLlmProvider({ reported: name })).toBe(name);
    }
  });

  test("every provider account's GenAI name is one of them", () => {
    for (const definition of LlmConnectionCatalog) {
      expect(normalizeLlmProvider({ reported: definition.genAiProviderName }))
        .toBe(definition.genAiProviderName);
    }
  });

  test("names and aliases are unique across providers", () => {
    const seen: Map<string, string> = new Map<string, string>();

    for (const definition of LlmProviders) {
      for (const spelling of [definition.name, ...definition.aliases]) {
        expect({ spelling, owner: seen.get(spelling) }).toEqual({
          spelling,
          owner: undefined,
        });
        seen.set(spelling, definition.name);
      }
    }
  });

  test("aliases are written lower case, as they are matched", () => {
    for (const definition of LlmProviders) {
      for (const alias of definition.aliases) {
        expect(alias).toBe(alias.toLowerCase());
      }
      expect(definition.name).toBe(definition.name.toLowerCase());
    }
  });
});

describe("normalizeLlmProvider", () => {
  test.each([
    ["az.ai.openai", LLM_PROVIDER_AZURE_OPENAI],
    ["azure_openai", LLM_PROVIDER_AZURE_OPENAI],
    ["azure-openai", LLM_PROVIDER_AZURE_OPENAI],
    ["Azure", LLM_PROVIDER_AZURE_OPENAI],
    ["az.ai.inference", LLM_PROVIDER_AZURE_AI_INFERENCE],
    ["OpenAI", LLM_PROVIDER_OPENAI],
    [" openai ", LLM_PROVIDER_OPENAI],
    ["bedrock", "aws.bedrock"],
    ["vertex_ai", "gcp.vertex_ai"],
    ["mistralai", "mistral_ai"],
    ["xai", "x_ai"],
  ])("%s is stored as %s", (reported: string, stored: string) => {
    expect(normalizeLlmProvider({ reported })).toBe(stored);
  });

  test("a value it does not know is kept as it was sent, trimmed", () => {
    expect(normalizeLlmProvider({ reported: "  MyGateway " })).toBe(
      "MyGateway",
    );
  });

  test("nothing reported, nothing called: nothing", () => {
    expect(normalizeLlmProvider({ reported: "" })).toBe("");
    expect(normalizeLlmProvider({ reported: undefined })).toBe("");
    expect(normalizeLlmProvider({ reported: null })).toBe("");
  });

  describe("an OpenAI SDK's call to an Azure host is Azure's", () => {
    test.each([
      ["contoso.openai.azure.com", LLM_PROVIDER_AZURE_OPENAI],
      ["contoso.cognitiveservices.azure.com", LLM_PROVIDER_AZURE_OPENAI],
      ["contoso.services.ai.azure.com", LLM_PROVIDER_AZURE_OPENAI],
      ["contoso.openai.azure.us", LLM_PROVIDER_AZURE_OPENAI],
      ["contoso.openai.azure.cn", LLM_PROVIDER_AZURE_OPENAI],
      [
        "my-model.eastus2.models.ai.azure.com",
        LLM_PROVIDER_AZURE_AI_INFERENCE,
      ],
      ["models.inference.ai.azure.com", LLM_PROVIDER_AZURE_AI_INFERENCE],
    ])("server.address %s", (host: string, provider: string) => {
      expect(
        normalizeLlmProvider({ reported: "openai", addresses: [host] }),
      ).toBe(provider);
    });

    test("OpenLLMetry's base URL says Azure for a Foundry endpoint it calls openai", () => {
      expect(
        normalizeLlmProvider({
          reported: "openai",
          addresses: [
            "",
            "https://contoso.services.ai.azure.com/openai/v1/",
          ],
        }),
      ).toBe(LLM_PROVIDER_AZURE_OPENAI);
    });

    test("an Azure host with a port", () => {
      expect(
        normalizeLlmProvider({
          reported: "openai",
          addresses: ["contoso.openai.azure.com:443"],
        }),
      ).toBe(LLM_PROVIDER_AZURE_OPENAI);
    });

    test("a call that names no provider, to an Azure host, is Azure's", () => {
      expect(
        normalizeLlmProvider({
          reported: "",
          addresses: ["contoso.openai.azure.com"],
        }),
      ).toBe(LLM_PROVIDER_AZURE_OPENAI);
    });

    test("api.openai.com stays OpenAI", () => {
      expect(
        normalizeLlmProvider({
          reported: "openai",
          addresses: ["api.openai.com"],
        }),
      ).toBe(LLM_PROVIDER_OPENAI);
    });

    test("another provider's name is never replaced by the host", () => {
      expect(
        normalizeLlmProvider({
          reported: "anthropic",
          addresses: ["contoso.services.ai.azure.com"],
        }),
      ).toBe("anthropic");
    });

    test("a look-alike host is not Azure's", () => {
      for (const host of [
        "openai.azure.com.example.org",
        "evilopenai.azure.com.attacker.net",
        "openai-azure.com",
        "azure.com",
      ]) {
        expect({
          host,
          provider: normalizeLlmProvider({
            reported: "openai",
            addresses: [host],
          }),
        }).toEqual({ host, provider: LLM_PROVIDER_OPENAI });
      }
    });
  });
});

describe("getLlmEndpointHost", () => {
  test.each([
    ["contoso.openai.azure.com", "contoso.openai.azure.com"],
    ["Contoso.OpenAI.Azure.com:443", "contoso.openai.azure.com"],
    ["https://contoso.openai.azure.com/openai/v1", "contoso.openai.azure.com"],
    ["contoso.openai.azure.com/openai", "contoso.openai.azure.com"],
    ["", ""],
    ["https://", ""],
  ])("%s -> %s", (address: string, host: string) => {
    expect(getLlmEndpointHost(address)).toBe(host);
  });

  test("a value that is not text is no host", () => {
    expect(getLlmEndpointHost(undefined)).toBe("");
    expect(getLlmEndpointHost(null)).toBe("");
  });
});

describe("the AI provider an address belongs to", () => {
  test("every exact host", () => {
    for (const host of Object.keys(LLM_PROVIDER_EXACT_HOSTS)) {
      expect(getLlmProviderOfAddress(host)).toBe(LLM_PROVIDER_EXACT_HOSTS[host]);
    }
  });

  test("Vertex AI's regional and Bedrock's runtime endpoints", () => {
    expect(getLlmProviderOfAddress("us-central1-aiplatform.googleapis.com")).toBe(
      "gcp.vertex_ai",
    );
    expect(
      getLlmProviderOfAddress("bedrock-runtime.us-east-1.amazonaws.com"),
    ).toBe("aws.bedrock");
    expect(
      getLlmProviderOfAddress("bedrock-runtime-fips.us-east-1.amazonaws.com"),
    ).toBe("aws.bedrock");
  });

  test("Azure's hosts", () => {
    for (const suffix of getAzureLlmHostSuffixes()) {
      expect(getAzureLlmProviderOfAddress(`contoso${suffix}`)).not.toBe("");
      expect(getLlmProviderOfAddress(`contoso${suffix}`)).not.toBe("");
    }
  });

  test("any other host is no provider's", () => {
    for (const host of [
      "api.stripe.com",
      "s3.amazonaws.com",
      "storage.googleapis.com",
      "example.com",
      "openai.com",
    ]) {
      expect(getLlmProviderOfAddress(host)).toBe("");
    }
  });

  test("an object prototype key is no host", () => {
    expect(getLlmProviderOfAddress("constructor")).toBe("");
    expect(getLlmProviderOfAddress("__proto__")).toBe("");
  });
});

describe("titles", () => {
  test.each([
    ["openai", "OpenAI"],
    ["azure.ai.openai", "Azure OpenAI"],
    ["az.ai.openai", "Azure OpenAI"],
    ["azure.ai.inference", "Azure AI Inference"],
    ["aws.bedrock", "Amazon Bedrock"],
    ["gcp.vertex_ai", "Google Vertex AI"],
    ["anthropic", "Anthropic"],
  ])("%s reads %s", (value: string, title: string) => {
    expect(getLlmProviderTitle(value)).toBe(title);
  });

  test("a value it does not know reads as written", () => {
    expect(getLlmProviderTitle("my-gateway")).toBe("my-gateway");
    expect(getLlmProviderTitle("")).toBe("");
    expect(getLlmProviderTitle(undefined)).toBe("");
  });

  test("every provider has a title", () => {
    for (const definition of LlmProviders) {
      expect(definition.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("what a filter on a provider matches", () => {
  test("Azure OpenAI matches every spelling it was stored under", () => {
    const values: Array<string> = getLlmProviderStoredValues("azure.ai.openai");

    for (const spelling of [
      "azure.ai.openai",
      "az.ai.openai",
      "azure_openai",
      "Azure OpenAI",
    ]) {
      expect(values).toContain(spelling);
    }
  });

  test("an alias matches its provider's spellings too", () => {
    expect(getLlmProviderStoredValues("az.ai.openai")).toEqual(
      getLlmProviderStoredValues("azure.ai.openai"),
    );
  });

  test("OpenAI matches the capitalised spelling older OpenLLMetry stored", () => {
    expect(getLlmProviderStoredValues("openai")).toContain("OpenAI");
  });

  test("a value it does not know matches itself only", () => {
    expect(getLlmProviderStoredValues(" my-gateway ")).toEqual(["my-gateway"]);
  });

  test("nothing matches nothing", () => {
    expect(getLlmProviderStoredValues("")).toEqual([]);
    expect(getLlmProviderStoredValues(undefined)).toEqual([]);
  });

  test("no list repeats a value", () => {
    for (const definition of LlmProviders) {
      const values: Array<string> = getLlmProviderStoredValues(definition.name);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("the list itself", () => {
  test("every definition's aliases are not another's name", () => {
    const names: Set<string> = new Set(
      LlmProviders.map((definition: LlmProviderDefinition): string => {
        return definition.name;
      }),
    );

    for (const definition of LlmProviders) {
      for (const alias of definition.aliases) {
        expect(names.has(alias)).toBe(false);
      }
    }
  });
});
