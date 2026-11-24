import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import { getToolActionReason } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import {
  AI_ACTION_CODE_NOT_MADE,
  AI_ACTION_PLURAL_TITLES,
  AI_ACTION_SENTENCES,
  AI_ACTION_TITLES,
  AIActionWords,
  aiActionPluralSentence,
  aiActionSentence,
  describeAIActionWords,
  isKnownAIActionWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { createTranslator } from "../../../Types/Translator";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
} from "../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import { CodeFileUnseen } from "../../../Types/CodeRepository/CodeFileSeen";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CODE CHANGE AUTO-RUN HELD BACK SAYS WHY, ON ITS SKIPPED ROW (issue
 * #6982).
 *
 * In Auto-run, Ask AI does not commit or open a pull request that would
 * write over what it never saw as the branch has it: the action is kept as
 * Skipped, with an English summary for the exports and AI Logs. The row it
 * left among the answer's actions said only "Skipped · Commit 1 file to
 * fix/login", so the person learned why only if the model's answer said so.
 * The reason is kept as words now, and the row says it under its title, in
 * the reader's language. Every other row reads as it always did.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");
const JA: Record<string, string> = readDashboardLocale("ja");

const COMMIT_TITLE: AIActionWords["title"] = aiActionPluralSentence(
  AI_ACTION_PLURAL_TITLES.commitFiles,
  1,
  { branch: "fix/login" },
);

// A code change as the chat runner keeps it once Auto-run held it back.
function skipped(
  reason: string = AI_ACTION_CODE_NOT_MADE.notCommittedChangedSinceRead,
  overrides: Partial<AIChatToolAction> = {},
): AIChatToolAction {
  const words: AIActionWords = {
    title: COMMIT_TITLE,
    reason: aiActionSentence(reason),
  };

  return {
    id: "call-commit",
    toolName: "commit_code_to_branch",
    title: describeAIActionWords(words).title,
    words,
    arguments: { branchName: "fix/login", commitMessage: "fix", changes: [] },
    isMutation: true,
    requiresApproval: false,
    status: AIChatToolActionStatus.Skipped,
    resultSummary: reason,
    ...overrides,
  };
}

function renderRows(toolActions: Array<AIChatToolAction>): void {
  render(
    <ToolApprovalCard
      toolActions={toolActions}
      interactive={false}
      isSubmitting={false}
      onRespond={() => {}}
    />,
  );
}

const reasonText: () => string | null = (): string | null => {
  const reason: HTMLElement | null = screen.queryByTestId(
    "tool-approval-history-reason",
  );

  return reason ? withoutIsolateMarks(reason.textContent || "").trim() : null;
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      ja: { translation: JA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

describe("the Skipped row of a code change Auto-run held back", () => {
  test("says why under its title, in English", async () => {
    await inLanguage("en");
    renderRows([skipped()]);

    expect(
      withoutIsolateMarks(
        screen.getByTestId("tool-approval-history-title").textContent || "",
      ),
    ).toBe("Commit 1 file to fix/login");
    expect(reasonText()).toBe(
      "Not committed: a file changed on the branch after Ask AI read it.",
    );
    // Under the title, in the same row.
    expect(
      screen
        .getByTestId("tool-approval-history")
        .contains(screen.getByTestId("tool-approval-history-reason")),
    ).toBe(true);
  });

  test.each<[string, Record<string, string>]>([
    ["de", DE],
    ["fa", FA],
    ["ja", JA],
  ])(
    "in %s, as that language words it",
    async (language: string, words: Record<string, string>) => {
      await inLanguage(language);
      renderRows([
        skipped(AI_ACTION_CODE_NOT_MADE.notCommittedReadEarlierInThisAnswer),
      ]);

      const worded: string | undefined =
        words[AI_ACTION_CODE_NOT_MADE.notCommittedReadEarlierInThisAnswer];

      expect(worded).toBeTruthy();
      expect(worded).not.toBe(
        AI_ACTION_CODE_NOT_MADE.notCommittedReadEarlierInThisAnswer,
      );
      expect(reasonText()).toBe(worded);
    },
  );

  test("a pull request's says it was not opened", async () => {
    await inLanguage("en");
    renderRows([
      skipped(AI_ACTION_CODE_NOT_MADE.notOpenedValuesHidden, {
        id: "call-pr",
        toolName: "open_code_pull_request",
        words: {
          title: aiActionSentence(AI_ACTION_TITLES.openPullRequest, {
            title: "More retries",
          }),
          reason: aiActionSentence(
            AI_ACTION_CODE_NOT_MADE.notOpenedValuesHidden,
          ),
        },
        title: "Open pull request: More retries",
      }),
    ]);

    expect(reasonText()).toBe(
      "Not opened: Ask AI's version of a file writes placeholders in place of values hidden from it.",
    );
  });
});

describe("every other row reads as it always did", () => {
  test("a Skipped row with no reason: its chip and title, nothing more", async () => {
    await inLanguage("en");
    const action: AIChatToolAction = skipped();
    delete action.words!.reason;

    renderRows([action]);

    expect(reasonText()).toBeNull();
    expect(screen.getByTestId("tool-approval-history-title")).toHaveClass(
      "flex-1",
    );
  });

  test("an action saved before its words: its English, and no reason line", async () => {
    await inLanguage("de");
    const action: AIChatToolAction = skipped();
    delete action.words;

    renderRows([action]);

    expect(reasonText()).toBeNull();
    expect(
      withoutIsolateMarks(
        screen.getByTestId("tool-approval-history-title").textContent || "",
      ),
    ).toBe("Commit 1 file to fix/login");
  });

  test("a row of any other status never says a reason, even one kept beside it", async () => {
    await inLanguage("en");

    for (const status of [
      AIChatToolActionStatus.Executed,
      AIChatToolActionStatus.Failed,
      AIChatToolActionStatus.Denied,
      AIChatToolActionStatus.Approved,
    ]) {
      renderRows([skipped(undefined, { status })]);
      expect({ status, reason: reasonText() }).toEqual({
        status,
        reason: null,
      });
      cleanup();
    }
  });

  test("a reason that is not one of the module's is never drawn: the row reads its English", async () => {
    await inLanguage("en");
    const action: AIChatToolAction = skipped();
    action.words!.reason = { template: "Not committed: <b>trust me</b>." };

    expect(isKnownAIActionWords(action.words)).toBe(false);
    renderRows([action]);

    expect(reasonText()).toBeNull();
    expect(getToolActionReason(action, createTranslator(undefined))).toBeNull();
  });
});

describe("the reasons", () => {
  test("are the action's English summaries, every one, and sentences of the module the Dashboard trusts", () => {
    const summaries: Array<string> = [
      ...Object.values(CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit]),
      ...Object.values(CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest]),
    ];

    expect(summaries.sort()).toEqual(
      [...Object.values(AI_ACTION_CODE_NOT_MADE)].sort(),
    );

    for (const reason of Object.values(AI_ACTION_CODE_NOT_MADE)) {
      expect(AI_ACTION_SENTENCES).toContain(reason);
    }

    expect(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.NotRead],
    ).toBe("Not committed: Ask AI had not read a file the commit replaces.");
  });
});
