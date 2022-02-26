// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'
import getSlug from '../util/getSlug'
const errortrackerCollection = 'errortrackers';

async function run() {
    const errorTrackers = await find(errortrackerCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < errorTrackers.length; i++) {
        const { name } = errorTrackers[i];
        errorTrackers[i].slug = getSlug(name);
        await update(
            errortrackerCollection,
            { _id: errorTrackers[i]._id },
            { slug: errorTrackers[i].slug }
        );
    }
    return `Script ran for ${errorTrackers.length} errorTrackers.`;
}
export default run;
