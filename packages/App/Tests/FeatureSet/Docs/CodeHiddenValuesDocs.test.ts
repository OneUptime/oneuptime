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
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import { findCodePlaceholdersWritten } from "Common/Types/CodeRepository/CodeFileValuesHidden";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a code change that writes placeholders
 * where values were hidden from Ask AI (issue #6364), in every docs
 * language: the card line it quotes is the one that language's Dashboard
 * draws, with the file as the card writes it, on the code-change bullet,
 * after what it says of a file read only in part, and the mode it names is
 * the Dashboard's own. The English is held to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
// The file the bullet's other examples name, which finds the bullet.
const BULLET_FILE: string = "src/billing/charge.ts";
const FILE: string = "config/servers.ts";

const lineFor: (template: typeof AI_ACTION_PLURAL_LINES.codeFilesValuesHidden) => AIActionSentence = (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    files: aiActionList([aiActionSentence(AI_ACTION_CODE_FILE, { file: FILE })]),
  });
};

// The card's line for one file Ask AI's version writes placeholders into.
const VALUES_HIDDEN: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
);

// The card's line for one file read only in part (issue #6330), which comes before it.
const READ_IN_PART: AIActionSentence = aiActionPluralSentence(
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
  1,
  {
    files: aiActionList([
      aiActionSentence(AI_ACTION_CODE_FILE, { file: BULLET_FILE }),
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
        return line.startsWith("- ") && line.includes(BULLET_FILE);
      }) || ""
  );
};

const autoRunTitle: string = (
  AIChatPermissionModeHelper.getOptions().find(
    (option: AIChatPermissionModeOption): boolean => {
      return option.value === AIChatPermissionMode.AutoRun;
    },
  ) as AIChatPermissionModeOption
).title;

const flat: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

describe("the Ask AI page on a code change that writes placeholders where values were hidden (issue #6364)", () => {
  it("quotes the card line as the English card says it, on the code-change bullet", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(VALUES_HIDDEN);

    expect(line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: config/servers.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says why, what does not count, and what Auto-run does", () => {
    const bullet: string = codeBulletOf("en");

    for (const said of [
      "Ask AI is never shown values that look like secrets or personal data, such as IP addresses, email addresses and keys: it reads a placeholder such as `[redacted-ip]` in their place.",
      "So the card also names a file into which Ask AI's version writes such placeholders, for example",
      "A placeholder the file on the branch already has does not count.",
      `Ask AI cannot write those values back, so in ${autoRunTitle} it does not make that change, and tells you what to change instead.`,
    ]) {
      expect({ said, inPage: bullet.includes(said) }).toEqual({
        said,
        inPage: true,
      });
    }
  });

  it("is true of the code", () => {
    const serializer: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/Serializer.ts"),
    );
    const writeTools: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeWriteTools.ts"),
    );
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );

    // IP addresses, email addresses and keys are hidden, as placeholders such as [redacted-ip].
    for (const placeholder of [
      'placeholder: "[redacted-ip]"',
      'placeholder: "[redacted-email]"',
      'placeholder: "[redacted-aws-key]"',
      'const PRIVATE_KEY_PLACEHOLDER: string = "[redacted-private-key]"',
    ]) {
      expect(serializer).toContain(placeholder);
    }

    // The prepare holds what the change writes to the file on the branch.
    expect(writeTools).toContain(
      "valuesHidden: findCodeFilesValuesHidden({ changes, texts })",
    );

    // A placeholder the branch's file has already does not count; one more does.
    expect(
      findCodePlaceholdersWritten({
        content: 'A = "[redacted-ip]";\n',
        branchContent: 'A = "[redacted-ip]";\nB = 1;\n',
        placeholders: ["[redacted-ip]"],
      }),
    ).toEqual([]);
    expect(
      findCodePlaceholdersWritten({
        content: 'A = "[redacted-ip]";\n',
        branchContent: 'A = "10.0.0.12";\n',
        placeholders: ["[redacted-ip]"],
      }),
    ).toHaveLength(1);

    // In Auto-run it is not made, and the model is told it cannot write those values back.
    expect(writeTools).toContain(
      "notRunWithoutApproval: unseen.notRunWithoutApproval",
    );
    expect(seen).toContain("You cannot write a value hidden from you back");
    expect(seen).toContain("tell the user what to change, and where");
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the file as the card writes it", () => {
      const line: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("secrets or personal data");
      }
      expect(line).toContain(FILE);
      expect(codeBulletOf(language)).toContain(line);
    });

    it("says it after the line about a file read only in part, once, and names Auto-run as its Dashboard does after it", () => {
      const bullet: string = codeBulletOf(language);
      const hidden: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translatorFor(language),
      );
      const part: string = describeAIActionSentence(
        READ_IN_PART,
        translatorFor(language),
      );
      const label: unknown = dashboardLocale(language)[autoRunTitle];

      expect(bullet.indexOf(part)).toBeGreaterThan(-1);
      expect(bullet.indexOf(hidden)).toBeGreaterThan(bullet.indexOf(part));
      expect(bullet.split(hidden)).toHaveLength(2);
      expect(typeof label).toBe("string");
      expect(bullet.lastIndexOf(label as string)).toBeGreaterThan(
        bullet.indexOf(hidden),
      );
    });

    it("writes the placeholder as code, as the model reads it", () => {
      expect(codeBulletOf(language)).toContain("`[redacted-ip]`");
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
