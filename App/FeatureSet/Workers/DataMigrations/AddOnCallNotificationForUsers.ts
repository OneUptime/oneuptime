import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";

export default class AddOnCallNotificationForUsers extends DataMigrationBase {
  public constructor() {
    super("AddOnCallNotificationForUsers");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: project.id!,
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

      if (teamMembers.length > 0) {
        // for each team member.
        for (const teamMember of teamMembers) {
          const userId: ObjectID = teamMember.userId!;
          if (!userId) {
            continue;
          }

          try {
            await UserNotificationSettingService.addOnCallNotificationSettings(
              userId,
              project.id!,
            );
          } catch (err) {
            // Log the error
            logger.error(
              `Failed to add default notification settings for user ${userId}: ${err}`,
            );
          }
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
