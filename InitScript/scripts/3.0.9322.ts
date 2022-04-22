import { updateMany } from '../util/db';

const statusPageCollection: string = 'statuspages';

async function run(): void {
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
