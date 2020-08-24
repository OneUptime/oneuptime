const { find, update } = require('../util/db');

const monitorCollection = 'monitors';
const projectsCollection = 'projects';
const incidentsCollection = 'incidents';

async function run() {
    const monitors = await find(monitorCollection, {
        pollTime: { $type: 'date' },
        deleted: false,
    });
    for (let i = 0; i < monitors.length; i++) {
        const monitor = monitors[i];
        await update(monitorCollection, { _id: monitor._id }, { pollTime: [] });
    }

    const projects = await find(projectsCollection, {
        deleted: false,
    });

    for (const project of projects) {
        const query = {
            projectId: project._id,
        };
        const incidents = await global.db
            .collection(incidentsCollection)
            .find(query)
            .sort('createdAt', 1)
            .toArray();
        for (let i = 0; i < incidents.length; i++) {
            await update(
                incidentsCollection,
                { _id: incidents[i]._id },
                { idNumber: i }
            );
        }
    }
}
module.exports = run;
