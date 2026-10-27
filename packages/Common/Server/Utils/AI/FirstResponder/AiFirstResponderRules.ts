import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "../../../../Types/ObjectID";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import logger from "../../Logger";
import AiFirstResponder from "./AiFirstResponder";

/*
 * AN ALERT OR INCIDENT ON-CALL RULE THAT NO LONGER LETS ONEUPTIME AI RESPOND
 * FIRST - set to another When to Page, disabled, or deleted. The pages AI
 * holds for its policies go to people at once (AiFirstResponder): a hold the
 * rule no longer asks for is only a later page. A run does not say which
 * rule held it, so every hold of those policies goes.
 */

// What a rule service reads of the rules a write changes.
export interface AiFirstResponderRuleRow {
  projectId?: ObjectID | undefined;
  onCallDutyPolicies?: Array<OnCallDutyPolicy> | undefined;
}

export const AI_FIRST_RESPONDER_RULE_SELECT: {
  projectId: true;
  onCallDutyPolicies: { _id: true };
} = {
  projectId: true,
  onCallDutyPolicies: { _id: true },
};

export default class AiFirstResponderRules {
  // Whether an update to the rule stops it holding pages for OneUptime AI.
  public static isStoppingHolds(written: Record<string, unknown>): boolean {
    return (
      (written["whenToPage"] !== undefined &&
        written["whenToPage"] !== OnCallRuleWhenToPage.AfterOneUptimeAI) ||
      written["isEnabled"] === false
    );
  }

  // Hands off the pages AI holds for the rules' policies. Never throws.
  public static async handOffForRules(
    rules: Array<AiFirstResponderRuleRow>,
  ): Promise<void> {
    const policyIdsByProject: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const rule of rules) {
      if (!rule.projectId) {
        continue;
      }

      const policyIds: Set<string> =
        policyIdsByProject.get(rule.projectId.toString()) || new Set<string>();

      for (const policy of rule.onCallDutyPolicies || []) {
        if (policy.id) {
          policyIds.add(policy.id.toString());
        }
      }

      policyIdsByProject.set(rule.projectId.toString(), policyIds);
    }

    for (const [projectId, policyIds] of policyIdsByProject) {
      if (policyIds.size === 0) {
        continue;
      }

      try {
        await AiFirstResponder.onRuleStoppedHolding({
          projectId: new ObjectID(projectId),
          policyIds: Array.from(policyIds).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        });
      } catch (error) {
        logger.error(
          `OneUptime AI could not hand off the pages it holds for changed on-call rules in project ${projectId}: ${error}`,
        );
      }
    }
  }
}
