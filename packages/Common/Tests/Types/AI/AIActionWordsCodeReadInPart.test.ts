import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AIActionSentence,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  getAIActionSentenceLanguage,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import { createTranslator, Translator } from "../../../Types/Translator";
import { describeCodeFilesUnseenForPerson } from "../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import {
  CodeFileUnseen,
  CodeFileUnseenFinding,
} from "../../../Types/CodeRepository/CodeFileSeen";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ISSUE #6330: THE CARD'S LINE FOR A FILE ASK AI READ ONLY PART OF, IN
 * EVERY READER'S LANGUAGE.
 *
 * A plural sentence of the module - one file, or several, counted - that
 * every Dashboard language words whole. The files go in as data, the first
 * three named and the rest counted, and a language lists them its own way.
 * It names no branch and no line numbers: the card's title names the
 * branch, and the model is told the lines.
 */

const PLURAL: typeof AI_ACTION_PLURAL_LINES.codeFilesReadInPart =
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart;

const FILES: Array<string> = [
  "src/billing/charge.ts",
  "src/billing/refund.ts",
  "README.md",
  "docs/setup.md",
  "package.json",
];

// The card's line for `count` files read in part.
const lineOf: (count: number) => AIActionSentence = (
  count: number,
): AIActionSentence => {
  return describeCodeFilesUnseenForPerson({
    branchName: "fix/login",
    findings: FILES.slice(0, count).map(
      (filePath: string): CodeFileUnseenFinding => {
        return {
          filePath,
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 2000,
          linesNotRead: [{ first: 1, last: 339 }],
        };
      },
    ),
  })[0]!;
};

describe("the English the model, the exports and older readers get", () => {
  test.each<[number, string]>([
    [
      1,
      "Ask AI read only part of this file, and its version replaces all of it: src/billing/charge.ts.",
    ],
    [
      2,
      "Ask AI read only part of these 2 files, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts.",
    ],
    [
      5,
      "Ask AI read only part of these 5 files, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts, README.md, 2 more files.",
    ],
  ])("%d file(s)", (count: number, english: string) => {
    expect(describeAIActionSentence(lineOf(count))).toBe(english);
  });

  test("a sentence of the module, which the Dashboard trusts", () => {
    expect(AI_ACTION_PLURAL_SENTENCES).toContain(PLURAL);

    for (const count of [1, 2, 5]) {
      expect(isKnownAIActionSentence(lineOf(count))).toBe(true);
    }
  });

  test("English holds it as itself, its one form under _one", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english[PLURAL.other]).toBe(PLURAL.other);
    expect(english[`${PLURAL.other}_one`]).toBe(PLURAL.one);
    expect(english[PLURAL.one]).toBe(PLURAL.one);
  });

  test("names no branch and no line numbers: the title names the branch, and the model is told the lines", () => {
    const english: string = describeAIActionSentence(lineOf(1));

    expect(english).not.toContain("fix/login");
    expect(english).not.toContain("339");
    expect(placeholdersOf(PLURAL.other)).toEqual(
      placeholdersOf("{{count}} {{files}}"),
    );
  });
});

describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);
  const words: Record<string, string> = readDashboardLocale(language);

  test("words it, one file and several, with its placeholders and the files as written", () => {
    for (const key of [PLURAL.other, `${PLURAL.other}_one`, PLURAL.one]) {
      expect({
        key,
        worded: isWordedInDashboardLocale(key, language),
      }).toEqual({
        key,
        worded: true,
      });
    }

    expect(placeholdersOf(words[PLURAL.other]!)).toEqual(
      placeholdersOf(PLURAL.other),
    );
    expect(placeholdersOf(words[`${PLURAL.other}_one`]!)).toEqual(
      placeholdersOf(PLURAL.one),
    );
    // The one-file sentence on its own reads as the plural's one form.
    expect(words[PLURAL.one]).toBe(words[`${PLURAL.other}_one`]);

    for (const count of [1, 2, 5]) {
      const sentence: AIActionSentence = lineOf(count);
      const drawn: string = describeAIActionSentence(sentence, translator);

      expect(drawn).toContain("src/billing/charge.ts");
      expect(drawn).not.toContain("{{");
      expect(drawn).not.toContain("Ask AI");
      expect(drawn).not.toContain("read only part");
      expect(drawn).not.toContain(describeAIActionSentence(sentence));
      expect(getAIActionSentenceLanguage(sentence, translator)).toBe(language);
    }
  });

  test("names the files it counts rather than writes out, in its own words", () => {
    const drawn: string = describeAIActionSentence(lineOf(5), translator);

    expect(drawn).toContain("README.md");
    expect(drawn).not.toContain("docs/setup.md");
    expect(drawn).not.toContain("more files");
  });
});

describe("right to left, list separators, and a language not worded yet", () => {
  test("Persian reads right to left, the English paths set apart", () => {
    const persian: Translator = dashboardTranslator("fa");
    const sentence: AIActionSentence = lineOf(2);

    expect(getAIActionSentenceDirection(sentence, persian)).toBe("rtl");

    const drawn: string = describeAIActionSentence(sentence, persian, {
      setsValuesApart: true,
    });

    expect(drawn).toContain(isolated("src/billing/charge.ts"));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(sentence, persian),
    );
  });

  test("Japanese and Chinese list the files their own way, and read right for one file", () => {
    for (const language of ["ja", "zh-CN", "zh-TW"]) {
      const translator: Translator = dashboardTranslator(language);

      expect(describeAIActionSentence(lineOf(2), translator)).toContain(
        "src/billing/charge.ts、src/billing/refund.ts",
      );
      // No "one" form: the general form names the one file, counted as 1.
      expect(describeAIActionSentence(lineOf(1), translator)).toContain(" 1 ");
    }
  });

  test("Russian's general form reads right for any count", () => {
    const russian: Translator = dashboardTranslator("ru");

    for (const count of [2, 5]) {
      expect(describeAIActionSentence(lineOf(count), russian)).toContain(
        `(${count})`,
      );
    }
  });

  test("a language that has not worded it reads the whole sentence in English, never half of it", () => {
    const none: Translator = createTranslator((): string | undefined => {
      return undefined;
    }, "xx");

    for (const count of [1, 4]) {
      const sentence: AIActionSentence = lineOf(count);

      expect(describeAIActionSentence(sentence, none)).toBe(
        describeAIActionSentence(sentence),
      );
      expect(getAIActionSentenceLanguage(sentence, none)).toBe("en");
    }
  });
});
