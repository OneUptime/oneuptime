const { find, update } = require('../util/db');
const usersCollection = 'users';

async function run() {
    const items = await find(usersCollection, {
        slug: { $exists: false },
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

module.exports = run;
