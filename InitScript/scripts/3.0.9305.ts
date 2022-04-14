import { find, update } from '../util/db';
const usersCollection: string = 'users';

async function run(): void {
    const items = await find(usersCollection, {
        email: { $regex: '[A-Z]' },
    });
    for (let i = 0; i < items.length; i++) {
        const { email } = items[i];
        items[i].email = email.toLowerCase();
        await update(
            usersCollection,
            { _id: items[i]._id },
            { email: items[i].email }
        );
    }
    return `Script ran for ${items.length} users.`;
}

export default run;
