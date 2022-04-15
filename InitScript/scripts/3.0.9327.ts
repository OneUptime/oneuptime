import { find } from '../util/db';
import payment from '../util/payment';
import Stripe from 'stripe';
import logger from 'CommonServer/utils/Logger';

const stripe: $TSFixMe = Stripe(payment.paymentPrivateKey);

import BackendAPI from '../util/api';

const projectCollection: string = 'projects';

async function run(): void {
    const projects: $TSFixMe = await find(projectCollection, {
        deleted: false,
    });

    for (const project of projects) {
        const stripeSubscriptionId: $TSFixMe = project.stripeSubscriptionId;

        // Fetch the subscription
        if (stripeSubscriptionId) {
            const subscription: $TSFixMe = await stripe.subscriptions.retrieve(
                stripeSubscriptionId
            );
            // If subscription is already cancelled, then delete the project
            if (subscription && subscription.status === 'canceled') {
                /*
                 * Integrate an axios call here to delete project for the init script
                 * We won't do that here, because alot of things should happen under the hood
                 * Ensure to add cluster key to the request for validation
                 */
                try {
                    await BackendAPI.delete(
                        `project/${project._id}/initScript/deleteProject`
                    );
                } catch (error) {
                    logger.info('** Init error: ', error);
                }
            }
        }
    }

    return `Script completed`;
}

export default run;
