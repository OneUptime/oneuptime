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
 * Gives every existing project member their "Incident SLA breached"
 * notification setting (SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION).
 *
 * An SLA breach was sent through the "Incident created" setting until it had
 * one of its own, so a member starts with email and every other channel they
 * have on for "Incident created": nobody stops hearing of breaches where they
 * heard of them (UserNotificationSettingService.SLA_BREACH_CHANNELS).
 *
 * Why this exists: defaults are only written when a user joins a project, and
 * the Notification Settings page shows an event with no row as switched off.
 * CheckSlaBreaches gives a person the setting itself before it tells them of
 * a breach, so nobody would miss one without this - but until their first
 * breach, everyone who joined before the event existed would see it as off
 * while it is in fact on.
 *
 * Modelled on AddIncomingCallMissedNotificationSettingsForUsers. Idempotent:
 * addIncidentSlaBreachedNotificationSettings writes a row only for somebody
 * who has none, and leaves a row a member already has as it is. One
 * project's or one member's failure is logged and the rest continue.
 */
export default class AddIncidentSlaBreachedNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddIncidentSlaBreachedNotificationSettingsForUsers");
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
          `AddIncidentSlaBreachedNotificationSettingsForUsers: could not list members of project ${projectId.toString()}: ${err}`,
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
          await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
            userId,
            projectId,
          );
        } catch (err) {
          logger.error(
            `AddIncidentSlaBreachedNotificationSettingsForUsers: failed to add the SLA breach notification setting for user ${userId.toString()} in project ${projectId.toString()}: ${err}`,
          );
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
