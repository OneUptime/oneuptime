// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const statusPageCollection = 'statuspages';

async function run() {
    // get all statuspages with cert and private key set to the custom domain
    const statusPages = await find(statusPageCollection, {
        'domains.cert': { $type: 'string' },
        'domains.privateKey': { $type: 'string' },
        'domains.enableHttps': { $exists: false },
    });

    for (const statusPage of statusPages) {
        const domains = statusPage.domains.map((eachDomain: $TSFixMe) => {
            if (eachDomain.cert && eachDomain.privateKey) {
                eachDomain.enableHttps = true;
            }
            return eachDomain;
        });
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { domains }
        );
    }

    return `Script ran for ${statusPages.length} status pages`;
}

export default run;
