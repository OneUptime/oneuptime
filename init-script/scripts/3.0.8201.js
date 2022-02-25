import { find, update } from '../util/db'

const statusPagesCollection = 'statuspages';

async function run() {
    // get all statusPages that don't have the hideProbeBar field
    const statusPages = await find(statusPagesCollection, {
        hideProbeBar: { $exists: false },
    });

    for (const statusPage of statusPages) {
        await update(
            statusPagesCollection,
            { _id: statusPage._id },
            { hideProbeBar: false }
        );
    }

    return `Script ran for ${statusPages.length} status pages`;
}

export default run;
