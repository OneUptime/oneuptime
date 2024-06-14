import RunCron from '../../Utils/Cron';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Dictionary from 'Common/Types/Dictionary';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import MonitorService from 'CommonServer/Services/MonitorService';
import ProjectService from 'CommonServer/Services/ProjectService';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import Markdown, { MarkdownContentType } from 'CommonServer/Types/Markdown';
import Monitor from 'Model/Models/Monitor';
import User from 'Model/Models/User';

RunCron(
    'MonitorOwner:SendCreatedResourceEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const monitors: Array<Monitor> = await MonitorService.findBy({
            query: {
                isOwnerNotifiedOfResourceCreation: false,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
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

        for (const monitor of monitors) {
            await MonitorService.updateOneById({
                id: monitor.id!,
                data: {
                    isOwnerNotifiedOfResourceCreation: true,
                },
                props: {
                    isRoot: true,
                },
            });

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> = await MonitorService.findOwners(
                monitor.id!
            );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(monitor.projectId!);
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                monitorName: monitor.name!,
                projectName: monitor.project!.name!,
                currentStatus: monitor.currentMonitorStatus!.name!,
                monitorDescription: await Markdown.convertToHTML(
                    monitor.description! || '',
                    MarkdownContentType.Email
                ),
                monitorViewLink: (
                    await MonitorService.getMonitorLinkInDashboard(
                        monitor.projectId!,
                        monitor.id!
                    )
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                const emailMessage: EmailEnvelope = {
                    templateType: EmailTemplateType.MonitorOwnerResourceCreated,
                    vars: vars,
                    subject: '[Monitor Created] ' + monitor.name!,
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. New monitor created - ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime. New monitor was created ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
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
                        NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
                });
            }
        }
    }
);
