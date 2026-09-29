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

class IncomingCallPolicyOwnerRuleEngineServiceClass
  implements RuleRunEngine<IncomingCallPolicy, IncomingCallPolicyOwnerRule>
{
  public readonly ruleSelect: Select<IncomingCallPolicyOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    incomingCallPolicyLabels: { _id: true },
    incomingCallPolicyNamePattern: true,
    incomingCallPolicyDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the incoming call policy, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<IncomingCallPolicy> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "IncomingCallPolicyOwnerRule",
        projectId: policy.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        policy: policy,
        rules: rules,
        allowOwnerNotification: true,
      });
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

  /*
   * "Run now": the same evaluation, for an incoming call policy that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      IncomingCallPolicy,
      IncomingCallPolicyOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        policy: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running incoming call policy owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incomingCallPolicyId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    policy: IncomingCallPolicy;
    rules: Array<IncomingCallPolicyOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { policy, rules } = data;

    if (!policy.id || !policy.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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

    const matchedRules: Array<IncomingCallPolicyOwnerRule> = [];
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

    // Owners already on the incoming call policy are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: IncomingCallPolicyOwnerUserService,
        ownerTeamService: IncomingCallPolicyOwnerTeamService,
        resourceIdColumn: "incomingCallPolicyId",
        resourceId: policy.id,
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
        const owner: IncomingCallPolicyOwnerUser =
          new IncomingCallPolicyOwnerUser();
        owner.incomingCallPolicyId = policy.id;
        owner.projectId = policy.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: IncomingCallPolicyOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: IncomingCallPolicyOwnerTeam =
          new IncomingCallPolicyOwnerTeam();
        owner.incomingCallPolicyId = policy.id;
        owner.projectId = policy.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: IncomingCallPolicyOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `IncomingCallPolicyOwnerRuleEngine added owners to policy ${policy.id}`,
      { projectId: policy.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesPolicyMatchRule(
    policy: IncomingCallPolicy,
    rule: IncomingCallPolicyOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "incomingCallPolicyLabels",
        "incomingCallPolicyNamePattern",
        "incomingCallPolicyDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: IncomingCallPolicyOwnerRule): boolean => {
        return this.doesPolicyMatchLegacyRule(policy, legacyRule);
      },
    });
  }

  private doesPolicyMatchLegacyRule(
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
