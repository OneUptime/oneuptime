import { find, update } from '../util/db';

const incidentsCollection: string = 'incidents';

async function run(): void {
    const incidents: $TSFixMe = await find(incidentsCollection, {
        hideIncident: { $exists: false },
    });

    for (let i: $TSFixMe = 0; i < incidents.length; i++) {
        const incident: $TSFixMe = incidents[i];
        await update(
            incidentsCollection,
            { _id: incident._id },
            { hideIncident: false }
        );
    }
}

export default run;
