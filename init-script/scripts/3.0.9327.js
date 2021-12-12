// todo
// fetch all project
// grab subscriptionid and customerid
// cancel the subscription
// delete the project
// update the hasPaid field in the collection to false

// projects that are still active
// update the hasPaid field in the collection to true
const { find } = require('../util/db');
const payment = require('../util/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const { deleteApi } = require('../util/api');

const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        deleted: false,
    });

    for (const project of projects) {
        const stripeSubscriptionId = project.stripeSubscriptionId;

        // fetch the subscription
        if (stripeSubscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(
                stripeSubscriptionId
            );
            // if subscription is already cancelled, then delete the project
            if (subscription && subscription.status === 'canceled') {
                // integrate an axios call here to delete project for the init script
                // we won't do that here, because alot of things should happen under the hood
                // ensure to add cluster key to the request for validation
                await deleteApi(
                    `project/${project._id}/initScript/deleteProject`
                );
            }
        }
    }

    return `Script completed`;
}

module.exports = run;
