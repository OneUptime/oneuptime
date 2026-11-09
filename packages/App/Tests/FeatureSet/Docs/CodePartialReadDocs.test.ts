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
  CodeFileUnseen,
  findCodeFileUnseen,
  getCodeFileLinesShown,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read only part of (issue
 * #6330), in every docs language: the card line it quotes is the one that
 * language's Dashboard draws, with the file as the card writes it, on the
 * code-change bullet, before what it says of a new file. The English is
 * held to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
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

describe("the Ask AI page on a file Ask AI read only part of (issue #6330)", () => {
  it("quotes the card line as the English card says it, on the code-change bullet", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(READ_IN_PART);

    expect(line).toBe(
      "Ask AI read only part of this file, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says why, and that reading all of it - in one read or several - says nothing", () => {
    const bullet: string = codeBulletOf("en");

    for (const said of [
      "Ask AI reads a long file a part at a time, so the card also names a file Ask AI read only part of, for example",
      "Once Ask AI has read all of the file, in one read or in several, the card says nothing of it.",
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
          { branchName: "fix/login", fingerprint: "a", order: 1, linesShown: part },
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
      expect(codeBulletOf(language)).toContain(line);
    });

    it("says it after the line about a file changed since the read, on the bullet it extends", () => {
      const bullet: string = codeBulletOf(language);
      const changed: string = describeAIActionSentence(
        CHANGED,
        translatorFor(language),
      );
      const part: string = describeAIActionSentence(
        READ_IN_PART,
        translatorFor(language),
      );

      expect(bullet.indexOf(changed)).toBeGreaterThan(-1);
      expect(bullet.indexOf(part)).toBeGreaterThan(bullet.indexOf(changed));
      // Each quoted once.
      expect(bullet.split(part)).toHaveLength(2);
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
