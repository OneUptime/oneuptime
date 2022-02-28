
import { find, update } from '../util/db';
import getSlug from '../util/getSlug';

const incidentCollection = 'incidents';

async function run() {
    const incidents = await find(
        incidentCollection,
        {
            deleted: false,
            slug: { $exists: false },
        },
        null,
        8000 // limit to 8k items
    );

    for (const incident of incidents) {
        const slug = getSlug(incident.idNumber);
        await update(incidentCollection, { _id: incident._id }, { slug });
    }

    return `Script completed`;
}

export default run;
