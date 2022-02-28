
import { updateMany } from '../util/db';

const userCollection = 'users';

// add admin mode fields
async function run() {
    await updateMany(
        userCollection,
        { isAdminMode: { $exists: false } },
        { isAdminMode: false, cachedPassword: null }
    );

    return `Script completed`;
}

export default run;
