import { KubectlCommandTier } from "../Kubernetes/KubernetesClusterAiAccess";
import { ResourceCommandTier } from "../ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../Runbook/RunbookStepType";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "./AiRemediationCommandPlan";
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
 * and the chat messages call "riskier". A fix of safe changes only, a
 * runbook and a fix through MCP servers need one approval, as before: the
 * rule is about the changes OneUptime itself knows to be riskier.
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
 * How many approvals a fix needs: two when the project asks two people to
 * approve a riskier fix and this one is a command plan that holds a riskier
 * change; one otherwise.
 */
export function getRemediationApprovalsNeeded(data: {
  isTwoApprovalsRuleOn: boolean;
  suggestionType: AutoRemediationSuggestionType | undefined;
  hasRiskierChange: boolean;
}): number {
  return data.isTwoApprovalsRuleOn &&
    data.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
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
