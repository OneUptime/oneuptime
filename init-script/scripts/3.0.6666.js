const { updateMany } = require('../util/db');

const monitorCollection = 'monitors';

// we need to run this once
// at the moment this should fix issue with the incident creation on the monitor
// no scheduled event is currently active or to be run in the future
async function run() {
    await updateMany(
        monitorCollection,
        { deleted: false },
        { shouldNotMonitor: false }
    );

    return `Script completed`;
}

module.exports = run;
