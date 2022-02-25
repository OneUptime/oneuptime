import { find, update } from '../util/db'

const incidentsCollection = 'incidents';

async function run() {
    const incidents = await find(incidentsCollection, {
        hideIncident: { $exists: false },
    });

    for (let i = 0; i < incidents.length; i++) {
        const incident = incidents[i];
        await update(
            incidentsCollection,
            { _id: incident._id },
            { hideIncident: false }
        );
    }
}

export default run;
