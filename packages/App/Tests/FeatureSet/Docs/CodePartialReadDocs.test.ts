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
import {
  CodeFileUnseen,
  findCodeFileUnseen,
  getCodeFileLinesShown,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read only part of (issue
 * #6330), in every docs language: the card line it quotes is the one that
 * language's Dashboard draws, with the file as the card writes it, on the
 * code-change bullet, before what it says of a new file. The English is
 * held to the code that makes it true.
 */

const FILE: string = "src/billing/charge.ts";

// The card's line for one file Ask AI read only part of.
const READ_IN_PART: AIActionSentence = aiActionPluralSentence(
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
  1,
  {
    files: aiActionList([
      aiActionSentence(AI_ACTION_CODE_FILE, { file: FILE }),
    ]),
  },
);

// The card's line for one file changed since the read (issue #6313), which comes before it.
const CHANGED: AIActionSentence = aiActionPluralSentence(
  AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead,
  1,
  {
    branch: "fix/login",
    files: aiActionList([
      aiActionSentence(AI_ACTION_CODE_FILE, { file: FILE }),
    ]),
  },
);

const translatorFor: (language: string) => Translator = codeDocsTranslatorFor;

const flat: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

describe("the Ask AI page on a file Ask AI read only part of (issue #6330)", () => {
  it("quotes the card line as the English card says it, as a caution of its own in the Code changes section", () => {
    const line: string = describeAIActionSentence(READ_IN_PART);

    expect(line).toBe(
      "Ask AI read only part of this file, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(
      codeChangeCautionQuoting("en", line)!.startsWith(`  - "${line}"`),
    ).toBe(true);
  });

  it("says why, and that reading all of it - in one read or several, all of it still had - says nothing", () => {
    const bullet: string = codeChangeCautionQuoting(
      "en",
      describeAIActionSentence(READ_IN_PART),
    )!;

    for (const said of [
      "Ask AI reads a long file a part at a time.",
      "Once it has read all of the file, in one read or in several, and still has all of its text, the card says nothing of it.",
    ]) {
      expect({ said, inPage: bullet.includes(said) }).toEqual({
        said,
        inPage: true,
      });
    }
  });

  it("is true of the code", () => {
    const readTool: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeTools.ts"),
    );
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );

    // A file is read a part at a time: at most 400 lines and 12 KB a call.
    expect(readTool).toContain("const MAX_LINES_PER_READ: number = 400;");
    expect(readTool).toContain(
      "const MAX_CODE_PAYLOAD_BYTES: number = 12 * 1024;",
    );
    // Each read keeps the lines it showed.
    expect(readTool).toContain("getCodeFileLinesShown({");

    // Read in part: the card names it. Read all of it, in two reads: nothing.
    const part: ReturnType<typeof getCodeFileLinesShown> =
      getCodeFileLinesShown({ lineCount: 2000, firstLine: 340, lastLine: 460 });

    expect(
      findCodeFileUnseen({
        views: [
          {
            branchName: "fix/login",
            fingerprint: "a",
            order: 1,
            linesShown: part,
          },
        ],
        branchName: "fix/login",
        now: { state: "file", fingerprint: "a" },
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 2000,
      linesNotRead: [
        { first: 1, last: 339 },
        { first: 461, last: 2000 },
      ],
    });
    expect(
      findCodeFileUnseen({
        views: [
          {
            branchName: "main",
            fingerprint: "a",
            order: 1,
            linesShown: getCodeFileLinesShown({
              lineCount: 800,
              firstLine: 1,
              lastLine: 400,
            }),
          },
          {
            branchName: "fix/login",
            fingerprint: "a",
            order: 2,
            linesShown: getCodeFileLinesShown({
              lineCount: 800,
              firstLine: 401,
              lastLine: 800,
            }),
          },
        ],
        branchName: "fix/login",
        now: { state: "file", fingerprint: "a" },
      }),
    ).toBeNull();

    // In Auto-run the model is told to read the rest.
    expect(seen).toContain(
      "Read the lines you have not read of each file you read only part of",
    );
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the file as the card writes it", () => {
      const line: string = describeAIActionSentence(
        READ_IN_PART,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("read only part of");
      }
      expect(line).toContain(FILE);
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("says it after the caution about a file changed since the read, right after the one about a part no longer had, once", () => {
      const translator: Translator = translatorFor(language);
      const changed: string = describeAIActionSentence(CHANGED, translator);
      const part: string = describeAIActionSentence(READ_IN_PART, translator);
      const noLongerHad: string = describeAIActionSentence(
        codeDocsCautionLine(AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand),
        translator,
      );

      expect(codeChangeCautionIndex(language, changed)).toBeGreaterThan(-1);
      expect(codeChangeCautionIndex(language, part)).toBeGreaterThan(
        codeChangeCautionIndex(language, changed),
      );
      expect(codeChangeCautionIndex(language, part)).toBe(
        codeChangeCautionIndex(language, noLongerHad) + 1,
      );
      // Each quoted once.
      expect(codeChangesSectionOf(language).split(part)).toHaveLength(2);
    });

    it("keeps the caution in its place: where the English page has it", () => {
      expect(
        codeChangeCautionIndex(
          language,
          describeAIActionSentence(READ_IN_PART, translatorFor(language)),
        ),
      ).toBe(
        codeChangeCautionIndex("en", describeAIActionSentence(READ_IN_PART)),
      );
    });
  });
});
