import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import {
  ASK_AI_PAGE,
  CODE_DOCS_FILE,
  CODE_DOCS_HIDDEN_FILE,
  codeChangeActionBulletOf,
  codeChangeCautionsOf,
  codeChangesBulletStartingWith,
  codeChangesSectionLinesOf,
  codeChangesSectionOf,
  codeChangesSectionRangeOf,
  codeDocsCautionLine,
  codeDocsTranslatorFor,
} from "./CodeChangesDocsSection";
import {
  AI_ACTION_CODE_CHANGE_LINES,
  AI_ACTION_CODE_NOT_MADE,
  AI_ACTION_PLURAL_LINES,
  AIActionSentence,
  describeAIActionSentence,
  getAIActionPluralTemplate,
} from "Common/Types/AI/AIActionWords";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import { describeCodeFilesUnseenForPerson } from "Common/Server/Utils/AI/Toolbox/CodeFilesSeen";
import {
  CodeFileUnseen,
  CodeFileUnseenFinding,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * ISSUE #6983: ASK AI'S CODE CHANGES, A SECTION OF THEIR OWN.
 *
 * All of the Ask AI page's code-change text sat in one item of its list of
 * actions - "Propose a code change: ..." - a single paragraph of fourteen
 * sentences that every fix added one more to. The card draws each caution
 * on a line of its own, so a reader could not find the one caution they
 * were looking at. The text is a section of its own now, "Code changes",
 * with a short pointer left in the list of actions; in it, every caution
 * the card can show is a list item quoting the card's own line, in the
 * order the card says them, in every docs language, each language's
 * Dashboard words.
 */

// One finding of each kind, as the card would see them in a change of several files.
const ONE_OF_EACH: Array<CodeFileUnseenFinding> = [
  { filePath: "a.ts", unseen: CodeFileUnseen.NotChecked },
  {
    filePath: "b.ts",
    unseen: CodeFileUnseen.ReadInPart,
    lineCount: 20,
    linesNotRead: [{ first: 11, last: 20 }],
  },
  {
    filePath: "c.ts",
    unseen: CodeFileUnseen.PartNoLongerInHand,
    lineCount: 20,
    linesNoLongerInHand: [{ first: 1, last: 10 }],
  },
  { filePath: "d.ts", unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
  { filePath: "e.ts", unseen: CodeFileUnseen.ReadInEarlierAnswer },
  { filePath: "f.ts", unseen: CodeFileUnseen.NotRead },
  {
    filePath: "g.ts",
    unseen: CodeFileUnseen.ReadOnAnotherBranch,
    readOnBranch: "main",
  },
  { filePath: "h.ts", unseen: CodeFileUnseen.ChangedSinceRead },
  {
    filePath: "i.ts",
    unseen: CodeFileUnseen.ValuesHidden,
    placeholdersWritten: [
      {
        placeholder: "[redacted-ip]",
        written: 1,
        onBranch: 0,
        lines: [{ first: 1, last: 1 }],
      },
    ],
  },
];

// The card's lines, in the order the card says them.
const CARD_ORDER: Array<PluralTemplate> = describeCodeFilesUnseenForPerson({
  branchName: "fix/login",
  findings: ONE_OF_EACH,
}).map((sentence: AIActionSentence): PluralTemplate => {
  return getAIActionPluralTemplate(sentence.template)!;
});

// Each caution as the section quotes it: config/servers.ts for hidden values, the billing file for the rest.
const quotedLine: (
  template: PluralTemplate,
  translator?: Translator,
) => string = (template: PluralTemplate, translator?: Translator): string => {
  return describeAIActionSentence(
    codeDocsCautionLine(
      template,
      template === AI_ACTION_PLURAL_LINES.codeFilesValuesHidden
        ? CODE_DOCS_HIDDEN_FILE
        : CODE_DOCS_FILE,
    ),
    translator,
  );
};

const autoRunTitle: string = (
  AIChatPermissionModeHelper.getOptions().find(
    (option: AIChatPermissionModeOption): boolean => {
      return option.value === AIChatPermissionMode.AutoRun;
    },
  ) as AIChatPermissionModeOption
).title;

describe("the Ask AI page's Code changes section, in English", () => {
  it("is a section of its own, after Set things up, and the list of actions points to it", () => {
    const lines: Array<string> = readPage("en", ASK_AI_PAGE).split("\n");
    const { start } = codeChangesSectionRangeOf("en");

    expect(start).toBeGreaterThan(lines.indexOf("## Set things up"));
    expect(start).toBeLessThan(lines.indexOf("## Steering a conversation"));
    expect(codeChangeActionBulletOf("en")).toBe(
      "- Propose a code change: commit to a new branch of a repository on GitHub, GitLab, Forgejo or Gitea and open a pull request (a merge request on GitLab). See [Code changes](#code-changes).",
    );
    // The pointer is short: the section says it all.
    expect(codeChangeActionBulletOf("en").length).toBeLessThan(250);
  });

  it("says what Ask AI never writes, that it writes each file whole, and what a new file does", () => {
    expect(
      codeChangesBulletStartingWith("en", "**Never the default branch.**"),
    ).toContain(
      "Ask AI never writes to the default branch or a protected one, so a person still merges the change.",
    );

    const whole: string = codeChangesBulletStartingWith(
      "en",
      "**Each file whole.**",
    );

    expect(whole).toContain(
      "Ask AI writes each file whole, from the file as it last read it, and reads a repository's main branch unless it is asked for another.",
    );
    expect(whole).toContain("A new file never counts.");
  });

  it("lists every caution the card can show, one item each, quoting the card's own line, in the card's order", () => {
    const cautions: Array<string> = codeChangeCautionsOf("en");

    // Every line a code change's card can carry, each once.
    expect(
      CARD_ORDER.map((plural: PluralTemplate) => {
        return plural.other;
      }).sort(),
    ).toEqual([...AI_ACTION_CODE_CHANGE_LINES].sort());
    expect(cautions).toHaveLength(AI_ACTION_CODE_CHANGE_LINES.length);

    CARD_ORDER.forEach((template: PluralTemplate, index: number) => {
      const line: string = quotedLine(template);

      expect({
        index,
        item: cautions[index]!.startsWith(`  - "${line}"`),
      }).toEqual({
        index,
        item: true,
      });
    });
  });

  it("says when a file read in parts, or read again, says nothing", () => {
    const section: string = codeChangesSectionOf("en");

    expect(section).toContain(
      "Once it has read all of the file, in one read or in several, and still has all of its text, the card says nothing of it.",
    );
    expect(codeChangesBulletStartingWith("en", "**Reading again.**")).toContain(
      "Once Ask AI reads the file again in the answer that changes it, the card says nothing of it. To keep what someone else changed, skip the action and ask Ask AI to read the files again.",
    );
  });

  it("says a value hidden from Ask AI is written back on a line kept exactly as shown, and when it is not", () => {
    const hidden: string = codeChangesBulletStartingWith(
      "en",
      "**Hidden values.**",
    );

    for (const said of [
      "it reads a placeholder such as `[redacted-ip]` in their place.",
      "When its version keeps such a line exactly as it was shown, OneUptime writes the value back as the file has it, and the card says nothing of it.",
      "A placeholder stays on a line Ask AI changed, on a line that reads the same as another line with a different value, and in a new file.",
      "A placeholder the file on the branch already has does not count.",
    ]) {
      expect({ said, inPage: hidden.includes(said) }).toEqual({
        said,
        inPage: true,
      });
    }
  });

  it("says what Auto-run does instead, quoting the Skipped row's reason as the Dashboard says it", () => {
    const autoRun: string = codeChangesBulletStartingWith(
      "en",
      `**In ${autoRunTitle}.**`,
    );

    expect(autoRun).toContain(
      `the action's row says why, for example "${AI_ACTION_CODE_NOT_MADE.notCommittedChangedSinceRead}"`,
    );
    expect(autoRun).toContain(
      "Ask AI reads the files again and makes its change on them as they are now",
    );
  });

  it("says what approving anyway does, and the note a pull request carries", () => {
    expect(codeChangesBulletStartingWith("en", "**Approved anyway.**")).toBe(
      "- **Approved anyway.** If a file changes while the card waits for you, approving it changes nothing, and Ask AI proposes the change again. A pull request you approve anyway lists those files in its description, for whoever reviews it.",
    );
  });
});

describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
  const translator: Translator = codeDocsTranslatorFor(language);

  it("has the section where the English page has it, and its pointer in the list of actions", () => {
    expect(codeChangesSectionRangeOf(language)).toEqual(
      codeChangesSectionRangeOf("en"),
    );

    const lines: Array<string> = readPage(language, ASK_AI_PAGE).split("\n");
    const english: Array<string> = readPage("en", ASK_AI_PAGE).split("\n");

    expect(lines.indexOf(codeChangeActionBulletOf(language))).toBe(
      english.indexOf(codeChangeActionBulletOf("en")),
    );
    // The section's lines match the English one for one: a list item for each.
    expect(
      codeChangesSectionLinesOf(language).map((line: string) => {
        return line.startsWith("  - ")
          ? "caution"
          : line.startsWith("- **")
            ? "item"
            : line.startsWith("## ")
              ? "heading"
              : line === ""
                ? ""
                : "text";
      }),
    ).toEqual(
      codeChangesSectionLinesOf("en").map((line: string) => {
        return line.startsWith("  - ")
          ? "caution"
          : line.startsWith("- **")
            ? "item"
            : line.startsWith("## ")
              ? "heading"
              : line === ""
                ? ""
                : "text";
      }),
    );
  });

  it("quotes each caution as its Dashboard draws it, one item each, in the card's order", () => {
    const cautions: Array<string> = codeChangeCautionsOf(language);

    expect(cautions).toHaveLength(CARD_ORDER.length);

    CARD_ORDER.forEach((template: PluralTemplate, index: number) => {
      const line: string = quotedLine(template, translator);

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toBe(quotedLine(template));
      }
      expect({ index, quoted: cautions[index]!.includes(line) }).toEqual({
        index,
        quoted: true,
      });
      expect(codeChangesSectionOf(language).split(line)).toHaveLength(2);
    });
  });

  it("names Auto-run as its Dashboard does, and quotes the Skipped row's reason as its Dashboard words it", () => {
    const label: unknown = dashboardLocale(language)[autoRunTitle];
    const reason: string = describeAIActionSentence(
      { template: AI_ACTION_CODE_NOT_MADE.notCommittedChangedSinceRead },
      translator,
    );
    const autoRun: string | undefined = codeChangesSectionLinesOf(
      language,
    ).find((line: string) => {
      return line.includes(reason);
    });

    expect(typeof label).toBe("string");
    expect(autoRun).toBeDefined();
    expect(autoRun!.startsWith("- **")).toBe(true);
    // Its bold lead-in names the mode: up to the "**" that closes it.
    expect(autoRun!.slice(0, autoRun!.indexOf("**", 4) + 2)).toContain(
      label as string,
    );
    if (language !== "en") {
      expect(reason).not.toBe(
        AI_ACTION_CODE_NOT_MADE.notCommittedChangedSinceRead,
      );
    }
  });

  it("writes the placeholder as code, as the model reads it", () => {
    expect(codeChangesSectionOf(language)).toContain("`[redacted-ip]`");
  });
});
