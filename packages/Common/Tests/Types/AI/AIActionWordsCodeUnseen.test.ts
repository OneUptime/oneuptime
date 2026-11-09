import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_CODE_FILE,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_SENTENCES,
  AI_ACTION_TERMS,
  AI_ACTION_TERM_WORDS,
  AIActionSentence,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  getAIActionSentenceLanguage,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";
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
 * ISSUE #6313: THE CARD'S NEW LINES, IN EVERY READER'S LANGUAGE.
 *
 * A commit or a pull request Ask AI wrote from an older read of a file says
 * on its card which files it would write over unseen: changed on the
 * branch since Ask AI read them, read on another branch only, never read,
 * or not checked. Each is a plural sentence of the module - one file, or
 * several, counted - that every Dashboard language words whole; the files
 * go in as data, the first three named and the rest counted, and a
 * language lists them its own way.
 */

const LINES: Array<[string, PluralTemplate]> = [
  ["changed since the read", AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead],
  [
    "read on another branch",
    AI_ACTION_PLURAL_LINES.codeFilesReadOnAnotherBranch,
  ],
  ["not read", AI_ACTION_PLURAL_LINES.codeFilesNotRead],
  ["not checked", AI_ACTION_PLURAL_LINES.codeFilesNotChecked],
];

const KINDS: Record<string, CodeFileUnseen> = {
  "changed since the read": CodeFileUnseen.ChangedSinceRead,
  "read on another branch": CodeFileUnseen.ReadOnAnotherBranch,
  "not read": CodeFileUnseen.NotRead,
  "not checked": CodeFileUnseen.NotChecked,
};

const FILES: Array<string> = [
  "src/billing/charge.ts",
  "src/billing/refund.ts",
  "README.md",
  "docs/setup.md",
  "package.json",
];

type LineFunction = (name: string, count: number) => AIActionSentence;

// The card's line for `count` files of one kind, read on main where it says.
const lineOf: LineFunction = (
  name: string,
  count: number,
): AIActionSentence => {
  const findings: Array<CodeFileUnseenFinding> = FILES.slice(0, count).map(
    (filePath: string): CodeFileUnseenFinding => {
      return {
        filePath,
        unseen: KINDS[name]!,
        ...(KINDS[name] === CodeFileUnseen.ReadOnAnotherBranch
          ? { readOnBranch: "main" }
          : {}),
      };
    },
  );

  return describeCodeFilesUnseenForPerson({
    branchName: "fix/login",
    findings,
  })[0]!;
};

describe("the English the model, the exports and older readers get", () => {
  test.each<[string, number, string]>([
    [
      "changed since the read",
      1,
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/charge.ts.",
    ],
    [
      "changed since the read",
      2,
      "These 2 files changed on fix/login after Ask AI read them, and Ask AI's versions undo those changes: src/billing/charge.ts, src/billing/refund.ts.",
    ],
    [
      "read on another branch",
      1,
      "Ask AI read this file on main, but it is different on fix/login, so Ask AI's version may undo changes made there: src/billing/charge.ts.",
    ],
    [
      "read on another branch",
      3,
      "Ask AI read these 3 files on main, but they are different on fix/login, so Ask AI's versions may undo changes made there: src/billing/charge.ts, src/billing/refund.ts, README.md.",
    ],
    [
      "not read",
      1,
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: src/billing/charge.ts.",
    ],
    [
      "not read",
      5,
      "Ask AI wrote these 5 files without reading them, and they replace the ones on fix/login: src/billing/charge.ts, src/billing/refund.ts, README.md, 2 more files.",
    ],
    [
      "not checked",
      1,
      "OneUptime could not check this file on fix/login against what Ask AI read: src/billing/charge.ts.",
    ],
    [
      "not checked",
      4,
      "OneUptime could not check these 4 files on fix/login against what Ask AI read: src/billing/charge.ts, src/billing/refund.ts, README.md, 1 more file.",
    ],
  ])("%s, %d file(s)", (name: string, count: number, english: string) => {
    expect(describeAIActionSentence(lineOf(name, count))).toBe(english);
  });

  test("every one is a sentence of the module, which the Dashboard trusts", () => {
    for (const [, plural] of LINES) {
      expect(AI_ACTION_PLURAL_SENTENCES).toContain(plural);
    }
    expect(AI_ACTION_PLURAL_SENTENCES).toContain(
      AI_ACTION_PLURAL_LINES.moreFiles,
    );
    expect(AI_ACTION_SENTENCES).toContain(AI_ACTION_CODE_FILE);
    expect(AI_ACTION_TERM_WORDS).toContain(AI_ACTION_TERMS.anotherBranch);

    for (const [name] of LINES) {
      for (const count of [1, 2, 5]) {
        expect(isKnownAIActionSentence(lineOf(name, count))).toBe(true);
      }
    }
  });

  test("English holds each as itself, its one form under _one", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const [, plural] of [
      ...LINES,
      ["", AI_ACTION_PLURAL_LINES.moreFiles] as [string, PluralTemplate],
    ]) {
      expect(english[plural.other]).toBe(plural.other);
      expect(english[`${plural.other}_one`]).toBe(plural.one);
    }
    expect(english[AI_ACTION_TERMS.anotherBranch]).toBe(
      AI_ACTION_TERMS.anotherBranch,
    );
  });

  test("a file's own template has no words, so it is data in every language", () => {
    expect(AI_ACTION_CODE_FILE).toBe("{{file}}");
  });
});

describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);
  const words: Record<string, string> = readDashboardLocale(language);

  test.each(LINES)(
    "words the line for %s, one file and several, with its placeholders and the files as written",
    (name: string, plural: PluralTemplate) => {
      for (const key of [plural.other, `${plural.other}_one`]) {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({
          key,
          worded: true,
        });
      }

      expect(placeholdersOf(words[plural.other]!)).toEqual(
        placeholdersOf(plural.other),
      );
      expect(placeholdersOf(words[`${plural.other}_one`]!)).toEqual(
        placeholdersOf(plural.one),
      );

      for (const count of [1, 2, 5]) {
        const sentence: AIActionSentence = lineOf(name, count);
        const drawn: string = describeAIActionSentence(sentence, translator);

        expect(drawn).toContain("fix/login");
        expect(drawn).toContain("src/billing/charge.ts");
        expect(drawn).not.toContain("{{");
        expect(drawn).not.toContain("Ask AI's");
        expect(drawn).not.toContain(describeAIActionSentence(sentence));
        expect(getAIActionSentenceLanguage(sentence, translator)).toBe(
          language,
        );

        if (KINDS[name] === CodeFileUnseen.ReadOnAnotherBranch) {
          expect(drawn).toContain("main");
        }
      }
    },
  );

  test("names the files it counts rather than writes out, in its own words", () => {
    const drawn: string = describeAIActionSentence(
      lineOf("not read", 5),
      translator,
    );

    expect(drawn).toContain("README.md");
    expect(drawn).not.toContain("docs/setup.md");
    expect(drawn).not.toContain("more files");
    expect(
      isWordedInDashboardLocale(
        AI_ACTION_PLURAL_LINES.moreFiles.other,
        language,
      ),
    ).toBe(true);
  });

  test("words 'another branch', where files were read on several", () => {
    expect(
      isWordedInDashboardLocale(AI_ACTION_TERMS.anotherBranch, language),
    ).toBe(true);

    const drawn: string = describeAIActionSentence(
      describeCodeFilesUnseenForPerson({
        branchName: "fix/login",
        findings: [
          {
            filePath: "a.ts",
            unseen: CodeFileUnseen.ReadOnAnotherBranch,
            readOnBranch: "main",
          },
          {
            filePath: "b.ts",
            unseen: CodeFileUnseen.ReadOnAnotherBranch,
            readOnBranch: "release",
          },
        ],
      })[0]!,
      translator,
    );

    expect(drawn).toContain(words[AI_ACTION_TERMS.anotherBranch]!);
    expect(drawn).not.toContain("another branch");
  });
});

describe("right to left, and a language not worded yet", () => {
  test("Persian reads right to left, the English paths and branches set apart", () => {
    const persian: Translator = dashboardTranslator("fa");
    const sentence: AIActionSentence = lineOf("changed since the read", 2);

    expect(getAIActionSentenceDirection(sentence, persian)).toBe("rtl");

    const drawn: string = describeAIActionSentence(sentence, persian, {
      setsValuesApart: true,
    });

    expect(drawn).toContain(isolated("fix/login"));
    expect(drawn).toContain(isolated("src/billing/charge.ts"));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(sentence, persian),
    );
  });

  test("Japanese and Chinese list the files their own way", () => {
    for (const language of ["ja", "zh-CN", "zh-TW"]) {
      expect(
        describeAIActionSentence(
          lineOf("not read", 2),
          dashboardTranslator(language),
        ),
      ).toContain("src/billing/charge.ts、src/billing/refund.ts");
    }
  });

  test("a language that has not worded them reads each whole sentence in English, never half of it", () => {
    const none: Translator = createTranslator((): string | undefined => {
      return undefined;
    }, "xx");

    for (const [name] of LINES) {
      for (const count of [1, 4]) {
        const sentence: AIActionSentence = lineOf(name, count);

        expect(describeAIActionSentence(sentence, none)).toBe(
          describeAIActionSentence(sentence),
        );
        expect(getAIActionSentenceLanguage(sentence, none)).toBe("en");
      }
    }
  });
});
