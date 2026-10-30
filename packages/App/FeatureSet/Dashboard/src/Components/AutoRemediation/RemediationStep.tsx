import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationDecision from "Common/Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import { isProjectRunbookPick } from "Common/Types/AutoRemediation/AutoRemediationFix";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "Common/Types/AutoRemediation/AutoRemediationDecision";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionState,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
  isRemovedSshCommand,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import {
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "Common/Types/AutoRemediation/ExternalMcpToolCallPlan";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceCommandTier } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
  isCloudAiResourceType,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import {
  InvestigationCodeFixSuggestion,
  parseInvestigationCodeFixSuggestion,
} from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import { useAiSwitchState } from "../../Utils/UseAiOffered";
import AiCardStep from "../AI/AiCardStep";
import InvestigationNotice, {
  noticeFailedIcon,
} from "../AI/InvestigationNotice";
import { InvestigationStatusIndicator } from "../AI/InvestigationStatusBadge";
import { AIInvestigationStage } from "../AI/AIInvestigationStatus";
import useAiLaneSwitchStates, {
  AiLaneSwitchRead,
} from "../AI/useAiLaneSwitchStates";
import RemediationCodeFix from "./RemediationCodeFix";
import RemediationFixFact, {
  RemediationFixFactVisual,
} from "./RemediationFixFact";
import {
  REMEDIATION_STEP_NOT_TRIED,
  REMEDIATION_STEP_STATUS_LABEL,
  REMEDIATION_STEP_TITLE,
  REMEDIATION_STEP_WAITING,
  REMEDIATION_TRY_AGAIN_BUTTON,
  REMEDIATION_TRY_AGAIN_FAILED,
  REMEDIATION_TRY_AGAIN_HINT,
} from "./RemediationStepCopy";
import {
  canOfferRemediationTryAgain,
  getRemediationFixFacts,
  getRemediationStepStatus,
  isRemediationWaitingForInvestigation,
  RemediationFixFacts,
  RemediationStepStatus,
  RemediationStepTone,
} from "./RemediationStepStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RemediationDecisionList from "./RemediationDecisionList";
import McpToolCallList, { MCP_TOOL_CALL_LIST_COPY } from "./McpToolCallList";
import {
  getRemediationDecisionLines,
  pickRemediationDecision,
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionSignal,
  RemediationSwitchesNow,
} from "./RemediationDecisionLines";
import CloudDryRunNote from "./CloudDryRunNote";
import {
  CLOUD_DRY_RUN_COPY,
  getCloudDryRunButtonTitle,
} from "./CloudDryRunCopy";
import { isCloudDryRunInFlight } from "Common/Utils/AiRemediation/CloudChangeDryRunPlan";
import OneUptimeDate from "Common/Types/Date";
import {
  AiCardFold,
  getRemediationFoldState,
  isRemediationFoldedIntoAiCard,
  isSameRemediationFoldState,
  RemediationFoldState,
} from "../AI/AiOffSummaryData";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  /*
   * Where the record's AI investigation stands (the step above): fixing is
   * decided once it is done, so while it runs, the step says it waits.
   */
  investigationStage: AIInvestigationStage;
  /*
   * The record is resolved now: OneUptime AI does not try to fix it again,
   * so Try again is not offered.
   */
  isRecordResolved?: boolean | undefined;
  /*
   * The investigation recommends a fix in the code: the step reads what
   * came of it (InvestigationCodeFixSuggestion) and offers to open it.
   */
  codeFix?: RemediationStepCodeFix | undefined;
  /*
   * What the step read, for the AI card (RemediationFoldState,
   * AiOffSummaryData): still reading, fixing did something or has
   * something to say, or it did nothing because it was off - and why.
   * Called on every change, and afresh for every incident or alert.
   */
  onFoldStateChange?: ((state: RemediationFoldState) => void) | undefined;
  /*
   * How the AI card is drawn. While it is the one-line "AI investigation is
   * off" summary - or is still deciding whether it is - that line says
   * why nothing was fixed too, so the step draws nothing. It stays mounted
   * all the same: what it reads is what the card folds by.
   */
  aiCardFold?: AiCardFold | undefined;
}

export interface RemediationStepCodeFix {
  isRecommended: boolean;
  // The investigation whose report a pull request is opened from.
  investigationRunId: string | null;
}

/*
 * Where a fix stands, as the fact beside its title says it
 * (RemediationFixFact): a dot and its words, not a pill.
 */
const STATUS_VISUAL: Record<
  AutoRemediationSuggestionStatus,
  RemediationFixFactVisual
> = {
  [AutoRemediationSuggestionStatus.Planning]: {
    label: "AI is picking a runbook…",
    dot: "bg-blue-500",
  },
  [AutoRemediationSuggestionStatus.Suggested]: {
    label: "Waiting for approval",
    dot: "bg-amber-500",
  },
  [AutoRemediationSuggestionStatus.Approved]: {
    label: "Approved & started",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.AutoExecuted]: {
    label: "Auto-executed",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.Dismissed]: {
    label: "Dismissed",
    dot: "bg-gray-400",
  },
  [AutoRemediationSuggestionStatus.NoneApplicable]: {
    label: "No runbook applies",
    dot: "bg-gray-400",
  },
};

/*
 * A plan waiting for approval that can no longer be approved: it holds an
 * SSH command, composed before runbook credentials were removed. "Waiting
 * for approval" would wait for what nobody can give.
 */
const UNAPPROVABLE_PLAN_VISUAL: RemediationFixFactVisual = {
  label: translationKey("Can't be approved"),
  dot: "bg-gray-400",
};

function StatusFact({
  status,
  isCommandPlan,
  isUnapprovable,
}: {
  status: AutoRemediationSuggestionStatus;
  isCommandPlan?: boolean | undefined;
  isUnapprovable?: boolean | undefined;
}): ReactElement {
  const visual: RemediationFixFactVisual = isUnapprovable
    ? UNAPPROVABLE_PLAN_VISUAL
    : STATUS_VISUAL[status] ||
      STATUS_VISUAL[AutoRemediationSuggestionStatus.Planning]!;
  // A command plan is composed, not picked from runbooks.
  const label: string =
    isCommandPlan && status === AutoRemediationSuggestionStatus.Planning
      ? translationKey("AI is composing a fix…")
      : isCommandPlan &&
          status === AutoRemediationSuggestionStatus.NoneApplicable
        ? translationKey("No safe fix found")
        : visual.label;
  return (
    <RemediationFixFact
      visual={visual}
      label={label}
      testId="remediation-fix-status"
    />
  );
}

/*
 * The kubectl policy tier, in the reader's words: is this a look, a safe
 * change, or something that needed a human to say yes.
 */
const TIER_VISUAL: Record<KubectlCommandTier, RemediationFixFactVisual> = {
  [KubectlCommandTier.Read]: {
    label: "read-only",
    dot: "bg-sky-500",
  },
  [KubectlCommandTier.SafeWrite]: {
    label: "safe change",
    dot: "bg-emerald-500",
  },
  [KubectlCommandTier.RiskyWrite]: {
    label: "riskier change",
    dot: "bg-amber-500",
  },
  [KubectlCommandTier.Denied]: {
    label: "denied",
    dot: "bg-rose-500",
    isAlarming: true,
  },
};

function KubectlTierFact({ tier }: { tier: KubectlCommandTier }): ReactElement {
  return (
    <RemediationFixFact
      visual={TIER_VISUAL[tier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!}
      testId="remediation-command-tier"
    />
  );
}

/*
 * The resource command policy's tier, in the same words and colours: the
 * two tier enums carry the same values (a Common test asserts it), so a
 * resource command's "safe change" reads exactly like a kubectl one.
 */
const RESOURCE_TIER_TO_KUBECTL_TIER: Record<
  ResourceCommandTier,
  KubectlCommandTier
> = {
  [ResourceCommandTier.Read]: KubectlCommandTier.Read,
  [ResourceCommandTier.SafeWrite]: KubectlCommandTier.SafeWrite,
  [ResourceCommandTier.RiskyWrite]: KubectlCommandTier.RiskyWrite,
  [ResourceCommandTier.Denied]: KubectlCommandTier.Denied,
};

export function getResourceCommandTierLabel(tier: ResourceCommandTier): string {
  const kubectlTier: KubectlCommandTier =
    RESOURCE_TIER_TO_KUBECTL_TIER[tier] || KubectlCommandTier.RiskyWrite;
  return (
    TIER_VISUAL[kubectlTier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!
  ).label;
}

function ResourceCommandTierFact({
  tier,
}: {
  tier: ResourceCommandTier;
}): ReactElement {
  return (
    <KubectlTierFact
      tier={
        RESOURCE_TIER_TO_KUBECTL_TIER[tier] || KubectlCommandTier.RiskyWrite
      }
    />
  );
}

/*
 * Where a command runs, as the card's command row names it: the cluster of
 * a kubectl step, the resource of a resource command ("Docker host web-1"),
 * the Runner of a Bash or SSH step.
 */
export function getCommandTargetLabel(
  command: Pick<
    AiRemediationCommand,
    | "stepType"
    | "kubernetesClusterNameSnapshot"
    | "resourceType"
    | "resourceNameSnapshot"
    | "runnerNameSnapshot"
  >,
  translator: Translator = getGlobalTranslator(),
): string {
  const unknownName: string = translator.translateText("(unknown)") as string;

  if (command.stepType === RunbookStepType.Kubectl) {
    return translator.translateTemplate("cluster {{name}}", {
      name: command.kubernetesClusterNameSnapshot || unknownName,
    });
  }

  if (command.stepType === RunbookStepType.ResourceCommand) {
    // The kind of resource, then its name: "Docker host web-1".
    const kind: string = translator.translateText(
      isAiResourceType(command.resourceType)
        ? AI_RESOURCE_TYPE_INFO[command.resourceType].displayName
        : "resource",
    ) as string;

    return `${kind} ${command.resourceNameSnapshot || unknownName}`;
  }

  return command.runnerNameSnapshot;
}

/*
 * The step-type chip of a command row: "kubectl" for a kubectl step, the
 * program a resource command runs ("docker", "systemctl", "pvesh", ...), the
 * step type otherwise.
 */
export function getCommandStepLabel(
  command: Pick<AiRemediationCommand, "stepType" | "command">,
): string {
  if (command.stepType === RunbookStepType.Kubectl) {
    return "kubectl";
  }

  if (command.stepType === RunbookStepType.ResourceCommand) {
    return (command.command || "").trim().split(/\s+/)[0] || "command";
  }

  return command.stepType;
}

/*
 * The program chip a command row draws beside where it runs, or null when
 * the command shown under it already starts with that program: "kubectl"
 * over "kubectl rollout restart ..." said the same word twice in one row.
 * A Bash or SSH step keeps its chip - its command does not say what runs it.
 */
export function getCommandProgramChip(
  command: Pick<AiRemediationCommand, "stepType" | "command">,
): string | null {
  const program: string = getCommandStepLabel(command);
  const firstWord: string =
    (command.command || "").trim().split(/\s+/)[0] || "";

  return firstWord === program ? null : program;
}

/*
 * Said over the fixes while one of them waits for approval: what pressing
 * Approve & Run does. It was the Remediation card's description, which also
 * listed every kind of fix there is ("kubectl on a cluster, commands on a
 * Runner, or a runbook ... for this signal"); inside the step each fix
 * says what it is, so only the part that matters before the press is left,
 * and only while there is something to press.
 */
export const REMEDIATION_APPROVAL_NOTE: string = translationKey(
  "Approving runs exactly what is shown, under your name.",
);

/*
 * Whether a fix waits for the reader's approval - one Approve & Run can
 * run: waiting for approval, and not a plan that can no longer be approved
 * (an SSH command from before runbook credentials were removed).
 */
export function isRemediationApprovalNoteShown(
  suggestions: Array<
    Pick<AutoRemediationSuggestion, "status" | "suggestionType" | "commandPlan">
  >,
): boolean {
  return suggestions.some(
    (
      suggestion: Pick<
        AutoRemediationSuggestion,
        "status" | "suggestionType" | "commandPlan"
      >,
    ): boolean => {
      if (suggestion.status !== AutoRemediationSuggestionStatus.Suggested) {
        return false;
      }

      const plan: AiRemediationCommandPlan | null =
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
          ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null)
          : null;

      return !hasRemovedSshCommand(plan);
    },
  );
}

/*
 * Whether a fix through MCP servers is still being made: a change sent and
 * not answered yet, or an approved fix whose changes are not sent yet.
 */
export function isMcpFixInProgress(
  suggestion: Pick<
    AutoRemediationSuggestion,
    "suggestionType" | "status" | "mcpToolCallPlan"
  >,
): boolean {
  if (
    suggestion.suggestionType !== AutoRemediationSuggestionType.McpToolCalls
  ) {
    return false;
  }

  const plan: ExternalMcpToolCallPlan | null =
    ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan || null);

  if (!plan) {
    return false;
  }

  if (ExternalMcpToolCallPlanUtil.isInFlight(plan)) {
    return true;
  }

  return (
    (suggestion.status === AutoRemediationSuggestionStatus.Approved ||
      suggestion.status === AutoRemediationSuggestionStatus.AutoExecuted) &&
    ExternalMcpToolCallPlanUtil.getProposedCalls(plan).length > 0
  );
}

const VERIFICATION_VISUAL: Record<
  AutoRemediationVerificationStatus,
  RemediationFixFactVisual
> = {
  [AutoRemediationVerificationStatus.Pending]: {
    label: "Verifying recovery\u2026",
    dot: "bg-blue-500",
  },
  [AutoRemediationVerificationStatus.Verified]: {
    label: "Verified fixed",
    dot: "bg-emerald-500",
  },
  [AutoRemediationVerificationStatus.Failed]: {
    label: "Verification failed",
    dot: "bg-rose-500",
    isAlarming: true,
  },
  [AutoRemediationVerificationStatus.Skipped]: {
    label: "Verification skipped",
    dot: "bg-gray-400",
  },
};

function VerificationFact({
  status,
}: {
  status: AutoRemediationVerificationStatus;
}): ReactElement {
  return (
    <RemediationFixFact
      visual={
        VERIFICATION_VISUAL[status] ||
        VERIFICATION_VISUAL[AutoRemediationVerificationStatus.Pending]!
      }
      testId="remediation-fix-verification"
    />
  );
}

/*
 * What the per-command approval pill says: did (or will) this command run
 * without a human saying yes?
 *
 * It is NOT read off command.policyVerdict. The server stores that verdict
 * as information for the approval card: every kubectl command on a
 * proposed plan is recorded RequiresApproval, and AutoApproved appears
 * only on a command a FullAuto run executed inline (wasAutoExecuted) or,
 * for Bash/SSH, on an informational allowlist match — a proposed plan can
 * therefore carry "AutoApproved" Bash commands that have not run and will
 * not run until someone approves. A green "auto-approved" pill under an
 * "Approve & Run" button reads as "already ran"; the on-call reader then
 * skips the approval, or approves expecting a second run. The pill is
 * therefore derived from what actually happened to the command and its
 * plan.
 */
export enum CommandApprovalPillKind {
  // Ran, or runs, with nobody approving it — the only time "auto-approved" is true.
  RanWithoutApproval = "RanWithoutApproval",
  // Nothing runs until a human approves the plan it belongs to.
  NeedsApproval = "NeedsApproval",
  /*
   * An SSH command of a plan composed before runbook credentials were
   * removed, which never ran: its plan cannot be approved any more, so
   * "needs approval" would ask for what nobody can give.
   */
  NoLongerRuns = "NoLongerRuns",
}

export function getCommandApprovalPillKind(
  command: Pick<AiRemediationCommand, "wasAutoExecuted"> &
    Partial<Pick<AiRemediationCommand, "stepType" | "execution">>,
  suggestionStatus: AutoRemediationSuggestionStatus,
): CommandApprovalPillKind | null {
  // A FullAuto / Automatic run executed this inline during planning.
  if (command.wasAutoExecuted === true) {
    return CommandApprovalPillKind.RanWithoutApproval;
  }

  if (
    command.stepType !== undefined &&
    isRemovedSshCommand({ stepType: command.stepType }) &&
    !command.execution &&
    (suggestionStatus === AutoRemediationSuggestionStatus.Suggested ||
      suggestionStatus === AutoRemediationSuggestionStatus.Planning)
  ) {
    return CommandApprovalPillKind.NoLongerRuns;
  }

  switch (suggestionStatus) {
    // The whole plan executed unattended; no approval step exists for it.
    case AutoRemediationSuggestionStatus.AutoExecuted:
      return CommandApprovalPillKind.RanWithoutApproval;
    /*
     * Waiting for a human (or still being composed and headed that way):
     * every command in the plan, whatever its verdict, runs only on
     * approval.
     */
    case AutoRemediationSuggestionStatus.Suggested:
    case AutoRemediationSuggestionStatus.Planning:
      return CommandApprovalPillKind.NeedsApproval;
    /*
     * Approved: a human said yes, so neither label is true any more — the
     * status pill and each command's execution pill tell the story.
     * Dismissed / NoneApplicable: nothing ran and nothing will.
     */
    default:
      return null;
  }
}

const APPROVAL_VISUAL: Record<
  CommandApprovalPillKind,
  RemediationFixFactVisual
> = {
  [CommandApprovalPillKind.RanWithoutApproval]: {
    label: "auto-approved",
    dot: "bg-emerald-500",
  },
  [CommandApprovalPillKind.NeedsApproval]: {
    label: "needs approval",
    dot: "bg-amber-500",
  },
  [CommandApprovalPillKind.NoLongerRuns]: {
    label: "no longer runs",
    dot: "bg-gray-400",
  },
};

/*
 * Under a plan waiting for approval that holds an SSH command (composed
 * before runbook credentials were removed), in place of "Approve & Run":
 * the server refuses to approve it, so the card says so before anyone
 * clicks, and Dismiss is the one thing left to do.
 */
export const REMOVED_SSH_PLAN_NOTE: string = translationKey(
  "This plan can't be approved: OneUptime AI no longer runs SSH commands.",
);

// Whether a plan holds an SSH command, which no longer runs (isRemovedSshCommand).
export function hasRemovedSshCommand(
  plan: Pick<AiRemediationCommandPlan, "commands"> | null,
): boolean {
  return Boolean(
    plan?.commands.some((command: AiRemediationCommand): boolean => {
      return isRemovedSshCommand(command);
    }),
  );
}

function CommandApprovalFact({
  kind,
}: {
  kind: CommandApprovalPillKind;
}): ReactElement {
  return (
    <RemediationFixFact
      visual={
        APPROVAL_VISUAL[kind] ||
        APPROVAL_VISUAL[CommandApprovalPillKind.NeedsApproval]!
      }
      testId="remediation-command-approval"
    />
  );
}

const COMMAND_EXECUTION_VISUAL: Record<
  AiRemediationCommandExecutionStatus,
  RemediationFixFactVisual
> = {
  [AiRemediationCommandExecutionStatus.Pending]: {
    label: "Pending",
    dot: "bg-gray-400",
  },
  [AiRemediationCommandExecutionStatus.Running]: {
    label: "Running…",
    dot: "bg-blue-500",
  },
  [AiRemediationCommandExecutionStatus.Succeeded]: {
    label: "Succeeded",
    dot: "bg-emerald-500",
  },
  [AiRemediationCommandExecutionStatus.Failed]: {
    label: "Failed",
    dot: "bg-rose-500",
    isAlarming: true,
  },
  [AiRemediationCommandExecutionStatus.Skipped]: {
    label: "Skipped",
    dot: "bg-gray-400",
  },
};

function CommandExecutionFact({
  status,
  testId,
}: {
  status: AiRemediationCommandExecutionStatus;
  testId?: string | undefined;
}): ReactElement {
  return (
    <RemediationFixFact
      visual={
        COMMAND_EXECUTION_VISUAL[status] ||
        COMMAND_EXECUTION_VISUAL[AiRemediationCommandExecutionStatus.Pending]!
      }
      testId={testId || "remediation-command-execution"}
    />
  );
}

// How a plan's execution and rollback statuses read: English keys.
const PLAN_EXECUTION_LABELS: Record<AiRemediationPlanExecutionStatus, string> =
  {
    [AiRemediationPlanExecutionStatus.NotStarted]:
      translationKey("Not started"),
    [AiRemediationPlanExecutionStatus.Running]: translationKey("Running"),
    [AiRemediationPlanExecutionStatus.Completed]: translationKey("Completed"),
    [AiRemediationPlanExecutionStatus.Failed]: translationKey("Failed"),
  };

const ROLLBACK_STATUS_LABELS: Record<AiRemediationRollbackStatus, string> = {
  [AiRemediationRollbackStatus.NotAttempted]: translationKey("Not attempted"),
  [AiRemediationRollbackStatus.Completed]: translationKey("Completed"),
  [AiRemediationRollbackStatus.Failed]: translationKey("Failed"),
  [AiRemediationRollbackStatus.NotApplicable]: translationKey("Not applicable"),
};

/*
 * What one execution record says beyond its status pill: the exit code,
 * the error, and the output behind a toggle. Used for a command and for
 * its rollback.
 */
function CommandExecutionDetails(props: {
  execution: AiRemediationCommandExecutionState;
  isOutputExpanded: boolean;
  onToggleOutput: () => void;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div className="mt-2">
      {typeof props.execution.exitCode === "number" ? (
        <div className="text-xs text-gray-500">
          {translator.translateTemplate("Exit code: {{code}}", {
            code: props.execution.exitCode,
          })}
        </div>
      ) : (
        <></>
      )}
      {props.execution.errorMessage ? (
        <div dir="auto" className="mt-1 text-xs text-rose-600">
          {props.execution.errorMessage}
        </div>
      ) : (
        <></>
      )}
      {props.execution.output ? (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={props.isOutputExpanded}
            className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={props.onToggleOutput}
          >
            {translator.translateText(
              props.isOutputExpanded ? "Hide output" : "Show output",
            )}
          </button>
          {props.isOutputExpanded ? (
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
              {props.execution.output}
            </pre>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}

/*
 * Who declares the object a kubectl command changes (Argo CD, Flux or a
 * Helm release) and what that means for the change, in OneUptime's own
 * sentence — and, once verification read the object again, what of the
 * change was put back. A change its owner puts back is labelled a
 * temporary fix, so nobody approves it as the lasting one.
 */
function CommandGitOpsNote(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { gitOps, revertWatch } = props.command;

  if (!gitOps && !revertWatch?.putBackAt) {
    return <></>;
  }

  return (
    <div className="mt-2" data-testid="remediation-command-gitops">
      {gitOps ? (
        <p className="break-words text-xs leading-5 text-gray-600">
          {gitOps.putsBack ? (
            <span className="me-1 font-medium text-amber-700">
              {translator.translateText("Temporary fix")}
            </span>
          ) : (
            <></>
          )}
          {gitOps.summary}
        </p>
      ) : (
        <></>
      )}
      {revertWatch?.putBackAt ? (
        <div className="mt-1 text-xs text-rose-600">
          {translator.translateTemplate("Put back on the cluster: {{fields}}", {
            fields: (revertWatch.putBackFields || []).join(", "),
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}

/*
 * A cloud change's notes: the code that declares its resource (such a
 * change is only ever proposed: the next apply would put the old value
 * back), and, before it ran, its dry run (CloudDryRunNote) - or, before
 * any, that its undo is written from the value it replaces: the agent
 * reads that value first and reports it.
 */
function CloudCommandNote(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { command } = props;

  if (
    command.stepType !== RunbookStepType.ResourceCommand ||
    !isCloudAiResourceType(command.resourceType)
  ) {
    return <></>;
  }

  return (
    <div className="mt-2 space-y-1" data-testid="remediation-command-cloud">
      {command.managedAsCode ? (
        <div className="text-xs leading-5 text-amber-700">
          {translator.translateTemplate(
            "Declared as code by {{owner}}: the next apply may put the old value back, so change the code too.",
            { owner: command.managedAsCode },
          )}
        </div>
      ) : (
        <></>
      )}
      {!command.execution && command.dryRun ? (
        <CloudDryRunNote dryRun={command.dryRun} />
      ) : !command.execution && !command.rollbackCommand ? (
        <div className="text-xs text-gray-500">
          {translator.translateText(
            "The agent reads the value this change replaces before it makes it, and OneUptime writes the exact undo from it.",
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}

const POLL_INTERVAL_MS: number = 15 * 1000;

export type RemediationSuggestionAction = "approve" | "dismiss" | "dry-run";

// The suggestion has left "waiting": someone approved it, or it ran unattended.
function isAlreadyStarted(
  status: AutoRemediationSuggestionStatus | undefined,
): boolean {
  return (
    status === AutoRemediationSuggestionStatus.Approved ||
    status === AutoRemediationSuggestionStatus.AutoExecuted
  );
}

/*
 * The refusal's headline: the action that failed, and what the reloaded
 * suggestion says really happened. The server refuses an approval BEFORE
 * it claims the plan when the plan cannot run — the cluster's remediation
 * was switched off, its Runner changed — so a refused approval of a plan
 * that is still waiting ran nothing. But it also refuses an approval that
 * lost to another one ("Only suggested remediations can be approved — this
 * one is Approved", "This suggestion was just actioned by someone else"):
 * then the plan WAS approved and is running, and "nothing ran" would tell
 * the reader the opposite of what happened to the cluster.
 */
export function getActionErrorTitle(
  action: RemediationSuggestionAction | null,
  statusAfterReload?: AutoRemediationSuggestionStatus | undefined,
): string {
  // English keys: the alert that shows the headline translates it.
  if (action === "approve") {
    if (statusAfterReload === AutoRemediationSuggestionStatus.Approved) {
      return translationKey(
        "Your approval was not recorded: this fix had already been approved, and it has started — see its commands below",
      );
    }
    if (statusAfterReload === AutoRemediationSuggestionStatus.AutoExecuted) {
      return translationKey(
        "Your approval was not recorded: this fix already ran without approval — see its commands below",
      );
    }
    return translationKey(
      "Could not save your action: the fix was not approved and nothing ran",
    );
  }
  if (action === "dry-run") {
    return CLOUD_DRY_RUN_COPY.dryRunActionError;
  }
  if (action === "dismiss") {
    if (isAlreadyStarted(statusAfterReload)) {
      return translationKey(
        "Could not save your action: the suggestion was not dismissed — this fix had already started; see its commands below",
      );
    }
    return translationKey(
      "Could not save your action: the suggestion was not dismissed",
    );
  }
  return translationKey("Could not save your action");
}

// How each step status's tone is marked: with the investigation's marks.
const STEP_TONE_INDICATOR: Record<
  RemediationStepTone,
  InvestigationStatusIndicator
> = {
  checking: "checking",
  waiting: "waiting",
  live: "live",
  attention: "attention",
  done: "done",
  failed: "failed",
  idle: "idle",
};

// How often the fix in the code is read again while it is being written.
const CODE_FIX_POLL_INTERVAL_MS: number = 15 * 1000;

/*
 * THE REMEDIATION STEP OF THE AI CARD (block 43): step 2, under the
 * investigation - what OneUptime AI is doing to fix the incident or alert,
 * or why it is not. It was a card of its own, far down the page under the
 * telemetry, and easy to miss entirely: "Up there, it should show the
 * remediation card."
 *
 * It says, in this order: what OneUptime AI decided for each way it fixes
 * (the decision's lines - with what to do and where, when something stood
 * in the way), the fixes it proposed or ran (with Approve & Run where they
 * wait for approval), the fix in the code the investigation recommends, and
 * - when nothing was fixed and the record is open - Try again, which decides
 * again with the project's settings of now.
 */
// What Try again's gate asks about: the record itself.
const PRIVATE_RECORD_INCIDENT: Incident = new Incident();
const PRIVATE_RECORD_ALERT: Alert = new Alert();

const RemediationStep: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [suggestions, setSuggestions] = useState<
    Array<AutoRemediationSuggestion>
  >([]);
  /*
   * What the rule engine did with the signal, or why it did nothing - shown
   * even when there is no suggestion, so a signal nothing fixed says why.
   */
  const [decision, setDecision] = useState<RemediationDecision | null>(null);
  /*
   * The stage of the decision as last read. An evaluated decision does not
   * change - approving or dismissing a suggestion does not touch it - so it
   * is read again only while remediation still waits for the investigation,
   * or after Try again wrote a new one.
   */
  const decisionStageRef: React.MutableRefObject<AutoRemediationDecisionStage | null> =
    useRef<AutoRemediationDecisionStage | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  /*
   * The incident or alert what the step holds was read for: the card can
   * stay on the page while it moves to the next one, and what it tells the
   * AI card is only ever about the one on the page.
   */
  const [loadedSubjectId, setLoadedSubjectId] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [failedAction, setFailedAction] =
    useState<RemediationSuggestionAction | null>(null);
  // Which suggestion the refused action was on, to read its reloaded status.
  const [failedSuggestionId, setFailedSuggestionId] = useState<string>("");
  const [busySuggestionId, setBusySuggestionId] = useState<string>("");
  const [busyAction, setBusyAction] =
    useState<RemediationSuggestionAction | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set<string>(),
  );
  // Try again: in flight, and what the server said when it refused.
  const [isTryingAgain, setIsTryingAgain] = useState<boolean>(false);
  const [tryAgainError, setTryAgainError] = useState<string>("");
  /*
   * How many times Try again has had its answer, and where the keyboard's
   * place goes then: Try again itself while it is still offered, else the
   * step's title (useEffect below).
   */
  const [tryAgainAnswerCount, setTryAgainAnswerCount] = useState<number>(0);
  const tryAgainButtonId: string = useId();
  const stepHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);
  // The fix in the code the investigation recommends, once read.
  const [codeFixSuggestion, setCodeFixSuggestion] =
    useState<InvestigationCodeFixSuggestion | null>(null);
  const [codeFixSubjectKey, setCodeFixSubjectKey] = useState<string>("");
  /*
   * An approve/dismiss is in flight — from the click until the reload that
   * shows its outcome has landed. It is both the single-submit guard and
   * what keeps a background poll from clobbering the list meanwhile.
   */
  const isActionInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const isTryAgainInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const incidentIdString: string | undefined = props.incidentId?.toString();
  const alertIdString: string | undefined = props.alertId?.toString();
  const subjectIdString: string = incidentIdString || alertIdString || "";
  const signal: RemediationDecisionSignal = incidentIdString
    ? "incident"
    : "alert";
  /*
   * On a private incident's or alert's page, what the reader holds on it
   * (PrivateRecordScope): Try again changes the record, which the server
   * allows only through a team of theirs that owns it.
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(
      incidentIdString ? PRIVATE_RECORD_INCIDENT : PRIVATE_RECORD_ALERT,
    );
  const currentSubjectIdRef: React.MutableRefObject<string> =
    useRef<string>(subjectIdString);
  currentSubjectIdRef.current = subjectIdString;

  /*
   * Enable AI as the selected project holds it now - followed live when it
   * is switched - or unknown while the project is not loaded: never "it is
   * on now" of a switch nobody read. With AI off, the fix in the code is
   * not asked about: nothing new can start, and the server says nothing.
   */
  const isAiOnNow: boolean | undefined = useAiSwitchState();
  const isCodeFixRecommended: boolean =
    Boolean(props.codeFix?.isRecommended) && isAiOnNow !== false;
  const codeFixKey: string = `${subjectIdString}:${
    props.codeFix?.investigationRunId || ""
  }`;

  /*
   * Each record starts from nothing: a refusal or a Try again of the record
   * before never shows on the next one.
   */
  useEffect(() => {
    setTryAgainError("");
    setIsTryingAgain(false);
    isTryAgainInFlightRef.current = false;
  }, [subjectIdString]);

  const load: (options?: {
    isActionReload?: boolean;
    isDecisionRead?: boolean;
  }) => Promise<void> = useCallback(
    async (options?: {
      isActionReload?: boolean;
      isDecisionRead?: boolean;
    }): Promise<void> => {
      /*
       * Don't clobber the list while an approve/dismiss is in flight —
       * except for that action's own reload, which is what ends it.
       */
      if (isActionInFlightRef.current && !options?.isActionReload) {
        return;
      }
      const requestedSubjectId: string =
        incidentIdString || alertIdString || "";
      try {
        const query: Record<string, ObjectID> = {};
        if (incidentIdString) {
          query["incidentId"] = new ObjectID(incidentIdString);
        } else if (alertIdString) {
          query["alertId"] = new ObjectID(alertIdString);
        } else {
          // Nothing to read for: nothing to show, and nothing to wait on.
          setLoadedSubjectId("");
          setIsLoaded(true);
          return;
        }

        /*
         * The decisions are read beside the suggestions, and a failed
         * read of them (an older server, say) only leaves them out.
         */
        const shouldReadDecision: boolean =
          options?.isDecisionRead === true ||
          (!options?.isActionReload &&
            decisionStageRef.current !==
              AutoRemediationDecisionStage.Evaluated);

        const [result, decisionRows]: [
          ListResult<AutoRemediationSuggestion>,
          ListResult<AutoRemediationDecision> | null,
        ] = await Promise.all([
          ModelAPI.getList<AutoRemediationSuggestion>({
            modelType: AutoRemediationSuggestion,
            query,
            limit: 10,
            skip: 0,
            select: {
              _id: true,
              status: true,
              ruleNameSnapshot: true,
              // No rule: the project's own pick, named as it is (not "Rule: ...").
              autoRemediationRuleId: true,
              runbookNameSnapshot: true,
              rationaleMarkdown: true,
              runbookId: true,
              runbookExecutionId: true,
              suggestionType: true,
              commandPlan: true,
              mcpToolCallPlan: true,
              verificationStatus: true,
              verificationNote: true,
              kubernetesClusterId: true,
              resourceType: true,
              resourceId: true,
              createdAt: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
          }),
          shouldReadDecision
            ? ModelAPI.getList<AutoRemediationDecision>({
                modelType: AutoRemediationDecision,
                query,
                limit: 5,
                skip: 0,
                select: {
                  _id: true,
                  stage: true,
                  entries: true,
                  createdAt: true,
                },
                sort: {
                  createdAt: SortOrder.Descending,
                },
              }).catch((): null => {
                return null;
              })
            : Promise.resolve(null),
        ]);

        // An answer for the incident or alert the page has moved on from.
        if (currentSubjectIdRef.current !== requestedSubjectId) {
          return;
        }

        setSuggestions(result.data);
        if (decisionRows) {
          const picked: RemediationDecision | null = pickRemediationDecision(
            decisionRows.data,
          );
          decisionStageRef.current = picked?.stage || null;
          setDecision(picked);
        }
        setLoadedSubjectId(requestedSubjectId);
        setIsLoaded(true);
      } catch {
        // Best-effort step — a failed refresh keeps the previous state.
        if (currentSubjectIdRef.current === requestedSubjectId) {
          setLoadedSubjectId(requestedSubjectId);
          setIsLoaded(true);
        }
      }
    },
    [incidentIdString, alertIdString],
  );

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  /*
   * While the investigation runs, remediation waits for it. The moment it
   * is done, the decision that follows is read: the step moves on from
   * "Waiting" without a reload.
   */
  const previousStageRef: React.MutableRefObject<AIInvestigationStage> =
    useRef<AIInvestigationStage>(props.investigationStage);
  useEffect(() => {
    const previous: AIInvestigationStage = previousStageRef.current;
    previousStageRef.current = props.investigationStage;

    if (previous === "underway" && props.investigationStage !== "underway") {
      load({ isDecisionRead: true }).catch(() => {
        // handled inside load
      });
    }
  }, [props.investigationStage, load]);

  /*
   * The fix in the code the investigation recommends: read when it does,
   * and again while it is being written. A failed read says nothing.
   */
  const loadCodeFix: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestedKey: string = codeFixKey;

      if (!isCodeFixRecommended || !subjectIdString) {
        setCodeFixSuggestion(null);
        setCodeFixSubjectKey(requestedKey);
        return;
      }

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-investigation/code-fix-suggestion",
            ),
            data: { subjectType: signal, subjectId: subjectIdString },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (`${currentSubjectIdRef.current}` !== subjectIdString) {
          return;
        }

        setCodeFixSuggestion(
          parseInvestigationCodeFixSuggestion(response.data),
        );
        setCodeFixSubjectKey(requestedKey);
      } catch {
        if (`${currentSubjectIdRef.current}` === subjectIdString) {
          setCodeFixSuggestion(null);
          setCodeFixSubjectKey(requestedKey);
        }
      }
    }, [codeFixKey, isCodeFixRecommended, signal, subjectIdString]);

  useEffect(() => {
    loadCodeFix().catch(() => {
      // handled inside loadCodeFix
    });
  }, [loadCodeFix]);

  const codeFix: InvestigationCodeFixSuggestion | null =
    codeFixSubjectKey === codeFixKey ? codeFixSuggestion : null;
  const isCodeFixInProgress: boolean =
    codeFix?.offer === SuggestionOffer.InProgress;

  useEffect(() => {
    if (!isCodeFixInProgress) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      loadCodeFix().catch(() => {
        // handled inside loadCodeFix
      });
    }, CODE_FIX_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isCodeFixInProgress, loadCodeFix]);

  // Poll while an AI plan is still in flight so the pick lands live.
  const hasPlanning: boolean =
    decision?.stage === AutoRemediationDecisionStage.WaitingForInvestigation ||
    suggestions.some((s: AutoRemediationSuggestion): boolean => {
      if (
        s.status === AutoRemediationSuggestionStatus.Planning ||
        s.verificationStatus === AutoRemediationVerificationStatus.Pending
      ) {
        return true;
      }
      // A cloud change's dry run is on its way: its answer lands on the plan.
      if (
        s.status === AutoRemediationSuggestionStatus.Suggested &&
        s.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
        isCloudDryRunInFlight(
          AiRemediationCommandPlanUtil.parse(s.commandPlan || null),
          OneUptimeDate.getCurrentDate(),
        )
      ) {
        return true;
      }
      /*
       * An approved fix through MCP servers is made detached: keep polling
       * while a change is still on its way or not yet sent.
       */
      if (isMcpFixInProgress(s)) {
        return true;
      }
      // An approved command plan settles asynchronously — keep polling until it does.
      if (
        s.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
        (s.status === AutoRemediationSuggestionStatus.Approved ||
          s.status === AutoRemediationSuggestionStatus.AutoExecuted)
      ) {
        const plan: AiRemediationCommandPlan | null =
          AiRemediationCommandPlanUtil.parse(s.commandPlan || null);
        if (!plan) {
          return false;
        }
        // A missing executionStatus right after approval means the sweep has not started yet.
        const executionStatus: AiRemediationPlanExecutionStatus =
          plan.executionStatus || AiRemediationPlanExecutionStatus.NotStarted;
        return (
          executionStatus === AiRemediationPlanExecutionStatus.Running ||
          executionStatus === AiRemediationPlanExecutionStatus.NotStarted
        );
      }
      return false;
    });

  useEffect(() => {
    if (!hasPlanning) {
      return;
    }
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      load().catch(() => {
        // handled inside load
      });
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [hasPlanning, load]);

  const toggleExpanded: (key: string) => void = (key: string): void => {
    setExpandedIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set<string>(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const performAction: (
    suggestion: AutoRemediationSuggestion,
    action: RemediationSuggestionAction,
  ) => Promise<void> = async (
    suggestion: AutoRemediationSuggestion,
    action: RemediationSuggestionAction,
  ): Promise<void> => {
    const suggestionId: string | undefined = suggestion.id?.toString();
    if (!suggestionId) {
      return;
    }

    /*
     * One action at a time, decided on the ref rather than on state: a
     * double click lands both clicks before React re-renders the button
     * as disabled, and each click would otherwise post its own approve.
     */
    if (isActionInFlightRef.current) {
      return;
    }
    isActionInFlightRef.current = true;

    setActionError("");
    setFailedAction(null);
    setFailedSuggestionId("");
    setBusySuggestionId(suggestionId);
    setBusyAction(action);

    let refusal: string = "";

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/auto-remediation/${action}`,
          ),
          data: { suggestionId },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
    } catch (err) {
      /*
       * The server re-checks a kubectl plan at approval time — the cluster's
       * remediation may have been switched off, or what runs its kubectl
       * changed, since the plan was composed — and refuses the click with
       * the reason and what to do. It also refuses a click that lost to
       * someone else's; the reload below says which.
       */
      refusal = API.getFriendlyMessage(err);
    }

    /*
     * Reload either way — a refusal usually means the plan's state moved
     * on — and only then release the guard. Until the reloaded row
     * replaces the one the click was made on, that row still shows
     * "Approve & Run", and a second click there would post again. The
     * refusal is shown together with the reloaded row, so its headline can
     * say what really happened.
     */
    try {
      await load({ isActionReload: true });
    } finally {
      if (refusal) {
        setActionError(refusal);
        setFailedAction(action);
        setFailedSuggestionId(suggestionId);
      }
      setBusySuggestionId("");
      setBusyAction(null);
      isActionInFlightRef.current = false;
    }
  };

  /*
   * Try again: OneUptime AI decides again, now, with the project's settings
   * of now (POST /auto-remediation/try-again). The new decision - and any
   * fix it started - is read at once; a refusal says why, in the reader's
   * language.
   */
  const tryAgain: () => Promise<void> = async (): Promise<void> => {
    if (isTryAgainInFlightRef.current || !subjectIdString) {
      return;
    }

    const requestedSubjectId: string = subjectIdString;
    isTryAgainInFlightRef.current = true;
    setIsTryingAgain(true);
    setTryAgainError("");

    let refusal: string = "";

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(
            APP_API_URL.toString() + "/auto-remediation/try-again",
          ),
          data: incidentIdString
            ? { incidentId: incidentIdString }
            : { alertId: alertIdString || "" },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
    } catch (err) {
      refusal = API.getFriendlyMessage(err) || REMEDIATION_TRY_AGAIN_FAILED;
    }

    try {
      await load({ isDecisionRead: true });
      await loadCodeFix();
    } finally {
      if (currentSubjectIdRef.current === requestedSubjectId) {
        setTryAgainError(refusal);
        setIsTryingAgain(false);
        setTryAgainAnswerCount((count: number): number => {
          return count + 1;
        });
      }
      isTryAgainInFlightRef.current = false;
    }
  };

  /*
   * Once Try again has its answer, the keyboard stays on the step. The
   * button is locked while it works, which takes the focus off it, and a
   * new decision that started a fix takes the button away altogether: the
   * focus fell to the top of the page, and a screen reader said nothing of
   * what changed. It goes back to Try again while it is offered, else to
   * the step's title, so the new lines are read from there. A reader who
   * has moved on meanwhile keeps their place.
   */
  useEffect(() => {
    if (tryAgainAnswerCount === 0) {
      return;
    }

    const active: Element | null = document.activeElement;

    if (active && active !== document.body) {
      return;
    }

    const button: HTMLElement | null =
      document.getElementById(tryAgainButtonId);

    if (button) {
      button.focus();
      return;
    }

    stepHeadingRef.current?.focus();
  }, [tryAgainAnswerCount, tryAgainButtonId]);

  /*
   * The project's switches as they are now: a decision that found fixing,
   * or AI, off says so in the past tense once it is on again - with Try
   * again as the next step. The fixing switch is read only for such a
   * decision; Enable AI comes with the selected project.
   */
  const isRemediationOffEntry: boolean = Boolean(
    decision?.entries.some((entry: AutoRemediationDecisionEntry): boolean => {
      return entry.reason === AutoRemediationDecisionReason.RemediationOff;
    }),
  );
  const laneSwitches: AiLaneSwitchRead = useAiLaneSwitchStates({
    subjectType: signal,
    isEnabled: isRemediationOffEntry,
  });
  const switchesNow: RemediationSwitchesNow = {
    isAiOn: isAiOnNow,
    isFixingOn: laneSwitches.states.fix,
  };

  const decisionLines: Array<RemediationDecisionLine> = decision
    ? getRemediationDecisionLines({
        decision,
        signal,
        translator,
        switchesNow,
      })
    : [];

  /*
   * What the page's AI card needs to know to fold into one line: whether
   * fixing did anything with this incident or alert, or why not. Still
   * reading until what the step holds was read for this one. Told once per
   * change, and afresh for each incident or alert.
   */
  const foldState: RemediationFoldState = getRemediationFoldState({
    isLoaded: isLoaded && loadedSubjectId === subjectIdString,
    suggestionCount: suggestions.length,
    decision,
  });
  const onFoldStateChangeRef: React.MutableRefObject<
    ((state: RemediationFoldState) => void) | undefined
  > = useRef<((state: RemediationFoldState) => void) | undefined>(
    props.onFoldStateChange,
  );
  onFoldStateChangeRef.current = props.onFoldStateChange;
  const reportedFoldStateRef: React.MutableRefObject<{
    subjectId: string;
    state: RemediationFoldState;
  } | null> = useRef<{
    subjectId: string;
    state: RemediationFoldState;
  } | null>(null);

  useEffect(() => {
    const reported: {
      subjectId: string;
      state: RemediationFoldState;
    } | null = reportedFoldStateRef.current;

    if (
      reported &&
      reported.subjectId === subjectIdString &&
      isSameRemediationFoldState(reported.state, foldState)
    ) {
      return;
    }

    reportedFoldStateRef.current = {
      subjectId: subjectIdString,
      state: foldState,
    };
    onFoldStateChangeRef.current?.(foldState);
  });

  /*
   * Why an approve, a dry run or a dismiss was refused, headed by what
   * really happened to the fix (getActionErrorTitle): under the buttons of
   * the fix that was pressed, where the reader is looking - a long fix on a
   * phone put the step's own top out of sight - or over the step when that
   * fix is gone from it.
   */
  const renderActionError: (
    statusAfterReload: AutoRemediationSuggestionStatus | undefined,
  ) => ReactElement = (
    statusAfterReload: AutoRemediationSuggestionStatus | undefined,
  ): ReactElement => {
    return (
      <InvestigationNotice
        role="alert"
        testId="remediation-action-error"
        indicator={noticeFailedIcon}
        title={getActionErrorTitle(failedAction, statusAfterReload)}
        onDismiss={() => {
          setActionError("");
        }}
      >
        {translator.translateText(actionError)}
      </InvestigationNotice>
    );
  };

  // One fix, flat: its title and where it stands, why, its commands, and its actions.
  const renderSuggestion: (
    suggestion: AutoRemediationSuggestion,
  ) => ReactElement = (suggestion: AutoRemediationSuggestion): ReactElement => {
    const suggestionId: string = suggestion.id?.toString() || "";
    const status: AutoRemediationSuggestionStatus =
      (suggestion.status as AutoRemediationSuggestionStatus) ||
      AutoRemediationSuggestionStatus.Planning;
    const isBusy: boolean = busySuggestionId === suggestionId;
    const isExpanded: boolean = expandedIds.has(suggestionId);
    const isCommandPlan: boolean =
      suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan;
    const isMcpFix: boolean =
      suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls;
    const plan: AiRemediationCommandPlan | null = isCommandPlan
      ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null)
      : null;
    const mcpPlan: ExternalMcpToolCallPlan | null = isMcpFix
      ? ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan || null)
      : null;
    /*
     * A plan waiting for approval that holds an SSH command can no longer
     * be approved: the step says so in place of "Approve & Run", and leaves
     * Dismiss.
     */
    const isUnapprovablePlan: boolean =
      status === AutoRemediationSuggestionStatus.Suggested &&
      hasRemovedSshCommand(plan);
    // A fix that changes a cloud account can be dry-run first.
    const dryRunTitle: string | null = isUnapprovablePlan
      ? null
      : getCloudDryRunButtonTitle({ status, plan });
    const runbookTitle: string =
      suggestion.runbookNameSnapshot ||
      (translator.translateText(
        status === AutoRemediationSuggestionStatus.Planning
          ? "Picking the best runbook…"
          : "No runbook",
      ) as string);
    const isClusterFix: boolean = Boolean(
      suggestion.kubernetesClusterId ||
        plan?.commands.some((command: AiRemediationCommand) => {
          return command.stepType === RunbookStepType.Kubectl;
        }),
    );
    // A resource round, or a plan of commands on a resource's AI agent.
    const isResourceFix: boolean =
      !isClusterFix &&
      Boolean(
        suggestion.resourceId ||
          plan?.commands.some((command: AiRemediationCommand) => {
            return command.stepType === RunbookStepType.ResourceCommand;
          }),
      );
    const title: string = isMcpFix
      ? (translator.translateText("AI fix through MCP servers") as string)
      : isCommandPlan
        ? (translator.translateText(
            isClusterFix
              ? "AI kubectl fix"
              : isResourceFix
                ? "AI infrastructure fix"
                : "AI Command Plan",
          ) as string)
        : runbookTitle;
    let sourceLabel: string = translator.translateTemplate("Rule: {{name}}", {
      name:
        suggestion.ruleNameSnapshot ||
        (translator.translateText("Unknown") as string),
    });

    if (isProjectRunbookPick(suggestion)) {
      /*
       * The project's own pick, made while no rule is set up: it is
       * OneUptime AI's, and no rule's.
       */
      sourceLabel = translator.translateText("OneUptime AI") as string;
    } else if (suggestion.kubernetesClusterId) {
      sourceLabel =
        suggestion.ruleNameSnapshot ||
        (translator.translateText("AI remediation for cluster") as string);
    } else if (suggestion.resourceId) {
      sourceLabel =
        suggestion.ruleNameSnapshot ||
        (translator.translateText("AI remediation") as string);
    }

    // What can be done with the fix now.
    const canApprove: boolean =
      status === AutoRemediationSuggestionStatus.Suggested &&
      !isUnapprovablePlan;
    const canDismiss: boolean =
      status === AutoRemediationSuggestionStatus.Suggested ||
      status === AutoRemediationSuggestionStatus.Planning;
    const canViewExecution: boolean = Boolean(
      !isCommandPlan &&
        (status === AutoRemediationSuggestionStatus.Approved ||
          status === AutoRemediationSuggestionStatus.AutoExecuted) &&
        suggestion.runbookId &&
        suggestion.runbookExecutionId,
    );
    const hasActions: boolean =
      canApprove || Boolean(dryRunTitle) || canDismiss || canViewExecution;

    return (
      <div
        key={suggestionId}
        data-testid="remediation-fix"
        data-status={status}
        className="py-5 first:pt-0 last:pb-0"
      >
        {/*
          The fix's name and where it came from, and where it stands beside
          them: at the end of the name's line while both fit, under the name
          on a narrow card, where it starts like the lines it heads.
        */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col">
            <span className="break-words text-sm font-medium text-gray-900">
              {title}
            </span>
            <span className="break-words text-xs text-gray-500">
              {sourceLabel}
            </span>
          </div>
          <div
            data-testid="remediation-fix-facts"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:pt-0.5"
          >
            <StatusFact
              status={status}
              isCommandPlan={isCommandPlan || isMcpFix}
              isUnapprovable={isUnapprovablePlan}
            />
            {suggestion.verificationStatus ? (
              <VerificationFact
                status={
                  suggestion.verificationStatus as AutoRemediationVerificationStatus
                }
              />
            ) : (
              <></>
            )}
          </div>
        </div>

        {/*
          What OneUptime AI and the agents wrote - the verification's note,
          the reasoning, each command's why, an error - reads in its own
          direction (dir="auto"): English on a Persian page kept its full
          stop at the start of its line.
        */}
        {suggestion.verificationNote ? (
          <div
            dir="auto"
            data-testid="remediation-fix-verification-note"
            className="mt-2 text-xs text-gray-500"
          >
            {suggestion.verificationNote}
          </div>
        ) : (
          <></>
        )}

        {suggestion.rationaleMarkdown ? (
          <div className="mt-3">
            <button
              type="button"
              className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={isExpanded}
              onClick={() => {
                toggleExpanded(suggestionId);
              }}
            >
              {translator.translateText(
                isExpanded ? "Hide reasoning" : "Show reasoning",
              )}
            </button>
            {isExpanded ? (
              <div dir="auto" className="mt-2 text-sm text-gray-700">
                <MarkdownViewer
                  text={suggestion.rationaleMarkdown}
                  safeMode={true}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {plan ? (
          <div className="mt-3">
            <ol className="flex flex-col gap-4">
              {plan.commands.map(
                (command: AiRemediationCommand): ReactElement => {
                  const commandKey: string = `${suggestionId}:command:${command.sequence}`;
                  const isOutputExpanded: boolean = expandedIds.has(commandKey);
                  const commandPillKind: CommandApprovalPillKind | null =
                    getCommandApprovalPillKind(command, status);
                  /*
                   * Nothing in a plan that can't be approved waits for an
                   * approval: only its SSH command's "no longer runs" is
                   * said.
                   */
                  const approvalPillKind: CommandApprovalPillKind | null =
                    isUnapprovablePlan &&
                    commandPillKind === CommandApprovalPillKind.NeedsApproval
                      ? null
                      : commandPillKind;
                  const programChip: string | null =
                    getCommandProgramChip(command);

                  return (
                    <li
                      key={commandKey}
                      data-testid="remediation-command"
                      className="border-l-2 border-gray-200 pl-3"
                    >
                      {/*
                        Where it runs and the program it runs, then what
                        the policy says of it and how it went: words with a
                        dot, which wrap as words do on a phone.
                      */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-medium text-gray-500">
                            {command.sequence}.
                          </span>
                          <span className="break-words text-xs font-medium text-gray-900">
                            {getCommandTargetLabel(command, translator)}
                          </span>
                          {programChip ? (
                            <code
                              data-testid="remediation-command-program"
                              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
                            >
                              {programChip}
                            </code>
                          ) : (
                            <></>
                          )}
                        </span>
                        {command.kubectlTier ? (
                          <KubectlTierFact tier={command.kubectlTier} />
                        ) : command.stepType ===
                            RunbookStepType.ResourceCommand &&
                          command.resourceCommandTier ? (
                          <ResourceCommandTierFact
                            tier={command.resourceCommandTier}
                          />
                        ) : (
                          <></>
                        )}
                        {approvalPillKind ? (
                          <CommandApprovalFact kind={approvalPillKind} />
                        ) : (
                          <></>
                        )}
                        {command.execution ? (
                          <CommandExecutionFact
                            status={command.execution.status}
                          />
                        ) : (
                          <></>
                        )}
                      </div>

                      <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
                        {command.command}
                      </pre>

                      <div
                        dir="auto"
                        data-testid="remediation-command-rationale"
                        className="mt-2 text-xs text-gray-600"
                      >
                        {command.rationale}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {translator.translateTemplate(
                          "Expected effect: {{effect}}",
                          { effect: command.expectedEffect },
                        )}
                      </div>

                      <CommandGitOpsNote command={command} />

                      <CloudCommandNote command={command} />

                      {command.rollbackCommand ? (
                        <div className="mt-1 text-xs text-gray-500">
                          <TranslatedSentence
                            template="Rollback: {{command}}"
                            slots={{
                              /*
                               * Code, which reads left to right in every
                               * language (Theme.css).
                               */
                              command: (
                                <code className="font-mono text-gray-700">
                                  {command.rollbackCommand}
                                </code>
                              ),
                            }}
                          />
                        </div>
                      ) : (
                        <></>
                      )}

                      {command.execution ? (
                        <CommandExecutionDetails
                          execution={command.execution}
                          isOutputExpanded={isOutputExpanded}
                          onToggleOutput={() => {
                            toggleExpanded(commandKey);
                          }}
                        />
                      ) : (
                        <></>
                      )}

                      {/*
                       * The undo's own outcome, when the rollback arm ran
                       * (or skipped) it for this command: "Rollback status"
                       * below the plan says how the rollback as a whole
                       * ended, this says what happened to each undo.
                       */}
                      {command.rollbackExecution ? (
                        <div
                          className="mt-2 border-l-2 border-gray-200 pl-2"
                          data-testid="remediation-rollback-outcome"
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-xs font-medium text-gray-700">
                              {translator.translateText("Rollback result")}
                            </span>
                            <CommandExecutionFact
                              status={command.rollbackExecution.status}
                              testId="remediation-rollback-execution"
                            />
                          </div>
                          {command.rollbackExecution.status ===
                            AiRemediationCommandExecutionStatus.Skipped &&
                          !command.rollbackExecution.errorMessage ? (
                            <div className="mt-1 text-xs text-gray-500">
                              {translator.translateText(
                                "The undo did not run — undo this change by hand if it is still needed.",
                              )}
                            </div>
                          ) : (
                            <></>
                          )}
                          <CommandExecutionDetails
                            execution={command.rollbackExecution}
                            isOutputExpanded={expandedIds.has(
                              `${commandKey}:rollback`,
                            )}
                            onToggleOutput={() => {
                              toggleExpanded(`${commandKey}:rollback`);
                            }}
                          />
                        </div>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ol>
            {plan.executionStatus ? (
              <div className="mt-3 text-xs text-gray-500">
                {translator.translateTemplate("Plan execution: {{status}}", {
                  status: translator.translateText(
                    PLAN_EXECUTION_LABELS[plan.executionStatus] ||
                      plan.executionStatus,
                  ) as string,
                })}
              </div>
            ) : (
              <></>
            )}
            {plan.rollbackStatus ? (
              <div className="mt-1 text-xs text-gray-500">
                {translator.translateTemplate("Rollback status: {{status}}", {
                  status: translator.translateText(
                    ROLLBACK_STATUS_LABELS[plan.rollbackStatus] ||
                      plan.rollbackStatus,
                  ) as string,
                })}
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {mcpPlan ? (
          <McpToolCallList plan={mcpPlan} suggestionId={suggestionId} />
        ) : (
          <></>
        )}

        {((isCommandPlan && !plan) || (isMcpFix && !mcpPlan)) &&
        status !== AutoRemediationSuggestionStatus.Planning ? (
          <div className="mt-3 text-xs text-gray-500">
            {translator.translateText(
              isMcpFix
                ? MCP_TOOL_CALL_LIST_COPY.notShown
                : "The command plan could not be displayed.",
            )}
          </div>
        ) : (
          <></>
        )}

        {isUnapprovablePlan ? (
          <p
            className="mt-3 text-xs text-gray-600"
            data-testid="remediation-removed-ssh-note"
          >
            {translator.translateText(REMOVED_SSH_PLAN_NOTE)}
          </p>
        ) : (
          <></>
        )}

        {/*
          What the reader can do with the fix, each button as wide as its
          words: a Button fills the row below md, which made Approve & Run a
          bar of its own over the others on a phone. A refused press says
          why right under the buttons that were pressed.
        */}
        {hasActions ? (
          <div
            data-testid="remediation-fix-actions"
            className="mt-3 flex flex-wrap items-center gap-2 [&>button]:ml-0 [&>button]:w-auto [&>button]:md:ml-0"
          >
            {canApprove ? (
              <Button
                title="Approve & Run"
                icon={IconProp.Check}
                buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                buttonSize={ButtonSize.Small}
                disabled={isBusy}
                isLoading={isBusy && busyAction === "approve"}
                dataTestId="remediation-approve-button"
                onClick={() => {
                  performAction(suggestion, "approve").catch(() => {
                    // handled inside performAction
                  });
                }}
              />
            ) : (
              <></>
            )}

            {dryRunTitle ? (
              <Button
                title={dryRunTitle}
                icon={IconProp.Search}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                disabled={
                  isBusy ||
                  isCloudDryRunInFlight(plan, OneUptimeDate.getCurrentDate())
                }
                isLoading={isBusy && busyAction === "dry-run"}
                dataTestId="remediation-dry-run-button"
                onClick={() => {
                  performAction(suggestion, "dry-run").catch(() => {
                    // handled inside performAction
                  });
                }}
              />
            ) : (
              <></>
            )}

            {canDismiss ? (
              <Button
                title="Dismiss"
                icon={IconProp.Close}
                buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                buttonSize={ButtonSize.Small}
                disabled={isBusy}
                onClick={() => {
                  performAction(suggestion, "dismiss").catch(() => {
                    // handled inside performAction
                  });
                }}
              />
            ) : (
              <></>
            )}

            {canViewExecution ? (
              <Button
                title="View Execution"
                icon={IconProp.List}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                      {
                        modelId: suggestion.runbookId!,
                        subModelId: suggestion.runbookExecutionId!.toString(),
                      },
                    ),
                  );
                }}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {actionError && failedSuggestionId === suggestionId ? (
          <div className="mt-3">{renderActionError(status)}</div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  // The AI card is one line that says why nothing was fixed, or deciding.
  if (
    props.aiCardFold === "folded" ||
    props.aiCardFold === "checking" ||
    isRemediationFoldedIntoAiCard({
      state: foldState,
      aiCardFold: props.aiCardFold,
    })
  ) {
    return <Fragment />;
  }

  const isLoadedForSubject: boolean =
    isLoaded && loadedSubjectId === subjectIdString;
  // A refusal shows under the fix that was pressed while it is on the step.
  const isActionErrorOnItsFix: boolean = suggestions.some(
    (suggestion: AutoRemediationSuggestion): boolean => {
      return (
        Boolean(failedSuggestionId) &&
        suggestion.id?.toString() === failedSuggestionId
      );
    },
  );
  const fixes: Array<RemediationFixFacts> = suggestions.map(
    (suggestion: AutoRemediationSuggestion): RemediationFixFacts => {
      return getRemediationFixFacts(suggestion);
    },
  );
  const isWaiting: boolean =
    isLoadedForSubject &&
    isRemediationWaitingForInvestigation({
      decision,
      investigationStage: props.investigationStage,
    });
  const stepStatus: RemediationStepStatus = getRemediationStepStatus({
    isLoaded: isLoadedForSubject,
    decision,
    lines: decisionLines,
    fixes,
    investigationStage: props.investigationStage,
    codeFix,
    isOffByChoice: foldState.kind === "off",
  });
  const updateGate: PermissionGateResult = PermissionGate.check(
    incidentIdString ? new Incident() : new Alert(),
    ModelAction.Update,
    privateRecordOptions,
  );
  const isTryAgainOffered: boolean =
    updateGate.isAllowed &&
    canOfferRemediationTryAgain({
      isLoaded: isLoadedForSubject,
      isRecordResolved: Boolean(props.isRecordResolved),
      decision,
      lines: decisionLines,
      fixes,
      investigationStage: props.investigationStage,
      codeFix,
      switchesNow,
    });

  /*
   * While remediation waits for the investigation, its one line says so.
   * Written down (WaitingForInvestigation) or not yet: fixing is decided
   * once the investigation is done, whether it is on or off.
   */
  const waitingLines: Array<RemediationDecisionLine> = isWaiting
    ? [
        {
          key: "waiting-for-investigation",
          tone: "waiting",
          text: translator.translateText(
            REMEDIATION_STEP_WAITING[signal],
          ) as string,
          links: [],
        },
      ]
    : [];
  const linesToDraw: Array<RemediationDecisionLine> = isWaiting
    ? waitingLines
    : decisionLines;
  /*
   * Nothing was ever decided about the record, no fix was proposed, and
   * there is no fix in the code to speak of: a pull request being written
   * or opened is OneUptime AI trying, and its own line says so.
   */
  const hasCodeFixLine: boolean = Boolean(
    codeFix && codeFix.offer !== SuggestionOffer.None,
  );
  const isNotTried: boolean =
    isLoadedForSubject &&
    !isWaiting &&
    !decision &&
    suggestions.length === 0 &&
    !hasCodeFixLine;

  return (
    <AiCardStep
      number={2}
      title={REMEDIATION_STEP_TITLE}
      status={{
        text: stepStatus.text,
        indicator: STEP_TONE_INDICATOR[stepStatus.tone],
      }}
      statusLabel={REMEDIATION_STEP_STATUS_LABEL}
      isLast={true}
      testId="ai-card-step-remediation"
      headingRef={stepHeadingRef}
    >
      {actionError && !isActionErrorOnItsFix ? (
        renderActionError(undefined)
      ) : (
        <></>
      )}

      {!isLoadedForSubject ? (
        <p
          data-testid="remediation-step-checking"
          className="text-sm leading-6 text-gray-500"
        >
          {translator.translateText(
            "Checking what OneUptime AI did to fix this…",
          )}
        </p>
      ) : (
        <></>
      )}

      <RemediationDecisionList lines={linesToDraw} />

      {isNotTried ? (
        <p
          data-testid="remediation-step-not-tried"
          className="text-sm leading-6 text-gray-600"
        >
          {translator.translateText(REMEDIATION_STEP_NOT_TRIED[signal])}
        </p>
      ) : (
        <></>
      )}

      {suggestions.length > 0 ? (
        <div data-testid="remediation-fixes">
          {/*
            While a fix waits for approval: what approving it does. It runs
            exactly what is shown, under the approver's name.
          */}
          {isRemediationApprovalNoteShown(suggestions) ? (
            <p
              data-testid="remediation-approval-note"
              className="mb-4 text-xs leading-5 text-gray-500"
            >
              {translator.translateText(REMEDIATION_APPROVAL_NOTE)}
            </p>
          ) : (
            <></>
          )}
          <div className="divide-y divide-gray-200">
            {suggestions.map(
              (suggestion: AutoRemediationSuggestion): ReactElement => {
                return renderSuggestion(suggestion);
              },
            )}
          </div>
        </div>
      ) : (
        <></>
      )}

      {codeFix && codeFix.offer !== SuggestionOffer.None ? (
        <RemediationCodeFix
          key={codeFixKey}
          signal={signal}
          subjectId={subjectIdString}
          investigationRunId={props.codeFix?.investigationRunId || null}
          suggestion={codeFix}
          onChanged={() => {
            loadCodeFix().catch(() => {
              // handled inside loadCodeFix
            });
          }}
        />
      ) : (
        <></>
      )}

      {isTryAgainOffered ? (
        <div
          data-testid="remediation-try-again"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <div className="flex-none [&>button]:ml-0 [&>button]:md:ml-0">
            <Button
              id={tryAgainButtonId}
              title={REMEDIATION_TRY_AGAIN_BUTTON}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isTryingAgain}
              disabled={isTryingAgain}
              dataTestId="remediation-try-again-button"
              onClick={() => {
                tryAgain().catch(() => {
                  // handled inside tryAgain
                });
              }}
            />
          </div>
          <p className="min-w-0 flex-[1_1_14rem] text-xs leading-5 text-gray-500">
            {translator.translateText(REMEDIATION_TRY_AGAIN_HINT[signal])}
          </p>
        </div>
      ) : (
        <></>
      )}

      {tryAgainError ? (
        <InvestigationNotice
          role="alert"
          testId="remediation-try-again-error"
          indicator={noticeFailedIcon}
          title={REMEDIATION_TRY_AGAIN_FAILED}
          onDismiss={() => {
            setTryAgainError("");
          }}
        >
          {translator.translateText(tryAgainError)}
        </InvestigationNotice>
      ) : (
        <></>
      )}
    </AiCardStep>
  );
};

export default RemediationStep;
