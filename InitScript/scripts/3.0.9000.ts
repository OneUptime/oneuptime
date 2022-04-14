import { find, update } from '../util/db';

const  subscriberCollection: string = 'subscribers';

async function run(): void {
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

export default run;
