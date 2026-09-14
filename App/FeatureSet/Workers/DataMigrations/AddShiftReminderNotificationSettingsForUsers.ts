import DataMigrationBase from "./DataMigrationBase";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";

/*
 * Backfills the two shift-reminder notification settings
 * (SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS and
 * SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED) for every existing project
 * member.
 *
 * Why this exists: UserNotificationSettingService.sendUserNotification does a
 * findOneBy on (user, project, eventType) and sends NOTHING without a row,
 * and the defaults are only written when a user joins a project. So without
 * this migration every user who joined before these events existed would
 * configure a reminder lead time and silently never receive a reminder.
 *
 * Modelled on AddOnCallNotificationForUsers. Idempotent and safe to run
 * twice concurrently: addShiftReminderNotificationSettings is a
 * count-then-create per (user, project, eventType), and a second creator
 * losing the race hits the service's own duplicate check. One project's or
 * one member's failure is logged and the rest continue.
 */
export default class AddShiftReminderNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddShiftReminderNotificationSettingsForUsers");
  }

  public override async migrate(): Promise<void> {
    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {},
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      const projectId: ObjectID | null = project.id;

      if (!projectId) {
        continue;
      }

      let teamMembers: Array<TeamMember> = [];

      try {
        teamMembers = await TeamMemberService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            userId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `AddShiftReminderNotificationSettingsForUsers: could not list members of project ${projectId.toString()}: ${err}`,
        );
        continue;
      }

      // A user in several teams of one project is one member.
      const seenUserIds: Set<string> = new Set<string>();

      for (const teamMember of teamMembers) {
        const userId: ObjectID | undefined = teamMember.userId;

        if (!userId || seenUserIds.has(userId.toString())) {
          continue;
        }

        seenUserIds.add(userId.toString());

        try {
          await UserNotificationSettingService.addShiftReminderNotificationSettings(
            userId,
            projectId,
          );
        } catch (err) {
          logger.error(
            `AddShiftReminderNotificationSettingsForUsers: failed to add shift reminder notification settings for user ${userId.toString()} in project ${projectId.toString()}: ${err}`,
          );
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
