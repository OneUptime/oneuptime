import {
  LLM_PROVIDER_ACTIVITY_TEMPLATES,
  LlmProviderActivity,
  getLlmProviderActivityTemplate,
  readLlmProviderId,
} from "Common/Types/AI/LlmProviderChoice";
import {
  Translator,
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A RULE'S "LLM PROVIDER" FIELD SAYS, AND WHAT IT KNOWS - React-free,
 * so the rule tables, the field (RuleLlmProviderField) and App's tests read
 * the same words and the same rule.
 *
 * Every OneUptime AI rule - investigation, auto remediation, postmortem,
 * and the AI rules of the telemetry products after them - has this field
 * under its More fields. The maintainer: "If the provider is not selected,
 * select the project LLM provider by default if one is set to default, or
 * you can select the global LLM provider as well. If one is selected, use
 * that LLM provider to do everything." So the field starts empty, and empty
 * says which provider that is: "Project default (Azure GPT-4o)" in the box,
 * and the same on the folded More fields line. The rule itself - the pick,
 * else the project's default, else the global provider - is
 * Common/Types/AI/LlmProviderChoice.
 *
 * The providers come from POST /ai-chat/providers (the chat's provider
 * switcher reads the same): the project's own, its default first, then the
 * global ones, and which of them the project uses today.
 */

// What the field's description says OneUptime AI does with the provider.
export enum RuleLlmProviderWork {
  Investigate = "Investigate",
  Fix = "Fix",
  DraftPostmortem = "DraftPostmortem",
}

export const RULE_LLM_PROVIDER_FIELD_COPY: {
  title: string;
  descriptions: Record<RuleLlmProviderWork, string>;
  projectDefaultPlaceholder: string;
  globalPlaceholder: string;
  defaultPlaceholder: string;
  noProviderPlaceholder: string;
  manageHint: string;
  llmProvidersPage: string;
  projectDefaultTag: string;
  globalTag: string;
  hiddenProvider: string;
  unavailableProvider: string;
  unavailableWarning: string;
  projectDefaultSummary: string;
  globalSummary: string;
} = {
  title: translationKey("LLM Provider"),
  descriptions: {
    [RuleLlmProviderWork.Investigate]: translationKey(
      "OneUptime AI investigates with the default LLM provider. Pick one to use another for this rule.",
    ),
    [RuleLlmProviderWork.Fix]: translationKey(
      "OneUptime AI fixes with the default LLM provider, pull requests included. Pick one to use another for this rule.",
    ),
    [RuleLlmProviderWork.DraftPostmortem]: translationKey(
      "OneUptime AI drafts with the default LLM provider. Pick one to use another for this rule.",
    ),
  },
  // In the empty box: the provider an empty field uses, by name.
  projectDefaultPlaceholder: translationKey("Project default ({{provider}})"),
  globalPlaceholder: translationKey("Global provider ({{provider}})"),
  // In the empty box while the providers are not known.
  defaultPlaceholder: translationKey("Default LLM provider"),
  noProviderPlaceholder: translationKey("No LLM provider yet"),
  manageHint: translationKey(
    "Add and manage providers on the {{llmProvidersLink}} page.",
  ),
  llmProvidersPage: translationKey("LLM Providers"),
  // Beside a provider in the list.
  projectDefaultTag: translationKey("Project default"),
  globalTag: translationKey("Global"),
  /*
   * A provider the rule picks that the reader may not see (they may not
   * read the project's providers), and one the project can no longer use.
   */
  hiddenProvider: translationKey("A provider you cannot see"),
  unavailableProvider: translationKey("No longer available"),
  unavailableWarning: translationKey(
    "OneUptime AI can no longer use this provider, so it uses the default instead. Pick another one, or clear it.",
  ),
  // On the folded More fields line while the rule picks none.
  projectDefaultSummary: translationKey(
    "The rule uses the project's default LLM provider, {{provider}}.",
  ),
  globalSummary: translationKey(
    "The rule uses the global LLM provider, {{provider}}.",
  ),
};

// The data-testids of the field.
export const RULE_LLM_PROVIDER_PICKER_TEST_ID: string =
  "rule-llm-provider-picker";

export const RULE_LLM_PROVIDER_LOADING_TEST_ID: string =
  "rule-llm-provider-loading";

export const RULE_LLM_PROVIDER_HINT_TEST_ID: string = "rule-llm-provider-hint";

export const RULE_LLM_PROVIDER_WARNING_TEST_ID: string =
  "rule-llm-provider-warning";

// Where the field reads the providers (Common/Server/API/AIChatAPI).
export const RULE_LLM_PROVIDERS_PATH: string = "/ai-chat/providers";

// One provider the field lists.
export interface RuleLlmProviderOption {
  // Lower-case, as a rule holds its pick.
  id: string;
  name: string;
  // The model it is set to: shown beside it, when it names one.
  modelName: string;
  // The project's default provider.
  isDefault: boolean;
  // A global provider, shared with every project.
  isGlobal: boolean;
}

export interface RuleLlmProviderChoices {
  /*
   * Whether the providers were read. False when the reader may not read
   * them or the read failed: nothing to pick, and a rule's pick is kept,
   * named as one they cannot see.
   */
  isRead: boolean;
  // The project's providers, its default first, then the global ones.
  providers: Array<RuleLlmProviderOption>;
  // The provider the project uses today, "" for none: its default, else a global one.
  defaultProviderId: string;
}

export const UNREAD_RULE_LLM_PROVIDER_CHOICES: RuleLlmProviderChoices = {
  isRead: false,
  providers: [],
  defaultProviderId: "",
};

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * The field's choices from POST /ai-chat/providers' answer, in its order:
 * the project's own providers, its default first, then the global ones.
 */
export function readRuleLlmProviderChoices(
  answer: unknown,
): RuleLlmProviderChoices {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return UNREAD_RULE_LLM_PROVIDER_CHOICES;
  }

  const data: Record<string, unknown> = answer as Record<string, unknown>;
  const rows: unknown = data["providers"];

  if (!Array.isArray(rows)) {
    return UNREAD_RULE_LLM_PROVIDER_CHOICES;
  }

  const providers: Array<RuleLlmProviderOption> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const provider: Record<string, unknown> = row as Record<string, unknown>;
    const id: string = readLlmProviderId(provider["id"]);

    if (
      !id ||
      providers.some((known: RuleLlmProviderOption): boolean => {
        return known.id === id;
      })
    ) {
      continue;
    }

    providers.push({
      id,
      name: readText(provider["name"]).trim(),
      modelName: readText(provider["modelName"]).trim(),
      isDefault: provider["isDefault"] === true,
      isGlobal: provider["isGlobal"] === true,
    });
  }

  return {
    isRead: true,
    providers,
    defaultProviderId: readLlmProviderId(data["defaultProviderId"]),
  };
}

// The provider the rule being edited picks, from the form's values: "" for none.
export function getRulePickedLlmProviderId(values: unknown): string {
  if (!values || typeof values !== "object") {
    return "";
  }

  const rule: { llmProviderId?: unknown; llmProvider?: unknown } = values as {
    llmProviderId?: unknown;
    llmProvider?: unknown;
  };

  return (
    readLlmProviderId(rule.llmProviderId) || readLlmProviderId(rule.llmProvider)
  );
}

// The provider a rule that picks none uses, or null when there is none (or it is not known).
export function getDefaultRuleLlmProvider(
  choices: RuleLlmProviderChoices | null,
): RuleLlmProviderOption | null {
  if (!choices || !choices.defaultProviderId) {
    return null;
  }

  return (
    choices.providers.find((provider: RuleLlmProviderOption): boolean => {
      return provider.id === choices.defaultProviderId;
    }) || null
  );
}

// Where the rule being edited stands with its pick.
export enum RuleLlmProviderPickState {
  // It picks none: the default provider.
  None = "None",
  // It picks one of the providers listed.
  Listed = "Listed",
  // It picks one the reader was not shown: they may not read the providers.
  Hidden = "Hidden",
  // It picks one the project can no longer use (read, and not among them).
  Unavailable = "Unavailable",
}

export function getRuleLlmProviderPickState(data: {
  pickedProviderId: string;
  choices: RuleLlmProviderChoices | null;
}): RuleLlmProviderPickState {
  if (!data.pickedProviderId) {
    return RuleLlmProviderPickState.None;
  }

  if (!data.choices || !data.choices.isRead) {
    return RuleLlmProviderPickState.Hidden;
  }

  return data.choices.providers.some(
    (provider: RuleLlmProviderOption): boolean => {
      return provider.id === data.pickedProviderId;
    },
  )
    ? RuleLlmProviderPickState.Listed
    : RuleLlmProviderPickState.Unavailable;
}

/*
 * What the empty box says: the provider an empty field uses, by name -
 * "Project default (Azure GPT-4o)", "Global provider (OneUptime AI)" - or,
 * before the providers are read, "Default provider".
 */
export function getRuleLlmProviderPlaceholder(
  choices: RuleLlmProviderChoices | null,
  translator: Translator = getGlobalTranslator(),
): string {
  if (!choices || !choices.isRead) {
    return translator.translateText(
      RULE_LLM_PROVIDER_FIELD_COPY.defaultPlaceholder,
    ) as string;
  }

  const defaultProvider: RuleLlmProviderOption | null =
    getDefaultRuleLlmProvider(choices);

  if (!defaultProvider) {
    return translator.translateText(
      RULE_LLM_PROVIDER_FIELD_COPY.noProviderPlaceholder,
    ) as string;
  }

  return translator.translateTemplate(
    defaultProvider.isGlobal
      ? RULE_LLM_PROVIDER_FIELD_COPY.globalPlaceholder
      : RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultPlaceholder,
    { provider: defaultProvider.name },
  );
}

/*
 * What the folded More fields line says after "LLM Provider" while the rule
 * picks one: its name - or that the reader cannot see it, or that it is no
 * longer available. Null while it picks none: the summary says which
 * provider that is (getRuleLlmProviderSummary).
 */
export function getRuleLlmProviderFoldedValue(
  values: unknown,
  choices: RuleLlmProviderChoices | null,
  translator: Translator = getGlobalTranslator(),
): string | null {
  const pickedProviderId: string = getRulePickedLlmProviderId(values);

  switch (getRuleLlmProviderPickState({ pickedProviderId, choices })) {
    case RuleLlmProviderPickState.None:
      return null;
    case RuleLlmProviderPickState.Hidden:
      return translator.translateText(
        RULE_LLM_PROVIDER_FIELD_COPY.hiddenProvider,
      ) as string;
    case RuleLlmProviderPickState.Unavailable:
      return translator.translateText(
        RULE_LLM_PROVIDER_FIELD_COPY.unavailableProvider,
      ) as string;
    default:
      return (
        choices!.providers.find((provider: RuleLlmProviderOption): boolean => {
          return provider.id === pickedProviderId;
        })?.name || null
      );
  }
}

/*
 * The sentence the folded More fields line says while the rule picks no
 * provider: which provider OneUptime AI uses instead, by name, in the
 * reader's language. Nothing while the rule picks one (the line names it),
 * or while there is no provider or it is not known: the AI settings page
 * says so at its top.
 */
export function getRuleLlmProviderSummary(
  values: unknown,
  choices: RuleLlmProviderChoices | null,
  translator: Translator = getGlobalTranslator(),
): Array<string> {
  if (getRulePickedLlmProviderId(values)) {
    return [];
  }

  const defaultProvider: RuleLlmProviderOption | null =
    getDefaultRuleLlmProvider(choices);

  if (!defaultProvider) {
    return [];
  }

  return [
    translator.translateTemplate(
      defaultProvider.isGlobal
        ? RULE_LLM_PROVIDER_FIELD_COPY.globalSummary
        : RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultSummary,
      { provider: defaultProvider.name },
    ),
  ];
}

/*
 * A rule form's More fields summary with the provider sentence first, as
 * the field comes first in the section: what the rest of the section's
 * defaults say follows. Undefined when there is nothing to say.
 */
export function withRuleLlmProviderSummary(
  sentences: Array<string> | undefined,
  values: unknown,
  choices: RuleLlmProviderChoices | null,
  translator: Translator = getGlobalTranslator(),
): Array<string> | undefined {
  const all: Array<string> = [
    ...getRuleLlmProviderSummary(values, choices, translator),
    ...(sentences || []),
  ];

  return all.length > 0 ? all : undefined;
}

/*
 * A run's line about its LLM provider, in its activity (ChatActivityFeed):
 * the words the server writes (Common/Types/AI/LlmProviderChoice
 * LLM_PROVIDER_ACTIVITY_TEMPLATES - a test holds the two equal), here so
 * the Dashboard's translations know them, and looked up in the reader's
 * language.
 */
export const RULE_LLM_PROVIDER_ACTIVITY_LINES: typeof LLM_PROVIDER_ACTIVITY_TEMPLATES =
  {
    rulePick: translationKey("Using {{provider}}, the rule's LLM provider"),
    unavailableToProjectDefault: translationKey(
      "Using {{provider}}, the project's default LLM provider: the rule's provider is no longer available",
    ),
    unavailableToGlobal: translationKey(
      "Using {{provider}}, the global LLM provider: the rule's provider is no longer available",
    ),
    unavailableToNone: translationKey(
      "No LLM provider to use: the rule's provider is no longer available",
    ),
    creditsUsedUp: translationKey(
      "Using {{provider}}, the project's default LLM provider: the rule's provider uses AI credits, and they are used up",
    ),
    spendLimitReached: translationKey(
      "Using {{provider}}, the project's default LLM provider: the daily AI spend limit stops the rule's provider",
    ),
  };

// A run's line about its LLM provider, in the reader's language.
export function describeRuleLlmProviderActivity(
  activity: LlmProviderActivity,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translateTemplate(
    getLlmProviderActivityTemplate(activity),
    { provider: activity.providerName || "" },
  );
}

/*
 * What a provider says beside its name in the list: the project's default,
 * a global one, and the model it is set to - "Project default · gpt-4o".
 */
export function getRuleLlmProviderOptionDescription(
  provider: RuleLlmProviderOption,
  translator: Translator = getGlobalTranslator(),
): string {
  const parts: Array<string> = [];

  if (provider.isDefault && !provider.isGlobal) {
    parts.push(
      translator.translateText(
        RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultTag,
      ) as string,
    );
  }

  if (provider.isGlobal) {
    parts.push(
      translator.translateText(RULE_LLM_PROVIDER_FIELD_COPY.globalTag) as string,
    );
  }

  if (provider.modelName) {
    parts.push(provider.modelName);
  }

  return parts.join(" · ");
}
