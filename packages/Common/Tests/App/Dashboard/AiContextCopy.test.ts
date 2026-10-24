import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_CONTEXT_ACTIVITY_COPY,
  AI_CONTEXT_CARD_ANCHOR,
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_CHARACTERS_TEMPLATE,
  AI_CONTEXT_OUTLINE_BUTTON_TEXT,
  AI_CONTEXT_OUTLINE_HEADINGS,
  AI_CONTEXT_SIZE_TEMPLATE,
  AI_CONTEXT_TEST_IDS,
  AI_CONTEXT_TOKENS_TEMPLATE,
  AI_CONTEXT_TOO_LONG_TEMPLATE,
  AI_RULE_AI_CONTEXT_FIELD_COPY,
  describeAiContextActivity,
  describeAiContextActivityDetail,
  describeAiContextLeftOut,
  describeAiContextLength,
  describeAiContextSize,
  getAiContextFieldError,
  getAiContextLength,
  getAiContextOutline,
  getAiRuleAiContextFoldedValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import {
  AI_CONTEXT_RUN_MAX_CHARACTERS,
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  AiContextActivity,
  AiContextOwner,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  composeAiContext,
} from "../../../Types/AI/AiContext";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT THE DASHBOARD SAYS ABOUT THE AI CONTEXT (AISettings/AiContextCopy,
 * issue #5198), React-free: the project's card and its dialog, the AI
 * rule's field, the count and token estimate under both, and the line a
 * run's activity draws for what it read - in English and in the reader's
 * language, from the Dashboard's own locale files.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(code: string): Translator {
  const words: Record<string, string> = locale(code);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, code);
}

const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = translatorFor("de");
const RUSSIAN: Translator = translatorFor("ru");

// The two lines a card's description may run to, and a field's (ShortDescriptionsGuard).
const CARD_DESCRIPTION_LIMIT: number = 210;
const LINE_LIMIT: number = 150;

function activity(
  projectContext: string,
  ruleNames: Array<string> = [],
): AiContextActivity {
  return composeAiContext({
    projectContext,
    rules: ruleNames.map((name: string, index: number) => {
      return { id: `r${index}`, name, aiContext: `${name} notes` };
    }),
  })!;
}

describe("the card and the field say little, and say what they are for", () => {
  test("each line fits where it is drawn", () => {
    expect(AI_CONTEXT_CARD_COPY.cardDescription.length).toBeLessThanOrEqual(
      CARD_DESCRIPTION_LIMIT,
    );

    for (const line of [
      AI_CONTEXT_CARD_COPY.editModalDescription,
      AI_CONTEXT_CARD_COPY.fieldDescription,
      AI_CONTEXT_CARD_COPY.fieldPlaceholder,
      AI_RULE_AI_CONTEXT_FIELD_COPY.description,
      AI_RULE_AI_CONTEXT_FIELD_COPY.placeholder,
      AI_CONTEXT_ACTIVITY_COPY.modalDescription,
    ]) {
      expect(line.length).toBeLessThanOrEqual(LINE_LIMIT);
    }
  });

  test("the card names what OneUptime AI reads it in, and what goes in it", () => {
    expect(AI_CONTEXT_CARD_COPY.cardTitle).toBe("AI context");
    for (const word of [
      "investigation",
      "fix",
      "postmortem draft",
      "Ask AI",
      "who owns which symptom",
      "where the logs are",
    ]) {
      expect(AI_CONTEXT_CARD_COPY.cardDescription).toContain(word);
    }
  });

  test("the dialog says it is read first, and to leave secrets out - and why", () => {
    expect(AI_CONTEXT_CARD_COPY.editModalDescription).toBe(
      "OneUptime AI reads this first, before anything else. Leave secrets out: anyone who can see what it did can read it.",
    );
    expect(AI_RULE_AI_CONTEXT_FIELD_COPY.description).toContain(
      "Leave secrets out.",
    );
  });

  test("the rule's field says it is read after the project's, by what the rule starts", () => {
    expect(AI_RULE_AI_CONTEXT_FIELD_COPY.title).toBe("AI context");
    expect(AI_RULE_AI_CONTEXT_FIELD_COPY.description).toBe(
      "Notes OneUptime AI reads after the project's AI context when it investigates or fixes what this rule matches. Leave secrets out.",
    );
  });

  test("the button says what it does: add, until there are notes to edit", () => {
    expect(AI_CONTEXT_CARD_COPY.addButtonText).toBe("Add AI context");
    expect(AI_CONTEXT_CARD_COPY.editButtonText).toBe("Edit");
    expect(AI_CONTEXT_CARD_COPY.emptyText).toBe("No AI context yet.");
  });

  test("the card has its place on the page, and the parts their test ids", () => {
    expect(AI_CONTEXT_CARD_ANCHOR).toBe("ai-context");
    expect(new Set(Object.values(AI_CONTEXT_TEST_IDS)).size).toBe(
      Object.values(AI_CONTEXT_TEST_IDS).length,
    );
  });
});

describe("the count under a field: how much of its limit, and about how many tokens", () => {
  test("nothing yet: the count alone", () => {
    expect(
      describeAiContextLength(
        getAiContextLength({ value: "", owner: AiContextOwner.Project }),
        ENGLISH,
      ),
    ).toBe("0 of 20,000 characters");
    expect(
      describeAiContextLength(
        getAiContextLength({ value: undefined, owner: AiContextOwner.AiRule }),
        ENGLISH,
      ),
    ).toBe("0 of 5,000 characters");
  });

  test("written: the count against its owner's limit, and the estimate", () => {
    expect(
      describeAiContextLength(
        getAiContextLength({
          value: "a".repeat(2360),
          owner: AiContextOwner.Project,
        }),
        ENGLISH,
      ),
    ).toBe("2,360 of 20,000 characters · about 590 tokens");
    expect(
      describeAiContextLength(
        getAiContextLength({ value: "abcd", owner: AiContextOwner.AiRule }),
        ENGLISH,
      ),
    ).toBe("4 of 5,000 characters · about 1 token");
  });

  test("past the limit it says so, and the form refuses it with the count", () => {
    const tooLong: string = "a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS + 1);

    expect(
      getAiContextLength({ value: tooLong, owner: AiContextOwner.Project })
        .isTooLong,
    ).toBe(true);
    expect(
      getAiContextFieldError({
        value: tooLong,
        owner: AiContextOwner.Project,
        translator: ENGLISH,
      }),
    ).toBe("At most 20,000 characters. This has 20,001.");
    expect(
      getAiContextFieldError({
        value: "a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 1),
        owner: AiContextOwner.AiRule,
        translator: ENGLISH,
      }),
    ).toBe("At most 5,000 characters. This has 5,001.");
  });

  test("the form refuses nothing the server would save", () => {
    for (const [value, owner] of [
      ["a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS), AiContextOwner.Project],
      ["a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS), AiContextOwner.AiRule],
      [
        `  ${"a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)}  `,
        AiContextOwner.AiRule,
      ],
      ["", AiContextOwner.Project],
      [undefined, AiContextOwner.Project],
    ] as Array<[string | undefined, AiContextOwner]>) {
      expect(
        getAiContextFieldError({ value, owner, translator: ENGLISH }),
      ).toBeNull();
    }
  });

  test("in German, with the reader's way of writing numbers", () => {
    expect(
      describeAiContextLength(
        getAiContextLength({
          value: "a".repeat(2360),
          owner: AiContextOwner.Project,
        }),
        GERMAN,
      ),
    ).toBe("2.360 von 20.000 Zeichen · etwa 590 Tokens");
    expect(
      getAiContextFieldError({
        value: "a".repeat(5001),
        owner: AiContextOwner.AiRule,
        translator: GERMAN,
      }),
    ).toBe("Höchstens 5.000 Zeichen. Dieser Text hat 5.001.");
  });

  test("the plural sentences are the ones the locale files hold", () => {
    expect(AI_CONTEXT_TOKENS_TEMPLATE).toEqual({
      one: "about {{count}} token",
      other: "about {{count}} tokens",
    });
    expect(AI_CONTEXT_SIZE_TEMPLATE).toEqual({
      one: "{{count}} character",
      other: "{{count}} characters",
    });

    const english: Record<string, string> = locale("en");
    expect(english[AI_CONTEXT_TOKENS_TEMPLATE.other]).toBe(
      AI_CONTEXT_TOKENS_TEMPLATE.other,
    );
    expect(english[`${AI_CONTEXT_TOKENS_TEMPLATE.other}_one`]).toBe(
      AI_CONTEXT_TOKENS_TEMPLATE.one,
    );
    expect(english[AI_CONTEXT_CHARACTERS_TEMPLATE]).toBe(
      AI_CONTEXT_CHARACTERS_TEMPLATE,
    );
    expect(english[AI_CONTEXT_TOO_LONG_TEMPLATE]).toBe(
      AI_CONTEXT_TOO_LONG_TEMPLATE,
    );
  });
});

describe("the outline an empty field can start from", () => {
  test("a heading for each kind of note, each with a line to write on", () => {
    expect(AI_CONTEXT_OUTLINE_BUTTON_TEXT).toBe("Start from an outline");
    expect(AI_CONTEXT_OUTLINE_HEADINGS).toEqual([
      "How our systems fit together",
      "Who owns what",
      "Where the logs are",
      "Words we use",
    ]);
    expect(getAiContextOutline(ENGLISH)).toBe(
      "## How our systems fit together\n\n- \n\n## Who owns what\n\n- \n\n## Where the logs are\n\n- \n\n## Words we use\n\n- ",
    );
  });

  test("in the reader's language: the notes are theirs", () => {
    const outline: string = getAiContextOutline(GERMAN);

    expect(outline).toContain("## Wie unsere Systeme zusammenhängen");
    expect(outline).toContain("## Wem was gehört");
    expect(outline).not.toContain("Who owns what");
  });

  test("an outline fits a rule's limit, let alone the project's", () => {
    for (const code of ["en", "de", "ja", "ru", "fa"]) {
      expect(
        getAiContextLength({
          value: getAiContextOutline(
            code === "en" ? ENGLISH : translatorFor(code),
          ),
          owner: AiContextOwner.AiRule,
        }).isTooLong,
      ).toBe(false);
    }
  });
});

describe("the folded More fields line of a rule", () => {
  test("names a rule's notes by their size once written, and nothing before", () => {
    expect(getAiRuleAiContextFoldedValue("", ENGLISH)).toBeNull();
    expect(getAiRuleAiContextFoldedValue(undefined, ENGLISH)).toBeNull();
    expect(getAiRuleAiContextFoldedValue("   ", ENGLISH)).toBeNull();
    expect(getAiRuleAiContextFoldedValue("a".repeat(400), ENGLISH)).toBe(
      "about 100 tokens",
    );
    // A note too short for a whole token is still one.
    expect(getAiRuleAiContextFoldedValue("ab", ENGLISH)).toBe("about 1 token");
  });
});

describe("the line a run's activity draws for what it read", () => {
  test("the project's notes alone", () => {
    const read: AiContextActivity = activity("a".repeat(2360));

    expect(describeAiContextActivity(read, ENGLISH)).toBe(
      "Read the project's AI context",
    );
    expect(describeAiContextActivityDetail(read, ENGLISH)).toBe(
      "about 590 tokens",
    );
    expect(describeAiContextLeftOut(read, ENGLISH)).toBeNull();
  });

  test("the project's and its rules', counted", () => {
    expect(
      describeAiContextActivity(activity("notes", ["Checkout"]), ENGLISH),
    ).toBe("Read the AI context of the project and 1 AI rule");
    expect(
      describeAiContextActivity(
        activity("notes", ["Checkout", "Search"]),
        ENGLISH,
      ),
    ).toBe("Read the AI context of the project and 2 AI rules");
  });

  test("a rule's alone", () => {
    expect(describeAiContextActivity(activity("", ["Checkout"]), ENGLISH)).toBe(
      "Read the AI context of 1 AI rule",
    );
  });

  test("a rule's notes left out for the run's limit: a warning that says so", () => {
    const read: AiContextActivity = composeAiContext({
      projectContext: "p".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
      rules: ["A", "B", "C"].map((name: string) => {
        return {
          id: name,
          name,
          aiContext: name.repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        };
      }),
    })!;

    expect(read.leftOutRuleNames).toEqual(["C"]);
    expect(describeAiContextLeftOut(read, ENGLISH)).toBe(
      `Left out the AI context of 1 AI rule: a run reads at most ${AI_CONTEXT_RUN_MAX_CHARACTERS.toLocaleString("en-US")} characters of AI context`,
    );
  });

  test("in German and Russian: whole sentences, counted the reader's way", () => {
    expect(
      describeAiContextActivity(activity("notes", ["A", "B"]), GERMAN),
    ).toBe("KI-Kontext des Projekts und von 2 KI-Regeln gelesen");
    expect(describeAiContextActivity(activity("notes"), GERMAN)).toBe(
      "KI-Kontext des Projekts gelesen",
    );
    // Russian's general form reads right for any count.
    expect(
      describeAiContextActivity(
        activity("notes", ["A", "B", "C", "D", "E"]),
        RUSSIAN,
      ),
    ).toBe("Прочитан контекст ИИ проекта и правил ИИ: 5");
    expect(describeAiContextActivity(activity("notes", ["A"]), RUSSIAN)).toBe(
      "Прочитан контекст ИИ проекта и 1 правила ИИ",
    );
  });

  test("the dialog's size line: characters and tokens, no limit", () => {
    expect(describeAiContextSize("a".repeat(2360), ENGLISH)).toBe(
      "2,360 characters · about 590 tokens",
    );
    expect(describeAiContextSize("a", ENGLISH)).toBe(
      "1 character · about 1 token",
    );
  });

  test("the dialog says what it shows", () => {
    expect(AI_CONTEXT_ACTIVITY_COPY.modalTitle).toBe(
      "AI context this run read",
    );
    expect(AI_CONTEXT_ACTIVITY_COPY.viewButtonText).toBe("View");
    expect(AI_CONTEXT_ACTIVITY_COPY.projectPartTitle).toBe("Project");
    expect(AI_CONTEXT_ACTIVITY_COPY.rulePartTitle).toBe("AI rule {{name}}");
  });
});
