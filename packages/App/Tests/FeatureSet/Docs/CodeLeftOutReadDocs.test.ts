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
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
} from "Common/Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  findCodeFilesUnseen,
  seeCodeFile,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read earlier in the same
 * answer, whose result a very long answer has left out since (issue
 * #6570), in every docs language: the card line it quotes is the one that
 * language's Dashboard draws, with the file as the card writes it, a
 * caution of its own in the page's Code changes section (#6983), right
 * after the one about a file read only in an earlier answer (#6365), in
 * the card's order. The English is held to the code that makes it true.
 */

const FILE: string = "src/billing/charge.ts";

const lineFor: (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
  file: string,
) => AIActionSentence = (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
  file: string,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    files: aiActionList([aiActionSentence(AI_ACTION_CODE_FILE, { file })]),
  });
};

// The card's line for one file Ask AI read earlier in this answer, and no longer has.
const LEFT_OUT: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
  FILE,
);

// The card's line for a file read only in an earlier answer (issue #6365), which comes before it.
const EARLIER: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
  FILE,
);

// The card's line for a file read all of and no longer had part of (issue #6984), which comes after it.
const PART_NO_LONGER_IN_HAND: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
  FILE,
);

const translatorFor: (language: string) => Translator = codeDocsTranslatorFor;

const flat: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

describe("the Ask AI page on a file Ask AI read earlier in the same answer, left out since (issue #6570)", () => {
  it("quotes the card line as the English card says it, as a caution of its own in the Code changes section", () => {
    const line: string = describeAIActionSentence(LEFT_OUT);

    expect(line).toBe(
      "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(codeChangeCautionQuoting("en", line)).toBe(
      `  - "${line}" A very long answer leaves out its oldest results, to stay within what the model can take in at once.`,
    );
  });

  it("says why: a very long answer leaves out its oldest results", () => {
    expect(codeChangesSectionOf("en")).toContain(
      "A very long answer leaves out its oldest results, to stay within what the model can take in at once.",
    );
  });

  it("is true of the code", () => {
    const runner: string = flat(
      readRepoFile("Common/Server/Utils/AI/Chat/ChatAgentRunner.ts"),
    );
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );

    // The runner reads which results the conversation left out, and marks their records.
    expect(runner).toContain(
      "const leftOut: Set<string> = getElidedToolResultCitations(messages);",
    );
    expect(runner).toContain("? markAIChatRecordsFromLeftOutResults(records)");

    const record: ReturnType<typeof seeCodeFile> = seeCodeFile({
      repositoryId: "repo",
      branchName: "fix/login",
      filePath: FILE,
      fingerprint: "a",
    });
    const decide: (
      records: Array<unknown>,
    ) => Array<{ unseen: CodeFileUnseen }> = (
      records: Array<unknown>,
    ): Array<{ unseen: CodeFileUnseen }> => {
      return findCodeFilesUnseen({
        records,
        repositoryId: "repo",
        branchName: "fix/login",
        files: [{ filePath: FILE, now: { state: "file", fingerprint: "a" } }],
      });
    };

    // Read in this answer and left out since: said. Read again: nothing.
    expect(decide(markAIChatRecordsFromLeftOutResults([record]))).toEqual([
      { filePath: FILE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ]);
    expect(
      decide([...markAIChatRecordsFromLeftOutResults([record]), record]),
    ).toEqual([]);

    // Read in an earlier answer too, this answer's read is the one it names.
    expect(
      decide([
        ...markAIChatRecordsFromEarlierAnswers([record]),
        ...markAIChatRecordsFromLeftOutResults([record]),
      ]),
    ).toEqual([
      { filePath: FILE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ]);

    // In Auto-run the model is told to read it again now.
    expect(seen).toContain("Read each file whose text was left out again now");
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the file as the card writes it", () => {
      const line: string = describeAIActionSentence(
        LEFT_OUT,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("earlier in this answer");
      }
      expect(line).toContain(FILE);
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("says it right after the caution about a file read in an earlier answer and before the one about a part no longer had, once", () => {
      const translator: Translator = translatorFor(language);
      const leftOut: string = describeAIActionSentence(LEFT_OUT, translator);
      const earlier: string = describeAIActionSentence(EARLIER, translator);
      const part: string = describeAIActionSentence(
        PART_NO_LONGER_IN_HAND,
        translator,
      );

      expect(leftOut).not.toBe(earlier);
      expect(codeChangeCautionIndex(language, earlier)).toBeGreaterThan(-1);
      expect(codeChangeCautionIndex(language, leftOut)).toBe(
        codeChangeCautionIndex(language, earlier) + 1,
      );
      expect(codeChangeCautionIndex(language, part)).toBe(
        codeChangeCautionIndex(language, leftOut) + 1,
      );
      expect(codeChangesSectionOf(language).split(leftOut)).toHaveLength(2);
    });

    it("keeps the caution in its place: where the English page has it", () => {
      expect(
        codeChangeCautionIndex(
          language,
          describeAIActionSentence(LEFT_OUT, translatorFor(language)),
        ),
      ).toBe(codeChangeCautionIndex("en", describeAIActionSentence(LEFT_OUT)));
    });
  });
});
