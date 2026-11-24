import { DOCS_LANGUAGES } from "./DocsContentSupport";
import {
  codeChangeCautionIndex,
  codeChangeCautionQuoting,
  codeChangesSectionOf,
  codeDocsCautionLine,
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
import { markAIChatRecordsFromEarlierAnswers } from "Common/Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  findCodeFilesUnseen,
  seeCodeFile,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read only in an earlier
 * answer (issue #6365), in every docs language: the card line it quotes is
 * the one that language's Dashboard draws, with the file as the card writes
 * it, on the code-change bullet, after what it says of a file read only in
 * part and before what it says of values hidden (#6364). The English is held
 * to the code that makes it true.
 */

const FILE: string = "src/billing/charge.ts";

const lineFor: (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
  file: string,
) => AIActionSentence = (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
  file: string,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    files: aiActionList([aiActionSentence(AI_ACTION_CODE_FILE, { file })]),
  });
};

// The card's line for one file Ask AI read only in an earlier answer.
const EARLIER: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
  FILE,
);

// The card's line for a file Ask AI never read (issue #6313), which comes before it.
const NOT_READ: AIActionSentence = codeDocsCautionLine(
  AI_ACTION_PLURAL_LINES.codeFilesNotRead,
);

// The card's line for a file read earlier in this answer and left out since (issue #6570), which comes after it.
const LEFT_OUT: AIActionSentence = codeDocsCautionLine(
  AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
);

const translatorFor: (language: string) => Translator = codeDocsTranslatorFor;

const flat: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

describe("the Ask AI page on a file Ask AI read only in an earlier answer (issue #6365)", () => {
  it("quotes the card line as the English card says it, as a caution of its own in the Code changes section", () => {
    const line: string = describeAIActionSentence(EARLIER);

    expect(line).toBe(
      "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(codeChangeCautionQuoting("en", line)).toBe(
      `  - "${line}" A later answer has the words of the earlier ones, not the files they read.`,
    );
  });

  it("says why, and that reading it again in the answer that changes it says nothing", () => {
    const bullet: string = codeChangesSectionOf("en");

    for (const said of [
      "A later answer has the words of the earlier ones, not the files they read.",
      "Once Ask AI reads the file again in the answer that changes it, the card says nothing of it.",
    ]) {
      expect({ said, inPage: bullet.includes(said) }).toEqual({
        said,
        inPage: true,
      });
    }
  });

  it("is true of the code", () => {
    const runner: string = flat(
      readRepoFile("Common/Server/Utils/AI/Chat/ChatAgentRunner.ts"),
    );
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );

    // A later answer replays the earlier answers, and the runner marks their records.
    expect(runner).toContain(
      "...markAIChatRecordsFromEarlierAnswers(state.recordsSeenBeforeTurn),",
    );

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

    // Read in an earlier answer: said. Read again in this one: nothing.
    expect(decide(markAIChatRecordsFromEarlierAnswers([record]))).toEqual([
      { filePath: FILE, unseen: CodeFileUnseen.ReadInEarlierAnswer },
    ]);
    expect(
      decide([...markAIChatRecordsFromEarlierAnswers([record]), record]),
    ).toEqual([]);

    // In Auto-run the model is told to read it again, in this answer.
    expect(seen).toContain(
      "Read each file you read in an earlier answer again in this answer",
    );
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the file as the card writes it", () => {
      const line: string = describeAIActionSentence(
        EARLIER,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("earlier answer");
      }
      expect(line).toContain(FILE);
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("says it right after the caution about a file never read and before the one about a file left out of this answer, once", () => {
      const translator: Translator = translatorFor(language);
      const earlier: string = describeAIActionSentence(EARLIER, translator);
      const notRead: string = describeAIActionSentence(NOT_READ, translator);
      const leftOut: string = describeAIActionSentence(LEFT_OUT, translator);

      expect(codeChangeCautionIndex(language, notRead)).toBeGreaterThan(-1);
      expect(codeChangeCautionIndex(language, earlier)).toBe(
        codeChangeCautionIndex(language, notRead) + 1,
      );
      expect(codeChangeCautionIndex(language, leftOut)).toBe(
        codeChangeCautionIndex(language, earlier) + 1,
      );
      expect(codeChangesSectionOf(language).split(earlier)).toHaveLength(2);
    });

    it("keeps the caution in its place: where the English page has it", () => {
      expect(
        codeChangeCautionIndex(
          language,
          describeAIActionSentence(EARLIER, translatorFor(language)),
        ),
      ).toBe(codeChangeCautionIndex("en", describeAIActionSentence(EARLIER)));
    });
  });
});
