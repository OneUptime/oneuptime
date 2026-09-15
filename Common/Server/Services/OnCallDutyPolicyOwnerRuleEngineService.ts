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
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class OnCallDutyPolicyOwnerRuleEngineServiceClass
  implements RuleRunEngine<OnCallDutyPolicy, OnCallDutyPolicyOwnerRule>
{
  public readonly ruleSelect: Select<OnCallDutyPolicyOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    onCallDutyPolicyLabels: { _id: true },
    onCallDutyPolicyNamePattern: true,
    onCallDutyPolicyDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the on-call duty policy, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<OnCallDutyPolicy> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "OnCallDutyPolicyOwnerRule",
        projectId: onCallDutyPolicy.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        onCallDutyPolicy: onCallDutyPolicy,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying on-call duty policy owner rules: ${error}`, {
        projectId: onCallDutyPolicy.projectId?.toString(),
        onCallDutyPolicyId: onCallDutyPolicy.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an on-call duty policy that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      OnCallDutyPolicy,
      OnCallDutyPolicyOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        onCallDutyPolicy: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running on-call duty policy owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        onCallDutyPolicyId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    onCallDutyPolicy: OnCallDutyPolicy;
    rules: Array<OnCallDutyPolicyOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { onCallDutyPolicy, rules } = data;

    if (
      !onCallDutyPolicy.id ||
      !onCallDutyPolicy.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
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
      return RuleApplicationResultUtil.noMatch();
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
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesPolicyMatchRule(
        policyWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the on-call duty policy are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: OnCallDutyPolicyOwnerUserService,
        ownerTeamService: OnCallDutyPolicyOwnerTeamService,
        resourceIdColumn: "onCallDutyPolicyId",
        resourceId: onCallDutyPolicy.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

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
        ownersAdded++;
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
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `OnCallDutyPolicyOwnerRuleEngine added owners to policy ${onCallDutyPolicy.id}`,
      { projectId: onCallDutyPolicy.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesPolicyMatchRule(
    policy: OnCallDutyPolicy,
    rule: OnCallDutyPolicyOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "onCallDutyPolicyLabels",
        "onCallDutyPolicyNamePattern",
        "onCallDutyPolicyDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (policyRule: OnCallDutyPolicyOwnerRule): boolean => {
        return this.doesPolicyMatchRuleLegacy(policy, policyRule);
      },
    });
  }

  private doesPolicyMatchRuleLegacy(
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
