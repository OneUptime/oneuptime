// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';
import getSlug from '../util/getSlug';

const scheduledCollection = 'scheduledevents';

async function run() {
    const items = await find(scheduledCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < items.length; i++) {
        const { name } = items[i];
        items[i].slug = getSlug(name);
        await update(
            scheduledCollection,
            { _id: items[i]._id },
            { slug: items[i].slug }
        );
    }
    return `Script ran for ${items.length} status pages.`;
}

export default run;
