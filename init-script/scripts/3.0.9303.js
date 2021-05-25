const { updateMany } = require('../util/db');

const projectCollection = 'projects';

async function run() {
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

    return `Script completed`;
}

module.exports = run;
