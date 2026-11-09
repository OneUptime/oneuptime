import Project from "../../../Models/DatabaseModels/Project";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  getRemediationApprovalsNeeded,
  isRiskierRemediationCommand,
} from "../../../Types/AutoRemediation/RemediationApprovals";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import { isAiResourceType } from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import KubectlPolicy from "../../../Utils/AiRemediation/KubectlPolicy";
import ResourceCommandPolicy from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";

/*
 * HOW MANY PEOPLE APPROVE A FIX, ON THE SERVER (Types/AutoRemediation/
 * RemediationApprovals has the rule; this is where the server applies it).
 *
 * A command is a riskier change when the policy tiered it RiskyWrite when
 * the fix was proposed - what the card and the chat messages say - or tiers
 * it so now: the policies are asked again, as approving asks them again
 * whether a command may run at all, so a plan whose stored tier is out of
 * date never runs on one approval.
 */

export function isRiskierChangeNow(command: AiRemediationCommand): boolean {
  if (isRiskierRemediationCommand(command)) {
    return true;
  }

  if (command.stepType === RunbookStepType.Kubectl) {
    return (
      KubectlPolicy.evaluateCommand(command.command).tier ===
      KubectlCommandTier.RiskyWrite
    );
  }

  if (
    command.stepType === RunbookStepType.ResourceCommand &&
    isAiResourceType(command.resourceType)
  ) {
    return (
      ResourceCommandPolicy.evaluateCommand({
        resourceType: command.resourceType,
        command: command.command,
      }).tier === ResourceCommandTier.RiskyWrite
    );
  }

  return false;
}

// Whether a plan holds a riskier change, stored or as the policies tier it now.
export function hasRiskierChangeNow(
  plan: AiRemediationCommandPlan | null | undefined,
): boolean {
  return (plan?.commands || []).some(isRiskierChangeNow);
}

/*
 * How many approvals a fix needs, with the project's rule as a read of it
 * gave it: two for a command plan holding a riskier change where the
 * project asks two people to approve one, one otherwise.
 */
export function getFixApprovalsNeeded(data: {
  project: Pick<Project, "requireTwoApprovalsForRiskierFixes"> | null;
  suggestionType: AutoRemediationSuggestionType | undefined;
  plan: AiRemediationCommandPlan | null | undefined;
}): number {
  return getRemediationApprovalsNeeded({
    isTwoApprovalsRuleOn:
      data.project?.requireTwoApprovalsForRiskierFixes === true,
    suggestionType: data.suggestionType,
    hasRiskierChange: hasRiskierChangeNow(data.plan),
  });
}

/*
 * Whether the project asks two people to approve a riskier fix, for what a
 * chat message or dialog says about it: null when it cannot be read. Never
 * what decides an approval - RemediationApproval reads the project itself,
 * and refuses when it cannot.
 */
export async function readTwoApprovalsRule(
  projectId: ObjectID,
): Promise<boolean | null> {
  try {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, requireTwoApprovalsForRiskierFixes: true },
      props: { isRoot: true },
    });

    if (!project) {
      return null;
    }

    return project.requireTwoApprovalsForRiskierFixes === true;
  } catch (error) {
    logger.debug(
      `RemediationApprovalsNeeded: could not read whether project ${projectId.toString()} asks two people to approve a riskier fix: ${error}`,
    );
    return null;
  }
}
