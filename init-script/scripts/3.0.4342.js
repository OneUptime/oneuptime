const { find, update, save } = require('../util/db');

const monitorCollection = 'monitors';
const projectsCollection = 'projects';
const incidentsCollection = 'incidents';
const incidentprioritiesCollection = 'incidentpriorities';

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

    //Update the incidents idNumber
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

    //Add default incident priorities for existing
    //projects not having any priority
    for (const project of projects) {
        const query = {
            projectId: project._id,
        };
        const incidentPriorities = await global.db
            .collection(incidentprioritiesCollection)
            .find(query)
            .toArray();
        if (incidentPriorities.length === 0) {
            await save(incidentprioritiesCollection, [
                {
                    deleted: false,
                    createdAt: new Date(),
                    projectId: project._id,
                    name: 'High',
                    color: {
                        r: 255,
                        g: 0,
                        b: 0,
                        a: 1,
                    },
                },
                {
                    deleted: false,
                    createdAt: new Date(),
                    projectId: project._id,
                    name: 'Low',
                    color: {
                        r: 255,
                        g: 211,
                        b: 0,
                        a: 1,
                    },
                },
            ]);
        }
    }
}
module.exports = run;
