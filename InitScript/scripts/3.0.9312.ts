import { updateMany } from '../util/db';

const  userCollection: string = 'users';

// add admin mode fields
async function run(): void {
    await updateMany(
        userCollection,
        { isAdminMode: { $exists: false } },
        { isAdminMode: false, cachedPassword: null }
    );

    return `Script completed`;
}

export default run;
