
const Services = {
    events: async function (customerId, subscriptionId, chargeAttemptCount) {
        try {
            const chargeAttemptStage = chargeAttemptCount === 1 ? 'first' : (chargeAttemptCount === 2 ? 'second' : 'third');
            const user = await UserService.findOneBy({ stripeCustomerId: customerId });
            const project = await ProjectService.findOneBy({ stripeSubscriptionId: subscriptionId });

            await MailService.sendPaymentFailedEmail(project.name, user.email, user.name, chargeAttemptStage);

            if (chargeAttemptCount === 3) {
                await UserService.updateOneBy({ _id: user._id }, { paymentFailedDate: new Date });
            }
            return { paymentStatus: 'failed' };
        } catch (error) {
            ErrorService.log('stripeService.events', error);
            throw error;
        }
    },

    charges: async function (userId) {
        try {
            const user = await UserService.findOneBy({ _id: userId });
            const stripeCustomerId = user.stripeCustomerId;
            const charges = await stripe.charges.list({ customer: stripeCustomerId });
            return charges.data;
        } catch (error) {
            ErrorService.log('stripeService.charges', error);
            throw error;
        }
    },

    creditCard: {
        create: async function (tok, userId) {
            try {
                const tokenCard = await stripe.tokens.retrieve(tok);
                const cards = await this.get(userId);
                let duplicateCard = false;

                if (cards && cards.data && cards.data.length > 0 && tokenCard && tokenCard.card) {
                    duplicateCard = cards.data.filter(
                        card => card.fingerprint === tokenCard.card.fingerprint
                    ).length > 0;
                }

                if (!duplicateCard) {
                    const testChargeValue = 100;
                    const description = 'Verify if card is billable';
                    const user = await UserService.findOneBy({ _id: userId });
                    const stripeCustomerId = user.stripeCustomerId;
                    const card = await stripe.customers.createSource(stripeCustomerId, { source: tok });
                    const metadata = {
                        description
                    };
                    const source = card.id;
                    const paymentIntent = await Services.createInvoice(testChargeValue, stripeCustomerId, description, metadata, source);
                    return paymentIntent;
                } else {
                    const error = new Error('Cannot add duplicate card');
                    error.code = 400;
                    throw error;
                }
            } catch (error) {
                ErrorService.log('stripeService.creditCard.create', error);
                throw error;
            }
        },

        update: async function (userId, cardId) {
            try {
                const user = await UserService.findOneBy({ _id: userId });
                const stripeCustomerId = user.stripeCustomerId;
                const card = await stripe.customers.update(stripeCustomerId, {
                    default_source: cardId
                });
                return card;
            } catch (error) {
                ErrorService.log('stripeService.creditCard.update', error);
                throw error;
            }
        },

        delete: async function (cardId, userId) {
            try {
                const user = await UserService.findOneBy({ _id: userId });
                const stripeCustomerId = user.stripeCustomerId;
                const cards = await this.get(userId);
                if (cards.data.length === 1) {
                    const error = new Error('Cannot delete the only card');
                    error.code = 403;
                    throw error;
                }
                const card = await stripe.customers.deleteSource(stripeCustomerId, cardId);
                return card;
            } catch (error) {
                ErrorService.log('stripeService.creditCard.delete', error);
                throw error;
            }
        },

        get: async function (userId, cardId) {
            try {
                const user = await UserService.findOneBy({ _id: userId });
                const stripeCustomerId = user.stripeCustomerId;
                const customer = await stripe.customers.retrieve(stripeCustomerId);
                if (cardId) {
                    const card = await stripe.customers.retrieveSource(stripeCustomerId, cardId);
                    return card;
                }
                else {
                    const cards = await stripe.customers.listSources(stripeCustomerId, {
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
                ErrorService.log('stripeService.creditCard.delete', error);
                throw error;
            }
        }
    },
    chargeCustomerForBalance: async function (userId, chargeAmount, projectId, alertOptions) {

        const description = 'Recharge balance';
        const stripechargeAmount = chargeAmount * 100;
        const user = await UserService.findOneBy({ _id: userId });
        const stripeCustomerId = user.stripeCustomerId;
        let metadata;
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
        const paymentIntent = await this.createInvoice(stripechargeAmount, stripeCustomerId, description, metadata);
        return paymentIntent;
    },

    updateBalance: async function (paymentIntent) {
        try {
            if (paymentIntent.status === 'succeeded') {
                const amountRechargedStripe = Number(paymentIntent.amount_received);
                if (amountRechargedStripe) {
                    const projectId = paymentIntent.metadata.projectId,
                        minimumBalance = paymentIntent.metadata.minimumBalance && Number(paymentIntent.metadata.minimumBalance),
                        rechargeToBalance = paymentIntent.metadata.rechargeToBalance && Number(paymentIntent.metadata.rechargeToBalance),
                        billingUS = paymentIntent.metadata.billingUS && JSON.parse(paymentIntent.metadata.billingUS),
                        billingNonUSCountries = paymentIntent.metadata.billingNonUSCountries && JSON.parse(paymentIntent.metadata.billingNonUSCountries),
                        billingRiskCountries = paymentIntent.metadata.billingRiskCountries && JSON.parse(paymentIntent.metadata.billingRiskCountries);

                    const alertOptions = {
                        minimumBalance,
                        rechargeToBalance,
                        billingUS,
                        billingNonUSCountries,
                        billingRiskCountries
                    };
                    const amountRecharged = amountRechargedStripe / 100;
                    const project = await ProjectModel.findById(projectId).lean();
                    const currentBalance = project.balance;
                    const newbalance = currentBalance + amountRecharged;
                    let updateObject = {};
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
                    const updatedProject = await ProjectModel.findByIdAndUpdate(projectId, updateObject,
                        { new: true });
                    if (updatedProject.balance === newbalance) {
                        return true;
                    }
                }
            }
            return false;
        } catch (error) {
            ErrorService.log('stripeService.updateBalance', error);
            throw error;
        }

    },
    addBalance: async function (userId, chargeAmount, projectId) {
        try {
            const description = 'Recharge balance';
            const stripechargeAmount = chargeAmount * 100;
            const user = await UserService.findOneBy({ _id: userId });
            const stripeCustomerId = user.stripeCustomerId;
            const metadata = {
                projectId
            };
            const paymentIntent = await this.createInvoice(stripechargeAmount, stripeCustomerId, description, metadata);
            var project = await ProjectService.findOneBy({_id: projectId})
            await ProjectService.updateOneBy(
                { _id: projectId },
                {
                    balance: project.balance+chargeAmount
                }
            );
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.addBalance', error);
            throw error;
        }

    },
    createInvoice: async function (amount, stripeCustomerId, description, metadata, source) {
        try {
            let updatedPaymentIntent;
            await stripe.invoiceItems.create({
                amount: amount,
                currency: 'usd',
                customer: stripeCustomerId,
                description
            });
            const invoice = await stripe.invoices.create({
                customer: stripeCustomerId,
                collection_method: 'charge_automatically',
                description
            });
            const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
            const paymentIntent = await stripe.paymentIntents.retrieve(finalizedInvoice.payment_intent);
            if (source) {
                updatedPaymentIntent = await stripe.paymentIntents.update(paymentIntent.id, {
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
        } catch (error) {
            ErrorService.log('stripeService.createInvoice', error);
            throw error;
        }

    },
    makeTestCharge: async function (tokenId, email, companyName) {
        try {
            const description = 'Verify if card is billable';
            const testChargeValue = 100;
            const stripeCustomerId = await PaymentService.createCustomer(email, companyName);
            const card = await stripe.customers.createSource(stripeCustomerId, { source: tokenId });
            const metadata = {
                description
            };
            const source = card.id;
            const paymentIntent = await this.createInvoice(testChargeValue, stripeCustomerId, description, metadata, source);
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.makeTestCharge', error);
            throw error;
        }
    }
};

const payment = require('../config/payment');
const UserService = require('../services/userService');
const PaymentService = require('../services/paymentService');
const ProjectService = require('../services/projectService');
const ProjectModel = require('../models/project');
const MailService = require('../services/mailService');
const ErrorService = require('../services/errorService');
const stripe = require('stripe')(payment.paymentPrivateKey);

module.exports = Services;
