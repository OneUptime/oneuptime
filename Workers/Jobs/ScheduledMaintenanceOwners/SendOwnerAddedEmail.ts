import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';
import User from 'Model/Models/User';
import Markdown from 'CommonServer/Types/Markdown';
import ScheduledMaintenanceOwnerTeamService from 'CommonServer/Services/ScheduledMaintenanceOwnerTeamService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenanceOwnerUser from 'Model/Models/ScheduledMaintenanceOwnerUser';
import ScheduledMaintenanceOwnerUserService from 'CommonServer/Services/ScheduledMaintenanceOwnerUserService';
import ScheduledMaintenanceOwnerTeam from 'Model/Models/ScheduledMaintenanceOwnerTeam';

RunCron(
    'ScheduledMaintenanceOwner:SendOwnerAddedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const scheduledMaintenanceOwnerTeams: Array<ScheduledMaintenanceOwnerTeam> =
            await ScheduledMaintenanceOwnerTeamService.findBy({
                query: {
                    isOwnerNotified: false,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    scheduledMaintenanceId: true,
                    teamId: true,
                },
            });

        const scheduledMaintenanceOwnersMap: Dictionary<Array<User>> = {};

        for (const scheduledMaintenanceOwnerTeam of scheduledMaintenanceOwnerTeams) {
            const scheduledMaintenanceId: ObjectID = scheduledMaintenanceOwnerTeam.scheduledMaintenanceId!;
            const teamId: ObjectID = scheduledMaintenanceOwnerTeam.teamId!;

            const users: Array<User> = await TeamMemberService.getUsersInTeams([
                teamId,
            ]);

            if (scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] === undefined) {
                scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
            }

            for (const user of users) {
                (scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] as Array<User>).push(
                    user
                );
            }

            // mark this as notified.
            await ScheduledMaintenanceOwnerTeamService.updateOneById({
                id: scheduledMaintenanceOwnerTeam.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        const scheduledMaintenanceOwnerUsers: Array<ScheduledMaintenanceOwnerUser> =
            await ScheduledMaintenanceOwnerUserService.findBy({
                query: {
                    isOwnerNotified: false,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    scheduledMaintenanceId: true,
                    userId: true,
                },
                populate: {
                    user: {
                        email: true,
                        name: true,
                    },
                },
            });

        for (const scheduledMaintenanceOwnerUser of scheduledMaintenanceOwnerUsers) {
            const scheduledMaintenanceId: ObjectID = scheduledMaintenanceOwnerUser.scheduledMaintenanceId!;
            const user: User = scheduledMaintenanceOwnerUser.user!;

            if (scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] === undefined) {
                scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
            }

            (scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] as Array<User>).push(
                user
            );

            // mark this as notified.
            await ScheduledMaintenanceOwnerUserService.updateOneById({
                id: scheduledMaintenanceOwnerUser.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        // send email to all of these users.

        for (const scheduledMaintenanceId in scheduledMaintenanceOwnersMap) {
            if (!scheduledMaintenanceOwnersMap[scheduledMaintenanceId]) {
                continue;
            }

            if ((scheduledMaintenanceOwnersMap[scheduledMaintenanceId] as Array<User>).length === 0) {
                continue;
            }

            const users: Array<User> = scheduledMaintenanceOwnersMap[
                scheduledMaintenanceId
            ] as Array<User>;

            // get all scheduled events of all the projects.
            const scheduledMaintenance: ScheduledMaintenance | null = await ScheduledMaintenanceService.findOneById(
                {
                    id: new ObjectID(scheduledMaintenanceId),
                    props: {
                        isRoot: true,
                    },

                    select: {
                        _id: true,
                        title: true,
                        description: true,
                        projectId: true,
                    },
                    populate: {
                        project: {
                            name: true,
                        },
                        currentScheduledMaintenanceState: {
                            name: true,
                        },
                    },
                }
            );

            if (!scheduledMaintenance) {
                continue;
            }

            const vars: Dictionary<string> = {
                scheduledMaintenanceTitle: scheduledMaintenance.title!,
                projectName: scheduledMaintenance.project!.name!,
                currentState: scheduledMaintenance.currentScheduledMaintenanceState!.name!,
                scheduledMaintenanceDescription: Markdown.convertToHTML(
                    scheduledMaintenance.description! || ''
                ),
                scheduledMaintenanceViewLink: ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                    scheduledMaintenance.projectId!,
                    scheduledMaintenance.id!
                ).toString(),
            };

            for (const user of users) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.ScheduledMaintenanceOwnerAdded,
                    vars: vars,
                    subject:
                        'You have been added as the owner of the scheduledMaintenance.',
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);
