// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const PROJECT_COLLECTION = 'projects';
async function run() {
    // get projects without disableNotification fields for sms, email or webhook
    const projectsWithoutInvestigationNoteNotificationOptionFields = await find(
        PROJECT_COLLECTION,
        {
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
        }
    );
    // update project by setting the investigationNotification options to default value of true
    projectsWithoutInvestigationNoteNotificationOptionFields.forEach(
        (project: $TSFixMe) => {
            // add a default value only if the field is missing
            const updateValues = {};
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationSMS'
                )
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'enableInvestigationNoteNotificationSMS' ... Remove this comment to see the full error message
                updateValues.enableInvestigationNoteNotificationSMS = true;
            }
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationEmail'
                )
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'enableInvestigationNoteNotificationEmail... Remove this comment to see the full error message
                updateValues.enableInvestigationNoteNotificationEmail = true;
            }
            if (
                !Object.prototype.hasOwnProperty.call(
                    project,
                    'enableInvestigationNoteNotificationWebhook'
                )
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'enableInvestigationNoteNotificationWebho... Remove this comment to see the full error message
                updateValues.enableInvestigationNoteNotificationWebhook = true;
            }

            update(PROJECT_COLLECTION, { _id: project._id }, updateValues);
        }
    );
}

export default run;
