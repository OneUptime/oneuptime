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
 * Every accepted member of every project, once each, given every security
 * case notification setting they do not have yet
 * (UserNotificationSettingService.addSecurityCaseNotificationSettings: email
 * and push on), or the settings `addSettings` writes - a later Security
 * event's (AddSecurityHuntNotificationSettingsForUsers). `migrationName`
 * names the migration in what is logged.
 *
 * Idempotent: addSecurityCaseNotificationSettings is a count-then-create per
 * (user, project, eventType), and a row a member already has is left as it
 * is. One project's or one member's failure is logged and the rest continue.
 */
export async function addSecurityCaseNotificationSettingsForMembers(
  migrationName: string,
  addSettings: (userId: ObjectID, projectId: ObjectID) => Promise<void> = (
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> => {
    return UserNotificationSettingService.addSecurityCaseNotificationSettings(
      userId,
      projectId,
    );
  },
): Promise<void> {
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
        `${migrationName}: could not list members of project ${projectId.toString()}: ${err}`,
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
        await addSettings(userId, projectId);
      } catch (err) {
        logger.error(
          `${migrationName}: failed to add the security case notification settings for user ${userId.toString()} in project ${projectId.toString()}: ${err}`,
        );
      }
    }
  }
}

/*
 * Backfills the three security case notification settings (a case at my
 * chosen priority, a case assigned to me or my team, a playbook step waiting
 * for my approval - email and push on) for every existing project member.
 *
 * Why this exists: defaults are only written when a user joins a project, and
 * the Notification Settings page shows an event with no row as switched off.
 * SecurityCaseNotifications seeds a person's rows itself before it tells
 * them anything, so nobody would miss a case without this - but until their
 * first case, everyone who joined before the events existed would see them
 * as off while they are in fact on.
 *
 * Modelled on AddIncomingCallMissedNotificationSettingsForUsers. The walk is
 * shared (addSecurityCaseNotificationSettingsForMembers): a security case
 * event added later is backfilled by a migration of its own that walks the
 * members again (AddSecurityCaseTargetAndTaskNotificationSettingsForUsers).
 */
export default class AddSecurityCaseNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddSecurityCaseNotificationSettingsForUsers");
  }

  public override async migrate(): Promise<void> {
    await addSecurityCaseNotificationSettingsForMembers(this.name);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
