import User from 'Model/Models/User';
import DataMigrationBase from './DataMigrationBase';
import UserService from 'CommonServer/Services/UserService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import TeamMember from 'Model/Models/TeamMember';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import UserNotificationRuleService from 'CommonServer/Services/UserNotificationRuleService';

export default class MigrateDefaultUserNotificationRule extends DataMigrationBase {
    public constructor() {
        super('MigrateDefaultUserNotificationRule');
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
            // then get all the projects the user belogs to.
            const teamMembers: Array<TeamMember> =
                await TeamMemberService.findBy({
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
                await UserNotificationRuleService.addDefaultNotifictionRuleForUser(
                    teamMember.projectId!,
                    user.id!,
                    user.email!
                );
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
