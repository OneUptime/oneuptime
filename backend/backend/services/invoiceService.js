/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

module.exports = {
    //Description: Call this fuction to retrieve list of invoices for a customer. 
    //Params: 
    //Param 1: stripeCustomerId: Received from the frontend.
    //Param 2: projectId: Project id from req.params.
    //Param 3: startingAfter: A cursor for use in pagination. startingAfter is an object ID
    //         that helps to fetch items fro the next list.
    //Returns : promise
    get: async function (userId, startingAfter, endingBefore) {

        try {
            const user = await UserService.findOneBy({ _id: userId });
            if (!user) {
                const error = new Error('User not found.');
                error.code = 400;
                ErrorService.log('invoiceService.get', error);
                throw error;
            } else {
                const invoices = await stripe.invoices.list(
                    {
                        customer: user.stripeCustomerId,
                        limit: 10,
                        starting_after: startingAfter,
                        ending_before: endingBefore,
                        'include[]': 'total_count'
                    });
                if (!invoices || !invoices.data) {
                    const error = new Error('Your invoice cannot be retrieved.');
                    error.code = 400;
                    ErrorService.log('invoiceService.get', error);
                    throw error;
                }
                return invoices;
            }
        } catch (error) {
            ErrorService.log('invoiceService.get', error);
            throw error;
        }
    }
};

const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const UserService = require('./userService');
const ErrorService = require('./errorService');
