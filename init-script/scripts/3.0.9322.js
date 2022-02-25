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
