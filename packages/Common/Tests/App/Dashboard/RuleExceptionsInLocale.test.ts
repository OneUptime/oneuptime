import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as RuleExceptionsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import * as RetrohuntCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionProblem,
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
  getDetectionRuleExceptionProblems,
} from "../../../Types/SecurityEvent/DetectionRuleException";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * EVERY WORD OF RULE EXCEPTIONS AND RUN ON PAST EVENTS IS EVERY LANGUAGE'S
 * OWN: the list, the form and its problems (the shared rules' own
 * sentences), the line under a rule's name, the run's answer - read from
 * the Dashboard's locale files themselves, so a key that lost its
 * translation, kept the English or dropped a placeholder is caught.
 *
 * And a rule exception never borrows the Exceptions product's words: "{{count}}
 * exceptions" is an error a service threw in some languages (Chinese words
 * the two apart), so the line under a rule's name has words of its own.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Japanese, Korean and Chinese read no "one" form: theirs may say the same.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

function isPlural(value: unknown): value is PluralTemplate {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
}

// The sentences a module exports, and its plural sentences; test ids aside.
function wordsOf(module: Record<string, unknown>): {
  sentences: Array<string>;
  plurals: Array<PluralTemplate>;
} {
  const sentences: Array<string> = [];
  const plurals: Array<PluralTemplate> = [];

  for (const [name, value] of Object.entries(module)) {
    if (name.endsWith("TEST_IDS")) {
      continue;
    }

    if (typeof value === "string") {
      sentences.push(value);
    } else if (isPlural(value)) {
      plurals.push(value);
    }
  }

  return { sentences, plurals };
}

const EXCEPTION_WORDS: {
  sentences: Array<string>;
  plurals: Array<PluralTemplate>;
} = wordsOf(RuleExceptionsCopy as unknown as Record<string, unknown>);
const RETROHUNT_WORDS: {
  sentences: Array<string>;
  plurals: Array<PluralTemplate>;
} = wordsOf(RetrohuntCopy as unknown as Record<string, unknown>);

/*
 * Every problem the shared rules can answer with, found by asking about
 * an exception wrong in each way the form can be.
 */
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const WRONG: Array<DetectionRuleExceptionShape> = [
  { kind: "nothing" },
  { kind: DetectionRuleExceptionKind.Entity, entityType: "Spaceship" },
  { kind: DetectionRuleExceptionKind.Entity, value: "*" },
  { kind: DetectionRuleExceptionKind.Entity, value: "x".repeat(501) },
  {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.IpAddress,
    value: "10.0.0.0/99",
  },
  { kind: DetectionRuleExceptionKind.Value },
  { kind: DetectionRuleExceptionKind.Value, fieldName: "f".repeat(101) },
  { kind: DetectionRuleExceptionKind.Value, fieldName: "a b", value: "x" },
  { kind: DetectionRuleExceptionKind.TimeWindow },
  {
    kind: DetectionRuleExceptionKind.TimeWindow,
    startsAt: NOW,
    endsAt: NOW,
  },
  {
    kind: DetectionRuleExceptionKind.TimeWindow,
    startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000),
  },
  {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.User,
    value: "a",
    expiresAt: "soon",
    reason: "r".repeat(501),
  },
  {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.User,
    value: "a",
    expiresAt: new Date(NOW.getTime() - 1),
  },
];

const PROBLEMS: Array<string> = Array.from(
  new Set(
    WRONG.flatMap((exception: DetectionRuleExceptionShape): Array<string> => {
      return getDetectionRuleExceptionProblems(exception, {
        now: NOW,
        isExpiryNew: true,
      }).map((problem: DetectionRuleExceptionProblem): string => {
        return problem.message;
      });
    }),
  ),
).sort();

const MODEL: DetectionRuleException = new DetectionRuleException();

/*
 * A row's status pill: the status itself, looked up as a key (Upcoming was
 * still English in thirteen languages, a time window's pill said so).
 */
const STATUSES: Array<string> = Object.values(DetectionRuleExceptionStatus);

const SENTENCES: Array<string> = Array.from(
  new Set([
    ...EXCEPTION_WORDS.sentences,
    ...RETROHUNT_WORDS.sentences,
    ...PROBLEMS,
    ...STATUSES,
    MODEL.singularName!,
    MODEL.pluralName!,
    MODEL.tableDescription!,
  ]),
);

const PLURALS: Array<PluralTemplate> = [
  ...EXCEPTION_WORDS.plurals,
  ...RETROHUNT_WORDS.plurals,
];

// Written the same in some languages: a code example, an e.g. of one.
const MAY_STAY_AS_WRITTEN: Array<string> = ["e.g. processName"];

// A word some languages write as English does: Status, in German and its neighbours.
const SAME_WORD_IN: Record<string, Array<string>> = {
  Status: ["de", "pt", "nl", "da", "no", "sv"],
};

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("the words there are", () => {
  test("every problem the form can show, each a sentence of its own", () => {
    expect(PROBLEMS).toEqual(
      [
        "A field name has no spaces: principalUser, processName or an attribute key such as http.user_agent.",
        "A field name is at most 100 characters.",
        "A reason is at most 500 characters.",
        "A value is at most 500 characters.",
        "A value of only * would skip everything. To stop the rule, turn it off.",
        "A window is at most 30 days. To stop a rule for longer, turn it off.",
        "An exception expires in the future. To stop one now, delete it.",
        "Choose the kind of entity: a user, a host or an IP address.",
        "Choose what the rule skips: an entity, a value or a time window.",
        "Enter an address, a range such as 10.20.0.0/16, or a pattern with *.",
        "Enter the event field to match, such as processName.",
        "Enter the user, host or address the rule skips.",
        "Enter the value the rule skips.",
        "Enter when the exception expires, or leave it empty.",
        "Enter when the window ends.",
        "Enter when the window starts.",
        "Say why it is safe for the rule to skip this.",
        "The window must end after it starts.",
      ].sort(),
    );
  });

  test("a row's status is one of four", () => {
    expect(STATUSES).toEqual(["Active", "Expired", "Upcoming", "Ended"]);
  });

  test("the list's, the form's and the run's words, and their plurals", () => {
    expect(EXCEPTION_WORDS.sentences.length).toBeGreaterThan(40);
    expect(RETROHUNT_WORDS.sentences.length).toBeGreaterThan(20);
    expect(PLURALS.length).toBeGreaterThanOrEqual(11);
  });
});

describe("English holds every sentence under its own words", () => {
  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    expect(ENGLISH[plural.other]).toBe(plural.other);
    expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
  });
});

describe.each(LANGUAGES)("%s words every sentence", (language: string) => {
  const locale: Record<string, string> = LOCALES[language]!;

  test.each(SENTENCES)("%s", (sentence: string) => {
    const translated: string | undefined = locale[sentence];

    expect(translated).toBeDefined();
    expect(translated!.trim().length).toBeGreaterThan(0);

    if (
      !MAY_STAY_AS_WRITTEN.includes(sentence) &&
      !(SAME_WORD_IN[sentence] || []).includes(language)
    ) {
      expect(translated).not.toBe(sentence);
    }

    expect(placeholders(translated!)).toEqual(placeholders(sentence));
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    const other: string | undefined = locale[plural.other];
    const one: string | undefined = locale[`${plural.other}_one`];

    expect(other).toBeDefined();
    expect(one).toBeDefined();
    expect(other).not.toBe(plural.other);
    expect(placeholders(other!)).toEqual(placeholders(plural.other));

    if (!WITHOUT_ONE_FORM.includes(language)) {
      expect(one).not.toBe(plural.one);
      expect(placeholders(one!)).toEqual(placeholders(plural.one));
    }
  });
});

describe("a rule exception's words are its own", () => {
  test("the count under a rule's name is not the Exceptions product's count", () => {
    expect(RuleExceptionsCopy.ACTIVE_EXCEPTION_COUNT.other).not.toBe(
      "{{count}} exceptions",
    );
    expect(RuleExceptionsCopy.ACTIVE_EXCEPTION_COUNT).toEqual({
      one: "{{count}} active exception",
      other: "{{count}} active exceptions",
    });
  });

  test("the list names a row a Rule Exception, never a bare Exception", () => {
    for (const sentence of [
      ...EXCEPTION_WORDS.sentences,
      MODEL.singularName!,
      MODEL.pluralName!,
    ]) {
      expect(sentence).not.toBe("Exception");
      expect(sentence).not.toBe("Exceptions");
    }
  });

  test("Chinese says rule exceptions with 例外, the way it says an exemption", () => {
    for (const language of ["zh-CN", "zh-TW"]) {
      const locale: Record<string, string> = LOCALES[language]!;

      expect(locale["Rule Exceptions"]).toContain("例外");
      expect(locale["Add Exception"]).toContain("例外");
      expect(locale["{{count}} active exceptions"]).toContain("例外");
      expect(locale["Rule Exceptions"]).not.toContain("异常");
    }
  });
});
