const { find, update } = require('../util/db');

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        pollTime: { $type: 'date' },
        deleted: false,
    });
    for (let i = 0; i < monitors.length; i++) {
        const monitor = monitors[i];
        await update(monitorCollection, { _id: monitor._id }, { pollTime: [] });
    }
}
module.exports = run;
