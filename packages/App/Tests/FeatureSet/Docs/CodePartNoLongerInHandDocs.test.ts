import { DOCS_LANGUAGES } from "./DocsContentSupport";
import {
  codeChangeCautionIndex,
  codeChangeCautionQuoting,
  codeChangesSectionOf,
  codeDocsTranslatorFor,
} from "./CodeChangesDocsSection";
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
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read all of, in several
 * parts, and no longer has some of those parts (issue #6984), in every
 * docs language: the card line it quotes is the one that language's
 * Dashboard draws, with the file as the card writes it, a caution of its
 * own in the page's Code changes section (#6983), right after the one
 * about a file read earlier in the same answer and left out since (#6570)
 * and right before the one about a file read only in part (#6330), in the
 * card's order. Before #6984, the page said nothing of the line, and its
 * "once Ask AI has read all of the file, in one read or in several, the
 * card says nothing of it" read as if lines it no longer has still
 * counted: it now says "and still has all of its text". The English is
 * held to the code that makes it true.
 */

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

// The card's line for a file read only in part (issue #6330), the caution right after it.
const READ_IN_PART: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
  FILE,
);

// The card's line for values hidden (issue #6364), the card's first caution.
const VALUES_HIDDEN: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
  "config/servers.ts",
);

const translatorFor: (language: string) => Translator = codeDocsTranslatorFor;

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
  it("quotes the card line as the English card says it, as a caution of its own in the Code changes section", () => {
    const line: string = describeAIActionSentence(PART_NO_LONGER_IN_HAND);

    expect(line).toBe(
      "Ask AI read this file and no longer has part of its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(codeChangeCautionQuoting("en", line)).toBe(
      `  - "${line}" Ask AI read the file in several parts and no longer has some of them.`,
    );
  });

  it("says when: read in several parts, some of them no longer had", () => {
    expect(codeChangesSectionOf("en")).toContain(
      `"${describeAIActionSentence(PART_NO_LONGER_IN_HAND)}" Ask AI read the file in several parts and no longer has some of them.`,
    );
  });

  it("says a file read all of says nothing only while all of its text is still had, and so does one read again", () => {
    const section: string = codeChangesSectionOf("en");

    // Read all of it, every part still had: nothing.
    expect(section).toContain(
      "Once it has read all of the file, in one read or in several, and still has all of its text, the card says nothing of it.",
    );
    // Read again in the answer that changes it: nothing.
    expect(section).toContain(
      "Once Ask AI reads the file again in the answer that changes it, the card says nothing of it.",
    );
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

    /*
     * In Auto-run nothing is committed - the action's record and its Skipped
     * row say so, in words of their own (issue #6982) - and the model reads
     * those lines again.
     */
    expect(flat(readRepoFile("Common/Types/AI/AIActionWords.ts"))).toContain(
      '"Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text."',
    );
    expect(seen).toContain(
      "[CodeFileUnseen.PartNoLongerInHand]: AI_ACTION_CODE_NOT_MADE.notCommittedPartNoLongerInHand,",
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
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("says it right after the caution about a file left out of this answer, and right before the one about a file read in part, once", () => {
      const section: string = codeChangesSectionOf(language);
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
      expect(section.split(part)).toHaveLength(2);
      expect(section.split(left)).toHaveLength(2);

      // The card's order: hidden values first, ..., left out, part no longer had, read in part.
      expect(codeChangeCautionIndex(language, hidden)).toBe(0);
      expect(codeChangeCautionIndex(language, part)).toBe(
        codeChangeCautionIndex(language, left) + 1,
      );
      expect(codeChangeCautionIndex(language, inPart)).toBe(
        codeChangeCautionIndex(language, part) + 1,
      );

      // After the quote: one sentence that says when, in the language.
      const item: string = codeChangeCautionQuoting(language, part)!;
      const when: string = item.slice(item.indexOf(part) + part.length);

      expect(when.length).toBeGreaterThan(10);
      expect(when.length).toBeLessThan(200);
      if (language !== "en") {
        expect(when).not.toContain("several parts");
      }
    });

    it("keeps the caution in its place: where the English page has it", () => {
      expect(
        codeChangeCautionIndex(
          language,
          describeAIActionSentence(
            PART_NO_LONGER_IN_HAND,
            translatorFor(language),
          ),
        ),
      ).toBe(
        codeChangeCautionIndex(
          "en",
          describeAIActionSentence(PART_NO_LONGER_IN_HAND),
        ),
      );
    });
  });
});
