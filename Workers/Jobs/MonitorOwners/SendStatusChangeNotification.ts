import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import Monitor from 'Model/Models/Monitor';
import MonitorService from 'CommonServer/Services/MonitorService';
import User from 'Model/Models/User';
import ProjectService from 'CommonServer/Services/ProjectService';
import Markdown from 'CommonServer/Types/Markdown';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import MonitorStatusTimelineService from 'CommonServer/Services/MonitorStatusTimelineService';
import MonitorStatus from 'Model/Models/MonitorStatus';
import OneUptimeDate from 'Common/Types/Date';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';

RunCron(
    'MonitorOwner:SendStatusChangeEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.

        const monitorStatusTimelines: Array<MonitorStatusTimeline> =
            await MonitorStatusTimelineService.findBy({
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
                    projectId: true,
                    createdAt: true,
                    project: {
                        name: true,
                    },
                    monitor: {
                        _id: true,
                        name: true,
                        description: true,
                    },
                    monitorStatus: {
                        name: true,
                    },
                    rootCause: true,
                },
            });

        for (const monitorStatusTimeline of monitorStatusTimelines) {
            const monitor: Monitor = monitorStatusTimeline.monitor!;
            const monitorStatus: MonitorStatus =
                monitorStatusTimeline.monitorStatus!;

            await MonitorStatusTimelineService.updateOneById({
                id: monitorStatusTimeline.id!,
                data: {
                    isOwnerNotified: true,
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
                owners = await ProjectService.getOwners(
                    monitorStatusTimeline.projectId!
                );
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                monitorName: monitor.name!,
                projectName: monitorStatusTimeline.project!.name!,
                currentStatus: monitorStatus!.name!,
                monitorDescription: Markdown.convertToHTML(
                    monitor.description! || ''
                ),
                statusChangedAt:
                    OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
                        monitorStatusTimeline.createdAt!
                    ),
                monitorViewLink: MonitorService.getMonitorLinkInDashboard(
                    monitorStatusTimeline.projectId!,
                    monitor.id!
                ).toString(),
                rootCause:
                    monitorStatusTimeline.rootCause ||
                    'No root cause identified.',
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                const emailMessage: EmailEnvelope = {
                    templateType: EmailTemplateType.MonitorOwnerStatusChanged,
                    vars: vars,
                    subject: `${
                        monitor.name || 'Monitor'
                    } status changed to ${monitorStatus!.name!}`,
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. ${
                        monitor.name || 'Monitor'
                    } status changed to ${monitorStatus!
                        .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime. ${
                                monitor.name || 'Monitor'
                            } status changed to ${monitorStatus!
                                .name!}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
                        },
                    ],
                };

                await UserNotificationSettingService.sendUserNotification({
                    userId: user.id!,
                    projectId: monitorStatusTimeline.projectId!,
                    emailEnvelope: emailMessage,
                    smsMessage: sms,
                    callRequestMessage: callMessage,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
                });
            }
        }
    }
);
