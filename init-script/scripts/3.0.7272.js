const { find, update } = require('../util/db');

const PROJECT_COLLECTION = 'projects';
async function run() {
    // get projects without enableInvestigationNoteNotificationSMS feild
    const projectsWithoutEnableInvestigationNoteNotificationSMSField = await find(
        PROJECT_COLLECTION,
        {
            enableInvestigationNoteNotificationSMS: { $exists: false },
        }
    );
    // update project by setting enableInvestigationNoteNotificationSMS to default value of true
    projectsWithoutEnableInvestigationNoteNotificationSMSField.forEach(
        project => {
            update(
                PROJECT_COLLECTION,
                { _id: project._id },
                { enableInvestigationNoteNotificationSMS: true }
            );
        }
    );
}

module.exports = run;
