import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  AI_CONTEXT_RUN_MAX_CHARACTERS,
  AiContextActivity,
  AiContextOwner,
  countAiContextCharacters,
  estimateAiContextTokens,
  getAiContextMaxCharacters,
  getAiContextRuleParts,
  hasProjectAiContext,
} from "Common/Types/AI/AiContext";

/*
 * What the Dashboard says about the AI context (Common/Types/AI/AiContext,
 * issue #5198): the project's card in Project Settings → AI → AI Features,
 * the field under an AI rule's More fields, and the line a run's activity
 * draws for what it read. React-free, so App's tests read it too.
 *
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it, and is translated where it is drawn.
 */

// The project's card, and the dialog its button opens.
export const AI_CONTEXT_CARD_COPY: {
  cardTitle: string;
  cardDescription: string;
  emptyText: string;
  addButtonText: string;
  editButtonText: string;
  editModalTitle: string;
  editModalDescription: string;
  fieldTitle: string;
  fieldDescription: string;
  fieldPlaceholder: string;
  showAllText: string;
  showLessText: string;
} = {
  cardTitle: translationKey("AI context"),
  cardDescription: translationKey(
    "What OneUptime AI should know about your systems: what depends on what, who owns which symptom, where the logs are. It reads this in every investigation, fix, postmortem draft and Ask AI chat.",
  ),
  emptyText: translationKey("No AI context yet."),
  addButtonText: translationKey("Add AI context"),
  editButtonText: translationKey("Edit"),
  editModalTitle: translationKey("AI context"),
  editModalDescription: translationKey(
    "OneUptime AI reads this first, before anything else. Leave secrets out: anyone who can see what it did can read it.",
  ),
  fieldTitle: translationKey("What OneUptime AI should know"),
  fieldDescription: translationKey(
    "How your systems fit together, who owns which symptom, where the logs are, and the words your team uses. Markdown.",
  ),
  fieldPlaceholder: translationKey(
    "For example: checkout-api serves the checkout page and depends on payments-db.",
  ),
  showAllText: translationKey("Show all"),
  showLessText: translationKey("Show less"),
};

// The field under an AI rule's More fields, after the LLM provider.
export const AI_RULE_AI_CONTEXT_FIELD_COPY: {
  title: string;
  description: string;
  placeholder: string;
} = {
  title: translationKey("AI context"),
  description: translationKey(
    "Notes OneUptime AI reads after the project's AI context when it investigates or fixes what this rule matches. Leave secrets out.",
  ),
  placeholder: translationKey(
    "For example: checkout's logs are in Loki under app=checkout, and payments-db is its database.",
  ),
};

/*
 * The outline "Start from an outline" puts in an empty field: a heading for
 * each kind of note teams keep for their own people - how the systems fit
 * together, who owns what, where the logs are, the words they use.
 */
export const AI_CONTEXT_OUTLINE_BUTTON_TEXT: string = translationKey(
  "Start from an outline",
);

export const AI_CONTEXT_OUTLINE_HEADINGS: ReadonlyArray<string> = [
  translationKey("How our systems fit together"),
  translationKey("Who owns what"),
  translationKey("Where the logs are"),
  translationKey("Words we use"),
];

// The outline, with its headings in the reader's language.
export function getAiContextOutline(translator: Translator): string {
  return AI_CONTEXT_OUTLINE_HEADINGS.map((heading: string): string => {
    return `## ${translator.translateText(heading) || heading}\n\n- `;
  }).join("\n\n");
}

// "1,234 of 20,000 characters": how much of the limit the text takes.
export const AI_CONTEXT_CHARACTERS_TEMPLATE: string = translationKey(
  "{{count}} of {{max}} characters",
);

// "about 310 tokens": what the text costs a model to read, as estimated.
export const AI_CONTEXT_TOKENS_TEMPLATE: PluralTemplate = {
  one: "about {{count}} token",
  other: "about {{count}} tokens",
};

// "2,340 characters": how long a text a run read is.
export const AI_CONTEXT_SIZE_TEMPLATE: PluralTemplate = {
  one: "{{count}} character",
  other: "{{count}} characters",
};

// "2,340 characters · about 590 tokens": what a run read, and its cost.
export function describeAiContextSize(
  text: string,
  translator: Translator,
): string {
  const characterCount: number = countAiContextCharacters(text.trim());
  const tokens: number = estimateAiContextTokens(text);
  const characters: string = translator.translatePlural(
    AI_CONTEXT_SIZE_TEMPLATE,
    characterCount,
  );

  if (tokens === 0) {
    return characters;
  }

  return `${characters} · ${translator.translatePlural(
    AI_CONTEXT_TOKENS_TEMPLATE,
    tokens,
  )}`;
}

// The form's refusal of a text past its limit.
export const AI_CONTEXT_TOO_LONG_TEMPLATE: string = translationKey(
  "At most {{max}} characters. This has {{count}}.",
);

// What the text takes of its owner's limit, and what it costs to read.
export interface AiContextLength {
  characterCount: number;
  maxCharacters: number;
  estimatedTokenCount: number;
  isTooLong: boolean;
}

export function getAiContextLength(data: {
  value: unknown;
  owner: AiContextOwner;
}): AiContextLength {
  const text: string = typeof data.value === "string" ? data.value.trim() : "";
  const characterCount: number = countAiContextCharacters(text);
  const maxCharacters: number = getAiContextMaxCharacters(data.owner);

  return {
    characterCount,
    maxCharacters,
    estimatedTokenCount: estimateAiContextTokens(text),
    isTooLong: characterCount > maxCharacters,
  };
}

// "1,234 of 20,000 characters · about 310 tokens", in the reader's language.
export function describeAiContextLength(
  length: AiContextLength,
  translator: Translator,
): string {
  const characters: string = translator.translateTemplate(
    AI_CONTEXT_CHARACTERS_TEMPLATE,
    {
      count: translator.formatNumber(length.characterCount),
      max: translator.formatNumber(length.maxCharacters),
    },
  );

  if (length.estimatedTokenCount === 0) {
    return characters;
  }

  return `${characters} · ${translator.translatePlural(
    AI_CONTEXT_TOKENS_TEMPLATE,
    length.estimatedTokenCount,
  )}`;
}

/*
 * Why the form cannot save the text, in the reader's language, or null:
 * the same limit the server holds it to (getAiContextProblem).
 */
export function getAiContextFieldError(data: {
  value: unknown;
  owner: AiContextOwner;
  translator: Translator;
}): string | null {
  const length: AiContextLength = getAiContextLength(data);

  if (!length.isTooLong) {
    return null;
  }

  return data.translator.translateTemplate(AI_CONTEXT_TOO_LONG_TEMPLATE, {
    max: data.translator.formatNumber(length.maxCharacters),
    count: data.translator.formatNumber(length.characterCount),
  });
}

/*
 * The folded More fields line names a rule's AI context, set or not set,
 * by its size alone: "AI context: about 310 tokens".
 */
export function getAiRuleAiContextFoldedValue(
  value: unknown,
  translator: Translator,
): string | null {
  const length: AiContextLength = getAiContextLength({
    value,
    owner: AiContextOwner.AiRule,
  });

  if (length.characterCount === 0) {
    return null;
  }

  return translator.translatePlural(
    AI_CONTEXT_TOKENS_TEMPLATE,
    Math.max(1, length.estimatedTokenCount),
  );
}

// The line a run's activity draws for what it read, and its button.
export const AI_CONTEXT_ACTIVITY_COPY: {
  projectOnly: string;
  projectAndRules: PluralTemplate;
  rulesOnly: PluralTemplate;
  leftOut: PluralTemplate;
  viewButtonText: string;
  modalTitle: string;
  modalDescription: string;
  projectPartTitle: string;
  rulePartTitle: string;
  closeButtonText: string;
} = {
  projectOnly: translationKey("Read the project's AI context"),
  projectAndRules: {
    one: "Read the AI context of the project and {{count}} AI rule",
    other: "Read the AI context of the project and {{count}} AI rules",
  },
  rulesOnly: {
    one: "Read the AI context of {{count}} AI rule",
    other: "Read the AI context of {{count}} AI rules",
  },
  leftOut: {
    one: "Left out the AI context of {{count}} AI rule: a run reads at most {{max}} characters of AI context",
    other: "Left out the AI context of {{count}} AI rules: a run reads at most {{max}} characters of AI context",
  },
  viewButtonText: translationKey("View"),
  modalTitle: translationKey("AI context this run read"),
  modalDescription: translationKey(
    "OneUptime AI read this first, before anything else in the run.",
  ),
  projectPartTitle: translationKey("Project"),
  rulePartTitle: translationKey("AI rule {{name}}"),
  closeButtonText: translationKey("Close"),
};

// "Read the AI context of the project and 2 AI rules", in the reader's language.
export function describeAiContextActivity(
  activity: AiContextActivity,
  translator: Translator,
): string {
  const ruleCount: number = getAiContextRuleParts(activity).length;

  if (!hasProjectAiContext(activity)) {
    return translator.translatePlural(
      AI_CONTEXT_ACTIVITY_COPY.rulesOnly,
      ruleCount,
    );
  }

  if (ruleCount === 0) {
    return (
      translator.translateText(AI_CONTEXT_ACTIVITY_COPY.projectOnly) ||
      AI_CONTEXT_ACTIVITY_COPY.projectOnly
    );
  }

  return translator.translatePlural(
    AI_CONTEXT_ACTIVITY_COPY.projectAndRules,
    ruleCount,
  );
}

// The line's detail: "about 590 tokens".
export function describeAiContextActivityDetail(
  activity: AiContextActivity,
  translator: Translator,
): string {
  return translator.translatePlural(
    AI_CONTEXT_TOKENS_TEMPLATE,
    Math.max(1, activity.estimatedTokenCount),
  );
}

// The warning when a rule's AI context did not fit, or null.
export function describeAiContextLeftOut(
  activity: AiContextActivity,
  translator: Translator,
): string | null {
  const leftOutCount: number = (activity.leftOutRuleNames || []).length;

  if (leftOutCount === 0) {
    return null;
  }

  return translator.translatePlural(
    AI_CONTEXT_ACTIVITY_COPY.leftOut,
    leftOutCount,
    { max: translator.formatNumber(AI_CONTEXT_RUN_MAX_CHARACTERS) },
  );
}

/*
 * The card's place on the AI Features page (Card id, Utils/PageAnchor):
 * ".../settings/ai-features#ai-context" lands on it - where the AI rule
 * field's line and a run's AI context dialog send people to change it.
 */
export const AI_CONTEXT_CARD_ANCHOR: string = "ai-context";

// Test ids the card, the field and the activity's line are found by.
export const AI_CONTEXT_TEST_IDS: {
  card: string;
  view: string;
  empty: string;
  length: string;
  outlineButton: string;
  toggle: string;
  ruleField: string;
  activityViewButton: string;
  activityModalPart: string;
} = {
  card: "project-ai-context-card",
  view: "project-ai-context-view",
  empty: "project-ai-context-empty",
  length: "ai-context-length",
  outlineButton: "ai-context-outline-button",
  toggle: "project-ai-context-toggle",
  ruleField: "auto-remediation-ai-context-field",
  activityViewButton: "ai-context-activity-view-button",
  activityModalPart: "ai-context-activity-part",
};
