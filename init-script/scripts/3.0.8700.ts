
import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const logContainerCollection = 'applicationlogs';

async function run() {
    const logContainers = await find(logContainerCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < logContainers.length; i++) {
        const { name } = logContainers[i];
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
