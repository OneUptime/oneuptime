// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
import { updateMany } from '../util/db'

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { enableMultiLanguage: { $exists: false } },
        {
            enableMultiLanguage: false,
            multipleLanguages: [],
        }
    );
    return `Script completed`;
}

export default run;
