import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const containerSecurityCollection: string = 'containersecurities';

async function run(): void {
    const containerSecurities: $TSFixMe = await find(
        containerSecurityCollection,
        {
            $or: [
                { slug: { $exists: false } },
                { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
            ],
        }
    );
    for (let i: $TSFixMe = 0; i < containerSecurities.length; i++) {
        const { name }: $TSFixMe = containerSecurities[i];
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
