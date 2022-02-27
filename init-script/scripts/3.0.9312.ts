// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
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
