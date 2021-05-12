const { updateMany } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { incidentHistoryDays: { $exists: false } },
        { incidentHistoryDays: 14 }
    );

    await updateMany(
        statusPageCollection,
        { scheduleHistoryDays: { $exists: false } },
        { scheduleHistoryDays: 14 }
    );

    return `Script completed`;
}

module.exports = run;
