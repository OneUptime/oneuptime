import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import Incident from 'Model/Models/Incident';
import IncidentService from 'CommonServer/Services/IncidentService';
import User from 'Model/Models/User';
import Markdown from 'CommonServer/Types/Markdown';
import IncidentOwnerTeamService from 'CommonServer/Services/IncidentOwnerTeamService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import ObjectID from 'Common/Types/ObjectID';
import IncidentOwnerUser from 'Model/Models/IncidentOwnerUser';
import IncidentOwnerUserService from 'CommonServer/Services/IncidentOwnerUserService';
import IncidentOwnerTeam from 'Model/Models/IncidentOwnerTeam';

RunCron(
    'IncidentOwner:SendOwnerAddedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const incidentOwnerTeams: Array<IncidentOwnerTeam> =
            await IncidentOwnerTeamService.findBy({
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
                    incidentId: true,
                    teamId: true,
                },
            });

        const incidentOwnersMap: Dictionary<Array<User>> = {};

        for (const incidentOwnerTeam of incidentOwnerTeams) {
            const incidentId: ObjectID = incidentOwnerTeam.incidentId!;
            const teamId: ObjectID = incidentOwnerTeam.teamId!;

            const users: Array<User> = await TeamMemberService.getUsersInTeams([
                teamId,
            ]);

            if (incidentOwnersMap[incidentId.toString()] === undefined) {
                incidentOwnersMap[incidentId.toString()] = [];
            }

            for (const user of users) {
                (incidentOwnersMap[incidentId.toString()] as Array<User>).push(
                    user
                );
            }

            // mark this as notified.
            await IncidentOwnerTeamService.updateOneById({
                id: incidentOwnerTeam.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        const incidentOwnerUsers: Array<IncidentOwnerUser> =
            await IncidentOwnerUserService.findBy({
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
                    incidentId: true,
                    userId: true,
                },
                populate: {
                    user: {
                        email: true,
                        name: true,
                    },
                },
            });

        for (const incidentOwnerUser of incidentOwnerUsers) {
            const incidentId: ObjectID = incidentOwnerUser.incidentId!;
            const user: User = incidentOwnerUser.user!;

            if (incidentOwnersMap[incidentId.toString()] === undefined) {
                incidentOwnersMap[incidentId.toString()] = [];
            }

            (incidentOwnersMap[incidentId.toString()] as Array<User>).push(
                user
            );

            // mark this as notified.
            await IncidentOwnerUserService.updateOneById({
                id: incidentOwnerUser.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        // send email to all of these users.

        for (const incidentId in incidentOwnersMap) {
            if (!incidentOwnersMap[incidentId]) {
                continue;
            }

            if ((incidentOwnersMap[incidentId] as Array<User>).length === 0) {
                continue;
            }

            const users: Array<User> = incidentOwnersMap[
                incidentId
            ] as Array<User>;

            // get all scheduled events of all the projects.
            const incident: Incident | null = await IncidentService.findOneById(
                {
                    id: new ObjectID(incidentId),
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
                        currentIncidentState: {
                            name: true,
                        },
                        incidentSeverity: {
                            name: true,
                        },
                    },
                }
            );

            if (!incident) {
                continue;
            }

            const vars: Dictionary<string> = {
                incidentTitle: incident.title!,
                projectName: incident.project!.name!,
                currentState: incident.currentIncidentState!.name!,
                incidentDescription: Markdown.convertToHTML(
                    incident.description! || ''
                ),
                incidentSeverity: incident.incidentSeverity!.name!,
                incidentViewLink: IncidentService.getIncidentLinkInDashboard(
                    incident.projectId!,
                    incident.id!
                ).toString(),
            };

            for (const user of users) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.IncidentOwnerAdded,
                    vars: vars,
                    subject:
                        'You have been added as the owner of the incident.',
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);
