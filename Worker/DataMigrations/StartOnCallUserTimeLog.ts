import logger from "Common/Server/Utils/Logger";
import DataMigrationBase from "./DataMigrationBase";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleUserService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleTeamService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import User from "Common/Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OneUptimeDate from "Common/Types/Date";

export default class StartOnCallUserTimeLog extends DataMigrationBase {
  public constructor() {
    super("StartOnCallUserTimeLog");
  }

  public override async migrate(): Promise<void> {
    // get on call escalaton rules.
    // first for users
    // then for teams.
    // for teams, get the team members and create time logs for them.
    // then for schedules.
    // create logs for the current user.

    try {
      const escalationRulesForUsers: Array<OnCallDutyPolicyEscalationRuleUser> =
        await OnCallDutyPolicyEscalationRuleUserService.findBy({
          query: {},
          select: {
            userId: true,
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicyId: true,
            projectId: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const escalationRule of escalationRulesForUsers) {
        try {
          await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
            projectId: escalationRule.projectId!,
            onCallDutyPolicyId: escalationRule.onCallDutyPolicyId!,
            onCallDutyPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRuleId!,
            userId: escalationRule.userId!,
            startsAt: OneUptimeDate.getCurrentDate(),
          });
        } catch (err) {
          logger.error(
            `Error in starting time log for user ${escalationRule.userId?.toString()}`,
          );
          logger.error(err);
        }
      }

      logger.info("Started time logs for all users in escalation rules");

      // get escalation rules for teams
      const escalationRulesForTeams: Array<OnCallDutyPolicyEscalationRuleTeam> =
        await OnCallDutyPolicyEscalationRuleTeamService.findBy({
          query: {},
          select: {
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicyId: true,
            projectId: true,
            teamId: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const escalationRule of escalationRulesForTeams) {
        // get users in team.
        const users: Array<User> = await TeamMemberService.getUsersInTeam(
          escalationRule.teamId!,
        );

        for (const user of users) {
          try {
            await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
              projectId: escalationRule.projectId!,
              onCallDutyPolicyId: escalationRule.onCallDutyPolicyId!,
              onCallDutyPolicyEscalationRuleId:
                escalationRule.onCallDutyPolicyEscalationRuleId!,
              userId: user.id!,
              teamId: escalationRule.teamId!,
              startsAt: OneUptimeDate.getCurrentDate(),
            });
          } catch (err) {
            logger.error(
              `Error in starting time log for user ${user.id?.toString()}`,
            );
            logger.error(err);
          }
        }
      }

      // now do the schedules.
      const schedules: Array<OnCallDutyPolicyEscalationRuleSchedule> =
        await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
          query: {},
          select: {
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicyId: true,
            projectId: true,
            onCallDutyPolicyScheduleId: true,
            onCallDutyPolicySchedule: {
              currentUserIdOnRoster: true,
            },
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const schedule of schedules) {
        if (!schedule.onCallDutyPolicySchedule?.currentUserIdOnRoster) {
          continue;
        }

        try {
          await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
            projectId: schedule.projectId!,
            onCallDutyPolicyId: schedule.onCallDutyPolicyId!,
            onCallDutyPolicyEscalationRuleId:
              schedule.onCallDutyPolicyEscalationRuleId!,
            userId: schedule.onCallDutyPolicySchedule!.currentUserIdOnRoster!,
            onCallDutyPolicyScheduleId: schedule.onCallDutyPolicyScheduleId!,
            startsAt: OneUptimeDate.getCurrentDate(),
          });
        } catch (err) {
          logger.error(
            `Error in starting time log for schedule ${schedule.id} and user ${schedule.onCallDutyPolicySchedule?.currentUserIdOnRoster}`,
          );
          logger.error(err);
        }
      }
    } catch (err) {
      logger.error("Error in StartOnCallUserTimeLog migration");
      logger.error(err);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
