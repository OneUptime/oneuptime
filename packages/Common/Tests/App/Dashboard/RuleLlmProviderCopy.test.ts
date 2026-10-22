import {
  RULE_LLM_PROVIDER_ACTIVITY_LINES,
  RULE_LLM_PROVIDER_FIELD_COPY,
  RULE_LLM_PROVIDERS_PATH,
  RuleLlmProviderChoices,
  RuleLlmProviderOption,
  RuleLlmProviderPickState,
  RuleLlmProviderWork,
  UNREAD_RULE_LLM_PROVIDER_CHOICES,
  describeRuleLlmProviderActivity,
  getDefaultRuleLlmProvider,
  getRuleLlmProviderFoldedValue,
  getRuleLlmProviderOptionDescription,
  getRuleLlmProviderPickState,
  getRuleLlmProviderPlaceholder,
  getRuleLlmProviderSummary,
  getRulePickedLlmProviderId,
  readRuleLlmProviderChoices,
  withRuleLlmProviderSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
import {
  LLM_PROVIDER_ACTIVITY_TEMPLATES,
  LlmProviderActivity,
  LlmProviderFallbackReason,
  LlmProviderSource,
  describeLlmProviderActivityInEnglish,
} from "../../../Types/AI/LlmProviderChoice";
import ObjectID from "../../../Types/ObjectID";
import {
  Translator,
  createTranslator,
  getTemplatePlaceholders,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What every OneUptime AI rule's "LLM Provider" field says and knows
 * (RuleLlmProviderCopy, React-free): the providers it lists, as POST
 * /ai-chat/providers answers them; what the empty box says - the provider
 * an empty field uses, by name; what the folded More fields line says of a
 * pick, or of none; and a run's line about the provider it used, in the
 * reader's language, worded exactly as the server writes it.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Translator = createTranslator(undefined, "en");

function translatorFor(locale: string): Translator {
  const words: Record<string, string> = readLocale(locale);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, locale);
}

const OPUS: RuleLlmProviderOption = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Claude Opus",
  modelName: "claude-opus-4-5",
  isDefault: false,
  isGlobal: false,
};

const AZURE: RuleLlmProviderOption = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  name: "Azure GPT-4o",
  modelName: "gpt-4o",
  isDefault: true,
  isGlobal: false,
};

const ONEUPTIME_AI: RuleLlmProviderOption = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  name: "OneUptime AI",
  modelName: "",
  isDefault: false,
  isGlobal: true,
};

function choices(
  providers: Array<RuleLlmProviderOption>,
  defaultProviderId: string,
): RuleLlmProviderChoices {
  return { isRead: true, providers, defaultProviderId };
}

// A project with its own default, and the global provider.
const WITH_PROJECT_DEFAULT: RuleLlmProviderChoices = choices(
  [AZURE, OPUS, ONEUPTIME_AI],
  AZURE.id,
);

// A project with no default of its own: the global provider.
const ON_THE_GLOBAL: RuleLlmProviderChoices = choices(
  [OPUS, ONEUPTIME_AI],
  ONEUPTIME_AI.id,
);

describe("the providers the field lists", () => {
  test("are read from the chat's providers route, in its order", () => {
    expect(RULE_LLM_PROVIDERS_PATH).toBe("/ai-chat/providers");

    // As AIChatAPI answers: its default first, then the global ones.
    expect(
      readRuleLlmProviderChoices({
        isAIEnabledForProject: true,
        defaultProviderId: AZURE.id.toUpperCase(),
        providers: [
          {
            id: AZURE.id.toUpperCase(),
            name: " Azure GPT-4o ",
            description: null,
            llmType: "Azure OpenAI",
            modelName: "gpt-4o",
            isDefault: true,
            isGlobal: false,
          },
          {
            id: OPUS.id,
            name: "Claude Opus",
            description: "Our own key",
            llmType: "Anthropic",
            modelName: "claude-opus-4-5",
            isDefault: false,
            isGlobal: false,
          },
          {
            id: ONEUPTIME_AI.id,
            name: "OneUptime AI",
            description: null,
            llmType: "OpenAI",
            modelName: null,
            isDefault: false,
            isGlobal: true,
          },
        ],
      }),
    ).toEqual(WITH_PROJECT_DEFAULT);
  });

  test("a row with no id, or one already listed, is left out; so is what is not a row", () => {
    expect(
      readRuleLlmProviderChoices({
        defaultProviderId: null,
        providers: [
          null,
          "Claude Opus",
          { name: "No id" },
          { id: OPUS.id, name: "Claude Opus" },
          { id: OPUS.id.toUpperCase(), name: "Claude Opus again" },
        ],
      }),
    ).toEqual({
      isRead: true,
      providers: [
        {
          id: OPUS.id,
          name: "Claude Opus",
          modelName: "",
          isDefault: false,
          isGlobal: false,
        },
      ],
      defaultProviderId: "",
    });
  });

  test("an answer that is not one is no read: nothing to pick", () => {
    for (const answer of [
      null,
      undefined,
      "providers",
      [],
      {},
      { providers: "none" },
    ]) {
      expect(readRuleLlmProviderChoices(answer)).toBe(
        UNREAD_RULE_LLM_PROVIDER_CHOICES,
      );
    }

    expect(UNREAD_RULE_LLM_PROVIDER_CHOICES).toEqual({
      isRead: false,
      providers: [],
      defaultProviderId: "",
    });
  });

  test("the default is the one the project uses today, when it is listed", () => {
    expect(getDefaultRuleLlmProvider(WITH_PROJECT_DEFAULT)).toBe(AZURE);
    expect(getDefaultRuleLlmProvider(ON_THE_GLOBAL)).toBe(ONEUPTIME_AI);
    expect(getDefaultRuleLlmProvider(choices([OPUS], ""))).toBeNull();
    expect(getDefaultRuleLlmProvider(choices([OPUS], AZURE.id))).toBeNull();
    expect(getDefaultRuleLlmProvider(null)).toBeNull();
  });
});

describe("the rule's pick", () => {
  test("is read from every shape the form holds it in, lower-cased", () => {
    for (const value of [
      { llmProviderId: OPUS.id.toUpperCase() },
      { llmProviderId: new ObjectID(OPUS.id) },
      { llmProviderId: { value: OPUS.id } },
      { llmProvider: { _id: OPUS.id } },
    ]) {
      expect(getRulePickedLlmProviderId(value)).toBe(OPUS.id);
    }

    for (const value of [
      {},
      { llmProviderId: null },
      { llmProviderId: "" },
      null,
      "values",
    ]) {
      expect(getRulePickedLlmProviderId(value)).toBe("");
    }
  });

  test("stands as none, listed, hidden from the reader, or no longer available", () => {
    expect(
      getRuleLlmProviderPickState({
        pickedProviderId: "",
        choices: WITH_PROJECT_DEFAULT,
      }),
    ).toBe(RuleLlmProviderPickState.None);
    expect(
      getRuleLlmProviderPickState({
        pickedProviderId: OPUS.id,
        choices: WITH_PROJECT_DEFAULT,
      }),
    ).toBe(RuleLlmProviderPickState.Listed);
    expect(
      getRuleLlmProviderPickState({
        pickedProviderId: OPUS.id,
        choices: UNREAD_RULE_LLM_PROVIDER_CHOICES,
      }),
    ).toBe(RuleLlmProviderPickState.Hidden);
    expect(
      getRuleLlmProviderPickState({ pickedProviderId: OPUS.id, choices: null }),
    ).toBe(RuleLlmProviderPickState.Hidden);
    expect(
      getRuleLlmProviderPickState({
        pickedProviderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
        choices: WITH_PROJECT_DEFAULT,
      }),
    ).toBe(RuleLlmProviderPickState.Unavailable);
  });
});

describe("the empty box names the provider an empty field uses", () => {
  test("the project's default, by name", () => {
    expect(getRuleLlmProviderPlaceholder(WITH_PROJECT_DEFAULT, ENGLISH)).toBe(
      "Project default (Azure GPT-4o)",
    );
  });

  test("with no default of the project's own, the global provider, by name", () => {
    expect(getRuleLlmProviderPlaceholder(ON_THE_GLOBAL, ENGLISH)).toBe(
      "Global provider (OneUptime AI)",
    );
  });

  test("before the providers are read, or when they cannot be, the default", () => {
    expect(getRuleLlmProviderPlaceholder(null, ENGLISH)).toBe(
      "Default LLM provider",
    );
    expect(
      getRuleLlmProviderPlaceholder(UNREAD_RULE_LLM_PROVIDER_CHOICES, ENGLISH),
    ).toBe("Default LLM provider");
  });

  test("with no provider at all, that there is none yet", () => {
    expect(getRuleLlmProviderPlaceholder(choices([], ""), ENGLISH)).toBe(
      "No LLM provider yet",
    );
  });

  test("in the reader's language, the name as it is", () => {
    const german: Translator = translatorFor("de");
    const placeholder: string = getRuleLlmProviderPlaceholder(
      WITH_PROJECT_DEFAULT,
      german,
    );

    expect(placeholder).toContain("Azure GPT-4o");
    expect(placeholder).not.toBe("Project default (Azure GPT-4o)");
  });
});

describe("the folded More fields line", () => {
  test("names the provider a rule picks", () => {
    expect(
      getRuleLlmProviderFoldedValue(
        { llmProviderId: OPUS.id },
        WITH_PROJECT_DEFAULT,
        ENGLISH,
      ),
    ).toBe("Claude Opus");
  });

  test("says nothing of a rule that picks none: the summary names the default", () => {
    expect(
      getRuleLlmProviderFoldedValue({}, WITH_PROJECT_DEFAULT, ENGLISH),
    ).toBeNull();
    expect(
      getRuleLlmProviderSummary({}, WITH_PROJECT_DEFAULT, ENGLISH),
    ).toEqual([
      "The rule uses the project's default LLM provider, Azure GPT-4o.",
    ]);
    expect(getRuleLlmProviderSummary({}, ON_THE_GLOBAL, ENGLISH)).toEqual([
      "The rule uses the global LLM provider, OneUptime AI.",
    ]);
  });

  test("a pick the reader cannot see, or one no longer available, says so", () => {
    expect(
      getRuleLlmProviderFoldedValue(
        { llmProviderId: OPUS.id },
        UNREAD_RULE_LLM_PROVIDER_CHOICES,
        ENGLISH,
      ),
    ).toBe("A provider you cannot see");
    expect(
      getRuleLlmProviderFoldedValue(
        { llmProviderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9" },
        WITH_PROJECT_DEFAULT,
        ENGLISH,
      ),
    ).toBe("No longer available");
  });

  test("the summary says nothing while the rule picks one, or with no provider known", () => {
    expect(
      getRuleLlmProviderSummary(
        { llmProviderId: OPUS.id },
        WITH_PROJECT_DEFAULT,
        ENGLISH,
      ),
    ).toEqual([]);
    expect(getRuleLlmProviderSummary({}, null, ENGLISH)).toEqual([]);
    expect(
      getRuleLlmProviderSummary({}, UNREAD_RULE_LLM_PROVIDER_CHOICES, ENGLISH),
    ).toEqual([]);
    expect(getRuleLlmProviderSummary({}, choices([], ""), ENGLISH)).toEqual([]);
  });

  test("the provider sentence comes first: what OneUptime AI thinks with, before what it may use", () => {
    expect(
      withRuleLlmProviderSummary(
        ["Any runbook may be run."],
        {},
        WITH_PROJECT_DEFAULT,
        ENGLISH,
      ),
    ).toEqual([
      "The rule uses the project's default LLM provider, Azure GPT-4o.",
      "Any runbook may be run.",
    ]);
    expect(
      withRuleLlmProviderSummary(
        ["Any runbook may be run."],
        { llmProviderId: OPUS.id },
        WITH_PROJECT_DEFAULT,
        ENGLISH,
      ),
    ).toEqual(["Any runbook may be run."]);
    expect(
      withRuleLlmProviderSummary(undefined, {}, ON_THE_GLOBAL, ENGLISH),
    ).toEqual(["The rule uses the global LLM provider, OneUptime AI."]);
    expect(
      withRuleLlmProviderSummary(undefined, {}, null, ENGLISH),
    ).toBeUndefined();
    expect(withRuleLlmProviderSummary([], {}, null, ENGLISH)).toBeUndefined();
  });
});

describe("what a provider says beside its name", () => {
  test("the project's default, a global one, and its model", () => {
    expect(getRuleLlmProviderOptionDescription(AZURE, ENGLISH)).toBe(
      "Project default · gpt-4o",
    );
    expect(getRuleLlmProviderOptionDescription(ONEUPTIME_AI, ENGLISH)).toBe(
      "Global",
    );
    expect(getRuleLlmProviderOptionDescription(OPUS, ENGLISH)).toBe(
      "claude-opus-4-5",
    );
    expect(
      getRuleLlmProviderOptionDescription({ ...OPUS, modelName: "" }, ENGLISH),
    ).toBe("");
  });
});

describe("a run's line about its provider", () => {
  const ACTIVITIES: Array<LlmProviderActivity> = [
    { source: LlmProviderSource.RulePick, providerName: "Claude Opus" },
    {
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    },
    {
      source: LlmProviderSource.Global,
      providerName: "OneUptime AI",
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    },
    { fallbackReason: LlmProviderFallbackReason.Unavailable },
    {
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
    },
    {
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.SpendLimitReached,
    },
  ];

  test("is worded exactly as the server writes it", () => {
    expect(RULE_LLM_PROVIDER_ACTIVITY_LINES).toEqual(
      LLM_PROVIDER_ACTIVITY_TEMPLATES,
    );

    for (const activity of ACTIVITIES) {
      expect(describeRuleLlmProviderActivity(activity, ENGLISH)).toBe(
        describeLlmProviderActivityInEnglish(activity),
      );
    }
  });

  test.each(LANGUAGES)(
    "reads in %s, with the provider's name as it is",
    (locale: string) => {
      const translator: Translator = translatorFor(locale);

      for (const activity of ACTIVITIES) {
        const line: string = describeRuleLlmProviderActivity(
          activity,
          translator,
        );

        expect(line).not.toBe(describeLlmProviderActivityInEnglish(activity));
        expect(line).not.toContain("{{");

        if (activity.providerName) {
          expect(line).toContain(activity.providerName);
        }
      }
    },
  );
});

describe("every word the field adds is every language's own", () => {
  const SENTENCES: Array<string> = [
    RULE_LLM_PROVIDER_FIELD_COPY.title,
    ...Object.values(RULE_LLM_PROVIDER_FIELD_COPY.descriptions),
    RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultPlaceholder,
    RULE_LLM_PROVIDER_FIELD_COPY.globalPlaceholder,
    RULE_LLM_PROVIDER_FIELD_COPY.defaultPlaceholder,
    RULE_LLM_PROVIDER_FIELD_COPY.noProviderPlaceholder,
    RULE_LLM_PROVIDER_FIELD_COPY.manageHint,
    RULE_LLM_PROVIDER_FIELD_COPY.llmProvidersPage,
    RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultTag,
    RULE_LLM_PROVIDER_FIELD_COPY.globalTag,
    RULE_LLM_PROVIDER_FIELD_COPY.hiddenProvider,
    RULE_LLM_PROVIDER_FIELD_COPY.unavailableProvider,
    RULE_LLM_PROVIDER_FIELD_COPY.unavailableWarning,
    RULE_LLM_PROVIDER_FIELD_COPY.projectDefaultSummary,
    RULE_LLM_PROVIDER_FIELD_COPY.globalSummary,
    ...Object.values(RULE_LLM_PROVIDER_ACTIVITY_LINES),
  ];

  test("the field's own line says what it does for each kind of rule", () => {
    expect(RULE_LLM_PROVIDER_FIELD_COPY.descriptions).toEqual({
      [RuleLlmProviderWork.Investigate]:
        "OneUptime AI investigates with the default LLM provider. Pick one to use another for this rule.",
      [RuleLlmProviderWork.Fix]:
        "OneUptime AI fixes with the default LLM provider, pull requests included. Pick one to use another for this rule.",
      [RuleLlmProviderWork.DraftPostmortem]:
        "OneUptime AI drafts with the default LLM provider. Pick one to use another for this rule.",
    });
  });

  test("English holds each as it is written", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect(english[sentence]).toBe(sentence);
    }
  });

  test.each(LANGUAGES)(
    "%s has its own wording for each, with the same placeholders",
    (locale: string) => {
      const words: Record<string, string> = readLocale(locale);

      for (const sentence of SENTENCES) {
        const translated: string | undefined = words[sentence];

        expect(translated).toBeDefined();
        expect(translated!.trim().length).toBeGreaterThan(0);
        // A proper name may stay as it is; a sentence may not.
        if (sentence.split(" ").length > 2) {
          expect(translated).not.toBe(sentence);
        }
        expect(getTemplatePlaceholders(translated!).sort()).toEqual(
          getTemplatePlaceholders(sentence).sort(),
        );
      }
    },
  );
});
