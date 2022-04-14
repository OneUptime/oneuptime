import { find, update } from '../util/db';

const incidentsCollection: string = 'incidents';

async function run(): void {
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
