import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerRule from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerRule";
import OnCallDutyPolicyOwnerUser from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerRuleService from "./OnCallDutyPolicyOwnerRuleService";
import OnCallDutyPolicyOwnerUserService from "./OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyOwnerTeamService from "./OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class OnCallDutyPolicyOwnerRuleEngineServiceClass {
  @CaptureSpan()
  public async applyRulesToOnCallDutyPolicy(
    onCallDutyPolicy: OnCallDutyPolicy,
  ): Promise<void> {
    if (!onCallDutyPolicy.id || !onCallDutyPolicy.projectId) {
      return;
    }

    try {
      const rules: Array<OnCallDutyPolicyOwnerRule> =
        await OnCallDutyPolicyOwnerRuleService.findBy({
          query: {
            projectId: onCallDutyPolicy.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            onCallDutyPolicyLabels: { _id: true },
            onCallDutyPolicyNamePattern: true,
            onCallDutyPolicyDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const policyWithDetails: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: onCallDutyPolicy.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!policyWithDetails) {
        return;
      }

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);

      const matchedRules: Array<OnCallDutyPolicyOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesPolicyMatchRule(
          policyWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

        for (const userId of userIds) {
          const owner: OnCallDutyPolicyOwnerUser =
            new OnCallDutyPolicyOwnerUser();
          owner.onCallDutyPolicyId = onCallDutyPolicy.id;
          owner.projectId = onCallDutyPolicy.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await OnCallDutyPolicyOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: OnCallDutyPolicyOwnerTeam =
            new OnCallDutyPolicyOwnerTeam();
          owner.onCallDutyPolicyId = onCallDutyPolicy.id;
          owner.projectId = onCallDutyPolicy.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await OnCallDutyPolicyOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `OnCallDutyPolicyOwnerRuleEngine added owners to policy ${onCallDutyPolicy.id}`,
        { projectId: onCallDutyPolicy.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying on-call duty policy owner rules: ${error}`, {
        projectId: onCallDutyPolicy.projectId?.toString(),
        onCallDutyPolicyId: onCallDutyPolicy.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesPolicyMatchRule(
    policy: OnCallDutyPolicy,
    rule: OnCallDutyPolicyOwnerRule,
  ): boolean {
    if (rule.onCallDutyPolicyLabels && rule.onCallDutyPolicyLabels.length > 0) {
      if (!policy.labels || policy.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.onCallDutyPolicyLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = policy.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.onCallDutyPolicyNamePattern &&
      (!policy.name ||
        !this.testRegex(rule.onCallDutyPolicyNamePattern, policy.name, rule))
    ) {
      return false;
    }

    if (
      rule.onCallDutyPolicyDescriptionPattern &&
      (!policy.description ||
        !this.testRegex(
          rule.onCallDutyPolicyDescriptionPattern,
          policy.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: OnCallDutyPolicyOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in on-call duty policy owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OnCallDutyPolicyOwnerRuleEngineServiceClass();
