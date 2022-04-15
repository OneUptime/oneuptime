import { find, update } from '../util/db';

const PROJECT_COLLECTION: string = 'projects';
async function run(): void {
    // Get projects without disableNotification fields for sms, email or webhook
    const projectsWithoutInvestigationNoteNotificationOptionFields: $TSFixMe =
        await find(PROJECT_COLLECTION, {
            $or: [
                { enableInvestigationNoteNotificationSMS: { $exists: false } },
                {
                    enableInvestigationNoteNotificationEmail: {
                        $exists: false,
                    },
                },
                {
                    enableInvestigationNoteNotificationWebhook: {
                        $exists: false,
                    },
                },
            ],
        });
    // Update project by setting the investigationNotification options to default value of true
    projectsWithoutInvestigationNoteNotificationOptionFields.forEach(
        (project: $TSFixMe) => {
            // Add a default value only if the field is missing
            const updateValues: $TSFixMe = {};
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationSMS'
                )
            ) {
                updateValues.enableInvestigationNoteNotificationSMS = true;
            }
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationEmail'
                )
            ) {
                updateValues.enableInvestigationNoteNotificationEmail = true;
            }
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationWebhook'
                )
            ) {
                updateValues.enableInvestigationNoteNotificationWebhook = true;
            }

            update(PROJECT_COLLECTION, { _id: project._id }, updateValues);
        }
    );
}

export default run;
