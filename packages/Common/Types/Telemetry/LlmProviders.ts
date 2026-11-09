/*
 * WHICH AI PROVIDER A CALL WENT TO, NAMED ONE WAY.
 *
 * Instrumentations name the provider of an AI call three ways:
 *
 *   - gen_ai.provider.name, the GenAI conventions' current attribute, with
 *     well-known values (openai, azure.ai.openai, azure.ai.inference,
 *     anthropic, aws.bedrock, gcp.vertex_ai ...);
 *   - gen_ai.system, the attribute it replaced, whose older values differ:
 *     Azure's AI Inference SDK sends az.ai.inference, Semantic Kernel and
 *     older SDKs az.ai.openai or azure_openai, older OpenLLMetry "OpenAI";
 *   - nothing Azure-specific at all: the OpenAI SDKs' instrumentations
 *     (OpenAI .NET, the OpenTelemetry JavaScript instrumentation, OpenLLMetry
 *     for a Microsoft Foundry endpoint) say "openai" for a call to an Azure
 *     OpenAI or Foundry resource, and only the address they called
 *     (server.address, OpenLLMetry's gen_ai.openai.api_base) says Azure.
 *
 * So the same Azure OpenAI deployment showed under four provider names, a
 * budget on one of them missed the others, and Usage by provider split one
 * account into rows nobody could add up. Ingest now stores the
 * conventions' name (normalizeLlmProvider), the Dashboard shows its title
 * (getLlmProviderTitle), and a filter on a provider matches every spelling
 * it was ever stored under (getLlmProviderStoredValues) - rows ingested
 * before this kept what their instrumentation sent.
 *
 * A value this list does not know is kept as it was sent.
 */

export interface LlmProviderDefinition {
  // The conventions' well-known gen_ai.provider.name value.
  name: string;
  // What the product calls it.
  title: string;
  // Other spellings instrumentations send, lower case.
  aliases: Array<string>;
}

export const LLM_PROVIDER_OPENAI: string = "openai";
export const LLM_PROVIDER_AZURE_OPENAI: string = "azure.ai.openai";
export const LLM_PROVIDER_AZURE_AI_INFERENCE: string = "azure.ai.inference";

export const LlmProviders: Array<LlmProviderDefinition> = [
  { name: LLM_PROVIDER_OPENAI, title: "OpenAI", aliases: [] },
  {
    name: LLM_PROVIDER_AZURE_OPENAI,
    title: "Azure OpenAI",
    aliases: [
      "az.ai.openai",
      "azure_openai",
      "azure-openai",
      "azure.openai",
      "azureopenai",
      "azure",
    ],
  },
  {
    name: LLM_PROVIDER_AZURE_AI_INFERENCE,
    title: "Azure AI Inference",
    aliases: ["az.ai.inference", "azure_ai_inference", "azure-ai-inference"],
  },
  { name: "anthropic", title: "Anthropic", aliases: [] },
  {
    name: "aws.bedrock",
    title: "Amazon Bedrock",
    aliases: ["aws_bedrock", "aws-bedrock", "bedrock"],
  },
  {
    name: "gcp.vertex_ai",
    title: "Google Vertex AI",
    aliases: ["vertex_ai", "vertexai", "gcp.vertexai"],
  },
  { name: "gcp.gemini", title: "Gemini API", aliases: ["gemini"] },
  { name: "gcp.gen_ai", title: "Google Gen AI", aliases: [] },
  { name: "cohere", title: "Cohere", aliases: [] },
  { name: "deepseek", title: "DeepSeek", aliases: [] },
  { name: "groq", title: "Groq", aliases: [] },
  {
    name: "ibm.watsonx.ai",
    title: "IBM watsonx.ai",
    aliases: ["ibm_watsonx_ai", "watsonx"],
  },
  {
    name: "mistral_ai",
    title: "Mistral AI",
    aliases: ["mistralai", "mistral"],
  },
  { name: "perplexity", title: "Perplexity", aliases: [] },
  { name: "x_ai", title: "xAI", aliases: ["xai"] },
  // Sent by tools OneUptime reads, outside the conventions' list.
  { name: "github", title: "GitHub", aliases: [] },
  { name: "microsoft.copilot", title: "Microsoft 365 Copilot", aliases: [] },
  { name: "openrouter", title: "OpenRouter", aliases: [] },
  { name: "ollama", title: "Ollama", aliases: [] },
];

const DEFINITION_BY_SPELLING: Map<string, LlmProviderDefinition> = new Map<
  string,
  LlmProviderDefinition
>();

for (const definition of LlmProviders) {
  DEFINITION_BY_SPELLING.set(definition.name, definition);

  for (const alias of definition.aliases) {
    DEFINITION_BY_SPELLING.set(alias, definition);
  }
}

/*
 * The hosts of Azure's AI services, by the provider a call to them is. A
 * call to one of them is an Azure call whatever the SDK names it. The
 * leading dot keeps a look-alike such as evil-openai.azure.com.example.org
 * from matching. Azure Government (.us) and Azure in China (.cn) included.
 */
const AZURE_OPENAI_HOST_SUFFIXES: Array<string> = [
  ".openai.azure.com",
  ".openai.azure.us",
  ".openai.azure.cn",
  ".cognitiveservices.azure.com",
  ".cognitiveservices.azure.us",
  ".cognitiveservices.azure.cn",
  // A Microsoft Foundry (AI Services) resource's own endpoint.
  ".services.ai.azure.com",
  ".services.ai.azure.us",
];

const AZURE_AI_INFERENCE_HOST_SUFFIXES: Array<string> = [
  // Foundry serverless and managed compute endpoints.
  ".models.ai.azure.com",
  ".inference.ai.azure.com",
];

function findDefinition(
  value: string | undefined | null,
): LlmProviderDefinition | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return DEFINITION_BY_SPELLING.get(value.trim().toLowerCase());
}

/*
 * The host of an address: a bare host ("x.openai.azure.com:443") or a URL
 * ("https://x.openai.azure.com/openai/v1"). "" when it is neither.
 */
export function getLlmEndpointHost(address: string | undefined | null): string {
  if (typeof address !== "string") {
    return "";
  }

  const trimmed: string = address.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return "";
    }
  }

  // host, host:port, or [ipv6]:port - the part before the first "/".
  const hostAndPort: string = trimmed.split("/")[0] || "";

  if (hostAndPort.startsWith("[")) {
    return hostAndPort.slice(0, hostAndPort.indexOf("]") + 1);
  }

  return hostAndPort.split(":")[0] || "";
}

function hasSuffix(host: string, suffixes: Array<string>): boolean {
  return suffixes.some((suffix: string): boolean => {
    return host.endsWith(suffix);
  });
}

/*
 * The public endpoints of the other providers, for telling an AI call that
 * no GenAI instrumentation recorded (an HTTP client span to
 * api.openai.com) from any other outgoing call.
 */
export const LLM_PROVIDER_EXACT_HOSTS: Record<string, string> = {
  "api.openai.com": LLM_PROVIDER_OPENAI,
  "api.anthropic.com": "anthropic",
  "generativelanguage.googleapis.com": "gcp.gemini",
  "aiplatform.googleapis.com": "gcp.vertex_ai",
  "api.mistral.ai": "mistral_ai",
  "api.cohere.com": "cohere",
  "api.cohere.ai": "cohere",
  "api.groq.com": "groq",
  "api.deepseek.com": "deepseek",
  "api.x.ai": "x_ai",
  "api.perplexity.ai": "perplexity",
  "openrouter.ai": "openrouter",
};

// Vertex AI's regional endpoints: us-central1-aiplatform.googleapis.com.
export const VERTEX_AI_REGIONAL_HOST_SUFFIX: string =
  "-aiplatform.googleapis.com";

// Bedrock's runtime endpoints: bedrock-runtime(-fips).<region>.amazonaws.com.
export const BEDROCK_RUNTIME_HOST_PREFIX: string = "bedrock-runtime";
export const AMAZON_HOST_SUFFIX: string = ".amazonaws.com";

// Every suffix of an Azure AI host, for the readers that match hosts in SQL.
export function getAzureLlmHostSuffixes(): Array<string> {
  return [...AZURE_OPENAI_HOST_SUFFIXES, ...AZURE_AI_INFERENCE_HOST_SUFFIXES];
}

/*
 * The provider whose API an address is, by its host; "" for any other
 * host. A call to one of them that is not an AI / LLM span is an AI call
 * no GenAI instrumentation recorded.
 */
export function getLlmProviderOfAddress(
  address: string | undefined | null,
): string {
  const azure: string = getAzureLlmProviderOfAddress(address);

  if (azure) {
    return azure;
  }

  const host: string = getLlmEndpointHost(address);

  if (!host) {
    return "";
  }

  if (Object.prototype.hasOwnProperty.call(LLM_PROVIDER_EXACT_HOSTS, host)) {
    return LLM_PROVIDER_EXACT_HOSTS[host] || "";
  }

  if (host.endsWith(VERTEX_AI_REGIONAL_HOST_SUFFIX)) {
    return "gcp.vertex_ai";
  }

  if (
    host.startsWith(BEDROCK_RUNTIME_HOST_PREFIX) &&
    host.endsWith(AMAZON_HOST_SUFFIX)
  ) {
    return "aws.bedrock";
  }

  return "";
}

// The Azure provider a call to this address is; "" when it is not Azure's.
export function getAzureLlmProviderOfAddress(
  address: string | undefined | null,
): string {
  const host: string = getLlmEndpointHost(address);

  if (!host) {
    return "";
  }

  if (hasSuffix(host, AZURE_OPENAI_HOST_SUFFIXES)) {
    return LLM_PROVIDER_AZURE_OPENAI;
  }

  if (hasSuffix(host, AZURE_AI_INFERENCE_HOST_SUFFIXES)) {
    return LLM_PROVIDER_AZURE_AI_INFERENCE;
  }

  return "";
}

/*
 * The provider of a call as the conventions name it.
 *
 *   - A known spelling becomes the conventions' name ("az.ai.openai" and
 *     "azure_openai" become "azure.ai.openai", "OpenAI" becomes "openai").
 *   - A call the SDK calls "openai" (or names no provider) that went to an
 *     Azure AI host is the Azure provider of that host: the OpenAI SDKs say
 *     "openai" when they call an Azure OpenAI or Foundry resource.
 *   - Anything else is kept as it was sent, trimmed.
 *
 * `addresses` are what the span says it called, in any order:
 * server.address, OpenLLMetry's gen_ai.openai.api_base.
 */
export function normalizeLlmProvider(data: {
  reported: string | undefined | null;
  addresses?: Array<string | undefined | null> | undefined;
}): string {
  const reported: string =
    typeof data.reported === "string" ? data.reported.trim() : "";
  const definition: LlmProviderDefinition | undefined =
    findDefinition(reported);
  const name: string = definition ? definition.name : reported;

  if (name === "" || name === LLM_PROVIDER_OPENAI) {
    for (const address of data.addresses || []) {
      const azure: string = getAzureLlmProviderOfAddress(address);

      if (azure) {
        return azure;
      }
    }
  }

  return name;
}

// What the product calls a provider; the value itself when it is not known.
export function getLlmProviderTitle(value: string | undefined | null): string {
  const definition: LlmProviderDefinition | undefined = findDefinition(value);

  if (definition) {
    return definition.title;
  }

  return typeof value === "string" ? value.trim() : "";
}

/*
 * Every value a provider can be stored under: its name, its aliases, and
 * the spellings ingest kept before it named providers one way ("OpenAI").
 * A filter on a provider matches all of them, so a budget on Azure OpenAI
 * counts the calls stored as az.ai.openai before the upgrade too. A value
 * this list does not know matches itself only.
 */
export function getLlmProviderStoredValues(
  value: string | undefined | null,
): Array<string> {
  const trimmed: string = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    return [];
  }

  const definition: LlmProviderDefinition | undefined = findDefinition(trimmed);

  if (!definition) {
    return [trimmed];
  }

  return Array.from(
    new Set<string>([
      definition.name,
      ...definition.aliases,
      definition.title,
      trimmed,
    ]),
  );
}
