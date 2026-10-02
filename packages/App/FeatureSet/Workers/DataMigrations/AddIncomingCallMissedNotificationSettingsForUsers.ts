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
 * Backfills the missed call notification setting
 * (SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION, email on) for every
 * existing project member.
 *
 * Why this exists: defaults are only written when a user joins a project, and
 * the Notification Settings page shows an event with no row as switched off.
 * The missed call notification seeds the row itself before it sends, so
 * nobody would miss an email without this - but until their first missed
 * call, everyone who joined before the event existed would see it as off
 * while it is in fact on.
 *
 * Modelled on AddShiftReminderNotificationSettingsForUsers. Idempotent:
 * addIncomingCallNotificationSettings is a count-then-create per (user,
 * project, eventType). One project's or one member's failure is logged and
 * the rest continue.
 */
export default class AddIncomingCallMissedNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddIncomingCallMissedNotificationSettingsForUsers");
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
            hasAcceptedInvitation: true,
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
          `AddIncomingCallMissedNotificationSettingsForUsers: could not list members of project ${projectId.toString()}: ${err}`,
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
          await UserNotificationSettingService.addIncomingCallNotificationSettings(
            userId,
            projectId,
          );
        } catch (err) {
          logger.error(
            `AddIncomingCallMissedNotificationSettingsForUsers: failed to add the missed call notification setting for user ${userId.toString()} in project ${projectId.toString()}: ${err}`,
          );
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
