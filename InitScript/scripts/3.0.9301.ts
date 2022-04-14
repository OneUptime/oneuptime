import { find, update } from '../util/db';
import getSlug from '../util/getSlug';

const scheduledCollection: string = 'scheduledevents';

async function run(): void {
    const items: $TSFixMe = await find(scheduledCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i: $TSFixMe = 0; i < items.length; i++) {
        const { name }: $TSFixMe = items[i];
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
