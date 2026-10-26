import IconProp from "../../../Types/Icon/IconProp";
import LlmType from "../../../Types/LLM/LlmType";
import LlmProviderEndpoint from "../../../Utils/LLM/LlmProviderEndpoint";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";

/*
 * WHAT EACH LLM PROVIDER NEEDS, IN THE WORDS ITS FORM USES.
 *
 * The form that adds an LLM provider - Project Settings > AI > LLM
 * Providers, a provider's own page, and the Admin Dashboard's Global LLM
 * Providers - asked for a name first, then showed every field every
 * provider has: an API Key "required for OpenAI, Azure OpenAI / Microsoft
 * Foundry, Anthropic, Groq and Mistral", a Model Name explained for Azure,
 * a Base URL whose help was about Azure and whose placeholder was Ollama's.
 * Somebody adding Ollama read about Azure keys; somebody adding OpenAI was
 * asked for a Base URL OpenAI does not need.
 *
 * Now the provider comes first, one card each with what it is in a line,
 * and the next step asks only what that provider uses, with the help for
 * that provider under each field (LlmProviderFormFields). This module says,
 * for each provider type, what the server reads (Common/Server/Utils/LLM/
 * LLMService): which fields it needs, which it never reads, and the model it
 * asks for when Model Name is left blank. Tests hold every fact here to the
 * service.
 *
 * Kept free of React so App's tests can read it. Every sentence is wrapped
 * in translationKey() so npm run i18n:extract finds it.
 */

// Whether the provider needs a field, can take it, or never reads it.
export enum LlmProviderFieldNeed {
  Required = "Required",
  Optional = "Optional",
  NotUsed = "NotUsed",
}

export interface LlmProviderTypeCopy {
  // The card's title: the provider as every list names it.
  title: string;
  // The card's line: what it is, in a few words.
  description: string;
  icon: IconProp;
  /*
   * The name a new provider of this type starts with, followed until a
   * name of one's own is typed: a brand, never translated.
   */
  defaultName: string;
  apiKey: LlmProviderFieldNeed;
  /*
   * Required: the provider has no address of its own (Azure, Ollama, a
   * server of yours). Optional: it has one, and a Base URL only sends its
   * requests elsewhere (a proxy, a gateway).
   */
  baseUrl: LlmProviderFieldNeed;
  modelName: LlmProviderFieldNeed;
  /*
   * The model the server asks for when Model Name is left blank (LLMService
   * defaultModels, ANTHROPIC_DEFAULT_MODEL, AZURE_OPENAI_DEFAULT_DEPLOYMENT,
   * Ollama's llama3.1). None for an OpenAI-compatible server, which has no
   * default of its own: a blank Model Name asks it for the models it serves
   * and uses the first (defaultModelLabel).
   */
  defaultModel?: string | undefined;
  /*
   * What a provider's page and list say for a blank Model Name when no one
   * model can be named in advance: the server's choice, in words.
   */
  defaultModelLabel?: string | undefined;
  // The address the server sends requests to when Base URL is left blank.
  defaultBaseUrl?: string | undefined;
  // The line under API Key: where to get one.
  apiKeyHint?: string | undefined;
  // The line under the Connection step's Base URL: what address to give.
  baseUrlHint?: string | undefined;
  /*
   * The line under Model Name: what to type there, or the model the server
   * asks for when it is left blank ({{model}}).
   */
  modelNameHint: string;
}

// The providers, in the order the form offers them: the most used first.
export const LLM_PROVIDER_TYPES: ReadonlyArray<LlmType> = [
  LlmType.OpenAI,
  LlmType.Anthropic,
  LlmType.AzureOpenAI,
  LlmType.Groq,
  LlmType.Mistral,
  LlmType.Ollama,
  LlmType.OpenAICompatible,
];

export const LLM_PROVIDER_TYPE_COPY: Record<LlmType, LlmProviderTypeCopy> = {
  [LlmType.OpenAI]: {
    title: "OpenAI",
    description: translationKey("GPT models, with an API key from OpenAI."),
    icon: IconProp.Sparkles,
    defaultName: "OpenAI",
    apiKey: LlmProviderFieldNeed.Required,
    baseUrl: LlmProviderFieldNeed.Optional,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "gpt-5.1",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyHint: translationKey(
      "Create one at platform.openai.com, under API keys.",
    ),
    modelNameHint: translationKey("Leave empty for {{model}}."),
  },
  [LlmType.Anthropic]: {
    title: "Anthropic",
    description: translationKey(
      "Claude models, with an API key from Anthropic.",
    ),
    icon: IconProp.ChatBubbleLeftRight,
    defaultName: "Anthropic",
    apiKey: LlmProviderFieldNeed.Required,
    baseUrl: LlmProviderFieldNeed.Optional,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "claude-sonnet-5-5",
    defaultBaseUrl: LlmProviderEndpoint.ANTHROPIC_DEFAULT_BASE_URL,
    apiKeyHint: translationKey(
      "Create one at console.anthropic.com, under API Keys.",
    ),
    modelNameHint: translationKey("Leave empty for {{model}}."),
  },
  [LlmType.AzureOpenAI]: {
    title: "Azure OpenAI / Microsoft Foundry",
    description: translationKey(
      "Models you deploy in Azure: OpenAI models, Foundry Models and Claude.",
    ),
    icon: IconProp.Cloud,
    defaultName: "Azure OpenAI",
    apiKey: LlmProviderFieldNeed.Required,
    baseUrl: LlmProviderFieldNeed.Required,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "gpt-4o",
    apiKeyHint: translationKey(
      "KEY 1 or KEY 2, from your resource's Keys and Endpoint page.",
    ),
    baseUrlHint: translationKey(
      "Your resource's endpoint, such as https://<resource>.openai.azure.com/openai/v1, or https://<resource>.services.ai.azure.com/anthropic for Claude.",
    ),
    /*
     * Not "Leave empty for gpt-4o": left empty, a Claude deployment
     * (a Base URL on the resource's /anthropic API) is asked for Anthropic's
     * default instead (getLlmProviderDefaultModel), and a deployment is
     * named by whoever made it.
     */
    modelNameHint: translationKey(
      "Your deployment's name, exactly as Foundry shows it.",
    ),
  },
  [LlmType.Groq]: {
    title: "Groq",
    description: translationKey("Fast open models, with an API key from Groq."),
    icon: IconProp.Bolt,
    defaultName: "Groq",
    apiKey: LlmProviderFieldNeed.Required,
    baseUrl: LlmProviderFieldNeed.Optional,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    apiKeyHint: translationKey(
      "Create one at console.groq.com, under API Keys.",
    ),
    modelNameHint: translationKey("Leave empty for {{model}}."),
  },
  [LlmType.Mistral]: {
    title: "Mistral",
    description: translationKey(
      "Mistral's models, with an API key from Mistral.",
    ),
    // Brain draws the Sparkles path: OpenAI's card would look the same.
    icon: IconProp.GlobeEuropeAfrica,
    defaultName: "Mistral",
    apiKey: LlmProviderFieldNeed.Required,
    baseUrl: LlmProviderFieldNeed.Optional,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "mistral-large-latest",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    apiKeyHint: translationKey(
      "Create one at console.mistral.ai, under API Keys.",
    ),
    modelNameHint: translationKey("Leave empty for {{model}}."),
  },
  [LlmType.Ollama]: {
    title: "Ollama",
    description: translationKey("Open models you run yourself. No API key."),
    icon: IconProp.ComputerDesktop,
    defaultName: "Ollama",
    apiKey: LlmProviderFieldNeed.NotUsed,
    baseUrl: LlmProviderFieldNeed.Required,
    modelName: LlmProviderFieldNeed.Optional,
    defaultModel: "llama3.1",
    baseUrlHint: translationKey(
      "An address the OneUptime server can reach, such as http://ollama:11434. Not localhost.",
    ),
    modelNameHint: translationKey(
      "A model you pulled into Ollama. Leave empty for {{model}}.",
    ),
  },
  [LlmType.OpenAICompatible]: {
    title: "OpenAI-Compatible (vLLM, LocalAI, etc.)",
    description: translationKey(
      "Any server with an OpenAI-style API, such as vLLM or LocalAI.",
    ),
    icon: IconProp.ServerStack,
    defaultName: "OpenAI-compatible",
    apiKey: LlmProviderFieldNeed.Optional,
    baseUrl: LlmProviderFieldNeed.Required,
    /*
     * Left blank, the server is asked for the models it serves and the
     * first is used (LLMService.getOpenAICompatibleServedModel): the one
     * model a vLLM server serves.
     */
    modelName: LlmProviderFieldNeed.Optional,
    defaultModelLabel: translationKey("First model the server lists"),
    apiKeyHint: translationKey("Only if your server asks for one."),
    baseUrlHint: translationKey(
      "Your server's OpenAI-style API, such as http://vllm:8000/v1. Not localhost.",
    ),
    modelNameHint: translationKey(
      "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
    ),
  },
};

/*
 * The provider a form value names, or null for none (or one this version
 * does not know).
 */
export function readLlmType(value: unknown): LlmType | null {
  return typeof value === "string" &&
    (Object.values(LlmType) as Array<string>).includes(value)
    ? (value as LlmType)
    : null;
}

export function getLlmProviderTypeCopy(
  value: unknown,
): LlmProviderTypeCopy | null {
  const type: LlmType | null = readLlmType(value);

  return type ? LLM_PROVIDER_TYPE_COPY[type] : null;
}

// Whether the provider reads an API key at all (Ollama never does).
export function takesApiKey(value: unknown): boolean {
  const copy: LlmProviderTypeCopy | null = getLlmProviderTypeCopy(value);

  return Boolean(copy && copy.apiKey !== LlmProviderFieldNeed.NotUsed);
}

// Whether the server refuses to run the provider without an API key.
export function needsApiKey(value: unknown): boolean {
  return (
    getLlmProviderTypeCopy(value)?.apiKey === LlmProviderFieldNeed.Required
  );
}

/*
 * Whether the provider has no address of its own, so the server refuses it
 * without a Base URL. One with an address of its own takes a Base URL only
 * to be reached through a proxy.
 */
export function needsBaseUrl(value: unknown): boolean {
  return (
    getLlmProviderTypeCopy(value)?.baseUrl === LlmProviderFieldNeed.Required
  );
}

// Whether the server refuses to run the provider without a Model Name.
export function needsModelName(value: unknown): boolean {
  return (
    getLlmProviderTypeCopy(value)?.modelName === LlmProviderFieldNeed.Required
  );
}

/*
 * The model the server asks a provider for when its Model Name is left
 * blank (LLMService): the provider type's default - or, for Azure OpenAI /
 * Microsoft Foundry pointed at the resource's Claude API (a Base URL on
 * /anthropic), Anthropic's, as that request goes on the Anthropic wire.
 */
export function getLlmProviderDefaultModel(data: {
  llmType: unknown;
  baseUrl?: string | undefined | null;
}): string | undefined {
  const type: LlmType | null = readLlmType(data.llmType);

  if (!type) {
    return undefined;
  }

  if (
    type === LlmType.AzureOpenAI &&
    data.baseUrl &&
    LlmProviderEndpoint.isAnthropicApiBaseUrl(data.baseUrl)
  ) {
    return LLM_PROVIDER_TYPE_COPY[LlmType.Anthropic].defaultModel;
  }

  return LLM_PROVIDER_TYPE_COPY[type].defaultModel;
}

/*
 * A provider's Model Name or Base URL as its page shows it: what was typed,
 * or - left blank - what the server uses instead, by name ("gpt-5.1
 * (default)"), or a dash when there is nothing to say.
 */
export const LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE: string =
  translationKey("{{name}} (default)");

export function getLlmProviderShownValue(data: {
  value: string | undefined | null;
  defaultValue: string | undefined;
  translator: Translator;
}): string {
  const value: string = (data.value || "").trim();

  if (value) {
    return value;
  }

  if (data.defaultValue) {
    return data.translator.translateTemplate(
      LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE,
      { name: data.defaultValue },
    );
  }

  return "-";
}

/*
 * A provider's Model Name as its page and its list show it: what was typed,
 * or - left blank - the model the server asks for ("gpt-5.1 (default)"),
 * or what it does instead where no model can be named in advance ("First
 * model the server lists", for an OpenAI-compatible server).
 */
export function getLlmProviderShownModelName(data: {
  modelName: string | undefined | null;
  llmType: unknown;
  baseUrl?: string | undefined | null;
  translator: Translator;
}): string {
  const defaultModel: string | undefined = getLlmProviderDefaultModel({
    llmType: data.llmType,
    baseUrl: data.baseUrl,
  });
  const defaultModelLabel: string | undefined = getLlmProviderTypeCopy(
    data.llmType,
  )?.defaultModelLabel;

  if (!(data.modelName || "").trim() && !defaultModel && defaultModelLabel) {
    return (
      data.translator.translateText(defaultModelLabel) || defaultModelLabel
    );
  }

  return getLlmProviderShownValue({
    value: data.modelName,
    defaultValue: defaultModel,
    translator: data.translator,
  });
}

export const LlmProviderFormCopy: {
  readonly providerStepTitle: string;
  readonly connectionStepTitle: string;
  readonly providerFieldTitle: string;
  readonly nameDescription: string;
  readonly namePlaceholder: string;
  readonly descriptionPlaceholder: string;
  readonly optionalBaseUrlHint: string;
  readonly baseUrlNoKeys: string;
  readonly defaultDescription: string;
  readonly additionalParametersDescription: string;
} = {
  providerStepTitle: translationKey("Provider"),
  connectionStepTitle: translationKey("Connection"),
  providerFieldTitle: translationKey("LLM Provider"),
  nameDescription: translationKey(
    "Named after the provider until you type a name of your own.",
  ),
  namePlaceholder: translationKey("e.g. Production OpenAI"),
  descriptionPlaceholder: translationKey("What this provider is for."),
  /*
   * Under Base URL, for a provider with an address of its own: the field is
   * only for reaching it through a proxy, and empty means its own API.
   */
  optionalBaseUrlHint: translationKey(
    "Only to go through a proxy or a gateway. Leave empty for {{provider}}'s own API: {{url}}.",
  ),
  /*
   * After every Base URL hint: more of the project may read a provider's
   * Base URL than its API key (LlmProvider's read lists), so a key written
   * into the address would be read by them.
   */
  baseUrlNoKeys: translationKey("Never put keys here."),
  defaultDescription: translationKey(
    "AI features in this project use this provider.",
  ),
  additionalParametersDescription: translationKey(
    'Extra JSON parameters sent to the provider with every request, such as {"temperature": 0.2}. Leave empty unless your model needs them.',
  ),
};
