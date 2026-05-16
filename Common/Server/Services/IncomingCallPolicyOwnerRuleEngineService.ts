import Label from "../../Models/DatabaseModels/Label";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyOwnerRule from "../../Models/DatabaseModels/IncomingCallPolicyOwnerRule";
import IncomingCallPolicyOwnerUser from "../../Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import IncomingCallPolicyOwnerTeam from "../../Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerRuleService from "./IncomingCallPolicyOwnerRuleService";
import IncomingCallPolicyOwnerUserService from "./IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyOwnerTeamService from "./IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncomingCallPolicyOwnerRuleEngineServiceClass {
  @CaptureSpan()
  public async applyRulesToIncomingCallPolicy(
    policy: IncomingCallPolicy,
  ): Promise<void> {
    if (!policy.id || !policy.projectId) {
      return;
    }

    try {
      const rules: Array<IncomingCallPolicyOwnerRule> =
        await IncomingCallPolicyOwnerRuleService.findBy({
          query: {
            projectId: policy.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            incomingCallPolicyLabels: { _id: true },
            incomingCallPolicyNamePattern: true,
            incomingCallPolicyDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const policyWithDetails: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: policy.id,
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

      const matchedRules: Array<IncomingCallPolicyOwnerRule> = [];

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
          const owner: IncomingCallPolicyOwnerUser =
            new IncomingCallPolicyOwnerUser();
          owner.incomingCallPolicyId = policy.id;
          owner.projectId = policy.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await IncomingCallPolicyOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: IncomingCallPolicyOwnerTeam =
            new IncomingCallPolicyOwnerTeam();
          owner.incomingCallPolicyId = policy.id;
          owner.projectId = policy.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await IncomingCallPolicyOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `IncomingCallPolicyOwnerRuleEngine added owners to policy ${policy.id}`,
        { projectId: policy.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(
        `Error applying incoming call policy owner rules: ${error}`,
        {
          projectId: policy.projectId?.toString(),
          incomingCallPolicyId: policy.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesPolicyMatchRule(
    policy: IncomingCallPolicy,
    rule: IncomingCallPolicyOwnerRule,
  ): boolean {
    if (
      rule.incomingCallPolicyLabels &&
      rule.incomingCallPolicyLabels.length > 0
    ) {
      if (!policy.labels || policy.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.incomingCallPolicyLabels.map(
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
      rule.incomingCallPolicyNamePattern &&
      (!policy.name ||
        !this.testRegex(rule.incomingCallPolicyNamePattern, policy.name, rule))
    ) {
      return false;
    }

    if (
      rule.incomingCallPolicyDescriptionPattern &&
      (!policy.description ||
        !this.testRegex(
          rule.incomingCallPolicyDescriptionPattern,
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
    rule: IncomingCallPolicyOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incoming call policy owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncomingCallPolicyOwnerRuleEngineServiceClass();
