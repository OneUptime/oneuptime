import { updateMany } from '../util/db';

const projectCollection: string = 'projects';

async function run(): void {
    await updateMany(
        projectCollection,
        { sendCreatedScheduledEventNotificationSms: { $exists: false } },
        { sendCreatedScheduledEventNotificationSms: true }
    );

    await updateMany(
        projectCollection,
        { sendCreatedScheduledEventNotificationEmail: { $exists: false } },
        { sendCreatedScheduledEventNotificationEmail: true }
    );
    await updateMany(
        projectCollection,
        { sendScheduledEventResolvedNotificationSms: { $exists: false } },
        { sendScheduledEventResolvedNotificationSms: true }
    );
    await updateMany(
        projectCollection,
        { sendScheduledEventResolvedNotificationEmail: { $exists: false } },
        { sendScheduledEventResolvedNotificationEmail: true }
    );
    await updateMany(
        projectCollection,
        {
            sendNewScheduledEventInvestigationNoteNotificationSms: {
                $exists: false,
            },
        },
        { sendNewScheduledEventInvestigationNoteNotificationSms: true }
    );
    await updateMany(
        projectCollection,
        {
            sendNewScheduledEventInvestigationNoteNotificationEmail: {
                $exists: false,
            },
        },
        { sendNewScheduledEventInvestigationNoteNotificationEmail: true }
    );
    await updateMany(
        projectCollection,
        { sendScheduledEventCancelledNotificationSms: { $exists: false } },
        { sendScheduledEventCancelledNotificationSms: true }
    );

    await updateMany(
        projectCollection,
        { sendScheduledEventCancelledNotificationEmail: { $exists: false } },
        { sendScheduledEventCancelledNotificationEmail: true }
    );

    await updateMany(
        projectCollection,
        { sendAnnouncementNotificationSms: { $exists: false } },
        { sendAnnouncementNotificationSms: true }
    );

    await updateMany(
        projectCollection,
        { sendAnnouncementNotificationEmail: { $exists: false } },
        { sendAnnouncementNotificationEmail: true }
    );
    return `Script completed`;
}

export default run;
