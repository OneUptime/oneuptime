import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_CODE_CHANGE_LINES,
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
 * ISSUE #6364: THE CARD'S LINE FOR A FILE ASK AI'S VERSION WRITES
 * PLACEHOLDERS INTO, IN EVERY READER'S LANGUAGE.
 *
 * A plural sentence of the module - one file, or several, counted - that
 * every Dashboard language words whole. The files go in as data, the first
 * three named and the rest counted, and a language lists them its own way.
 * It names no placeholder, no branch and no line: the model is told those,
 * and the pull request's reviewer the placeholders and lines.
 */

const PLURAL: typeof AI_ACTION_PLURAL_LINES.codeFilesValuesHidden =
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden;

const FILES: Array<string> = [
  "config/servers.ts",
  "config/mail.ts",
  ".env.example",
  "docs/setup.md",
  "package.json",
];

// The card's line for `count` files written with placeholders.
const lineOf: (count: number) => AIActionSentence = (
  count: number,
): AIActionSentence => {
  return describeCodeFilesUnseenForPerson({
    branchName: "fix/login",
    findings: FILES.slice(0, count).map(
      (filePath: string): CodeFileUnseenFinding => {
        return {
          filePath,
          unseen: CodeFileUnseen.ValuesHidden,
          placeholdersWritten: [
            {
              placeholder: "[redacted-ip]",
              written: 1,
              onBranch: 0,
              lines: [{ first: 4, last: 4 }],
            },
          ],
        };
      },
    ),
  })[0]!;
};

describe("the English the model, the exports and older readers get", () => {
  test.each<[number, string]>([
    [
      1,
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: config/servers.ts.",
    ],
    [
      2,
      "Values that look like secrets or personal data were hidden from Ask AI, and its versions of these 2 files write placeholders in their place: config/servers.ts, config/mail.ts.",
    ],
    [
      5,
      "Values that look like secrets or personal data were hidden from Ask AI, and its versions of these 5 files write placeholders in their place: config/servers.ts, config/mail.ts, .env.example, 2 more files.",
    ],
  ])("%d file(s)", (count: number, english: string) => {
    expect(describeAIActionSentence(lineOf(count))).toBe(english);
  });

  test("a sentence of the module, which the Dashboard trusts, and a code change line that leaves Files: N on the card", () => {
    expect(AI_ACTION_PLURAL_SENTENCES).toContain(PLURAL);
    expect(AI_ACTION_CODE_CHANGE_LINES).toContain(PLURAL.other);

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

  test("names no placeholder, no branch and no line: those are the model's and the reviewer's", () => {
    const english: string = describeAIActionSentence(lineOf(1));

    expect(english).not.toContain("[redacted");
    expect(english).not.toContain("fix/login");
    expect(english).not.toContain("4");
    expect(placeholdersOf(PLURAL.other)).toEqual(
      placeholdersOf("{{count}} {{files}}"),
    );
    expect(placeholdersOf(PLURAL.one)).toEqual(placeholdersOf("{{files}}"));
  });

  test("first among a code change's lines: reading the file again never mends it", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        { filePath: "src/a.ts", unseen: CodeFileUnseen.ChangedSinceRead },
        { filePath: "src/b.ts", unseen: CodeFileUnseen.NotChecked },
        {
          filePath: "src/a.ts",
          unseen: CodeFileUnseen.ValuesHidden,
        },
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return line.template;
      }),
    ).toEqual([
      PLURAL.other,
      AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead.other,
      AI_ACTION_PLURAL_LINES.codeFilesNotChecked.other,
    ]);
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

      expect(drawn).toContain("config/servers.ts");
      expect(drawn).not.toContain("{{");
      expect(drawn).not.toContain("Ask AI");
      expect(drawn).not.toContain("placeholders in their place");
      expect(drawn).not.toContain(describeAIActionSentence(sentence));
      expect(getAIActionSentenceLanguage(sentence, translator)).toBe(language);
    }
  });

  test("names the files it counts rather than writes out, in its own words", () => {
    const drawn: string = describeAIActionSentence(lineOf(5), translator);

    expect(drawn).toContain(".env.example");
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

    expect(drawn).toContain(isolated("config/servers.ts"));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(sentence, persian),
    );
  });

  test.each<[string, string]>([
    ["ja", "1 個のファイル"],
    ["zh-CN", "这 1 个文件"],
    ["zh-TW", "這 1 個檔案"],
  ])(
    "%s lists the files its own way, and reads right for one file",
    (language: string, oneFile: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(describeAIActionSentence(lineOf(2), translator)).toContain(
        "config/servers.ts、config/mail.ts",
      );
      // No "one" form: the general form names the one file, counted as 1.
      expect(describeAIActionSentence(lineOf(1), translator)).toContain(oneFile);
    },
  );

  test("Korean has no one form either: the general form counts the one file", () => {
    expect(
      describeAIActionSentence(lineOf(1), dashboardTranslator("ko")),
    ).toContain("파일 1개");
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
