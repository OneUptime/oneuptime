import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_CODE_NOT_MADE,
  AIActionSentence,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  UnseenCodeChange,
  findUnseenCodeChange,
  summarizeCodeFilesUnseen,
} from "../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import { CodeFileUnseen } from "../../../Types/CodeRepository/CodeFileSeen";
import { LEFT_TO_RIGHT, RIGHT_TO_LEFT } from "../../../Types/ReadingDirection";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ISSUE #6982: WHY AUTO-RUN DID NOT MAKE A CODE CHANGE, IN EVERY READER'S
 * LANGUAGE.
 *
 * The action's record kept the reason in English only (resultSummary), for
 * the exports and AI Logs. It keeps the same reason as a sentence of the
 * module now, which the Skipped row says in the reader's language: one for
 * each finding that can hold a change back, for a commit and for a pull
 * request, its English the summary exactly.
 */

const REASONS: Array<string> = Object.values(AI_ACTION_CODE_NOT_MADE);

describe("the reasons Auto-run holds a code change back for", () => {
  test("one for each kind of finding, for a commit and for a pull request, the English summaries exactly", () => {
    const kinds: Array<CodeFileUnseen> = Object.values(CodeFileUnseen);

    expect(REASONS).toHaveLength(kinds.length * 2);

    for (const kind of kinds) {
      expect(REASONS).toContain(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][kind],
      );
      expect(REASONS).toContain(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][kind],
      );
    }

    expect(new Set(REASONS).size).toBe(REASONS.length);
  });

  test("a commit's say it was not committed, a pull request's that it was not opened", () => {
    for (const kind of Object.values(CodeFileUnseen)) {
      expect(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][kind].startsWith(
          "Not committed: ",
        ),
      ).toBe(true);
      expect(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][kind].startsWith(
          "Not opened: ",
        ),
      ).toBe(true);
    }
  });

  test("the change held back carries its reason as a sentence whose English is its summary", () => {
    for (const change of [CodeChangeKind.Commit, CodeChangeKind.PullRequest]) {
      const unseen: UnseenCodeChange | null = findUnseenCodeChange({
        change,
        recordsSeen: [],
        repositoryId: "repo",
        branchName: "fix/login",
        files: [
          { filePath: "src/a.ts", now: { state: "file", fingerprint: "a" } },
        ],
      });
      const reason: AIActionSentence = unseen!.notRunWithoutApproval.reason;

      expect(isKnownAIActionSentence(reason)).toBe(true);
      expect(describeAIActionSentence(reason)).toBe(
        unseen!.notRunWithoutApproval.summary,
      );
      expect(unseen!.notRunWithoutApproval.summary).toBe(
        summarizeCodeFilesUnseen({ change, findings: unseen!.findings }),
      );
      expect(unseen!.notRunWithoutApproval.summary).toBe(
        CODE_UNSEEN_SUMMARIES[change][CodeFileUnseen.NotRead],
      );
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  test("words every reason its own way, a whole sentence with no placeholder", () => {
    for (const reason of REASONS) {
      const worded: string | undefined = words[reason];

      expect({
        reason,
        worded: isWordedInDashboardLocale(reason, language),
      }).toEqual({ reason, worded: true });
      expect({ reason, braces: (worded || "").includes("{{") }).toEqual({
        reason,
        braces: false,
      });
    }
  });

  test("words each of the eighteen differently, and says the row's reason in the reader's direction", () => {
    const worded: Array<string> = REASONS.map((reason: string): string => {
      return words[reason] || "";
    });

    expect(new Set(worded).size).toBe(REASONS.length);

    const sentence: AIActionSentence = {
      template: AI_ACTION_CODE_NOT_MADE.notOpenedChangedSinceRead,
    };

    // French draws a no-break space before its colon: the same words.
    const spaced: (text: string) => string = (text: string): string => {
      return text.replace(/[\u00a0\u202f]/g, " ");
    };

    expect(
      spaced(describeAIActionSentence(sentence, dashboardTranslator(language))),
    ).toBe(spaced(words[AI_ACTION_CODE_NOT_MADE.notOpenedChangedSinceRead]!));
    expect(
      getAIActionSentenceDirection(sentence, dashboardTranslator(language)),
    ).toBe(["fa", "ar"].includes(language) ? RIGHT_TO_LEFT : LEFT_TO_RIGHT);
  });
});
