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
import {
  CodeFileUnseen,
  findCodeFileUnseen,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a code change written from an older
 * read of a file (issue #6313), in every docs language: the card line it
 * quotes is the one that language's Dashboard draws, with the branch and
 * the file as the card writes them, and the mode it names is the
 * Dashboard's own. The English is held to the code that makes it true.
 */

const BRANCH: string = "fix/login";
const FILE: string = "src/billing/charge.ts";

// The card's line for one file changed on the branch since Ask AI read it.
const CHANGED: AIActionSentence = aiActionPluralSentence(
  AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead,
  1,
  {
    branch: BRANCH,
    files: aiActionList([
      aiActionSentence(AI_ACTION_CODE_FILE, { file: FILE }),
    ]),
  },
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

describe("the Ask AI page on a code change written from an older read (issue #6313)", () => {
  it("quotes the card line as the English card says it, as a caution of its own in the Code changes section", () => {
    const line: string = describeAIActionSentence(CHANGED);

    expect(line).toBe(
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/charge.ts.",
    );
    expect(codeChangeCautionQuoting("en", line)).toBe(
      `  - "${line}" The file changed on the branch after Ask AI read it.`,
    );
  });

  it("says what counts, what else the card names, what to do, and what Auto-run, a late change and an approved pull request do", () => {
    const bullet: string = codeChangesSectionOf("en");

    for (const said of [
      "Ask AI writes each file whole, from the file as it last read it, and reads a repository's main branch unless it is asked for another.",
      "So before you approve a commit or a pull request, its card names each file whose version would write over what Ask AI did not see.",
      `"${describeAIActionSentence(codeDocsCautionLine(AI_ACTION_PLURAL_LINES.codeFilesReadOnAnotherBranch))}" Ask AI read the file only on another branch, where it is different.`,
      `"${describeAIActionSentence(codeDocsCautionLine(AI_ACTION_PLURAL_LINES.codeFilesNotRead))}" Ask AI never read the file it replaces.`,
      `"${describeAIActionSentence(codeDocsCautionLine(AI_ACTION_PLURAL_LINES.codeFilesNotChecked))}"`,
      "A new file never counts.",
      "To keep what someone else changed, skip the action and ask Ask AI to read the files again.",
      `**In ${autoRunTitle}.** Where nobody approves actions, Ask AI does not make a change its card would warn about`,
      "Ask AI reads the files again and makes its change on them as they are now",
      "If a file changes while the card waits for you, approving it changes nothing, and Ask AI proposes the change again.",
      "A pull request you approve anyway lists those files in its description, for whoever reviews it.",
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
    const writeTools: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeWriteTools.ts"),
    );
    const seen: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts"),
    );
    const reviewerNote: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeChangeReviewerNote.ts"),
    );

    // It reads the main branch unless it is told one.
    expect(readTool).toContain(
      "It reads the repository's main branch unless you pass branchName",
    );
    expect(readTool).toContain(
      'normalizeCodeBranchName(ToolArgs.getString(args, "branchName") || "") || repository.mainBranchName || "main"',
    );

    // A new file never counts; one changed since, read elsewhere, or never read does.
    expect(
      findCodeFileUnseen({
        views: [],
        branchName: BRANCH,
        now: { state: "absent" },
      }),
    ).toBeNull();
    expect(
      findCodeFileUnseen({
        views: [{ branchName: BRANCH, fingerprint: "a", order: 1 }],
        branchName: BRANCH,
        now: { state: "file", fingerprint: "b" },
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(
      findCodeFileUnseen({
        views: [{ branchName: "main", fingerprint: "a", order: 1 }],
        branchName: BRANCH,
        now: { state: "file", fingerprint: "b" },
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadOnAnotherBranch,
      readOnBranch: "main",
    });
    expect(
      findCodeFileUnseen({
        views: [],
        branchName: BRANCH,
        now: { state: "file", fingerprint: "b" },
      }),
    ).toEqual({ unseen: CodeFileUnseen.NotRead });
    expect(
      findCodeFileUnseen({
        views: [],
        branchName: BRANCH,
        now: { state: "unreadable", reason: "x" },
      }),
    ).toEqual({ unseen: CodeFileUnseen.NotChecked });

    // Auto-run: not made, and the model told to read the files again.
    expect(writeTools).toContain(
      "notRunWithoutApproval: unseen.notRunWithoutApproval",
    );
    expect(seen).toContain(
      'Read each of these files on ${branch} with read_code_file and branchName "${branch}"',
    );

    // A file changed while the card waited: nothing made, proposed again.
    expect(writeTools).toContain("await holdToWhatTheCardShowed({");
    expect(seen).toContain("`Nothing was committed: ${files} changed on");
    expect(seen).toContain(
      "propose the commit again on the files as they are now",
    );

    // A pull request approved anyway names the files for its reviewer.
    expect(writeTools).toContain("describeCodeFilesUnseenForReviewer({");
    expect(reviewerNote).toContain(
      "Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read",
    );
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the branch and the file as the card writes them", () => {
      const line: string = describeAIActionSentence(
        CHANGED,
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("This file changed");
      }
      expect(line).toContain(BRANCH);
      expect(line).toContain(FILE);
      expect(codeChangeCautionQuoting(language, line)).toBeDefined();
    });

    it("names Auto-run as its Dashboard does", () => {
      const label: unknown = dashboardLocale(language)[autoRunTitle];

      expect(typeof label).toBe("string");
      expect(codeChangesSectionOf(language)).toContain(label as string);
    });

    it("keeps the caution in its place: right after the one about hidden values, where the English page has it", () => {
      const translator: Translator = translatorFor(language);
      const hidden: string = describeAIActionSentence(
        codeDocsCautionLine(
          AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
          "config/servers.ts",
        ),
        translator,
      );
      const changed: string = describeAIActionSentence(CHANGED, translator);

      expect(codeChangeCautionIndex(language, changed)).toBe(
        codeChangeCautionIndex(language, hidden) + 1,
      );
      expect(codeChangeCautionIndex(language, changed)).toBe(
        codeChangeCautionIndex("en", describeAIActionSentence(CHANGED)),
      );
    });
  });
});
