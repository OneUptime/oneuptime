// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find } from '../util/db';
import payment from '../util/payment';
import Stripe from 'stripe';
const stripe = Stripe(payment.paymentPrivateKey);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/api"' has no exported member 'del... Remove this comment to see the full error message
import { deleteApi } from '../util/api';

const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        deleted: false,
    });

    for (const project of projects) {
        const stripeSubscriptionId = project.stripeSubscriptionId;

        // fetch the subscription
        if (stripeSubscriptionId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
            const subscription = await stripe.subscriptions.retrieve(
                stripeSubscriptionId
            );
            // if subscription is already cancelled, then delete the project
            if (subscription && subscription.status === 'canceled') {
                // integrate an axios call here to delete project for the init script
                // we won't do that here, because alot of things should happen under the hood
                // ensure to add cluster key to the request for validation
                try {
                    await deleteApi(
                        `project/${project._id}/initScript/deleteProject`
                    );
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.log('** Init error: ', error);
                }
            }
        }
    }

    return `Script completed`;
}

export default run;
