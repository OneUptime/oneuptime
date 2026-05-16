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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class OnCallDutyPolicyScheduleOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            onCallDutyPolicyScheduleLabels: { _id: true },
            onCallDutyPolicyScheduleNamePattern: true,
            onCallDutyPolicyScheduleDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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

      const matchedRules: Array<OnCallDutyPolicyScheduleOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesScheduleMatchRule(
          scheduleWithDetails,
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
          const owner: OnCallDutyPolicyScheduleOwnerUser =
            new OnCallDutyPolicyScheduleOwnerUser();
          owner.onCallDutyPolicyScheduleId = schedule.id;
          owner.projectId = schedule.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await OnCallDutyPolicyScheduleOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: OnCallDutyPolicyScheduleOwnerTeam =
            new OnCallDutyPolicyScheduleOwnerTeam();
          owner.onCallDutyPolicyScheduleId = schedule.id;
          owner.projectId = schedule.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await OnCallDutyPolicyScheduleOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `OnCallDutyPolicyScheduleOwnerRuleEngine added owners to schedule ${schedule.id}`,
        { projectId: schedule.projectId.toString() } as LogAttributes,
      );
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

  private doesScheduleMatchRule(
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
