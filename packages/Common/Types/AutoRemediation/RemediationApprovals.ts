import { KubectlCommandTier } from "../Kubernetes/KubernetesClusterAiAccess";
import { ResourceCommandTier } from "../ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../Runbook/RunbookStepType";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "./AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "./AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "./AutoRemediationSuggestionType";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX (#6148's follow-up, which #5519 proposed).
 *
 * A project can ask two people to approve a fix OneUptime AI proposes when
 * it holds a riskier change (Project.requireTwoApprovalsForRiskierFixes, off
 * by default). Such a fix waits after its first approval - who gave it,
 * when and where are kept on it (AutoRemediationSuggestion.firstApprovedBy*)
 * - for a second from someone else, which runs it. The person who approved
 * first cannot approve it again. RemediationApproval decides it on the
 * server, so the AI card's Approve & Run and Slack's and Microsoft Teams'
 * Approve and run reach the same rule.
 *
 * A riskier change is what the command policies tier RiskyWrite: on a
 * Kubernetes cluster (KubectlPolicy) or on a resource through its AI agent
 * (ResourceCommandPolicy), a cloud account included - the changes the card
 * and the chat messages call "riskier" - and every change through an MCP
 * server, which no policy of OneUptime's tiers (isRiskierWhateverItChanges).
 * A fix of safe changes only and a runbook need one approval.
 *
 * The rule holds wherever a fix would run: with it on, a riskier change
 * never runs without asking either - a cluster or resource that bypasses
 * approvals, or whose allowlist names the change, proposes it instead
 * (RemediationCommandToolkit), and a rule that fixes through MCP servers
 * without asking proposes its changes (McpRemediationRunner).
 *
 * Every approval names the fix it approves (its plan fingerprint) and the
 * step it was offered as (RemediationApprovalStep); the first of two records
 * what it approved, and the second runs the fix only while it still runs
 * exactly that.
 *
 * What a fix stores is read here, React- and server-free, so the Dashboard
 * says what the server will decide. The server also asks the policies again
 * (RemediationApprovalsNeeded): a command they tier riskier now counts,
 * whatever its stored tier says.
 */

// How many people approve a riskier fix where the project asks for two.
export const APPROVALS_FOR_A_RISKIER_FIX: number = 2;

/*
 * Why the press of the person who gave a riskier fix its first approval
 * does nothing: it runs on a second approval, from someone else. The server
 * refuses with it (RemediationApproval), Slack and Microsoft Teams answer
 * with it before a dialog opens, and the AI card words it in the reader's
 * language (RemediationStepCopy holds the same key).
 */
export const ALREADY_APPROVED_FIRST_MESSAGE: string =
  "You already approved this fix. It holds a riskier change, and this project asks two people to approve one, so it runs once someone else approves it too.";

/*
 * Whether a command was tiered a riskier change when the fix was proposed:
 * RiskyWrite, from the kubectl policy for a kubectl step or the resource
 * command policy for a resource command. A Runner's Bash command has no
 * tier, and is not one.
 */
export function isRiskierRemediationCommand(
  command: Pick<
    AiRemediationCommand,
    "stepType" | "kubectlTier" | "resourceCommandTier"
  >,
): boolean {
  if (command.stepType === RunbookStepType.Kubectl) {
    return command.kubectlTier === KubectlCommandTier.RiskyWrite;
  }

  if (command.stepType === RunbookStepType.ResourceCommand) {
    return command.resourceCommandTier === ResourceCommandTier.RiskyWrite;
  }

  return false;
}

// The commands of a plan tiered a riskier change, in their order.
export function getRiskierRemediationCommands(
  plan: AiRemediationCommandPlan | null | undefined,
): Array<AiRemediationCommand> {
  return (plan?.commands || []).filter(isRiskierRemediationCommand);
}

/*
 * Whether a fix's kind holds a riskier change whatever it changes: a fix
 * through MCP servers. OneUptime has no command policy for what an MCP
 * server's tool does - a tool the server does not mark read-only may change
 * anything, and what a server says of its own tools is not something a
 * safety rule can stand on - so every change through one counts as riskier.
 * A runbook does not: OneUptime AI only picks one people wrote, and a step
 * its author knows to be risky asks for approval before it runs
 * (RunbookStep.requireApprovalBeforeRunning).
 */
export function isRiskierWhateverItChanges(
  suggestionType: AutoRemediationSuggestionType | string | undefined,
): boolean {
  return suggestionType === AutoRemediationSuggestionType.McpToolCalls;
}

/*
 * How many approvals a fix needs: two when the project asks two people to
 * approve a riskier fix and this one holds a riskier change - a command
 * plan with a command the policy tiers riskier, or a fix through MCP
 * servers; one otherwise.
 */
export function getRemediationApprovalsNeeded(data: {
  isTwoApprovalsRuleOn: boolean;
  suggestionType: AutoRemediationSuggestionType | undefined;
  hasRiskierChange: boolean;
}): number {
  if (!data.isTwoApprovalsRuleOn) {
    return 1;
  }

  if (isRiskierWhateverItChanges(data.suggestionType)) {
    return APPROVALS_FOR_A_RISKIER_FIX;
  }

  return data.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
    data.hasRiskierChange
    ? APPROVALS_FOR_A_RISKIER_FIX
    : 1;
}

/*
 * Whether two ids name the same person. Ids are compared as the server
 * writes them, lower-cased, so an id read back in another case is the
 * same person.
 */
export function isSameApprover(
  first: { toString: () => string } | string | null | undefined,
  second: { toString: () => string } | string | null | undefined,
): boolean {
  if (!first || !second) {
    return false;
  }

  const firstId: string = first.toString().trim().toLowerCase();
  const secondId: string = second.toString().trim().toLowerCase();

  return Boolean(firstId) && firstId === secondId;
}

/*
 * When a fix that still waits for approval was approved first: it waits for
 * the second of the two approvals a riskier fix needs. Undefined for a fix
 * nobody approved yet, and for one that no longer waits (approved, dismissed
 * or settled) - what its first approval was is history then. The AI Logs
 * pages say "Waiting for a second approval" by it.
 */
export function getWaitingFirstApprovedAt(suggestion: {
  status?: AutoRemediationSuggestionStatus | string | undefined;
  firstApprovedAt?: Date | undefined;
}): Date | undefined {
  return suggestion.status === AutoRemediationSuggestionStatus.Suggested &&
    suggestion.firstApprovedAt
    ? suggestion.firstApprovedAt
    : undefined;
}

/*
 * Whether a fix waits for someone else's approval as a reader sees it: it
 * still waits, and the reader gave its first approval - the first of the two
 * a riskier fix needs - so theirs is not the approval it waits for. AI
 * Insights says so instead of "waiting for your approval".
 */
export function isWaitingForOthersApproval(data: {
  suggestion: {
    status?: AutoRemediationSuggestionStatus | string | undefined;
    firstApprovedByUserId?: { toString: () => string } | string | undefined;
  };
  readerUserId?: { toString: () => string } | string | null | undefined;
}): boolean {
  return (
    data.suggestion.status === AutoRemediationSuggestionStatus.Suggested &&
    isSameApprover(data.suggestion.firstApprovedByUserId, data.readerUserId)
  );
}

/*
 * WHAT A PRESS OF APPROVE DOES TO A FIX, AS THE PERSON WAS SHOWN IT.
 *
 * A Slack dialog can be left open, a Microsoft Teams approval card is a
 * reply anyone in the channel can press, and the AI card can be read a
 * while before its button is pressed: what the press does can change in
 * between - someone else approves first, the project turns the rule on or
 * off. Each press says which step it was offered as (encoded on the chats'
 * buttons, sent with the card's Approve), and RemediationApproval acts only
 * when that is still what the press does; otherwise nothing is done, and
 * the person reviews the fix again.
 */
export enum RemediationApprovalStepKind {
  // One approval runs the fix.
  Only = "only",
  // The first of two: it is recorded, and nothing runs.
  First = "first",
  // The second of two, after someone else's first: it runs the fix.
  Second = "second",
}

export interface RemediationApprovalStep {
  kind: RemediationApprovalStepKind;
  // The second of two: who gave the first approval, lower-cased.
  firstApprovedByUserId?: string | undefined;
}

// The longest an encoded step can be: "second:" and an id.
const MAX_ENCODED_STEP_LENGTH: number = 64;

const ENCODED_STEP_SEPARATOR: string = ":";

// An id the server writes: hex digits and dashes.
const APPROVER_ID_PATTERN: RegExp = /^[0-9a-f-]{1,40}$/;

/*
 * What a press of Approve does now: run the fix when it needs one approval,
 * record the first approval of one that needs two and has none (that
 * counts), and run it after the first approval named otherwise.
 */
export function getRemediationApprovalStep(data: {
  approvalsNeeded: number;
  // The first approval, when one was given to the fix as it is now.
  firstApprovedByUserId?:
    | { toString: () => string }
    | string
    | null
    | undefined;
}): RemediationApprovalStep {
  if (data.approvalsNeeded < 2) {
    return { kind: RemediationApprovalStepKind.Only };
  }

  const firstId: string = (data.firstApprovedByUserId?.toString() || "")
    .trim()
    .toLowerCase();

  if (!firstId) {
    return { kind: RemediationApprovalStepKind.First };
  }

  return {
    kind: RemediationApprovalStepKind.Second,
    firstApprovedByUserId: firstId,
  };
}

// A step as a button or a request carries it: "only", "first", "second:<id>".
export function encodeRemediationApprovalStep(
  step: RemediationApprovalStep,
): string {
  if (step.kind === RemediationApprovalStepKind.Second) {
    return `${step.kind}${ENCODED_STEP_SEPARATOR}${(
      step.firstApprovedByUserId || ""
    ).toLowerCase()}`;
  }

  return step.kind;
}

// A step a press carried, or null when it is not one this code wrote.
export function decodeRemediationApprovalStep(
  value: unknown,
): RemediationApprovalStep | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_ENCODED_STEP_LENGTH
  ) {
    return null;
  }

  if (value === RemediationApprovalStepKind.Only) {
    return { kind: RemediationApprovalStepKind.Only };
  }

  if (value === RemediationApprovalStepKind.First) {
    return { kind: RemediationApprovalStepKind.First };
  }

  const prefix: string = `${RemediationApprovalStepKind.Second}${ENCODED_STEP_SEPARATOR}`;

  if (!value.startsWith(prefix)) {
    return null;
  }

  const firstId: string = value.slice(prefix.length).toLowerCase();

  if (!APPROVER_ID_PATTERN.test(firstId)) {
    return null;
  }

  return {
    kind: RemediationApprovalStepKind.Second,
    firstApprovedByUserId: firstId,
  };
}

// Whether two steps are the same press: the same kind, after the same first.
export function isSameRemediationApprovalStep(
  first: RemediationApprovalStep,
  second: RemediationApprovalStep,
): boolean {
  if (first.kind !== second.kind) {
    return false;
  }

  return (
    first.kind !== RemediationApprovalStepKind.Second ||
    isSameApprover(first.firstApprovedByUserId, second.firstApprovedByUserId)
  );
}

/*
 * Why a press did nothing because what it does changed since it was
 * offered, by what it does now, in the chats' and the card's words. Who
 * approved first is named when their name could be read.
 */
export function getApprovalStepChangedMessage(data: {
  now: RemediationApprovalStep;
  firstApproverName?: string | null | undefined;
}): string {
  if (data.now.kind === RemediationApprovalStepKind.Second) {
    const who: string = data.firstApproverName?.trim() || "Someone else";

    return `${who} approved this fix while you were reviewing it, so approving it now would run it. Nothing was done: review it again before you approve.`;
  }

  if (data.now.kind === RemediationApprovalStepKind.First) {
    return "This fix now needs two people to approve it, and yours would be the first. Nothing was done: review it again before you approve.";
  }

  return "One approval now runs this fix, so yours would run it. Nothing was done: review it again before you approve.";
}
