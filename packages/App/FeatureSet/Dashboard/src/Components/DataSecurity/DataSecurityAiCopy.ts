import {
  DataSecurityAiAskReason,
  DataSecurityAiWork,
  isDataSecurityAiWork,
} from "Common/Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionHelper,
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
  isDataSecurityAiIssueSkipReason,
} from "Common/Types/DataSecurity/DataSecurityAiDecision";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT DATA SECURITY → AI SAYS (#10364): the names of the four kinds of
 * work, and why OneUptime AI did, or did not, act on an issue, in a
 * sentence each - from the reason codes its records keep
 * (Common/Types/DataSecurity/DataSecurityAiDecision), so the page says
 * them in the reader's language.
 *
 * Kept free of React so the page and the tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it, and looked up where it is drawn.
 */

export const DATA_SECURITY_AI_WORK_LABELS: Readonly<
  Record<DataSecurityAiWork, string>
> = {
  [DataSecurityAiWork.Analyze]: translationKey("Analyze"),
  [DataSecurityAiWork.Contain]: translationKey("Contain"),
  [DataSecurityAiWork.Fix]: translationKey("Fix"),
  [DataSecurityAiWork.Judge]: translationKey("Judge"),
};

// What each kind of work did, or why it did nothing, as a line under the issue.
export const DATA_SECURITY_AI_REASON_LINES: Readonly<
  Record<DataSecurityAiDecisionReason, string>
> = {
  [DataSecurityAiDecisionReason.WorkOff]: translationKey("Off for this issue"),
  [DataSecurityAiDecisionReason.NoActionForIssue]: translationKey(
    "Nothing it can do for this check yet",
  ),
  [DataSecurityAiDecisionReason.Analyzed]: translationKey("Analyzed"),
  [DataSecurityAiDecisionReason.AlreadyAnalyzed]: translationKey(
    "Analyzed already since the issue opened",
  ),
  [DataSecurityAiDecisionReason.NoLlmProvider]: translationKey(
    "No LLM provider is set up",
  ),
  [DataSecurityAiDecisionReason.NoAiCredits]: translationKey(
    "The project is out of AI credits",
  ),
  [DataSecurityAiDecisionReason.AiDailyLimitReached]: translationKey(
    "The project reached its daily AI limit",
  ),
  [DataSecurityAiDecisionReason.AnalysisFailed]: translationKey(
    "The analysis failed",
  ),
  [DataSecurityAiDecisionReason.Proposed]: translationKey(
    "Proposed, waiting for a person",
  ),
  [DataSecurityAiDecisionReason.AppliedWithoutAsking]: translationKey(
    "Done without asking",
  ),
  [DataSecurityAiDecisionReason.AlreadyProposed]:
    translationKey("Proposed already"),
  [DataSecurityAiDecisionReason.NothingToPropose]:
    translationKey("Nothing to change"),
  [DataSecurityAiDecisionReason.ProofFailed]: translationKey(
    "Its proof failed, so nothing was proposed",
  ),
  [DataSecurityAiDecisionReason.ApplyFailed]: translationKey(
    "Making the change failed, and nothing changed",
  ),
};

// Why OneUptime AI left an issue alone, in a sentence.
export const DATA_SECURITY_AI_SKIP_SENTENCES: Readonly<
  Record<DataSecurityAiIssueSkipReason, string>
> = {
  [DataSecurityAiIssueSkipReason.RulesUnreadable]: translationKey(
    "The project's AI rules could not be read, so OneUptime AI did nothing a rule may keep out.",
  ),
  [DataSecurityAiIssueSkipReason.NoRuleMatched]: translationKey(
    "No Data Security AI rule matches this issue.",
  ),
  [DataSecurityAiIssueSkipReason.StoreDailyLimitReached]: translationKey(
    "OneUptime AI already worked on as many of this store's issues as it may in a day.",
  ),
  [DataSecurityAiIssueSkipReason.ProjectDailyLimitReached]: translationKey(
    "OneUptime AI already worked on as many of this project's issues as it may in a day.",
  ),
  [DataSecurityAiIssueSkipReason.NothingToDo]: translationKey(
    "Nothing OneUptime AI may do fits this issue.",
  ),
  [DataSecurityAiIssueSkipReason.EvaluationFailed]: translationKey(
    "OneUptime AI could not finish working on this issue.",
  ),
};

// Why a change waits for a person rather than being made without asking.
export const DATA_SECURITY_AI_ASK_REASON_SENTENCES: Readonly<
  Record<DataSecurityAiAskReason, string>
> = {
  [DataSecurityAiAskReason.WorkAsksFirst]: translationKey(
    "Your AI rules have this kind of work wait for a person.",
  ),
  [DataSecurityAiAskReason.AlwaysAsks]: translationKey(
    "A change that deletes data or pages people always waits for a person.",
  ),
  [DataSecurityAiAskReason.NotNamedByRule]: translationKey(
    "A change of access is made without asking only where an AI rule names it.",
  ),
  [DataSecurityAiAskReason.NotProvenSafe]: translationKey(
    "Out of the box, a change is made without asking only once it is proven safe, and this one is not.",
  ),
  [DataSecurityAiAskReason.TwoApprovals]: translationKey(
    "This project has two people approve a riskier change.",
  ),
  [DataSecurityAiAskReason.CircuitBreaker]: translationKey(
    "OneUptime AI already made as many changes without asking as it may in an hour.",
  ),
};

export const DataSecurityAiPageCopy: {
  waitingTitle: string;
  waitingDescription: string;
  waitingEmpty: string;
  doneTitle: string;
  doneDescription: string;
  doneEmpty: string;
  skippedTitle: string;
  skippedDescription: string;
  skippedEmpty: string;
  approve: string;
  dismiss: string;
  undo: string;
  approveTitle: string;
  whatWillChange: string;
  why: string;
  howItIsProven: string;
  howToUndoIt: string;
  whyItAsks: string;
  approvedOnce: string;
  dismissTitle: string;
  dismissDescription: string;
  dismissReasonTitle: string;
  dismissReasonPlaceholder: string;
  undoTitle: string;
  undoDescription: string;
} = {
  waitingTitle: translationKey("Waiting for you"),
  waitingDescription: translationKey(
    "What OneUptime AI proposes for your Data Security issues, riskiest first. A change you approve is made with your own permissions.",
  ),
  waitingEmpty: translationKey("No proposals waiting yet."),
  doneTitle: translationKey("Done by AI"),
  doneDescription: translationKey(
    "What OneUptime AI changed without asking, as your AI rules allow. Undo takes a change back.",
  ),
  doneEmpty: translationKey("No changes made without asking yet."),
  skippedTitle: translationKey("Why AI did not act"),
  skippedDescription: translationKey(
    "Issues OneUptime AI looked at and left alone, and why.",
  ),
  skippedEmpty: translationKey("No issues left alone yet."),
  approve: translationKey("Approve"),
  // A proposal said no to, as the incidents' fixes say Dismiss fix ("Hide" is the notices').
  dismiss: translationKey("Dismiss proposal"),
  undo: translationKey("Undo"),
  approveTitle: translationKey("Approve This Change"),
  whatWillChange: translationKey("What Will Change"),
  why: translationKey("Why"),
  howItIsProven: translationKey("How It Is Proven"),
  howToUndoIt: translationKey("How to Undo It"),
  whyItAsks: translationKey("Why It Asks"),
  approvedOnce: translationKey(
    "Approved once. It is made when someone else approves it too.",
  ),
  dismissTitle: translationKey("Dismiss This Proposal"),
  dismissDescription: translationKey(
    "OneUptime AI will not propose this change for the issue again. Your reason goes on the issue's timeline.",
  ),
  dismissReasonTitle: translationKey("Why"),
  dismissReasonPlaceholder: translationKey(
    "Our support team searches logs by this field.",
  ),
  undoTitle: translationKey("Undo This Change"),
  undoDescription: translationKey(
    "The change is taken back with your own permissions, and the issue's check runs again.",
  ),
};

export function getDataSecurityAiAskReasonSentence(
  reason: unknown,
): string | undefined {
  return typeof reason === "string" &&
    Object.values(DataSecurityAiAskReason).includes(
      reason as DataSecurityAiAskReason,
    )
    ? DATA_SECURITY_AI_ASK_REASON_SENTENCES[reason as DataSecurityAiAskReason]
    : undefined;
}

export const DATA_SECURITY_AI_TABLE_IDS: {
  waiting: string;
  done: string;
  skipped: string;
} = {
  waiting: "data-security-ai-waiting",
  done: "data-security-ai-done",
  skipped: "data-security-ai-skipped",
};

// A kind of work as the page names it; one this build does not know, as it is stored.
export function getDataSecurityAiWorkLabel(work: unknown): string {
  return isDataSecurityAiWork(work)
    ? DATA_SECURITY_AI_WORK_LABELS[work]
    : String(work || "");
}

export function getDataSecurityAiSkipSentence(reason: unknown): string {
  return isDataSecurityAiIssueSkipReason(reason)
    ? DATA_SECURITY_AI_SKIP_SENTENCES[reason]
    : DATA_SECURITY_AI_SKIP_SENTENCES[
        DataSecurityAiIssueSkipReason.NothingToDo
      ];
}

/*
 * The lines under an issue OneUptime AI left alone: each kind of work, and
 * what it did or why it did nothing. A record a newer build wrote keeps
 * only the entries this build knows.
 */
export function getDataSecurityAiDecisionLines(
  entries: unknown,
): Array<{ work: string; reason: string }> {
  return DataSecurityAiDecisionHelper.parseEntries(entries).map(
    (entry: DataSecurityAiDecisionEntry) => {
      return {
        work: DATA_SECURITY_AI_WORK_LABELS[entry.work],
        reason: DATA_SECURITY_AI_REASON_LINES[entry.reason],
      };
    },
  );
}
