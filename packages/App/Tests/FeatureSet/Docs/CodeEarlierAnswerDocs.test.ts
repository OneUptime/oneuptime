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
import { markAIChatRecordsFromEarlierAnswers } from "Common/Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  findCodeFilesUnseen,
  seeCodeFile,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a file Ask AI read only in an earlier
 * answer (issue #6365), in every docs language: the card line it quotes is
 * the one that language's Dashboard draws, with the file as the card writes
 * it, on the code-change bullet, after what it says of a file read only in
 * part and before what it says of values hidden (#6364). The English is held
 * to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
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

// The card's line for a file read only in part (issue #6330), which comes before it.
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

describe("the Ask AI page on a file Ask AI read only in an earlier answer (issue #6365)", () => {
  it("quotes the card line as the English card says it, on the code-change bullet", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(EARLIER);

    expect(line).toBe(
      "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says why, and that reading it again in the answer that changes it says nothing", () => {
    const bullet: string = codeBulletOf("en");

    for (const said of [
      "A later answer has the words of the earlier ones, not the files they read, so the card also names a file Ask AI read only in an earlier answer, for example",
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
      expect(codeBulletOf(language)).toContain(line);
    });

    it("says it after the line about a file read in part and before the one about hidden values, once", () => {
      const bullet: string = codeBulletOf(language);
      const translator: Translator = translatorFor(language);
      const earlier: string = describeAIActionSentence(EARLIER, translator);
      const part: string = describeAIActionSentence(READ_IN_PART, translator);
      const hidden: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translator,
      );

      expect(bullet.indexOf(part)).toBeGreaterThan(-1);
      expect(bullet.indexOf(earlier)).toBeGreaterThan(bullet.indexOf(part));
      expect(bullet.indexOf(hidden)).toBeGreaterThan(bullet.indexOf(earlier));
      expect(bullet.split(earlier)).toHaveLength(2);
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
