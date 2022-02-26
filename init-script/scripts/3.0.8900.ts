// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'
import getSlug from '../util/getSlug'
const componentCollection = 'components';

async function run() {
    const components = await find(componentCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < components.length; i++) {
        const { name } = components[i];
        components[i].slug = getSlug(name);
        await update(
            componentCollection,
            { _id: components[i]._id },
            { slug: components[i].slug }
        );
    }
    return `Script ran for ${components.length} components.`;
}
export default run;
