import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { readRepoFile } from "./InventoryAndApiDocsSupport";
import {
  AI_ACTION_CODE_FILE,
  AI_ACTION_PLURAL_LINES,
  AIActionSentence,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
  describeAIActionSentence,
} from "Common/Types/AI/AIActionWords";
import {
  AIChatRecordSeen,
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
} from "Common/Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  CodeFileUnseenFinding,
  findCodeFilesUnseen,
  getCodeFileLinesShown,
  seeCodeFile,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read all of, in several
 * parts, and no longer has some of those parts (issue #6984), in every
 * docs language: the card line it quotes is the one that language's
 * Dashboard draws, with the file as the card writes it, on the
 * code-change bullet, right after what it says of a file read earlier in
 * the same answer and left out since (#6570) and before what it says of
 * values hidden (#6364). Before this, the page said nothing of the line,
 * and its "once Ask AI has read all of the file, in one read or in
 * several, the card says nothing of it" read as if lines it no longer has
 * still counted. The English is held to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
const FILE: string = "src/billing/charge.ts";

const lineFor: (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
  file: string,
) => AIActionSentence = (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
  file: string,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    files: aiActionList([aiActionSentence(AI_ACTION_CODE_FILE, { file })]),
  });
};

// The card's line for one file Ask AI read all of, and no longer has part of.
const PART_NO_LONGER_IN_HAND: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
  FILE,
);

// The card's line for a file read earlier in this answer, left out since (issue #6570), which comes before it.
const LEFT_OUT: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
  FILE,
);

// The card's line for a file read only in part (issue #6330), said earlier on the bullet.
const READ_IN_PART: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
  FILE,
);

// The card's line for values hidden (issue #6364), which comes after it.
const VALUES_HIDDEN: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
  "config/servers.ts",
);

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const words: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];
    return typeof value === "string" ? value : undefined;
  }, language);
};

// The bullet about proposing code changes, which says it all.
const codeBulletOf: (language: string) => string = (
  language: string,
): string => {
  return (
    readPage(language, PAGE)
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- ") && line.includes(FILE);
      }) || ""
  );
};

const flat: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

// A 20-line file, as one read of lines first to last shows it.
const read: (first: number, last: number) => AIChatRecordSeen = (
  first: number,
  last: number,
): AIChatRecordSeen => {
  const record: AIChatRecordSeen | null = seeCodeFile({
    repositoryId: "repo",
    branchName: "fix/login",
    filePath: FILE,
    fingerprint: "a",
    linesShown: getCodeFileLinesShown({
      lineCount: 20,
      firstLine: first,
      lastLine: last,
    }),
  });

  if (!record) {
    throw new Error("No record of the read");
  }

  return record;
};

const leftOut: (record: AIChatRecordSeen) => AIChatRecordSeen = (
  record: AIChatRecordSeen,
): AIChatRecordSeen => {
  return markAIChatRecordsFromLeftOutResults([record])[0]!;
};

const earlier: (record: AIChatRecordSeen) => AIChatRecordSeen = (
  record: AIChatRecordSeen,
): AIChatRecordSeen => {
  return markAIChatRecordsFromEarlierAnswers([record])[0]!;
};

// What the card would name of the file, as the branch has the version read.
const decide: (
  records: Array<AIChatRecordSeen>,
) => Array<CodeFileUnseenFinding> = (
  records: Array<AIChatRecordSeen>,
): Array<CodeFileUnseenFinding> => {
  return findCodeFilesUnseen({
    records,
    repositoryId: "repo",
    branchName: "fix/login",
    files: [{ filePath: FILE, now: { state: "file", fingerprint: "a" } }],
  });
};

describe("the Ask AI page on a file Ask AI read in parts and no longer has some of (issue #6984)", () => {
  it("quotes the card line as the English card says it, on the code-change bullet", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(PART_NO_LONGER_IN_HAND);

    expect(line).toBe(
      "Ask AI read this file and no longer has part of its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says when: read in several parts, some of them no longer had", () => {
    expect(codeBulletOf("en")).toContain(
      `If Ask AI read the file in several parts and no longer has some of them, the card says so, for example "${describeAIActionSentence(PART_NO_LONGER_IN_HAND)}"`,
    );
  });

  it("keeps what it says of a file read all of, and of one read again, around it", () => {
    const bullet: string = codeBulletOf("en");
    const said: number = bullet.indexOf(
      "If Ask AI read the file in several parts",
    );
    const readAll: number = bullet.indexOf(
      "Once Ask AI has read all of the file, in one read or in several, the card says nothing of it.",
    );
    const readAgain: number = bullet.indexOf(
      `"${describeAIActionSentence(PART_NO_LONGER_IN_HAND)}" Once Ask AI reads the file again in the answer that changes it, the card says nothing of it.`,
    );

    expect(said).toBeGreaterThan(-1);
    // Read all of it, every part still had: nothing - said before.
    expect(readAll).toBeGreaterThan(-1);
    expect(readAll).toBeLessThan(said);
    // Read again in the answer that changes it: nothing - said right after.
    expect(readAgain).toBeGreaterThan(said);
  });

  it("is true of the code", () => {
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );
    const partNoLongerInHand: CodeFileUnseenFinding = {
      filePath: FILE,
      unseen: CodeFileUnseen.PartNoLongerInHand,
      lineCount: 20,
      linesNoLongerInHand: [{ first: 1, last: 10 }],
    };

    // Read in two halves, both still had: nothing.
    expect(decide([read(1, 10), read(11, 20)])).toEqual([]);

    // The first half left out of this answer since: named, never "read only part".
    expect(decide([leftOut(read(1, 10)), read(11, 20)])).toEqual([
      partNoLongerInHand,
    ]);

    // The first half read in an earlier answer: named the same way.
    expect(decide([earlier(read(1, 10)), read(11, 20)])).toEqual([
      partNoLongerInHand,
    ]);

    // Neither half had any more: the line about a file read earlier in this answer.
    expect(decide([leftOut(read(1, 10)), leftOut(read(11, 20))])).toEqual([
      { filePath: FILE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ]);

    // Read again in the answer that changes it: nothing.
    expect(decide([leftOut(read(1, 10)), read(11, 20), read(1, 10)])).toEqual(
      [],
    );

    // A half never read at all is still "read only part".
    expect(decide([read(11, 20)])).toEqual([
      {
        filePath: FILE,
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: 20,
        linesNotRead: [{ first: 1, last: 10 }],
      },
    ]);

    // The card draws the line the page quotes for it.
    expect(seen).toContain(
      "CodeFileUnseen.PartNoLongerInHand, ); if (partNoLongerInHand.length > 0) { lines.push( aiActionPluralSentence( AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,",
    );

    // In Auto-run nothing is committed, and the model reads those lines again.
    expect(seen).toContain(
      '"Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text."',
    );
    expect(seen).toContain("Read the lines you no longer have again now");
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the file as the card writes it", () => {
      const line: string = describeAIActionSentence(
        PART_NO_LONGER_IN_HAND,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("no longer has part");
      }
      expect(line).toContain(FILE);
      expect(codeBulletOf(language)).toContain(line);
    });

    it("says it right after the line about a file left out of this answer, and before the one about hidden values, once", () => {
      const bullet: string = codeBulletOf(language);
      const translator: Translator = translatorFor(language);
      const part: string = describeAIActionSentence(
        PART_NO_LONGER_IN_HAND,
        translator,
      );
      const left: string = describeAIActionSentence(LEFT_OUT, translator);
      const inPart: string = describeAIActionSentence(READ_IN_PART, translator);
      const hidden: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translator,
      );

      // Three different lines, each said once.
      expect(new Set([part, left, inPart]).size).toBe(3);
      expect(bullet.split(part)).toHaveLength(2);
      expect(bullet.split(left)).toHaveLength(2);

      expect(bullet.indexOf(inPart)).toBeGreaterThan(-1);
      expect(bullet.indexOf(left)).toBeGreaterThan(bullet.indexOf(inPart));
      expect(bullet.indexOf(part)).toBeGreaterThan(bullet.indexOf(left));
      expect(bullet.indexOf(hidden)).toBeGreaterThan(bullet.indexOf(part));

      // Between the two lines: one sentence that says when, in the language.
      const between: string = bullet.slice(
        bullet.indexOf(left) + left.length,
        bullet.indexOf(part),
      );

      expect(between).toContain("Ask AI");
      expect(between.length).toBeLessThan(200);
      if (language !== "en") {
        expect(between).not.toContain("several parts");
      }
    });

    it("keeps the bullet one line, in its place", () => {
      const lines: Array<string> = readPage(language, PAGE).split("\n");
      const english: Array<string> = readPage("en", PAGE).split("\n");

      expect(lines.indexOf(codeBulletOf(language))).toBe(
        english.indexOf(codeBulletOf("en")),
      );
    });
  });
});
