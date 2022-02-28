
import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const containerSecurityCollection = 'containersecurities';

async function run() {
    const containerSecurities = await find(containerSecurityCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < containerSecurities.length; i++) {
        const { name } = containerSecurities[i];
        containerSecurities[i].slug = getSlug(name);
        await update(
            containerSecurityCollection,
            { _id: containerSecurities[i]._id },
            { slug: containerSecurities[i].slug }
        );
    }
    return `Script ran for ${containerSecurities.length} containerSecurities.`;
}
export default run;
