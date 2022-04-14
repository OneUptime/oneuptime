import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < statusPages.length; i++) {
        const { name }: $TSFixMe = statusPages[i];
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
