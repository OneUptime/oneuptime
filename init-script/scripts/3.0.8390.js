const { find, update } = require('../util/db');

const escalationsCollection = 'escalations';

async function run() {
    const escalations = await find(escalationsCollection, {
        deleted: false,
        pushReminders: { $exists: false },
    });

    for (let i = 0; i < escalations.length; i++) {
        const escalation = escalations[i];
        await update(
            escalationsCollection,
            { _id: escalation._id },
            { pushReminders: 3, push: false }
        );
    }
}

module.exports = run;
