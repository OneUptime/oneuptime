import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const applicationSecurityCollection = 'applicationsecurities';

async function run(): void {
    const applicationSecurities = await find(applicationSecurityCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < applicationSecurities.length; i++) {
        const { name } = applicationSecurities[i];
        applicationSecurities[i].slug = getSlug(name);
        await update(
            applicationSecurityCollection,
            { _id: applicationSecurities[i]._id },
            { slug: applicationSecurities[i].slug }
        );
    }
    return `Script ran for ${applicationSecurities.length} applicationSecurities.`;
}
export default run;
