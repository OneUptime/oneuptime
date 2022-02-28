export default {
    //Description: Call this fuction to retrieve list of invoices for a customer.
    //Params:
    //Param 1: stripeCustomerId: Received from the frontend.
    //Param 2: projectId: Project id from req.params.
    //Param 3: startingAfter: A cursor for use in pagination. startingAfter is an object ID
    //         that helps to fetch items fro the next list.
    //Returns : promise
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
    get: async function(userId, startingAfter, endingBefore) {
        const user = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        if (!user) {
            const error = new Error('User not found.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'invoices' does not exist on type 'typeof... Remove this comment to see the full error message
            const invoices = await stripe.invoices.list({
                customer: user.stripeCustomerId,
                limit: 10,
                starting_after: startingAfter,
                ending_before: endingBefore,
            });
            if (!invoices || !invoices.data) {
                const error = new Error('Your invoice cannot be retrieved.');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                throw error;
            }
            return invoices;
        }
    },
};

import payment from '../config/payment';
import Stripe from 'stripe';
const stripe = Stripe(payment.paymentPrivateKey);
import UserService from './userService';
