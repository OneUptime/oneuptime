// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'
const usersCollection = 'users';

async function run() {
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
