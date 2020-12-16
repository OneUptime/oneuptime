const { find, update } = require('../util/db');

const PROJECT_COLLECTION = 'projects';
async function run() {
    // get projects without disableInvestigationNoteNotificationSMS feild
    const projectsWithoutDisableInvestigationNoteNotificationSMSField = await find(
        PROJECT_COLLECTION,
        {
            disableInvestigationNoteNotificationSMS: { $exists: false },
        }
    );
    // update each project by adding the field with a default value of false
    projectsWithoutDisableInvestigationNoteNotificationSMSField.forEach(
        project => {
            update(
                PROJECT_COLLECTION,
                { _id: project._id },
                { disableInvestigationNoteNotificationSMS: false }
            );
        }
    );
}

module.exports = run;
