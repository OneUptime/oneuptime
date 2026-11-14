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
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  describeCodeFilesUnseenForModel,
  describeCodeFilesUnseenForPerson,
  summarizeCodeFilesUnseen,
} from "../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
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
 * ISSUE #6570: THE CARD'S LINE FOR A FILE ASK AI READ EARLIER IN THIS
 * ANSWER, WHOSE READ THE CONVERSATION HAS LEFT OUT SINCE, IN EVERY
 * READER'S LANGUAGE - and what the model and the action's record say of it.
 *
 * A plural sentence of the module - one file, or several, counted - that
 * every Dashboard language words whole, never with the words of the line
 * for a file read in an earlier answer (#6365): this is the same answer.
 * The files go in as data, the first three named and the rest counted. It
 * names no branch: the card's title does.
 */

const PLURAL: typeof AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer =
  AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer;

const EARLIER_ANSWER: typeof AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer =
  AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer;

const FILES: Array<string> = [
  "src/billing/charge.ts",
  "src/billing/refund.ts",
  ".env.example",
  "docs/setup.md",
  "package.json",
];

const findingsOf: (
  count: number,
  unseen: CodeFileUnseen,
) => Array<CodeFileUnseenFinding> = (
  count: number,
  unseen: CodeFileUnseen,
): Array<CodeFileUnseenFinding> => {
  return FILES.slice(0, count).map(
    (filePath: string): CodeFileUnseenFinding => {
      return { filePath, unseen };
    },
  );
};

// The card's line for `count` files read earlier in this answer and left out since.
const lineOf: (count: number) => AIActionSentence = (
  count: number,
): AIActionSentence => {
  return describeCodeFilesUnseenForPerson({
    branchName: "fix/login",
    findings: findingsOf(count, CodeFileUnseen.ReadEarlierInThisAnswer),
  })[0]!;
};

describe("the English the model, the exports and older readers get", () => {
  test.each<[number, string]>([
    [
      1,
      "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
    ],
    [
      2,
      "Ask AI read these 2 files earlier in this answer and no longer has their text, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts.",
    ],
    [
      5,
      "Ask AI read these 5 files earlier in this answer and no longer has their text, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts, .env.example, 2 more files.",
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

  test("names no branch: the card's title does", () => {
    const english: string = describeAIActionSentence(lineOf(1));

    expect(english).not.toContain("fix/login");
    expect(placeholdersOf(PLURAL.other)).toEqual(
      placeholdersOf("{{count}} {{files}}"),
    );
    expect(placeholdersOf(PLURAL.one)).toEqual(placeholdersOf("{{files}}"));
  });

  test("its place among a code change's lines: after read in an earlier answer, before read in part", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        { filePath: "src/c.ts", unseen: CodeFileUnseen.NotChecked },
        {
          filePath: "src/b.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 10,
          linesNotRead: [{ first: 1, last: 5 }],
        },
        {
          filePath: "src/e.ts",
          unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
        },
        { filePath: "src/a.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
        { filePath: "src/d.ts", unseen: CodeFileUnseen.NotRead },
        { filePath: "src/a.ts", unseen: CodeFileUnseen.ValuesHidden },
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return line.template;
      }),
    ).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
      AI_ACTION_PLURAL_LINES.codeFilesNotRead.other,
      EARLIER_ANSWER.other,
      PLURAL.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other,
      AI_ACTION_PLURAL_LINES.codeFilesNotChecked.other,
    ]);
  });
});

describe("what the model is told in Auto-run, and the action's record", () => {
  test.each<[CodeChangeKind, string, string]>([
    [
      CodeChangeKind.Commit,
      "Not done: nothing was committed to fix/login, because you read these files earlier in this answer and their text has been left out of this conversation since:",
      'Read each file whose text was left out again now, on fix/login with read_code_file and branchName "fix/login", and write it whole right after you read it: a commit replaces each file whole, and you no longer have the text you read before.',
    ],
    [
      CodeChangeKind.PullRequest,
      "Not done: no pull request was opened, because you read these files earlier in this answer and their text has been left out of this conversation since:",
      'Read each file whose text was left out again now, on fix/login with read_code_file and branchName "fix/login", and write it whole right after you read it: a pull request replaces each file whole, and you no longer have the text you read before.',
    ],
  ])(
    "%s: why, each file, and what to read again now",
    (change: CodeChangeKind, opening: string, instruction: string) => {
      expect(
        describeCodeFilesUnseenForModel({
          change,
          branchName: "fix/login",
          findings: findingsOf(2, CodeFileUnseen.ReadEarlierInThisAnswer),
        }),
      ).toBe(
        [
          opening,
          "- src/billing/charge.ts: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.",
          "- src/billing/refund.ts: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.",
          instruction,
        ].join("\n"),
      );
    },
  );

  test("read in an earlier answer and earlier in this one: one opening for both, and each instruction once", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        {
          filePath: "src/billing/charge.ts",
          unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
        },
        {
          filePath: "src/billing/refund.ts",
          unseen: CodeFileUnseen.ReadInEarlierAnswer,
        },
      ],
    });

    expect(told.split("\n")[0]).toBe(
      "Not done: nothing was committed to fix/login, because you read these files before and no longer have their text:",
    );
    expect(
      told.split("Read each file you read in an earlier answer"),
    ).toHaveLength(2);
    expect(told.split("Read each file whose text was left out")).toHaveLength(
      2,
    );
    // Nothing to tell the user about a change someone else made: none was.
    expect(told).not.toContain("tell the user it changed");
  });

  test("among other reasons, the general opening - and what Ask AI no longer has, never only what it did not read (#6984) - and the read-again instruction still said", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        {
          filePath: "src/billing/charge.ts",
          unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
        },
        { filePath: "src/billing/tax.ts", unseen: CodeFileUnseen.NotRead },
      ],
    });

    expect(told.split("\n")[0]).toBe(
      "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there, or no longer have:",
    );
    expect(told).toContain(
      "- src/billing/charge.ts: you read it earlier in this answer, and its text has been left out of this conversation since",
    );
    expect(told).toContain("Read each file whose text was left out again now");
  });

  test("the action's record says why it was not made, after an earlier answer and before a part read", () => {
    expect(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    ).toBe(
      "Not committed: Ask AI had read a file the commit replaces earlier in this answer, and no longer had its text.",
    );
    expect(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    ).toBe(
      "Not opened: Ask AI had read a file the pull request replaces earlier in this answer, and no longer had its text.",
    );

    const summary: (findings: Array<CodeFileUnseenFinding>) => string = (
      findings: Array<CodeFileUnseenFinding>,
    ): string => {
      return summarizeCodeFilesUnseen({
        change: CodeChangeKind.Commit,
        findings,
      });
    };
    const leftOut: CodeFileUnseenFinding = {
      filePath: "a.ts",
      unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
    };

    expect(summary([leftOut])).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    );
    expect(
      summary([
        leftOut,
        { filePath: "b.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
      ]),
    ).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadInEarlierAnswer
      ],
    );
    expect(
      summary([
        {
          filePath: "b.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 10,
          linesNotRead: [{ first: 1, last: 5 }],
        },
        leftOut,
      ]),
    ).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    );
  });
});

/*
 * Every Dashboard language words it: Arabic too, with the count as a label
 * (Locales/ARABIC.md), so the line reads whole in Arabic for any number of
 * files.
 */
const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES, "ar"];

describe.each(LANGUAGES)("%s", (language: string) => {
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
      expect(drawn).not.toContain("earlier in this answer");
      expect(drawn).not.toContain(describeAIActionSentence(sentence));
      expect(getAIActionSentenceLanguage(sentence, translator)).toBe(language);
    }
  });

  test("never in the words of a file read in an earlier answer: this is the same answer", () => {
    for (const key of [PLURAL.other, `${PLURAL.other}_one`, PLURAL.one]) {
      const earlierKey: string = key
        .replace(PLURAL.other, EARLIER_ANSWER.other)
        .replace(PLURAL.one, EARLIER_ANSWER.one);

      expect({ key, same: words[key] === words[earlierKey] }).toEqual({
        key,
        same: false,
      });
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
  test("Persian reads right to left, the English paths set apart, its words joined as Persian joins them", () => {
    const persian: Translator = dashboardTranslator("fa");
    const words: Record<string, string> = readDashboardLocale("fa");
    const sentence: AIActionSentence = lineOf(2);

    expect(getAIActionSentenceDirection(sentence, persian)).toBe("rtl");

    const drawn: string = describeAIActionSentence(sentence, persian, {
      setsValuesApart: true,
    });

    expect(drawn).toContain(isolated("src/billing/charge.ts"));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(sentence, persian),
    );

    // "Earlier" and "becomes" with the zero-width non-joiner Persian writes inside them.
    const nonJoiner: string = String.fromCharCode(0x200c);
    expect(words[PLURAL.one]).toContain(`پیش${nonJoiner}تر`);
    expect(words[PLURAL.one]).toContain(`می${nonJoiner}شود`);
    // And no marks that set a direction: the reader's own does (Locales/ARABIC.md).
    for (const key of [PLURAL.other, PLURAL.one]) {
      expect(words[key]).not.toMatch(/[‎‏؜]/);
    }
  });

  test("Arabic reads right to left, lists the files with its own comma, and counts them in a form that reads right for any count", () => {
    const arabic: Translator = dashboardTranslator("ar");
    const words: Record<string, string> = readDashboardLocale("ar");
    const sentence: AIActionSentence = lineOf(2);

    expect(getAIActionSentenceDirection(sentence, arabic)).toBe("rtl");
    expect(describeAIActionSentence(sentence, arabic)).toContain(
      "src/billing/charge.ts، src/billing/refund.ts",
    );

    const drawn: string = describeAIActionSentence(sentence, arabic, {
      setsValuesApart: true,
    });

    expect(drawn).toContain(isolated("src/billing/charge.ts"));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(sentence, arabic),
    );

    // The count stands as a label, never before a noun it would have to agree with.
    expect(words[PLURAL.other]).toContain("(العدد: {{count}})");
    expect(describeAIActionSentence(lineOf(5), arabic)).toContain(
      ".env.example، 2 من الملفات الأخرى",
    );
    expect(describeAIActionSentence(lineOf(1), arabic)).not.toContain(
      "{{count}}",
    );
    for (const key of [PLURAL.other, PLURAL.one]) {
      expect(words[key]).not.toMatch(/[‎‏؜]/);
    }
  });

  test.each<[string, string]>([
    ["ja", " 1 個のファイル"],
    ["zh-CN", "这 1 个文件"],
    ["zh-TW", "這 1 個檔案"],
  ])(
    "%s lists the files its own way, and reads right for one file",
    (language: string, oneFile: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(describeAIActionSentence(lineOf(2), translator)).toContain(
        "src/billing/charge.ts、src/billing/refund.ts",
      );
      // No "one" form: the general form names the one file, counted as 1.
      expect(describeAIActionSentence(lineOf(1), translator)).toContain(
        oneFile,
      );
    },
  );

  test("Korean has no one form either: the general form counts the one file", () => {
    expect(
      describeAIActionSentence(lineOf(1), dashboardTranslator("ko")),
    ).toContain("파일 1개");
  });

  test("Russian's general form reads right for any count, 21 among them", () => {
    const russian: Translator = dashboardTranslator("ru");

    for (const count of [2, 5]) {
      expect(describeAIActionSentence(lineOf(count), russian)).toContain(
        `(${count})`,
      );
    }

    // 21 is "one" in Russian, but the one form says one file only.
    const twentyOne: AIActionSentence = {
      ...lineOf(1),
      count: 21,
    };
    expect(describeAIActionSentence(twentyOne, russian)).toContain("(21)");
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
