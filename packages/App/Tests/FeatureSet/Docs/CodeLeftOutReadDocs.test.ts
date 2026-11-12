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
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
} from "Common/Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  findCodeFilesUnseen,
  seeCodeFile,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read earlier in the same
 * answer, whose result a very long answer has left out since (issue
 * #6570), in every docs language: the card line it quotes is the one that
 * language's Dashboard draws, with the file as the card writes it, on the
 * code-change bullet, right after what it says of a file read only in an
 * earlier answer (#6365) and before what it says of values hidden (#6364).
 * The English is held to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
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

describe("the Ask AI page on a file Ask AI read earlier in the same answer, left out since (issue #6570)", () => {
  it("quotes the card line as the English card says it, on the code-change bullet", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(LEFT_OUT);

    expect(line).toBe(
      "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says why: a very long answer leaves out its oldest results", () => {
    expect(codeBulletOf("en")).toContain(
      "A very long answer also leaves out its oldest results, to stay within what the model can take in at once, so the card also names a file Ask AI read earlier in the same answer if that result was left out, for example",
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
      expect(codeBulletOf(language)).toContain(line);
    });

    it("says it after the line about a file read in an earlier answer and before the one about hidden values, once", () => {
      const bullet: string = codeBulletOf(language);
      const translator: Translator = translatorFor(language);
      const leftOut: string = describeAIActionSentence(LEFT_OUT, translator);
      const earlier: string = describeAIActionSentence(EARLIER, translator);
      const hidden: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translator,
      );

      expect(leftOut).not.toBe(earlier);
      expect(bullet.indexOf(earlier)).toBeGreaterThan(-1);
      expect(bullet.indexOf(leftOut)).toBeGreaterThan(bullet.indexOf(earlier));
      expect(bullet.indexOf(hidden)).toBeGreaterThan(bullet.indexOf(leftOut));
      expect(bullet.split(leftOut)).toHaveLength(2);
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
