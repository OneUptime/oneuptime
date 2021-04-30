const { find, updateAll } = require('../util/db');

const scheduledCollection = 'scheduledevents';

async function run() {
    await updateAll(
        scheduledCollection,
        { cancelled: { $exists: false } },
        { cancelled: false }
    );

    return `Script completed`;
}

module.exports = run;
