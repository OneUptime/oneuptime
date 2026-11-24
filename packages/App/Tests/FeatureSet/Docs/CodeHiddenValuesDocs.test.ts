import { DOCS_LANGUAGES } from "./DocsContentSupport";
import {
  codeChangeCautionIndex,
  codeChangeCautionQuoting,
  codeChangesSectionOf,
  codeDocsCautionLine,
  codeDocsTranslatorFor,
} from "./CodeChangesDocsSection";
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
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a code change that writes placeholders
 * where values were hidden from Ask AI (issue #6364), and the values
 * OneUptime writes back on a line Ask AI kept exactly as shown (#6388), in
 * every docs language: the card line it quotes is the one that language's
 * Dashboard draws, with the file as the card writes it, the first caution
 * of the page's Code changes section (#6983), as it is the card's, and the
 * mode it names is the Dashboard's own. The English is held to the code
 * that makes it true.
 */

// The file the section's other examples name.
const BULLET_FILE: string = "src/billing/charge.ts";
const FILE: string = "config/servers.ts";

const lineFor: (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
) => AIActionSentence = (
  template: typeof AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    files: aiActionList([
      aiActionSentence(AI_ACTION_CODE_FILE, { file: FILE }),
    ]),
  });
};

// The card's line for one file Ask AI's version writes placeholders into.
const VALUES_HIDDEN: AIActionSentence = lineFor(
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
);

// The card's line for one file changed since the read (issue #6313), the caution after it.
const CHANGED: AIActionSentence = codeDocsCautionLine(
  AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead,
  BULLET_FILE,
);

const translatorFor: (language: string) => Translator = codeDocsTranslatorFor;

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
  it("quotes the card line as the English card says it, the first caution of the Code changes section", () => {
    const line: string = describeAIActionSentence(VALUES_HIDDEN);

    expect(line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: config/servers.ts.",
    );
    expect(codeChangeCautionQuoting("en", line)).toBe(
      `  - "${line}" Its version keeps a placeholder that OneUptime can't write back (see **Hidden values**).`,
    );
    expect(codeChangeCautionIndex("en", line)).toBe(0);
  });

  it("says why, what is written back and what is not, what does not count, and what Auto-run does", () => {
    const bullet: string = codeChangesSectionOf("en");

    for (const said of [
      "Ask AI is never shown values that look like secrets or personal data, such as IP addresses, email addresses and keys: it reads a placeholder such as `[redacted-ip]` in their place.",
      "When its version keeps such a line exactly as it was shown, OneUptime writes the value back as the file has it, and the card says nothing of it.",
      "A placeholder stays on a line Ask AI changed, on a line that reads the same as another line with a different value, and in a new file.",
      "A placeholder the file on the branch already has does not count.",
      `**In ${autoRunTitle}.** Where nobody approves actions, Ask AI does not make a change its card would warn about`,
      "or, for a placeholder it can't write back, tells you what to change instead.",
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

    // A line kept exactly as shown has its value written back (issue #6388): counted after that.
    expect(seen).toContain(
      "? restoreCodeFileValuesHidden({ content: change.content, fileContent: text.text, }).placeholdersWritten",
    );
    expect(writeTools).toContain(
      "const files: Array<CodeHostFileWrite> = await writeHiddenValuesBack({",
    );

    // In Auto-run what cannot be written back is not made, and the model is told why.
    expect(writeTools).toContain(
      "notRunWithoutApproval: unseen.notRunWithoutApproval",
    );
    expect(seen).toContain(
      "OneUptime writes a hidden value back only on a line you keep exactly as read_code_file showed it",
    );
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
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("says it first, before the caution about a file changed since the read, once, and names Auto-run as its Dashboard does after it", () => {
      const section: string = codeChangesSectionOf(language);
      const hidden: string = describeAIActionSentence(
        VALUES_HIDDEN,
        translatorFor(language),
      );
      const changed: string = describeAIActionSentence(
        CHANGED,
        translatorFor(language),
      );
      const label: unknown = dashboardLocale(language)[autoRunTitle];

      expect(codeChangeCautionIndex(language, hidden)).toBe(0);
      expect(codeChangeCautionIndex(language, changed)).toBe(1);
      expect(section.split(hidden)).toHaveLength(2);
      expect(typeof label).toBe("string");
      expect(section.lastIndexOf(label as string)).toBeGreaterThan(
        section.indexOf(hidden),
      );
    });

    it("writes the placeholder as code, as the model reads it", () => {
      expect(codeChangesSectionOf(language)).toContain("`[redacted-ip]`");
    });
  });
});
