import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationDecision from "Common/Models/DatabaseModels/AutoRemediationDecision";
import { AutoRemediationDecisionStage } from "Common/Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import { isProjectRunbookPick } from "Common/Types/AutoRemediation/AutoRemediationFix";
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
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
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
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RemediationDecisionList from "./RemediationDecisionList";
import McpToolCallList, { MCP_TOOL_CALL_LIST_COPY } from "./McpToolCallList";
import {
  getRemediationDecisionLines,
  getRemediationDecisionStatus,
  pickRemediationDecision,
  REMEDIATION_DECISION_CARD_DESCRIPTION,
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionStatus,
} from "./RemediationDecisionLines";
import RemediationDecisionStatusBadge from "./RemediationDecisionStatusBadge";
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
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  hideIfEmpty?: boolean | undefined;
  /*
   * What the card read, for the page's AI card (RemediationFoldState,
   * AiOffSummaryData): still reading, fixing did something or has
   * something to say, or it did nothing because it was off - and why.
   * Called on every change, and afresh for every incident or alert.
   */
  onFoldStateChange?: ((state: RemediationFoldState) => void) | undefined;
  /*
   * How the page's AI card is drawn. While it is the one-line "AI
   * investigation is off" summary - or is still deciding whether it is -
   * that line says why nothing was fixed too, so a card that would only
   * say so is not drawn. A fix to show, or anything else to say, is drawn
   * as always.
   */
  aiCardFold?: AiCardFold | undefined;
}

interface StatusVisual {
  label: string;
  badge: string;
  dot: string;
}

const STATUS_VISUAL: Record<AutoRemediationSuggestionStatus, StatusVisual> = {
  [AutoRemediationSuggestionStatus.Planning]: {
    label: "AI is picking a runbook…",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AutoRemediationSuggestionStatus.Suggested]: {
    label: "Waiting for approval",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [AutoRemediationSuggestionStatus.Approved]: {
    label: "Approved & started",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.AutoExecuted]: {
    label: "Auto-executed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.Dismissed]: {
    label: "Dismissed",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
  [AutoRemediationSuggestionStatus.NoneApplicable]: {
    label: "No runbook applies",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

/*
 * A plan waiting for approval that can no longer be approved: it holds an
 * SSH command, composed before runbook credentials were removed. "Waiting
 * for approval" would wait for what nobody can give.
 */
const UNAPPROVABLE_PLAN_VISUAL: StatusVisual = {
  label: translationKey("Can't be approved"),
  badge: "bg-gray-100 text-gray-700 ring-gray-200",
  dot: "bg-gray-400",
};

function StatusPill({
  status,
  isCommandPlan,
  isUnapprovable,
}: {
  status: AutoRemediationSuggestionStatus;
  isCommandPlan?: boolean | undefined;
  isUnapprovable?: boolean | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const v: StatusVisual = isUnapprovable
    ? UNAPPROVABLE_PLAN_VISUAL
    : STATUS_VISUAL[status] ||
      STATUS_VISUAL[AutoRemediationSuggestionStatus.Planning]!;
  // A command plan is composed, not picked from runbooks.
  const label: string = translator.translateText(
    isCommandPlan && status === AutoRemediationSuggestionStatus.Planning
      ? "AI is composing a fix…"
      : isCommandPlan &&
          status === AutoRemediationSuggestionStatus.NoneApplicable
        ? "No safe fix found"
        : v.label,
  ) as string;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {label}
    </span>
  );
}

interface TierVisual {
  label: string;
  badge: string;
  dot: string;
}

/*
 * The kubectl policy tier, in the reader's words: is this a look, a safe
 * change, or something that needed a human to say yes.
 */
const TIER_VISUAL: Record<KubectlCommandTier, TierVisual> = {
  [KubectlCommandTier.Read]: {
    label: "read-only",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    dot: "bg-sky-500",
  },
  [KubectlCommandTier.SafeWrite]: {
    label: "safe change",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [KubectlCommandTier.RiskyWrite]: {
    label: "riskier change",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [KubectlCommandTier.Denied]: {
    label: "denied",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
};

function KubectlTierPill({ tier }: { tier: KubectlCommandTier }): ReactElement {
  const translator: Translator = useTranslator();
  const v: TierVisual =
    TIER_VISUAL[tier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {translator.translateText(v.label)}
    </span>
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

function ResourceCommandTierPill({
  tier,
}: {
  tier: ResourceCommandTier;
}): ReactElement {
  return (
    <KubectlTierPill
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
 * The card's description: what an AI fix on this signal can be. Commands
 * run through a resource's AI agent (a Docker host, a database server, a
 * host, ...) are named only when the card shows such a fix, so every other
 * card — kubectl, Runner and runbook fixes — reads exactly as before.
 */
export const REMEDIATION_CARD_DESCRIPTION: string = translationKey(
  "Fixes OneUptime AI proposed or applied for this signal — kubectl on a cluster, commands on a Runner, or a runbook. Approving runs exactly what is shown, under your name.",
);

export const REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES: string =
  translationKey(
    "Fixes OneUptime AI proposed or applied for this signal — kubectl on a cluster, commands through a resource's AI agent, commands on a Runner, or a runbook. Approving runs exactly what is shown, under your name.",
  );

// Said when a fix on the card goes through the project's external MCP servers.
export const REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES: string =
  translationKey(
    "Fixes OneUptime AI proposed or applied for this signal — through an AI agent, a Runner, a runbook or your MCP servers' tools. Approving runs exactly what is shown, under your name.",
  );

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

export function getRemediationCardDescription(
  suggestions: Array<
    Pick<
      AutoRemediationSuggestion,
      "resourceId" | "suggestionType" | "commandPlan"
    >
  >,
): string {
  const hasMcpFix: boolean = suggestions.some(
    (
      suggestion: Pick<AutoRemediationSuggestion, "suggestionType">,
    ): boolean => {
      return (
        suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls
      );
    },
  );

  if (hasMcpFix) {
    return REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES;
  }

  const hasResourceFix: boolean = suggestions.some(
    (
      suggestion: Pick<
        AutoRemediationSuggestion,
        "resourceId" | "suggestionType" | "commandPlan"
      >,
    ): boolean => {
      if (suggestion.resourceId) {
        return true;
      }

      if (
        suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan
      ) {
        return false;
      }

      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null);

      return Boolean(
        plan?.commands.some((command: AiRemediationCommand): boolean => {
          return command.stepType === RunbookStepType.ResourceCommand;
        }),
      );
    },
  );

  return hasResourceFix
    ? REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES
    : REMEDIATION_CARD_DESCRIPTION;
}

interface VerificationVisual {
  label: string;
  badge: string;
  dot: string;
}

const VERIFICATION_VISUAL: Record<
  AutoRemediationVerificationStatus,
  VerificationVisual
> = {
  [AutoRemediationVerificationStatus.Pending]: {
    label: "Verifying recovery\u2026",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AutoRemediationVerificationStatus.Verified]: {
    label: "Verified fixed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationVerificationStatus.Failed]: {
    label: "Verification failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [AutoRemediationVerificationStatus.Skipped]: {
    label: "Verification skipped",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function VerificationPill({
  status,
}: {
  status: AutoRemediationVerificationStatus;
}): ReactElement {
  const translator: Translator = useTranslator();
  const v: VerificationVisual =
    VERIFICATION_VISUAL[status] ||
    VERIFICATION_VISUAL[AutoRemediationVerificationStatus.Pending]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {translator.translateText(v.label)}
    </span>
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

interface ApprovalVisual {
  label: string;
  badge: string;
  dot: string;
}

const APPROVAL_VISUAL: Record<CommandApprovalPillKind, ApprovalVisual> = {
  [CommandApprovalPillKind.RanWithoutApproval]: {
    label: "auto-approved",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [CommandApprovalPillKind.NeedsApproval]: {
    label: "needs approval",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [CommandApprovalPillKind.NoLongerRuns]: {
    label: "no longer runs",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
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

function CommandApprovalPill({
  kind,
}: {
  kind: CommandApprovalPillKind;
}): ReactElement {
  const translator: Translator = useTranslator();
  const v: ApprovalVisual =
    APPROVAL_VISUAL[kind] ||
    APPROVAL_VISUAL[CommandApprovalPillKind.NeedsApproval]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {translator.translateText(v.label)}
    </span>
  );
}

interface CommandExecutionVisual {
  label: string;
  badge: string;
  dot: string;
}

const COMMAND_EXECUTION_VISUAL: Record<
  AiRemediationCommandExecutionStatus,
  CommandExecutionVisual
> = {
  [AiRemediationCommandExecutionStatus.Pending]: {
    label: "Pending",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
  [AiRemediationCommandExecutionStatus.Running]: {
    label: "Running…",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AiRemediationCommandExecutionStatus.Succeeded]: {
    label: "Succeeded",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AiRemediationCommandExecutionStatus.Failed]: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [AiRemediationCommandExecutionStatus.Skipped]: {
    label: "Skipped",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function CommandExecutionPill({
  status,
}: {
  status: AiRemediationCommandExecutionStatus;
}): ReactElement {
  const translator: Translator = useTranslator();
  const v: CommandExecutionVisual =
    COMMAND_EXECUTION_VISUAL[status] ||
    COMMAND_EXECUTION_VISUAL[AiRemediationCommandExecutionStatus.Pending]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {translator.translateText(v.label)}
    </span>
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
        <div className="mt-1 text-xs text-rose-600">
          {props.execution.errorMessage}
        </div>
      ) : (
        <></>
      )}
      {props.execution.output ? (
        <div className="mt-1">
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            onClick={props.onToggleOutput}
          >
            {translator.translateText(
              props.isOutputExpanded ? "Hide output" : "Show output",
            )}
          </button>
          {props.isOutputExpanded ? (
            <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
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
        <div
          className={`rounded border px-2 py-1.5 text-xs ${
            gitOps.putsBack
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-gray-200 bg-white text-gray-600"
          }`}
        >
          {gitOps.putsBack ? (
            <span className="mr-1 font-medium">
              {translator.translateText("Temporary fix")}
            </span>
          ) : (
            <></>
          )}
          {gitOps.summary}
        </div>
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
 * back), and, before it ran, that its undo is written from the value it
 * replaces — the agent reads that value first and reports it.
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
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          {translator.translateTemplate(
            "Declared as code by {{owner}}: the next apply may put the old value back, so change the code too.",
            { owner: command.managedAsCode },
          )}
        </div>
      ) : (
        <></>
      )}
      {!command.execution && !command.rollbackCommand ? (
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

export type RemediationSuggestionAction = "approve" | "dismiss";

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

const RemediationSuggestionCard: FunctionComponent<ComponentProps> = (
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
   * is read again only while remediation still waits for the investigation.
   */
  const decisionStageRef: React.MutableRefObject<AutoRemediationDecisionStage | null> =
    useRef<AutoRemediationDecisionStage | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  /*
   * The incident or alert what the card holds was read for: the card can
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
  /*
   * An approve/dismiss is in flight — from the click until the reload that
   * shows its outcome has landed. It is both the single-submit guard and
   * what keeps a background poll from clobbering the list meanwhile.
   */
  const isActionInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const incidentIdString: string | undefined = props.incidentId?.toString();
  const alertIdString: string | undefined = props.alertId?.toString();
  const subjectIdString: string = incidentIdString || alertIdString || "";
  const currentSubjectIdRef: React.MutableRefObject<string> =
    useRef<string>(subjectIdString);
  currentSubjectIdRef.current = subjectIdString;

  const load: (options?: { isActionReload?: boolean }) => Promise<void> =
    useCallback(
      async (options?: { isActionReload?: boolean }): Promise<void> => {
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
            !options?.isActionReload &&
            decisionStageRef.current !== AutoRemediationDecisionStage.Evaluated;

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
          // Best-effort card — a failed refresh keeps the previous state.
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

  const decisionLines: Array<RemediationDecisionLine> = decision
    ? getRemediationDecisionLines({
        decision,
        signal: incidentIdString ? "incident" : "alert",
        translator,
      })
    : [];

  /*
   * What the page's AI card needs to know to fold into one line: whether
   * fixing did anything with this incident or alert, or why not. Still
   * reading until what the card holds was read for this one. Told once per
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

  if (!isLoaded && props.hideIfEmpty) {
    return <Fragment />;
  }

  // The AI card's one line says why nothing was fixed.
  if (
    isRemediationFoldedIntoAiCard({
      state: foldState,
      aiCardFold: props.aiCardFold,
    })
  ) {
    return <Fragment />;
  }

  // Nothing to show: no suggestion, and no decision (an older signal).
  if (suggestions.length === 0 && decisionLines.length === 0) {
    return <Fragment />;
  }

  const hasSuggestions: boolean = suggestions.length > 0;

  /*
   * The header's pill sums up the decision while the decision is all the
   * card says. Once there are fixes, each carries a pill of its own that
   * follows it (waiting, approved, verified), and a pill drawn from the
   * decision - written once, when the signal was evaluated - would sit
   * above them saying something older.
   */
  const decisionStatus: RemediationDecisionStatus | null = hasSuggestions
    ? null
    : getRemediationDecisionStatus(decisionLines);

  return (
    <Card
      title="Remediation"
      description={
        hasSuggestions
          ? getRemediationCardDescription(suggestions)
          : REMEDIATION_DECISION_CARD_DESCRIPTION
      }
      rightElement={
        decisionStatus ? (
          <RemediationDecisionStatusBadge status={decisionStatus} />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {actionError ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={getActionErrorTitle(
              failedAction,
              suggestions.find(
                (suggestion: AutoRemediationSuggestion): boolean => {
                  return suggestion.id?.toString() === failedSuggestionId;
                },
              )?.status as AutoRemediationSuggestionStatus | undefined,
            )}
            title={actionError}
            dataTestId="remediation-action-error"
          />
        ) : (
          <></>
        )}

        <RemediationDecisionList
          lines={decisionLines}
          showHeading={hasSuggestions}
        />

        {suggestions.map(
          (suggestion: AutoRemediationSuggestion): ReactElement => {
            const suggestionId: string = suggestion.id?.toString() || "";
            const status: AutoRemediationSuggestionStatus =
              (suggestion.status as AutoRemediationSuggestionStatus) ||
              AutoRemediationSuggestionStatus.Planning;
            const isBusy: boolean = busySuggestionId === suggestionId;
            const isExpanded: boolean = expandedIds.has(suggestionId);
            const isCommandPlan: boolean =
              suggestion.suggestionType ===
              AutoRemediationSuggestionType.CommandPlan;
            const isMcpFix: boolean =
              suggestion.suggestionType ===
              AutoRemediationSuggestionType.McpToolCalls;
            const plan: AiRemediationCommandPlan | null = isCommandPlan
              ? AiRemediationCommandPlanUtil.parse(
                  suggestion.commandPlan || null,
                )
              : null;
            const mcpPlan: ExternalMcpToolCallPlan | null = isMcpFix
              ? ExternalMcpToolCallPlanUtil.parse(
                  suggestion.mcpToolCallPlan || null,
                )
              : null;
            /*
             * A plan waiting for approval that holds an SSH command can no
             * longer be approved: the card says so in place of "Approve &
             * Run", and leaves Dismiss.
             */
            const isUnapprovablePlan: boolean =
              status === AutoRemediationSuggestionStatus.Suggested &&
              hasRemovedSshCommand(plan);
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
              ? (translator.translateText(
                  "AI fix through MCP servers",
                ) as string)
              : isCommandPlan
                ? (translator.translateText(
                    isClusterFix
                      ? "AI kubectl fix"
                      : isResourceFix
                        ? "AI infrastructure fix"
                        : "AI Command Plan",
                  ) as string)
                : runbookTitle;
            let sourceLabel: string = translator.translateTemplate(
              "Rule: {{name}}",
              {
                name:
                  suggestion.ruleNameSnapshot ||
                  (translator.translateText("Unknown") as string),
              },
            );

            if (isProjectRunbookPick(suggestion)) {
              /*
               * The project's own pick, made while no rule is set up: it is
               * OneUptime AI's, and no rule's.
               */
              sourceLabel = translator.translateText("OneUptime AI") as string;
            } else if (suggestion.kubernetesClusterId) {
              sourceLabel =
                suggestion.ruleNameSnapshot ||
                (translator.translateText(
                  "AI remediation for cluster",
                ) as string);
            } else if (suggestion.resourceId) {
              sourceLabel =
                suggestion.ruleNameSnapshot ||
                (translator.translateText("AI remediation") as string);
            }

            return (
              <div
                key={suggestionId}
                className="rounded-md border border-gray-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {title}
                    </span>
                    <span className="text-xs text-gray-500">{sourceLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      status={status}
                      isCommandPlan={isCommandPlan || isMcpFix}
                      isUnapprovable={isUnapprovablePlan}
                    />
                    {suggestion.verificationStatus ? (
                      <VerificationPill
                        status={
                          suggestion.verificationStatus as AutoRemediationVerificationStatus
                        }
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                </div>

                {suggestion.verificationNote ? (
                  <div className="mt-2 text-xs text-gray-500">
                    {suggestion.verificationNote}
                  </div>
                ) : (
                  <></>
                )}

                {suggestion.rationaleMarkdown ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      onClick={() => {
                        toggleExpanded(suggestionId);
                      }}
                    >
                      {translator.translateText(
                        isExpanded ? "Hide reasoning" : "Show reasoning",
                      )}
                    </button>
                    {isExpanded ? (
                      <div className="mt-2 text-sm text-gray-700">
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
                    <ol className="flex flex-col gap-3">
                      {plan.commands.map(
                        (command: AiRemediationCommand): ReactElement => {
                          const commandKey: string = `${suggestionId}:command:${command.sequence}`;
                          const isOutputExpanded: boolean =
                            expandedIds.has(commandKey);
                          const commandPillKind: CommandApprovalPillKind | null =
                            getCommandApprovalPillKind(command, status);
                          /*
                           * Nothing in a plan that can't be approved waits
                           * for an approval: only its SSH command's "no
                           * longer runs" is said.
                           */
                          const approvalPillKind: CommandApprovalPillKind | null =
                            isUnapprovablePlan &&
                            commandPillKind ===
                              CommandApprovalPillKind.NeedsApproval
                              ? null
                              : commandPillKind;

                          return (
                            <li
                              key={commandKey}
                              className="rounded-md border border-gray-100 bg-gray-50 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-gray-500">
                                  {command.sequence}.
                                </span>
                                <span className="text-xs font-medium text-gray-900">
                                  {getCommandTargetLabel(command, translator)}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                                  {getCommandStepLabel(command)}
                                </span>
                                {command.kubectlTier ? (
                                  <KubectlTierPill tier={command.kubectlTier} />
                                ) : command.stepType ===
                                    RunbookStepType.ResourceCommand &&
                                  command.resourceCommandTier ? (
                                  <ResourceCommandTierPill
                                    tier={command.resourceCommandTier}
                                  />
                                ) : (
                                  <></>
                                )}
                                {approvalPillKind ? (
                                  <CommandApprovalPill
                                    kind={approvalPillKind}
                                  />
                                ) : (
                                  <></>
                                )}
                                {command.execution ? (
                                  <CommandExecutionPill
                                    status={command.execution.status}
                                  />
                                ) : (
                                  <></>
                                )}
                              </div>

                              <pre className="mt-2 overflow-x-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
                                {command.command}
                              </pre>

                              <div className="mt-2 text-xs text-gray-600">
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
                                      command: (
                                        <span className="font-mono text-gray-700">
                                          {command.rollbackCommand}
                                        </span>
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
                               * The undo's own outcome, when the rollback
                               * arm ran (or skipped) it for this command:
                               * "Rollback status" below the plan says how
                               * the rollback as a whole ended, this says
                               * what happened to each undo.
                               */}
                              {command.rollbackExecution ? (
                                <div
                                  className="mt-2 rounded border border-gray-200 bg-white px-2 py-1.5"
                                  data-testid="remediation-rollback-outcome"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-gray-700">
                                      {translator.translateText(
                                        "Rollback result",
                                      )}
                                    </span>
                                    <CommandExecutionPill
                                      status={command.rollbackExecution.status}
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
                      <div className="mt-2 text-xs text-gray-500">
                        {translator.translateTemplate(
                          "Plan execution: {{status}}",
                          {
                            status: translator.translateText(
                              PLAN_EXECUTION_LABELS[plan.executionStatus] ||
                                plan.executionStatus,
                            ) as string,
                          },
                        )}
                      </div>
                    ) : (
                      <></>
                    )}
                    {plan.rollbackStatus ? (
                      <div className="mt-1 text-xs text-gray-500">
                        {translator.translateTemplate(
                          "Rollback status: {{status}}",
                          {
                            status: translator.translateText(
                              ROLLBACK_STATUS_LABELS[plan.rollbackStatus] ||
                                plan.rollbackStatus,
                            ) as string,
                          },
                        )}
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

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {status === AutoRemediationSuggestionStatus.Suggested &&
                  !isUnapprovablePlan ? (
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

                  {status === AutoRemediationSuggestionStatus.Suggested ||
                  status === AutoRemediationSuggestionStatus.Planning ? (
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

                  {!isCommandPlan &&
                  (status === AutoRemediationSuggestionStatus.Approved ||
                    status === AutoRemediationSuggestionStatus.AutoExecuted) &&
                  suggestion.runbookId &&
                  suggestion.runbookExecutionId ? (
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
                              subModelId:
                                suggestion.runbookExecutionId!.toString(),
                            },
                          ),
                        );
                      }}
                    />
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
};

export default RemediationSuggestionCard;
