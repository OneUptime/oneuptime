// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';

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
