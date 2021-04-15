const { find, update } = require('../util/db');

const subscriberCollection = 'subscribers';

async function run() {
    const subscribers = await find(subscriberCollection, {
        subscribed: { $exists: false },
    });

    for (let i = 0; i < subscribers.length; i++) {
        const subscriber = subscribers[i];
        await update(
            subscriberCollection,
            { _id: subscriber._id },
            { subscribed: true }
        );
    }
}

module.exports = run;
