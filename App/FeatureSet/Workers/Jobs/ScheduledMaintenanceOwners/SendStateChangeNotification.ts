import RunCron from '../../Utils/Cron';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import ProjectService from 'CommonServer/Services/ProjectService';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';
import ScheduledMaintenanceStateTimelineService from 'CommonServer/Services/ScheduledMaintenanceStateTimelineService';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import Markdown, { MarkdownContentType } from 'CommonServer/Types/Markdown';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import User from 'Model/Models/User';

RunCron(
    'ScheduledMaintenanceOwner:SendStateChangeEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.

        const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
            await ScheduledMaintenanceStateTimelineService.findBy({
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
                    createdAt: true,
                    projectId: true,
                    project: {
                        name: true,
                    },
                    scheduledMaintenance: {
                        _id: true,
                        title: true,
                        description: true,
                    },
                    scheduledMaintenanceState: {
                        name: true,
                    },
                },
            });

        for (const scheduledMaintenanceStateTimeline of scheduledMaintenanceStateTimelines) {
            const scheduledMaintenance: ScheduledMaintenance =
                scheduledMaintenanceStateTimeline.scheduledMaintenance!;
            const scheduledMaintenanceState: ScheduledMaintenanceState =
                scheduledMaintenanceStateTimeline.scheduledMaintenanceState!;

            await ScheduledMaintenanceStateTimelineService.updateOneById({
                id: scheduledMaintenanceStateTimeline.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> =
                await ScheduledMaintenanceService.findOwners(
                    scheduledMaintenance.id!
                );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(
                    scheduledMaintenanceStateTimeline.projectId!
                );
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                scheduledMaintenanceTitle: scheduledMaintenance.title!,
                projectName: scheduledMaintenanceStateTimeline.project!.name!,
                currentState: scheduledMaintenanceState!.name!,
                scheduledMaintenanceDescription: await Markdown.convertToHTML(
                    scheduledMaintenance.description! || '',
                    MarkdownContentType.Email
                ),
                stateChangedAt:
                    OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
                        scheduledMaintenanceStateTimeline.createdAt!
                    ),
                scheduledMaintenanceViewLink: (
                    await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                        scheduledMaintenanceStateTimeline.projectId!,
                        scheduledMaintenance.id!
                    )
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                const emailMessage: EmailEnvelope = {
                    templateType:
                        EmailTemplateType.ScheduledMaintenanceOwnerStateChanged,
                    vars: vars,
                    subject:
                        'Scheduled maintenance event state changed to - ' +
                        scheduledMaintenanceState!.name!,
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. Scheduled maintenance event - ${
                        scheduledMaintenance.title
                    }, state changed to ${scheduledMaintenanceState!
                        .name!}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime. Scheduled maintenance event ${
                                scheduledMaintenance.title
                            } state changed to ${scheduledMaintenanceState!
                                .name!}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
                        },
                    ],
                };

                await UserNotificationSettingService.sendUserNotification({
                    userId: user.id!,
                    projectId: scheduledMaintenanceStateTimeline.projectId!,
                    emailEnvelope: emailMessage,
                    smsMessage: sms,
                    callRequestMessage: callMessage,
                    eventType:
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
                });
            }
        }
    }
);
