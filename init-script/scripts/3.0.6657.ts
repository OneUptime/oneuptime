// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const SUBSCRIBER_COLLECTION = 'subscribers';
async function run() {
    // get webhook subscribers without webhookMethod feild
    const subscribersWithoutWebhookMethod = await find(SUBSCRIBER_COLLECTION, {
        alertVia: 'webhook',
        webhookMethod: { $exists: false },
    });
    // update each subscriber by adding the field with a default value
    subscribersWithoutWebhookMethod.forEach((subscriber: $TSFixMe) => {
        update(
            SUBSCRIBER_COLLECTION,
            { _id: subscriber._id },
            { webhookMethod: 'post' }
        );
    });
}

export default run;
