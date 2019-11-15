
const Services = {
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
        create: async function(tok, userId) {
            try {
                let tokenCard = await stripe.tokens.retrieve(tok);
                let cards = await this.get(userId);
                let duplicateCard = false;

                if (cards && cards.data && cards.data.length > 0 && tokenCard && tokenCard.card) {
                    duplicateCard = cards.data.filter(
                        card => card.fingerprint === tokenCard.card.fingerprint
                    ).length > 0;
                }

                if (!duplicateCard) {
                    var testChargeValue = 100;
                    var description = 'Verify if card is billable.';
                    var user = await UserService.findOneBy({ _id: userId });
                    var stripeCustomerId = user.stripeCustomerId;
                    var card = await stripe.customers.createSource(stripeCustomerId, { source: tok });
                    var metadata = {
                        description
                    };          
                    var source = card.id;
                    var paymentIntent = await Services.createInvoice(testChargeValue, stripeCustomerId, description, metadata, source );
                    return paymentIntent;
                } else {
                    var error = new Error('Cannot add duplicate card.');
                    error.code = 400;
                    throw error;
                }
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
                if (cardId) {
                    var card = await stripe.customers.retrieveSource(stripeCustomerId, cardId);
                    return card;
                }
                else {
                    var cards = await stripe.customers.listSources(stripeCustomerId, {
                        object: 'card'
                    });
                    cards.data = await cards.data.map(card => {
                        if (card.id === customer.default_source) {
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
        
        var description = 'Recharge balance';
        var stripechargeAmount = chargeAmount * 100;
        var user = await UserService.findOneBy({ _id: userId });
        var stripeCustomerId = user.stripeCustomerId;
        var metadata;
        if (alertOptions) {
            metadata = {
                projectId,
                ...alertOptions
            };
        } else {
            metadata = {
                projectId
            };
        }
        var paymentIntent = await this.createInvoice(stripechargeAmount, stripeCustomerId, description, metadata);
        return paymentIntent;
    },

    updateBalance: async function (paymentIntent) {
        try{
            if (paymentIntent.status === 'succeeded') {
                var amountRechargedStripe = Number(paymentIntent.amount_received);
                if (amountRechargedStripe) {
                    var projectId = paymentIntent.metadata.projectId,
                        minimumBalance = paymentIntent.metadata.minimumBalance && Number(paymentIntent.metadata.minimumBalance),
                        rechargeToBalance = paymentIntent.metadata.rechargeToBalance && Number(paymentIntent.metadata.rechargeToBalance),
                        billingUS = paymentIntent.metadata.billingUS && JSON.parse(paymentIntent.metadata.billingUS),
                        billingNonUSCountries = paymentIntent.metadata.billingNonUSCountries && JSON.parse(paymentIntent.metadata.billingNonUSCountries),
                        billingRiskCountries = paymentIntent.metadata.billingRiskCountries && JSON.parse(paymentIntent.metadata.billingRiskCountries);
    
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
                    if (!minimumBalance || !rechargeToBalance) {
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
        } catch (error) {
            ErrorService.log('StripeService.updateBalance', error);
            throw error;
        } 
        
    },
    addBalance: async function (userId, chargeAmount, projectId) {
        try {
            var description = 'Recharge balance';
            var stripechargeAmount = chargeAmount * 100;
            var user = await UserService.findOneBy({ _id: userId });
            var stripeCustomerId = user.stripeCustomerId;
            var metadata = {
                projectId
            };
            var paymentIntent = await this.createInvoice(stripechargeAmount, stripeCustomerId, description, metadata );
            return paymentIntent;
        } catch (error) {
            ErrorService.log('StripeService.addBalance', error);
            throw error;
        }
 
    },
    createInvoice: async function (amount, stripeCustomerId, description, metadata, source) {
        try {
            var updatedPaymentIntent;
            await stripe.invoiceItems.create({
                amount: amount,
                currency: 'usd',
                customer: stripeCustomerId,
                description
            });
            var invoice = await stripe.invoices.create({
                customer: stripeCustomerId,
                collection_method: 'charge_automatically',
                description
            });
            var finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
            var paymentIntent = await stripe.paymentIntents.retrieve(finalizedInvoice.payment_intent);
            if (source) {
                updatedPaymentIntent= await stripe.paymentIntents.update(paymentIntent.id, {
                    description,
                    metadata,
                    source
                });
            } else {
                updatedPaymentIntent = await stripe.paymentIntents.update(paymentIntent.id, {
                    description,
                    metadata
                });
            }
            return updatedPaymentIntent;
        } catch(error) {
            ErrorService.log('StripeService.createInvoice', error);
            throw error;
        }

    },
    makeTestCharge: async function (tokenId, email, companyName) {
        try {
            var description = 'Verify if card is billable.';
            var testChargeValue = 100;
            var stripeCustomerId = await PaymentService.createCustomer(email, companyName);
            var card = await stripe.customers.createSource(stripeCustomerId, { source: tokenId });
            var metadata = {
                description
            };
            var source = card.id;
            var paymentIntent = await this.createInvoice(testChargeValue, stripeCustomerId, description, metadata, source );
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

module.exports = Services;