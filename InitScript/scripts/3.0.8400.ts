import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const monitorCollection: string = 'monitors';

async function run(): void {
    const monitors: $TSFixMe = await find(monitorCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i: $TSFixMe = 0; i < monitors.length; i++) {
        const { name }: $TSFixMe = monitors[i];
        monitors[i].slug = getSlug(name);
        await update(
            monitorCollection,
            { _id: monitors[i]._id },
            { slug: monitors[i].slug }
        );
    }
    return `Script ran for ${monitors.length} monitors.`;
}
export default run;
