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
  getLinesNoLongerInHand,
  isTextNoLongerInHand,
  summarizeCodeFilesUnseen,
} from "../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import { describeCodeFilesUnseenForReviewer } from "../../../Server/Utils/AI/Toolbox/CodeChangeReviewerNote";
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
 * ISSUE #6984: A FILE ASK AI READ ALL OF, IN PARTS, AND NO LONGER HAS PART
 * OF - read in two halves, the first in an earlier answer or left out of
 * this one since. What the card, the model, the action's record and a
 * pull request's reviewer are told of it.
 *
 * Every line of it was read, so it is never "read only part of", and the
 * lines no longer in hand are never "not read": the model is told it read
 * them earlier and no longer has them, and so is the reviewer. The card's
 * line is a plural sentence of the module that every Dashboard language
 * words whole, never with the words of the line for a file read only in
 * part (#6330) or of one with none of its text in hand (#6365, #6570).
 */

const PLURAL: typeof AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand =
  AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand;

// The lines it must never be worded as, in any language.
const OTHER_LINES: Array<
  [string, typeof AI_ACTION_PLURAL_LINES.codeFilesReadInPart]
> = [
  ["read only part of", AI_ACTION_PLURAL_LINES.codeFilesReadInPart],
  [
    "read in an earlier answer",
    AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
  ],
  [
    "read earlier in this answer",
    AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
  ],
];

const FILES: Array<string> = [
  "src/billing/charge.ts",
  "src/billing/refund.ts",
  ".env.example",
  "docs/setup.md",
  "package.json",
];

// The marks that set a direction: left-to-right, right-to-left and the Arabic letter mark.
const DIRECTION_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x200e, 0x200f, 0x061c)}]`,
);

// Read in two halves of 800 lines, the first no longer in hand.
const partOf: (filePath: string) => CodeFileUnseenFinding = (
  filePath: string,
): CodeFileUnseenFinding => {
  return {
    filePath,
    unseen: CodeFileUnseen.PartNoLongerInHand,
    lineCount: 800,
    linesNoLongerInHand: [{ first: 1, last: 400 }],
  };
};

// The card's line for `count` files read all of, with part no longer in hand.
const lineOf: (count: number) => AIActionSentence = (
  count: number,
): AIActionSentence => {
  return describeCodeFilesUnseenForPerson({
    branchName: "fix/login",
    findings: FILES.slice(0, count).map(partOf),
  })[0]!;
};

describe("the English the model, the exports and older readers get", () => {
  test.each<[number, string]>([
    [
      1,
      "Ask AI read this file and no longer has part of its text, and its version replaces all of it: src/billing/charge.ts.",
    ],
    [
      2,
      "Ask AI read these 2 files and no longer has part of their text, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts.",
    ],
    [
      5,
      "Ask AI read these 5 files and no longer has part of their text, and its versions replace all of them: src/billing/charge.ts, src/billing/refund.ts, .env.example, 2 more files.",
    ],
  ])("%d file(s)", (count: number, english: string) => {
    expect(describeAIActionSentence(lineOf(count))).toBe(english);
  });

  test("never says the file was read only in part, nor that none of its text is in hand", () => {
    for (const count of [1, 2, 5]) {
      const english: string = describeAIActionSentence(lineOf(count));

      expect(english).not.toContain("only part");
      expect(english).not.toContain("no longer has its text");
      expect(english).not.toContain("no longer has their text");
      expect(english).toContain("no longer has part of");
    }
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

  test("names no branch and no lines: the card's title names the branch, and the lines are for the model and the reviewer", () => {
    const english: string = describeAIActionSentence(lineOf(1));

    expect(english).not.toContain("fix/login");
    expect(english).not.toContain("400");
    expect(placeholdersOf(PLURAL.other)).toEqual(
      placeholdersOf("{{count}} {{files}}"),
    );
    expect(placeholdersOf(PLURAL.one)).toEqual(placeholdersOf("{{files}}"));
  });

  test("its place among a code change's lines: after read earlier in this answer, before read in part", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        { filePath: "src/c.ts", unseen: CodeFileUnseen.NotChecked },
        {
          filePath: "src/b.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 10,
          linesNotRead: [{ first: 1, last: 5 }],
          linesNoLongerInHand: [{ first: 6, last: 8 }],
        },
        partOf("src/f.ts"),
        {
          filePath: "src/e.ts",
          unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
        },
        { filePath: "src/a.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
        { filePath: "src/d.ts", unseen: CodeFileUnseen.NotRead },
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return line.template;
      }),
    ).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesNotRead.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
      PLURAL.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other,
      AI_ACTION_PLURAL_LINES.codeFilesNotChecked.other,
    ]);
  });

  test("a file read in part with lines no longer in hand besides is still named as read in part: it never read some of them", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        {
          filePath: "src/b.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 10,
          linesNotRead: [{ first: 1, last: 5 }],
          linesNoLongerInHand: [{ first: 6, last: 8 }],
        },
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return describeAIActionSentence(line);
      }),
    ).toEqual([
      "Ask AI read only part of this file, and its version replaces all of it: src/b.ts.",
    ]);
  });
});

describe("what the model is told in Auto-run, and the action's record", () => {
  test.each<[CodeChangeKind, string, string]>([
    [
      CodeChangeKind.Commit,
      "Not done: nothing was committed to fix/login, because you read these files before and no longer have all of their text:",
      'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
    ],
    [
      CodeChangeKind.PullRequest,
      "Not done: no pull request was opened, because you read these files before and no longer have all of their text:",
      'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a pull request replaces each file whole, and you no longer have the text you read of those lines before.',
    ],
  ])(
    "%s: why, each file with the lines it read and no longer has, and what to read again now",
    (change: CodeChangeKind, opening: string, instruction: string) => {
      expect(
        describeCodeFilesUnseenForModel({
          change,
          branchName: "fix/login",
          findings: [
            partOf("src/billing/charge.ts"),
            {
              filePath: "src/billing/refund.ts",
              unseen: CodeFileUnseen.PartNoLongerInHand,
              lineCount: 2000,
              linesNoLongerInHand: [
                { first: 1, last: 339 },
                { first: 461, last: 2000 },
              ],
            },
            {
              filePath: "one.ts",
              unseen: CodeFileUnseen.PartNoLongerInHand,
              lineCount: 30,
              linesNoLongerInHand: [{ first: 7, last: 7 }],
            },
          ],
        }),
      ).toBe(
        [
          opening,
          "- src/billing/charge.ts has 800 lines on fix/login, and you read lines 1-400 earlier and no longer have them.",
          "- src/billing/refund.ts has 2000 lines on fix/login, and you read lines 1-339 and 461-2000 earlier and no longer have them.",
          "- one.ts has 30 lines on fix/login, and you read line 7 earlier and no longer have it.",
          instruction,
        ].join("\n"),
      );
    },
  );

  test("never tells the model it has not read what it read", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [partOf("src/billing/charge.ts")],
    });

    expect(told).not.toContain("not read");
    expect(told).not.toContain("only part");
  });

  test("with a file none of whose text is in hand: read before, all of them - and each instruction once", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        partOf("src/billing/charge.ts"),
        {
          filePath: "src/billing/refund.ts",
          unseen: CodeFileUnseen.ReadInEarlierAnswer,
        },
        {
          filePath: "src/billing/tax.ts",
          unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
        },
        partOf("src/billing/fees.ts"),
      ],
    });

    expect(told.split("\n")[0]).toBe(
      "Not done: nothing was committed to fix/login, because you read these files before and no longer have all of their text:",
    );
    expect(
      told.split("Read the lines you no longer have again now"),
    ).toHaveLength(2);
    expect(
      told.split("Read each file you read in an earlier answer"),
    ).toHaveLength(2);
    expect(told.split("Read each file whose text was left out")).toHaveLength(
      2,
    );
    expect(told).not.toContain("tell the user it changed");
  });

  test("files none of whose text is in hand, and none read in parts: the opening as it always was", () => {
    expect(
      describeCodeFilesUnseenForModel({
        change: CodeChangeKind.Commit,
        branchName: "fix/login",
        findings: [
          { filePath: "a.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
          { filePath: "b.ts", unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
        ],
      }).split("\n")[0],
    ).toBe(
      "Not done: nothing was committed to fix/login, because you read these files before and no longer have their text:",
    );
  });

  test.each<[CodeChangeKind, string]>([
    [
      CodeChangeKind.Commit,
      "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there, or no longer have:",
    ],
    [
      CodeChangeKind.PullRequest,
      "Not done: no pull request was opened, because writing these files whole on top of fix/login, the branch it starts from, would undo or replace what you have not read there, or no longer have:",
    ],
  ])(
    "%s: among other reasons, the general opening says what Ask AI no longer has too",
    (change: CodeChangeKind, opening: string) => {
      const told: string = describeCodeFilesUnseenForModel({
        change,
        branchName: "fix/login",
        findings: [
          partOf("src/billing/charge.ts"),
          { filePath: "src/billing/tax.ts", unseen: CodeFileUnseen.NotRead },
        ],
      });

      expect(told.split("\n")[0]).toBe(opening);
      expect(told).toContain(
        "- src/billing/charge.ts has 800 lines on fix/login, and you read lines 1-400 earlier and no longer have them.",
      );
      expect(told).toContain(
        "- src/billing/tax.ts is on fix/login, and you have not read it.",
      );
      expect(told).toContain("Read the lines you no longer have again now");
      expect(told).toContain("Read each of these files on fix/login");
    },
  );

  test.each<[CodeChangeKind, string]>([
    [
      CodeChangeKind.Commit,
      "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there:",
    ],
    [
      CodeChangeKind.PullRequest,
      "Not done: no pull request was opened, because writing these files whole on top of fix/login, the branch it starts from, would undo or replace what you have not read there:",
    ],
  ])(
    "%s: nothing read and no longer had - the general opening as it always was",
    (change: CodeChangeKind, opening: string) => {
      const told: string = describeCodeFilesUnseenForModel({
        change,
        branchName: "fix/login",
        findings: [
          {
            filePath: "src/billing/charge.ts",
            unseen: CodeFileUnseen.ReadInPart,
            lineCount: 800,
            linesNotRead: [{ first: 401, last: 800 }],
          },
          { filePath: "src/billing/tax.ts", unseen: CodeFileUnseen.NotRead },
        ],
      });

      expect(told.split("\n")[0]).toBe(opening);
      expect(told).not.toContain("no longer have");
    },
  );

  test("read in part with lines no longer in hand besides: both runs on the file's line, and both instructions", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        {
          filePath: "src/billing/charge.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 800,
          linesNotRead: [{ first: 601, last: 800 }],
          linesNoLongerInHand: [{ first: 1, last: 400 }],
        },
      ],
    });

    expect(told).toBe(
      [
        "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there, or no longer have:",
        "- src/billing/charge.ts has 800 lines on fix/login, and you have not read lines 601-800 of it; you read lines 1-400 earlier and no longer have them.",
        'Read the lines you have not read of each file you read only part of, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and only then write the whole file: a commit replaces each file whole, so a line you have not read would be dropped from it.',
        'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
    );
  });

  test("a finding without its lines - one stored before they were kept - still says the file was read", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        {
          filePath: "src/billing/charge.ts",
          unseen: CodeFileUnseen.PartNoLongerInHand,
        },
      ],
    });

    expect(told).toContain(
      "- src/billing/charge.ts: you read all of it before, and you no longer have part of its text.",
    );
    expect(told).not.toContain("not read");
  });

  test("the action's record says why it was not made, after a file with none of its text in hand and before a part read", () => {
    expect(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.PartNoLongerInHand
      ],
    ).toBe(
      "Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text.",
    );
    expect(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.PartNoLongerInHand
      ],
    ).toBe(
      "Not opened: Ask AI had read a file the pull request replaces whole, and no longer had part of its text.",
    );

    const summary: (findings: Array<CodeFileUnseenFinding>) => string = (
      findings: Array<CodeFileUnseenFinding>,
    ): string => {
      return summarizeCodeFilesUnseen({
        change: CodeChangeKind.Commit,
        findings,
      });
    };
    const part: CodeFileUnseenFinding = partOf("a.ts");

    expect(summary([part])).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.PartNoLongerInHand
      ],
    );
    expect(
      summary([
        part,
        { filePath: "b.ts", unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
      ]),
    ).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadEarlierInThisAnswer
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
        part,
      ]),
    ).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.PartNoLongerInHand
      ],
    );
  });

  test("the lines no longer in hand: of the two findings that have them only, and what counts as text no longer had", () => {
    expect(getLinesNoLongerInHand(partOf("a.ts"))).toEqual([
      { first: 1, last: 400 },
    ]);
    expect(
      getLinesNoLongerInHand({
        filePath: "a.ts",
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: 10,
        linesNotRead: [{ first: 1, last: 5 }],
        linesNoLongerInHand: [{ first: 6, last: 8 }],
      }),
    ).toEqual([{ first: 6, last: 8 }]);
    // Another kind never carries them: one that does is not read.
    expect(
      getLinesNoLongerInHand({
        filePath: "a.ts",
        unseen: CodeFileUnseen.NotRead,
        linesNoLongerInHand: [{ first: 6, last: 8 }],
      }),
    ).toEqual([]);

    for (const [unseen, noLongerHad] of [
      [CodeFileUnseen.ReadInEarlierAnswer, true],
      [CodeFileUnseen.ReadEarlierInThisAnswer, true],
      [CodeFileUnseen.PartNoLongerInHand, true],
      [CodeFileUnseen.ReadInPart, false],
      [CodeFileUnseen.NotRead, false],
      [CodeFileUnseen.ChangedSinceRead, false],
      [CodeFileUnseen.ReadOnAnotherBranch, false],
      [CodeFileUnseen.NotChecked, false],
      [CodeFileUnseen.ValuesHidden, false],
    ] as Array<[CodeFileUnseen, boolean]>) {
      expect({
        unseen,
        noLongerHad: isTextNoLongerInHand({ filePath: "a.ts", unseen }),
      }).toEqual({ unseen, noLongerHad });
    }
    expect(
      isTextNoLongerInHand({
        filePath: "a.ts",
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: 10,
        linesNotRead: [{ first: 1, last: 5 }],
        linesNoLongerInHand: [{ first: 6, last: 8 }],
      }),
    ).toBe(true);
  });
});

describe("what a pull request approved anyway tells its reviewer", () => {
  const HEADING_NOT_READ: string =
    "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:";
  const HEADING_NO_LONGER_HAD: string =
    "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read, or no longer had:";

  test("the lines AI read and no longer had, said so - never as lines it did not read", () => {
    expect(
      describeCodeFilesUnseenForReviewer({
        baseBranchName: "main",
        findings: [
          partOf("src/billing/charge.ts"),
          {
            filePath: "one.ts",
            unseen: CodeFileUnseen.PartNoLongerInHand,
            lineCount: 1,
            linesNoLongerInHand: [{ first: 1, last: 1 }],
          },
        ],
      }),
    ).toBe(
      [
        HEADING_NO_LONGER_HAD,
        "- `src/billing/charge.ts`: AI read lines 1-400 of its 800 lines earlier and no longer had them when it wrote the whole file.",
        "- `one.ts`: AI read line 1 of its 1 line earlier and no longer had it when it wrote the whole file.",
      ].join("\n"),
    );
  });

  test("read in part with lines no longer had besides: each run in its own words", () => {
    expect(
      describeCodeFilesUnseenForReviewer({
        baseBranchName: "main",
        findings: [
          {
            filePath: "src/billing/charge.ts",
            unseen: CodeFileUnseen.ReadInPart,
            lineCount: 800,
            linesNotRead: [{ first: 601, last: 800 }],
            linesNoLongerInHand: [{ first: 1, last: 400 }],
          },
        ],
      }),
    ).toBe(
      [
        HEADING_NO_LONGER_HAD,
        "- `src/billing/charge.ts`: AI did not read lines 601-800 of its 800 lines before writing the whole file, and it read lines 1-400 earlier and no longer had them.",
      ].join("\n"),
    );
  });

  test("a finding stored without its lines still says AI read the file", () => {
    expect(
      describeCodeFilesUnseenForReviewer({
        baseBranchName: "main",
        findings: [
          {
            filePath: "src/billing/charge.ts",
            unseen: CodeFileUnseen.PartNoLongerInHand,
          },
        ],
      }),
    ).toBe(
      [
        HEADING_NO_LONGER_HAD,
        "- `src/billing/charge.ts`: AI read it earlier and no longer had part of its text when it wrote the whole file.",
      ].join("\n"),
    );
  });

  test.each<[string, CodeFileUnseenFinding]>([
    [
      "read in an earlier answer",
      { filePath: "a.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
    ],
    [
      "read earlier in the same answer",
      { filePath: "a.ts", unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ],
    ["read all of, part of it no longer had", partOf("a.ts")],
  ])(
    "a file %s: the heading says what AI no longer had, too",
    (_how: string, finding: CodeFileUnseenFinding) => {
      expect(
        describeCodeFilesUnseenForReviewer({
          baseBranchName: "main",
          findings: [
            { filePath: "b.ts", unseen: CodeFileUnseen.NotRead },
            finding,
          ],
        })!.split("\n")[0],
      ).toBe(HEADING_NO_LONGER_HAD);
    },
  );

  test("nothing AI read and no longer had: the heading as it always was", () => {
    expect(
      describeCodeFilesUnseenForReviewer({
        baseBranchName: "main",
        findings: [
          { filePath: "b.ts", unseen: CodeFileUnseen.NotRead },
          { filePath: "c.ts", unseen: CodeFileUnseen.ChangedSinceRead },
          {
            filePath: "d.ts",
            unseen: CodeFileUnseen.ReadInPart,
            lineCount: 10,
            linesNotRead: [{ first: 1, last: 5 }],
          },
          { filePath: "e.ts", unseen: CodeFileUnseen.NotChecked },
        ],
      })!.split("\n")[0],
    ).toBe(HEADING_NOT_READ);
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
      expect(drawn).not.toContain("no longer has part");
      expect(drawn).not.toContain(describeAIActionSentence(sentence));
      expect(getAIActionSentenceLanguage(sentence, translator)).toBe(language);
    }
  });

  test.each(OTHER_LINES)(
    "never in the words of a file %s: every line of it was read, and part of it is in hand",
    (
      _line: string,
      other: typeof AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
    ) => {
      for (const [key, otherKey] of [
        [PLURAL.other, other.other],
        [`${PLURAL.other}_one`, `${other.other}_one`],
        [PLURAL.one, other.one],
      ]) {
        expect({ key, same: words[key!] === words[otherKey!] }).toEqual({
          key,
          same: false,
        });
      }
    },
  );

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

    // "Becomes", "them", "versions" and "files" with the zero-width non-joiner Persian writes inside them.
    const nonJoiner: string = String.fromCharCode(0x200c);
    expect(words[PLURAL.one]).toContain(`می${nonJoiner}شود`);
    expect(words[PLURAL.other]).toContain(`می${nonJoiner}شوند`);
    expect(words[PLURAL.other]).toContain(`آن${nonJoiner}ها`);
    expect(words[PLURAL.other]).toContain(`نسخه${nonJoiner}های`);
    expect(words[PLURAL.other]).toContain(`فایل${nonJoiner}ها`);
    // And no marks that set a direction: the reader's own does (Locales/ARABIC.md).
    for (const key of [PLURAL.other, PLURAL.one]) {
      expect(words[key]).not.toMatch(DIRECTION_MARKS);
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
      expect(words[key]).not.toMatch(DIRECTION_MARKS);
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

  test("Japanese ends the sentence with its own full stop", () => {
    const words: Record<string, string> = readDashboardLocale("ja");

    for (const key of [PLURAL.other, PLURAL.one]) {
      expect(words[key]!.endsWith("{{files}}。")).toBe(true);
    }
  });

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
