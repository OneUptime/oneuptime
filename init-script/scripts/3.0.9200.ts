// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'
import getSlug from '../util/getSlug'
const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < statusPages.length; i++) {
        const { name } = statusPages[i];
        statusPages[i].slug = getSlug(name);
        await update(
            statusPageCollection,
            { _id: statusPages[i]._id },
            { slug: statusPages[i].slug }
        );
    }
    return `Script ran for ${statusPages.length} status pages.`;
}
export default run;
