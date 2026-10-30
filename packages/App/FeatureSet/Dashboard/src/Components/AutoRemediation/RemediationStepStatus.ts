import { AIInvestigationStage } from "../AI/AIInvestigationStatus";
import {
  RemediationDecision,
  RemediationDecisionLine,
  RemediationSwitchesNow,
} from "./RemediationDecisionLines";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
  isRemovedSshCommand,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "Common/Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "Common/Types/AutoRemediation/ExternalMcpToolCallPlan";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { FinishedFixOutcome } from "Common/Utils/Suggestions/CodeFixSuggestion";
import { InvestigationCodeFixSuggestion } from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";

/*
 * THE REMEDIATION STEP OF THE AI CARD, IN A FEW WORDS (block 43).
 *
 * An incident's or alert's AI card holds two steps: Investigation, then
 * Remediation - "you could clearly see what the investigation was and what
 * AI is doing to remediate stuff as well". The Remediation step's pill says
 * where fixing stands before a sentence is read: still checking, waiting
 * for the investigation, a fix that needs the reader's approval, fixing,
 * fixed or not, something to look at, or off - and whether "Try again" is
 * worth offering.
 *
 * Read from what the step already holds: the decision OneUptime AI wrote
 * down (its lines, RemediationDecisionLines), the fixes it proposed or ran
 * (AutoRemediationSuggestion), where the investigation stands, and the fix
 * in the code the investigation recommends (InvestigationCodeFixSuggestion).
 *
 * React-free, so App's tests can read it; RemediationStep draws it.
 */

/*
 * The pill's mark, named by meaning, as the investigation's pill names its
 * own (InvestigationStatusIndicator): RemediationStep draws each with the
 * investigation's marks, so the two steps read the same way.
 */
export type RemediationStepTone =
  | "checking"
  | "waiting"
  | "live"
  | "attention"
  | "done"
  | "failed"
  | "idle";

export interface RemediationStepStatus {
  tone: RemediationStepTone;
  // An English key: the pill translates it.
  text: string;
}

export const REMEDIATION_STEP_STATUS_TEXT: {
  checking: string;
  waiting: string;
  needsApproval: string;
  fixing: string;
  fixed: string;
  fixApplied: string;
  didNotWork: string;
  pullRequestOpened: string;
  needsYourAnswer: string;
  noChangeNeeded: string;
  needsAttention: string;
  off: string;
  dismissed: string;
  noFixFound: string;
  noActionTaken: string;
  notTried: string;
} = {
  checking: translationKey("Checking…"),
  waiting: translationKey("Waiting"),
  needsApproval: translationKey("Needs your approval"),
  fixing: translationKey("Fixing…"),
  fixed: translationKey("Fixed"),
  fixApplied: translationKey("Fix applied"),
  didNotWork: translationKey("Didn't work"),
  pullRequestOpened: translationKey("Pull request opened"),
  needsYourAnswer: translationKey("Needs your answer"),
  noChangeNeeded: translationKey("No change needed"),
  needsAttention: translationKey("Needs attention"),
  off: translationKey("Off"),
  dismissed: translationKey("Dismissed"),
  noFixFound: translationKey("No fix found"),
  noActionTaken: translationKey("No action taken"),
  notTried: translationKey("Not tried"),
};

/*
 * One fix (an AutoRemediationSuggestion) as the pill reads it: where it
 * stands, and whether it ran and how that went.
 */
export interface RemediationFixFacts {
  status: AutoRemediationSuggestionStatus;
  /*
   * Waits for approval nobody can give: a plan holding an SSH command,
   * composed before runbook credentials were removed.
   */
  isUnapprovable: boolean;
  /*
   * Still moving: being worked out, its commands or changes on their way
   * after an approval, or its recovery being verified.
   */
  isInProgress: boolean;
  // It ran (approved, or on its own) and its run ended.
  hasRun: boolean;
  // Its run failed, or the record did not recover.
  hasFailed: boolean;
  // The record recovered once it ran.
  isVerified: boolean;
}

export function getRemediationFixFacts(
  suggestion: Pick<
    AutoRemediationSuggestion,
    | "status"
    | "suggestionType"
    | "commandPlan"
    | "mcpToolCallPlan"
    | "verificationStatus"
    | "runbookExecutionId"
  >,
): RemediationFixFacts {
  const status: AutoRemediationSuggestionStatus =
    (suggestion.status as AutoRemediationSuggestionStatus) ||
    AutoRemediationSuggestionStatus.Planning;
  const isStarted: boolean =
    status === AutoRemediationSuggestionStatus.Approved ||
    status === AutoRemediationSuggestionStatus.AutoExecuted;
  const verification: AutoRemediationVerificationStatus | undefined =
    suggestion.verificationStatus as
      | AutoRemediationVerificationStatus
      | undefined;

  const plan: AiRemediationCommandPlan | null =
    suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
      ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null)
      : null;
  const mcpPlan: ExternalMcpToolCallPlan | null =
    suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls
      ? ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan || null)
      : null;

  const executionStatus: AiRemediationPlanExecutionStatus | undefined = plan
    ? plan.executionStatus || AiRemediationPlanExecutionStatus.NotStarted
    : undefined;

  const isPlanRunning: boolean =
    isStarted &&
    (executionStatus === AiRemediationPlanExecutionStatus.Running ||
      executionStatus === AiRemediationPlanExecutionStatus.NotStarted);
  const isMcpRunning: boolean = Boolean(
    mcpPlan &&
      (ExternalMcpToolCallPlanUtil.isInFlight(mcpPlan) ||
        (isStarted &&
          ExternalMcpToolCallPlanUtil.getProposedCalls(mcpPlan).length > 0)),
  );

  const isInProgress: boolean =
    status === AutoRemediationSuggestionStatus.Planning ||
    verification === AutoRemediationVerificationStatus.Pending ||
    isPlanRunning ||
    isMcpRunning;

  const hasFailed: boolean =
    verification === AutoRemediationVerificationStatus.Failed ||
    (isStarted && executionStatus === AiRemediationPlanExecutionStatus.Failed);

  return {
    status,
    isUnapprovable:
      status === AutoRemediationSuggestionStatus.Suggested &&
      Boolean(
        plan?.commands.some((command: { stepType: unknown }): boolean => {
          return isRemovedSshCommand(command as never);
        }),
      ),
    isInProgress,
    hasRun: isStarted && !isInProgress,
    hasFailed,
    isVerified: verification === AutoRemediationVerificationStatus.Verified,
  };
}

export interface RemediationStepStatusInput {
  // The decision and the fixes were read for this record.
  isLoaded: boolean;
  decision: RemediationDecision | null;
  lines: Array<RemediationDecisionLine>;
  fixes: Array<RemediationFixFacts>;
  investigationStage: AIInvestigationStage;
  // The fix in the code the investigation recommends, once read.
  codeFix?: InvestigationCodeFixSuggestion | null | undefined;
  /*
   * The decision says fixing was off for the record by choice (Enable AI,
   * the switch, AI rules that do not fix it): AiOffSummaryData's fold state.
   */
  isOffByChoice: boolean;
}

/*
 * Whether remediation still waits for the record's investigation: it said
 * so, or nothing is written down yet while the investigation runs - fixing
 * is decided once it is done, whether it is on or off.
 */
export function isRemediationWaitingForInvestigation(input: {
  decision: RemediationDecision | null;
  investigationStage: AIInvestigationStage;
}): boolean {
  if (input.decision) {
    return input.decision.stage !== AutoRemediationDecisionStage.Evaluated;
  }

  return (
    input.investigationStage === "underway" ||
    input.investigationStage === "checking"
  );
}

export function getRemediationStepStatus(
  input: RemediationStepStatusInput,
): RemediationStepStatus {
  const status: (
    tone: RemediationStepTone,
    text: string,
  ) => RemediationStepStatus = (
    tone: RemediationStepTone,
    text: string,
  ): RemediationStepStatus => {
    return { tone, text };
  };

  const TEXT: typeof REMEDIATION_STEP_STATUS_TEXT =
    REMEDIATION_STEP_STATUS_TEXT;

  if (!input.isLoaded) {
    return status("checking", TEXT.checking);
  }

  // What needs the reader comes first: a fix waits for their approval.
  if (
    input.fixes.some((fix: RemediationFixFacts): boolean => {
      return (
        fix.status === AutoRemediationSuggestionStatus.Suggested &&
        !fix.isUnapprovable
      );
    })
  ) {
    return status("attention", TEXT.needsApproval);
  }

  if (
    input.fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.isInProgress;
    }) ||
    input.codeFix?.offer === SuggestionOffer.InProgress
  ) {
    return status("live", TEXT.fixing);
  }

  if (
    isRemediationWaitingForInvestigation({
      decision: input.decision,
      investigationStage: input.investigationStage,
    })
  ) {
    return status("waiting", TEXT.waiting);
  }

  if (
    input.fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.isVerified;
    })
  ) {
    return status("done", TEXT.fixed);
  }

  if (
    input.fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.hasFailed;
    })
  ) {
    return status("failed", TEXT.didNotWork);
  }

  if (
    input.fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.hasRun;
    })
  ) {
    return status("done", TEXT.fixApplied);
  }

  if (input.codeFix?.offer === SuggestionOffer.Done) {
    if (input.codeFix.fixOutcome === FinishedFixOutcome.WaitingForYou) {
      return status("attention", TEXT.needsYourAnswer);
    }

    if (input.codeFix.fixOutcome === FinishedFixOutcome.NothingToChange) {
      return status("idle", TEXT.noChangeNeeded);
    }

    return status("done", TEXT.pullRequestOpened);
  }

  const hasLineOf: (tone: RemediationDecisionLine["tone"]) => boolean = (
    tone: RemediationDecisionLine["tone"],
  ): boolean => {
    return input.lines.some((line: RemediationDecisionLine): boolean => {
      return line.tone === tone;
    });
  };

  if (hasLineOf("attention") || input.codeFix?.offer === SuggestionOffer.SetUp) {
    return status("attention", TEXT.needsAttention);
  }

  if (input.fixes.length > 0) {
    if (
      input.fixes.every((fix: RemediationFixFacts): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.Dismissed;
      })
    ) {
      return status("idle", TEXT.dismissed);
    }

    if (
      input.fixes.every((fix: RemediationFixFacts): boolean => {
        return fix.status === AutoRemediationSuggestionStatus.NoneApplicable;
      })
    ) {
      return status("idle", TEXT.noFixFound);
    }

    return status("idle", TEXT.noActionTaken);
  }

  // A fix was started and its row is on its way.
  if (hasLineOf("acted")) {
    return status("live", TEXT.fixing);
  }

  if (!input.decision) {
    return status("idle", TEXT.notTried);
  }

  if (input.isOffByChoice) {
    return status("idle", TEXT.off);
  }

  return status("idle", TEXT.noActionTaken);
}

/*
 * Whether "Try again" is worth offering: the record is open, OneUptime AI's
 * latest decision about it is made (or none was ever written down), and it
 * fixed nothing - no fix proposed or started, no fix in the code on its way.
 * Deciding again then may now find a switch turned on, a cluster's fixes
 * on, an agent connected. With a fix to show, deciding again would only
 * find it (and the server refuses a fix still in flight). Nor while what
 * stopped it is still so: Enable AI or the record kind's fixing switch,
 * off then and still off (or not known to be on) now - the line's own
 * "Turn on" is the next step then, and once it is on the line says so and
 * Try again follows.
 */
export function canOfferRemediationTryAgain(input: {
  isLoaded: boolean;
  isRecordResolved: boolean;
  decision: RemediationDecision | null;
  lines: Array<RemediationDecisionLine>;
  fixes: Array<RemediationFixFacts>;
  investigationStage: AIInvestigationStage;
  codeFix?: InvestigationCodeFixSuggestion | null | undefined;
  switchesNow?: RemediationSwitchesNow | undefined;
}): boolean {
  if (!input.isLoaded || input.isRecordResolved) {
    return false;
  }

  const hasEntry: (reason: AutoRemediationDecisionReason) => boolean = (
    reason: AutoRemediationDecisionReason,
  ): boolean => {
    return Boolean(
      input.decision?.entries.some(
        (entry: AutoRemediationDecisionEntry): boolean => {
          return entry.reason === reason;
        },
      ),
    );
  };

  if (
    hasEntry(AutoRemediationDecisionReason.EnableAiOff) &&
    input.switchesNow?.isAiOn !== true
  ) {
    return false;
  }

  if (
    hasEntry(AutoRemediationDecisionReason.RemediationOff) &&
    input.switchesNow?.isFixingOn !== true
  ) {
    return false;
  }

  if (
    isRemediationWaitingForInvestigation({
      decision: input.decision,
      investigationStage: input.investigationStage,
    })
  ) {
    return false;
  }

  if (input.fixes.length > 0) {
    return false;
  }

  if (
    input.lines.some((line: RemediationDecisionLine): boolean => {
      return line.tone === "acted";
    })
  ) {
    return false;
  }

  return (
    input.codeFix?.offer !== SuggestionOffer.InProgress &&
    input.codeFix?.offer !== SuggestionOffer.Done
  );
}
