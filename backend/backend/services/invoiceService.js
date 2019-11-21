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
            var user = await UserService.findOneBy({ _id: userId });
        } catch (error) {
            ErrorService.log('UserService.findOneBy', error);
            throw error;
        }

        if (!user) {
            let error = new Error('User not found.');
            error.code = 400;
            ErrorService.log('InvoiceService.get', error);
            throw error;
        } else {
            var invoices = await stripe.invoices.list(
                {
                    customer: user.stripeCustomerId,
                    limit: 10,
                    starting_after: startingAfter,
                    ending_before: endingBefore,
                    'include[]': 'total_count'
                });
            if (!invoices || !invoices.data) {
                let error = new Error('Your invoice cannot be retrieved.');
                error.code = 400;
                ErrorService.log('InvoiceService.get', error);
                throw error;
            }
            return invoices;
        }
    }
};

var payment = require('../config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);
var UserService = require('./userService');
var ErrorService = require('./errorService');