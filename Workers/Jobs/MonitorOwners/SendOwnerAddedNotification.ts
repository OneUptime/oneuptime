import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import Monitor from 'Model/Models/Monitor';
import MonitorService from 'CommonServer/Services/MonitorService';
import User from 'Model/Models/User';
import Markdown from 'CommonServer/Types/Markdown';
import MonitorOwnerTeamService from 'CommonServer/Services/MonitorOwnerTeamService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import ObjectID from 'Common/Types/ObjectID';
import MonitorOwnerUser from 'Model/Models/MonitorOwnerUser';
import MonitorOwnerUserService from 'CommonServer/Services/MonitorOwnerUserService';
import MonitorOwnerTeam from 'Model/Models/MonitorOwnerTeam';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';

RunCron(
    'MonitorOwner:SendOwnerAddedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const monitorOwnerTeams: Array<MonitorOwnerTeam> =
            await MonitorOwnerTeamService.findBy({
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
                    monitorId: true,
                    teamId: true,
                },
            });

        const monitorOwnersMap: Dictionary<Array<User>> = {};

        for (const monitorOwnerTeam of monitorOwnerTeams) {
            const monitorId: ObjectID = monitorOwnerTeam.monitorId!;
            const teamId: ObjectID = monitorOwnerTeam.teamId!;

            const users: Array<User> = await TeamMemberService.getUsersInTeams([
                teamId,
            ]);

            if (monitorOwnersMap[monitorId.toString()] === undefined) {
                monitorOwnersMap[monitorId.toString()] = [];
            }

            for (const user of users) {
                (monitorOwnersMap[monitorId.toString()] as Array<User>).push(
                    user
                );
            }

            // mark this as notified.
            await MonitorOwnerTeamService.updateOneById({
                id: monitorOwnerTeam.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        const monitorOwnerUsers: Array<MonitorOwnerUser> =
            await MonitorOwnerUserService.findBy({
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
                    monitorId: true,
                    userId: true,
                    user: {
                        email: true,
                        name: true,
                    },
                },
            });

        for (const monitorOwnerUser of monitorOwnerUsers) {
            const monitorId: ObjectID = monitorOwnerUser.monitorId!;
            const user: User = monitorOwnerUser.user!;

            if (monitorOwnersMap[monitorId.toString()] === undefined) {
                monitorOwnersMap[monitorId.toString()] = [];
            }

            (monitorOwnersMap[monitorId.toString()] as Array<User>).push(user);

            // mark this as notified.
            await MonitorOwnerUserService.updateOneById({
                id: monitorOwnerUser.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        // send email to all of these users.

        for (const monitorId in monitorOwnersMap) {
            if (!monitorOwnersMap[monitorId]) {
                continue;
            }

            if ((monitorOwnersMap[monitorId] as Array<User>).length === 0) {
                continue;
            }

            const users: Array<User> = monitorOwnersMap[
                monitorId
            ] as Array<User>;

            // get all scheduled events of all the projects.
            const monitor: Monitor | null = await MonitorService.findOneById({
                id: new ObjectID(monitorId),
                props: {
                    isRoot: true,
                },

                select: {
                    _id: true,
                    name: true,
                    description: true,
                    projectId: true,
                    project: {
                        name: true,
                    },
                    currentMonitorStatus: {
                        name: true,
                    },
                },
            });

            if (!monitor) {
                continue;
            }

            const vars: Dictionary<string> = {
                monitorName: monitor.name!,
                projectName: monitor.project!.name!,
                currentStatus: monitor.currentMonitorStatus!.name!,
                monitorDescription: Markdown.convertToHTML(
                    monitor.description! || ''
                ),
                monitorViewLink: MonitorService.getMonitorLinkInDashboard(
                    monitor.projectId!,
                    monitor.id!
                ).toString(),
            };

            for (const user of users) {
                const emailMessage: EmailEnvelope = {
                    templateType: EmailTemplateType.MonitorOwnerAdded,
                    vars: vars,
                    subject: 'You have been added as the owner of the monitor.',
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. You have been added as the owner of the monitor - ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime. You have been added as the owner of the monitor ${monitor.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
                        },
                    ],
                };

                await UserNotificationSettingService.sendUserNotification({
                    userId: user.id!,
                    projectId: monitor.projectId!,
                    emailEnvelope: emailMessage,
                    smsMessage: sms,
                    callRequestMessage: callMessage,
                    eventType:
                        NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
                });
            }
        }
    }
);
