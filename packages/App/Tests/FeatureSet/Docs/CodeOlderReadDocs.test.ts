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
import {
  CodeFileUnseen,
  findCodeFileUnseen,
} from "Common/Types/CodeRepository/CodeFileSeen";
import { createTranslator, Translator } from "Common/Types/Translator";
import { describe, expect, it } from "@jest/globals";

/*
 * What the Ask AI page says about a code change written from an older
 * read of a file (issue #6313), in every docs language: the card line it
 * quotes is the one that language's Dashboard draws, with the branch and
 * the file as the card writes them, and the mode it names is the
 * Dashboard's own. The English is held to the code that makes it true.
 */

const PAGE: string = "ai/ask-ai";
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
  it("quotes the card line as the English card says it, beside the code-change action it is about", () => {
    const bullet: string = codeBulletOf("en");
    const line: string = describeAIActionSentence(CHANGED);

    expect(line).toBe(
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/charge.ts.",
    );
    expect(bullet).toMatch(/^- Propose a code change:/);
    expect(bullet).toContain(`"${line}"`);
  });

  it("says what counts, what else the card names, what to do, and what Auto-run, a late change and an approved pull request do", () => {
    const bullet: string = codeBulletOf("en");

    for (const said of [
      "Ask AI writes each file whole, from the file as it last read it, and reads a repository's main branch unless it is asked for another.",
      "If a file changed on the branch after Ask AI read it, the card names it before you approve the commit or the pull request",
      "It also names a file Ask AI read only on another branch, where it is different, a file Ask AI never read but replaces, and a file OneUptime could not check.",
      "A new file never counts.",
      "To keep what someone else changed, skip the action and ask Ask AI to read the files again.",
      `In ${autoRunTitle}, where nobody approves actions, Ask AI does not make such a change: it reads the files again and makes its change on them as they are now.`,
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
      "Before this was approved, OneUptime said AI's versions of them may undo or replace changes it did not read",
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
      expect(codeBulletOf(language)).toContain(line);
    });

    it("names Auto-run as its Dashboard does", () => {
      const label: unknown = dashboardLocale(language)[autoRunTitle];

      expect(typeof label).toBe("string");
      expect(codeBulletOf(language)).toContain(label as string);
    });

    it("keeps the bullet it extends: one line, in its place", () => {
      const lines: Array<string> = readPage(language, PAGE).split("\n");
      const english: Array<string> = readPage("en", PAGE).split("\n");

      expect(lines.indexOf(codeBulletOf(language))).toBe(
        english.indexOf(codeBulletOf("en")),
      );
    });
  });
});
