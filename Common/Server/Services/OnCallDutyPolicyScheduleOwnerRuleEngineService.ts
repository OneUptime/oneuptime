import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerRule from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerRule";
import OnCallDutyPolicyScheduleOwnerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import OnCallDutyPolicyScheduleOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerRuleService from "./OnCallDutyPolicyScheduleOwnerRuleService";
import OnCallDutyPolicyScheduleOwnerUserService from "./OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "./OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
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

class OnCallDutyPolicyScheduleOwnerRuleEngineServiceClass
  implements
    RuleRunEngine<OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleOwnerRule>
{
  public readonly ruleSelect: Select<OnCallDutyPolicyScheduleOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    onCallDutyPolicyScheduleLabels: { _id: true },
    onCallDutyPolicyScheduleNamePattern: true,
    onCallDutyPolicyScheduleDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the on-call duty schedule, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<OnCallDutyPolicySchedule> = {
    _id: true,
    projectId: true,
  };

  @CaptureSpan()
  public async applyRulesToSchedule(
    schedule: OnCallDutyPolicySchedule,
  ): Promise<void> {
    if (!schedule.id || !schedule.projectId) {
      return;
    }

    try {
      const rules: Array<OnCallDutyPolicyScheduleOwnerRule> =
        await OnCallDutyPolicyScheduleOwnerRuleService.findBy({
          query: {
            projectId: schedule.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "OnCallDutyPolicyScheduleOwnerRule",
        projectId: schedule.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        schedule: schedule,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(
        `Error applying on-call duty schedule owner rules: ${error}`,
        {
          projectId: schedule.projectId?.toString(),
          onCallDutyPolicyScheduleId: schedule.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * "Run now": the same evaluation, for an on-call duty schedule that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      OnCallDutyPolicySchedule,
      OnCallDutyPolicyScheduleOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        schedule: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(
        `Error running on-call duty schedule owner rules: ${error}`,
        {
          projectId: data.resource.projectId?.toString(),
          onCallDutyPolicyScheduleId: data.resource.id?.toString(),
        } as LogAttributes,
      );

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    schedule: OnCallDutyPolicySchedule;
    rules: Array<OnCallDutyPolicyScheduleOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { schedule, rules } = data;

    if (!schedule.id || !schedule.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const scheduleWithDetails: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneById({
        id: schedule.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!scheduleWithDetails) {
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

    const matchedRules: Array<OnCallDutyPolicyScheduleOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesScheduleMatchRule(
        scheduleWithDetails,
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

    // Owners already on the on-call duty schedule are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: OnCallDutyPolicyScheduleOwnerUserService,
        ownerTeamService: OnCallDutyPolicyScheduleOwnerTeamService,
        resourceIdColumn: "onCallDutyPolicyScheduleId",
        resourceId: schedule.id,
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
        const owner: OnCallDutyPolicyScheduleOwnerUser =
          new OnCallDutyPolicyScheduleOwnerUser();
        owner.onCallDutyPolicyScheduleId = schedule.id;
        owner.projectId = schedule.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: OnCallDutyPolicyScheduleOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: OnCallDutyPolicyScheduleOwnerTeam =
          new OnCallDutyPolicyScheduleOwnerTeam();
        owner.onCallDutyPolicyScheduleId = schedule.id;
        owner.projectId = schedule.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: OnCallDutyPolicyScheduleOwnerTeamService,
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
      `OnCallDutyPolicyScheduleOwnerRuleEngine added owners to schedule ${schedule.id}`,
      { projectId: schedule.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesScheduleMatchRule(
    schedule: OnCallDutyPolicySchedule,
    rule: OnCallDutyPolicyScheduleOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "onCallDutyPolicyScheduleLabels",
        "onCallDutyPolicyScheduleNamePattern",
        "onCallDutyPolicyScheduleDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        scheduleRule: OnCallDutyPolicyScheduleOwnerRule,
      ): boolean => {
        return this.doesScheduleMatchRuleLegacy(schedule, scheduleRule);
      },
    });
  }

  private doesScheduleMatchRuleLegacy(
    schedule: OnCallDutyPolicySchedule,
    rule: OnCallDutyPolicyScheduleOwnerRule,
  ): boolean {
    if (
      rule.onCallDutyPolicyScheduleLabels &&
      rule.onCallDutyPolicyScheduleLabels.length > 0
    ) {
      if (!schedule.labels || schedule.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> =
        rule.onCallDutyPolicyScheduleLabels.map((l: Label) => {
          return l.id?.toString() || "";
        });
      const labelIds: Array<string> = schedule.labels.map((l: Label) => {
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
      rule.onCallDutyPolicyScheduleNamePattern &&
      (!schedule.name ||
        !this.testRegex(
          rule.onCallDutyPolicyScheduleNamePattern,
          schedule.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.onCallDutyPolicyScheduleDescriptionPattern &&
      (!schedule.description ||
        !this.testRegex(
          rule.onCallDutyPolicyScheduleDescriptionPattern,
          schedule.description,
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
    rule: OnCallDutyPolicyScheduleOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in on-call duty schedule owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OnCallDutyPolicyScheduleOwnerRuleEngineServiceClass();
