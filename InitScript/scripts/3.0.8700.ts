import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const logContainerCollection: string = 'applicationlogs';

async function run(): void {
    const logContainers: $TSFixMe = await find(logContainerCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i: $TSFixMe = 0; i < logContainers.length; i++) {
        const { name }: $TSFixMe = logContainers[i];
        logContainers[i].slug = getSlug(name);
        await update(
            logContainerCollection,
            { _id: logContainers[i]._id },
            { slug: logContainers[i].slug }
        );
    }
    return `Script ran for ${logContainers.length} logContainers.`;
}
export default run;
