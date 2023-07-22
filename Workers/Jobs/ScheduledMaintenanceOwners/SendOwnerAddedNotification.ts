import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
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
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';

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
            const scheduledMaintenanceId: ObjectID =
                scheduledMaintenanceOwnerTeam.scheduledMaintenanceId!;
            const teamId: ObjectID = scheduledMaintenanceOwnerTeam.teamId!;

            const users: Array<User> = await TeamMemberService.getUsersInTeams([
                teamId,
            ]);

            if (
                scheduledMaintenanceOwnersMap[
                    scheduledMaintenanceId.toString()
                ] === undefined
            ) {
                scheduledMaintenanceOwnersMap[
                    scheduledMaintenanceId.toString()
                ] = [];
            }

            for (const user of users) {
                (
                    scheduledMaintenanceOwnersMap[
                        scheduledMaintenanceId.toString()
                    ] as Array<User>
                ).push(user);
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
                    user: {
                        email: true,
                        name: true,
                    },
                },
            });

        for (const scheduledMaintenanceOwnerUser of scheduledMaintenanceOwnerUsers) {
            const scheduledMaintenanceId: ObjectID =
                scheduledMaintenanceOwnerUser.scheduledMaintenanceId!;
            const user: User = scheduledMaintenanceOwnerUser.user!;

            if (
                scheduledMaintenanceOwnersMap[
                    scheduledMaintenanceId.toString()
                ] === undefined
            ) {
                scheduledMaintenanceOwnersMap[
                    scheduledMaintenanceId.toString()
                ] = [];
            }

            (
                scheduledMaintenanceOwnersMap[
                    scheduledMaintenanceId.toString()
                ] as Array<User>
            ).push(user);

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

            if (
                (
                    scheduledMaintenanceOwnersMap[
                        scheduledMaintenanceId
                    ] as Array<User>
                ).length === 0
            ) {
                continue;
            }

            const users: Array<User> = scheduledMaintenanceOwnersMap[
                scheduledMaintenanceId
            ] as Array<User>;

            // get all scheduled events of all the projects.
            const scheduledMaintenance: ScheduledMaintenance | null =
                await ScheduledMaintenanceService.findOneById({
                    id: new ObjectID(scheduledMaintenanceId),
                    props: {
                        isRoot: true,
                    },

                    select: {
                        _id: true,
                        title: true,
                        description: true,
                        projectId: true,
                        project: {
                            name: true,
                        },
                        currentScheduledMaintenanceState: {
                            name: true,
                        },
                    },
                });

            if (!scheduledMaintenance) {
                continue;
            }

            const vars: Dictionary<string> = {
                scheduledMaintenanceTitle: scheduledMaintenance.title!,
                projectName: scheduledMaintenance.project!.name!,
                currentState:
                    scheduledMaintenance.currentScheduledMaintenanceState!
                        .name!,
                scheduledMaintenanceDescription: Markdown.convertToHTML(
                    scheduledMaintenance.description! || ''
                ),
                scheduledMaintenanceViewLink:
                    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                        scheduledMaintenance.projectId!,
                        scheduledMaintenance.id!
                    ).toString(),
            };

            for (const user of users) {
                const emailMessage: EmailEnvelope = {
                    templateType:
                        EmailTemplateType.ScheduledMaintenanceOwnerAdded,
                    vars: vars,
                    subject:
                        'You have been added as the owner of the scheduled maintenance event.',
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. You have been added as the owner of the scheduled maintenance event - ${scheduledMaintenance.title}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime.You have been added as the owner of the scheduled maintenance event ${scheduledMaintenance.title}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
                        },
                    ],
                };

                await UserNotificationSettingService.sendUserNotification({
                    userId: user.id!,
                    projectId: scheduledMaintenance.projectId!,
                    emailEnvelope: emailMessage,
                    smsMessage: sms,
                    callRequestMessage: callMessage,
                    eventType:
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION,
                });
            }
        }
    }
);
