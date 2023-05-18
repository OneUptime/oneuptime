import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageService from 'CommonServer/Services/StatusPageService';
import User from 'Model/Models/User';
import Markdown from 'CommonServer/Types/Markdown';
import StatusPageOwnerTeamService from 'CommonServer/Services/StatusPageOwnerTeamService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageOwnerUser from 'Model/Models/StatusPageOwnerUser';
import StatusPageOwnerUserService from 'CommonServer/Services/StatusPageOwnerUserService';
import StatusPageOwnerTeam from 'Model/Models/StatusPageOwnerTeam';

RunCron(
    'StatusPageOwner:SendOwnerAddedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const statusPageOwnerTeams: Array<StatusPageOwnerTeam> =
            await StatusPageOwnerTeamService.findBy({
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
                    statusPageId: true,
                    teamId: true,
                },
            });

        const statusPageOwnersMap: Dictionary<Array<User>> = {};

        for (const statusPageOwnerTeam of statusPageOwnerTeams) {
            const statusPageId: ObjectID = statusPageOwnerTeam.statusPageId!;
            const teamId: ObjectID = statusPageOwnerTeam.teamId!;

            const users: Array<User> = await TeamMemberService.getUsersInTeams([
                teamId,
            ]);

            if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
                statusPageOwnersMap[statusPageId.toString()] = [];
            }

            for (const user of users) {
                (
                    statusPageOwnersMap[statusPageId.toString()] as Array<User>
                ).push(user);
            }

            // mark this as notified.
            await StatusPageOwnerTeamService.updateOneById({
                id: statusPageOwnerTeam.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        const statusPageOwnerUsers: Array<StatusPageOwnerUser> =
            await StatusPageOwnerUserService.findBy({
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
                    statusPageId: true,
                    userId: true,
                },
                populate: {
                    user: {
                        email: true,
                        name: true,
                    },
                },
            });

        for (const statusPageOwnerUser of statusPageOwnerUsers) {
            const statusPageId: ObjectID = statusPageOwnerUser.statusPageId!;
            const user: User = statusPageOwnerUser.user!;

            if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
                statusPageOwnersMap[statusPageId.toString()] = [];
            }

            (statusPageOwnersMap[statusPageId.toString()] as Array<User>).push(
                user
            );

            // mark this as notified.
            await StatusPageOwnerUserService.updateOneById({
                id: statusPageOwnerUser.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        // send email to all of these users.

        for (const statusPageId in statusPageOwnersMap) {
            if (!statusPageOwnersMap[statusPageId]) {
                continue;
            }

            if (
                (statusPageOwnersMap[statusPageId] as Array<User>).length === 0
            ) {
                continue;
            }

            const users: Array<User> = statusPageOwnersMap[
                statusPageId
            ] as Array<User>;

            // get all scheduled events of all the projects.
            const statusPage: StatusPage | null =
                await StatusPageService.findOneById({
                    id: new ObjectID(statusPageId),
                    props: {
                        isRoot: true,
                    },

                    select: {
                        _id: true,
                        name: true,
                        description: true,
                        projectId: true,
                    },
                    populate: {
                        project: {
                            name: true,
                        },
                    },
                });

            if (!statusPage) {
                continue;
            }

            const vars: Dictionary<string> = {
                statusPageName: statusPage.name!,
                projectName: statusPage.project!.name!,
                statusPageDescription: Markdown.convertToHTML(
                    statusPage.description! || ''
                ),
                statusPageViewLink:
                    StatusPageService.getStatusPageLinkInDashboard(
                        statusPage.projectId!,
                        statusPage.id!
                    ).toString(),
            };

            for (const user of users) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.StatusPageOwnerAdded,
                    vars: vars,
                    subject:
                        'You have been added as the owner of the status page.',
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);
