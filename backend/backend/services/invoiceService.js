

module.exports = {
    //Description: Call this fuction to retrieve list of invoices for a customer.
    //Params:
    //Param 1: stripeCustomerId: Received from the frontend.
    //Param 2: projectId: Project id from req.params.
    //Param 3: startingAfter: A cursor for use in pagination. startingAfter is an object ID
    //         that helps to fetch items fro the next list.
    //Returns : promise
    get: async function(userId, startingAfter, endingBefore) {
        const user = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        if (!user) {
            const error = new Error('User not found.');
            error.code = 400;
            throw error;
        } else {
            const invoices = await stripe.invoices.list({
                customer: user.stripeCustomerId,
                limit: 10,
                starting_after: startingAfter,
                ending_before: endingBefore,
            });
            if (!invoices || !invoices.data) {
                const error = new Error('Your invoice cannot be retrieved.');
                error.code = 400;
                throw error;
            }
            return invoices;
        }
    },
};

const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const UserService = require('./userService');
