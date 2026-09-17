import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserService from "Common/Server/Services/UserService";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";

export default class MigrateDefaultUserNotificationRule extends DataMigrationBase {
  public constructor() {
    super("MigrateDefaultUserNotificationRule");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const users: Array<User> = await UserService.findBy({
      query: {
        isEmailVerified: true,
      },
      select: {
        email: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      // then get all the projects the user belongs to.
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: user.id!,
          hasAcceptedInvitation: true,
        },
        select: {
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const teamMember of teamMembers) {
        await UserNotificationRuleService.addDefaultNotificationRuleForUser(
          teamMember.projectId!,
          user.id!,
          user.email!,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
