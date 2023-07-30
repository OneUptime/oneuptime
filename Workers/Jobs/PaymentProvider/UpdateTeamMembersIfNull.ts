import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_DAY, EVERY_MINUTE } from 'Common/Utils/CronTime';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';

RunCron(
    'PaymentProvider:UpdateTeamMembersIfNull',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: true },
    async () => {
        const projects: Array<Project> = await ProjectService.findBy({
            query: {
                paymentProviderSubscriptionSeats: QueryHelper.isNull(),
            },
            select: {
                _id: true,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
        });

        for (const project of projects) {
            await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
                project.id!
            );
        }
    }
);
