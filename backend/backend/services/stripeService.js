
module.exports = {
    events: async function (customerId, subscriptionId, chargeAttemptCount) {
        let chargeAttemptStage = chargeAttemptCount === 1 ? 'first' : (chargeAttemptCount === 2 ? 'second' : 'third');
        try {
            var user = await UserService.findOneBy({ stripeCustomerId: customerId });
        } catch (error) {
            ErrorService.log('UserService.findOneBy', error);
            throw error;
        }
        try {
            var project = await ProjectService.findOneBy({ stripeSubscriptionId: subscriptionId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        try {
            await MailService.sendPaymentFailedEmail(project.name, user.email, user.name, chargeAttemptStage);
        } catch (error) {
            ErrorService.log('MailService.sendPaymentFailedEmail', error);
            throw error;
        }
        if (chargeAttemptCount === 3) {
            try {
                await UserService.update({ _id: user._id, paymentFailedDate: new Date });
            } catch (error) {
                ErrorService.log('UserService.update', error);
                throw error;
            }
        }
        return { paymentStatus: 'failed' };
    },
    charges: async function (userId) {
        try {
            var user = await UserService.findOneBy({ _id: userId });
            var stripeCustomerId = user.stripeCustomerId;
            var charges = await stripe.charges.list({ customer: stripeCustomerId });
            return charges.data;
        } catch (error) {
            ErrorService.log('StripeService.charges', error);
            throw error;
        }
    },
    creditCard: {
        createPaymentIntent: async function (tok, userId) {
            try {
                var user = await UserService.findOneBy({ _id: userId });
                var stripeCustomerId = user.stripeCustomerId;
                var card = await stripe.customers.createSource(stripeCustomerId, { source: tok });
                var paymentIntent = await stripe.paymentIntents.create({
                    amount: 100,
                    currency: 'usd',
                    payment_method_types: ['card'],
                    customer: stripeCustomerId,
                    source: card.id
                });
                var confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id);
                return confirmedPaymentIntent;
            } catch (error) {
                ErrorService.log('StripeService.creditCard.createPaymentIntent', error);
                throw error;
            }
        },
        update: async function (userId, cardId) {
            try {
                var user = await UserService.findOneBy({ _id: userId });
                var stripeCustomerId = user.stripeCustomerId;
                var card = await stripe.customers.update(stripeCustomerId, {
                    default_source: cardId
                });
                return card;
            } catch (error) {
                ErrorService.log('StripeService.creditCard.update', error);
                throw error;
            }
        },
        delete: async function (cardId, userId) {
            try {
                var user = await UserService.findOneBy({ _id: userId });
                var stripeCustomerId = user.stripeCustomerId;
                var cards = await this.get(userId);
                if (cards.data.length === 1) {
                    let error = new Error('Cannot delete the only card');
                    error.code = 403;
                    throw error;
                }
                var card = await stripe.customers.deleteSource(stripeCustomerId, cardId);
                return card;
            } catch (error) {
                ErrorService.log('StripeService.creditCard.delete', error);
                throw error;
            }
        },
        get: async function (userId, cardId) {
            try {
                var user = await UserService.findOneBy({ _id: userId });
                var stripeCustomerId = user.stripeCustomerId;
                var customer = await stripe.customers.retrieve(stripeCustomerId);
                if(cardId){
                    var card = await stripe.customers.retrieveSource(stripeCustomerId, cardId);
                    return card;
                }
                else{
                    var cards = await stripe.customers.listSources(stripeCustomerId);
                    cards.data = await cards.data.map(card => {
                        if(card.id === customer.default_source){
                            card.default_source = true;
                            return card;
                        }
                        return card; 
                    });
                    return cards;
                }
            } catch (error) {
                ErrorService.log('StripeService.creditCard.delete', error);
                throw error;
            }
        }
    },
    chargeCustomerForBalance: async function (userId, chargeAmount, projectId, alertOptions) {

        var stripechargeAmount = chargeAmount * 100;
        var user = await UserService.findOneBy({ _id: userId });
        var stripeCustomerId = user.stripeCustomerId;
        var customer = await stripe.customers.retrieve(stripeCustomerId);
        try {
            var charge = await stripe.charges.create({
                amount: stripechargeAmount,
                currency: 'usd',
                customer: stripeCustomerId,
                description: 'Recharge balance for Alert services.'
            });
            return charge;
        } catch (error) {
            if(error.code === 'authentication_required'){
                //create payment intent and return to client for verification
                var metadata; 
                if(alertOptions){
                    metadata = {
                        projectId,
                        ...alertOptions
                    };
                } else {
                    metadata = {
                        projectId
                    };
                }
                var paymentIntent = await stripe.paymentIntents.create({
                    amount: stripechargeAmount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                    customer: stripeCustomerId,
                    source: customer.default_source,
                    description: 'Recharge balance',
                    metadata
                });
                return paymentIntent;
            }
            else {
                ErrorService.log('Stripe.charges.rechargeBalance', error);
                throw error;
            }
        }
    },
    updateBalance: async function(paymentIntentData){
        if(paymentIntentData.status === 'succeeded'){
            var amountRechargedStripe = Number(paymentIntentData.amount_received);
            if(amountRechargedStripe){
                var projectId = paymentIntentData.metadata.projectId,
                    minimumBalance = paymentIntentData.metadata.minimumBalance && Number(paymentIntentData.metadata.minimumBalance),
                    rechargeToBalance = paymentIntentData.metadata.rechargeToBalance && Number(paymentIntentData.metadata.rechargeToBalance),
                    billingUS = paymentIntentData.metadata.billingUS && JSON.parse(paymentIntentData.metadata.billingUS),
                    billingNonUSCountries = paymentIntentData.metadata.billingNonUSCountries && JSON.parse(paymentIntentData.metadata.billingNonUSCountries),
                    billingRiskCountries = paymentIntentData.metadata.billingRiskCountries && JSON.parse(paymentIntentData.metadata.billingRiskCountries);

                var alertOptions = {
                    minimumBalance,
                    rechargeToBalance,
                    billingUS,
                    billingNonUSCountries,
                    billingRiskCountries
                }; 
                var amountRecharged = amountRechargedStripe / 100;
                var project = await ProjectModel.findById(projectId).lean();
                var currentBalance = project.balance;
                var newbalance = currentBalance + amountRecharged;
                var updateObject = {};
                if(!minimumBalance || !rechargeToBalance){
                    updateObject = {
                        balance: newbalance,
                        alertEnable: true
                    };
                } else {
                    updateObject = {
                        balance: newbalance,
                        alertEnable: true,
                        alertOptions
                    };
                }
                var updatedProject = await ProjectModel.findByIdAndUpdate(projectId, updateObject,
                    { new: true });
                if (updatedProject.balance === newbalance) {
                    return true;
                }
            }
        }
        return false;
    },
    addBalance: async function (userId, chargeAmount, projectId) {

        var stripechargeAmount = chargeAmount * 100;
        var user = await UserService.findOneBy({ _id: userId });
        var stripeCustomerId = user.stripeCustomerId;
        var customer = await stripe.customers.retrieve(stripeCustomerId);

        var metadata = {
            projectId
        };
        var paymentIntent = await stripe.paymentIntents.create({
            amount: stripechargeAmount,
            currency: 'usd',
            payment_method_types: ['card'],
            confirm: true,
            customer: stripeCustomerId,
            source: customer.default_source,
            description: 'Recharge balance',
            metadata
        });
        return paymentIntent;
    },
    
    makeTestCharge: async function (tokenId, email, companyName) {
            
        try {
            var testChargeValue = 100;
            var stripeCustomerId = await PaymentService.createCustomer(email, companyName);
            var card = await stripe.customers.createSource(stripeCustomerId, { source: tokenId });
            var paymentIntent = await stripe.paymentIntents.create({
                amount: testChargeValue,
                currency: 'usd',
                customer: stripeCustomerId,
                description: 'Verify if card is billable.',
                payment_method_types: ['card'],
                source: card.id
            });
            return paymentIntent;
        } catch (error) {
            ErrorService.log('StripeService.makeTestCharge', error);
            throw error;
        }
    }
};

var payment = require('../config/payment');
var UserService = require('../services/userService');
var PaymentService = require('../services/paymentService');
var ProjectService = require('../services/projectService');
var ProjectModel = require('../models/project');
var MailService = require('../services/mailService');
var ErrorService = require('../services/errorService');
var stripe = require('stripe')(payment.paymentPrivateKey);