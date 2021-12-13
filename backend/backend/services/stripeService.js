const Services = {
    successEvent: async function(customerId, subscriptionId) {
        try {
            // eslint-disable-next-line no-unused-vars
            const [user, project] = await Promise.all([
                UserService.findOneBy({
                    query: { stripeCustomerId: customerId },
                    select: 'email name _id',
                }),
                ProjectService.findOneBy({
                    query: { stripeSubscriptionId: subscriptionId },
                    select: 'name _id',
                }),
            ]);

            if (project && project._id) {
                await ProjectService.updateOneBy(
                    {
                        _id: project._id,
                    },
                    { paymentSuccessDate: Date.now() }
                );
            }
            return { paymentStatus: 'success' };
        } catch (error) {
            ErrorService.log('stripeService.successEvent', error);
            throw error;
        }
    },

    failedEvent: async function(
        customerId,
        subscriptionId,
        chargeAttemptCount,
        invoiceUrl
    ) {
        try {
            const [user, project] = await Promise.all([
                UserService.findOneBy({
                    query: { stripeCustomerId: customerId },
                    select: 'email name _id',
                }),
                ProjectService.findOneBy({
                    query: { stripeSubscriptionId: subscriptionId },
                    select: 'name _id',
                }),
            ]);

            if (project && project.name && project._id) {
                const chargeAttemptStage =
                    chargeAttemptCount === 1
                        ? 'first'
                        : chargeAttemptCount === 2
                        ? 'second'
                        : 'third';

                if (user && user.email) {
                    MailService.sendPaymentFailedEmail(
                        project.name,
                        user.email,
                        user.name,
                        chargeAttemptStage,
                        invoiceUrl
                    );
                }

                await sendSlackAlert(
                    'Stripe Webhook Event',
                    'stripeService.failedEvent',
                    'Subscription Payment Failed',
                    400
                );

                if (chargeAttemptCount === 3) {
                    await ProjectService.updateOneBy(
                        { _id: project._id },
                        { paymentFailedDate: Date.now() } // date to keep track of last failed payment
                    );
                }
            }
            return { paymentStatus: 'failed' };
        } catch (error) {
            ErrorService.log('stripeService.failedEvent', error);
            throw error;
        }
    },

    cancelEvent: async function(customerId, subscriptionId) {
        try {
            const [user, project] = await Promise.all([
                UserService.findOneBy({
                    query: { stripeCustomerId: customerId },
                    select: 'name _id',
                }),
                ProjectService.findOneBy({
                    query: { stripeSubscriptionId: subscriptionId },
                    select: '_id users',
                }),
            ]);

            if (project) {
                let userId = user._id;
                if (user && user._id) {
                    await ProjectService.deleteBy(
                        {
                            stripeSubscriptionId: subscriptionId,
                        },
                        userId,
                        false
                    );
                } else {
                    for (const userObj of project.users) {
                        if (userObj.role === 'Owner') {
                            userId = userObj.userId;
                            break;
                        }
                    }

                    await ProjectService.deleteBy(
                        {
                            stripeSubscriptionId: subscriptionId,
                        },
                        userId,
                        false
                    );
                }
            }

            return { projectDeleted: true };
        } catch (error) {
            ErrorService.log('stripeService.successEvent', error);
            throw error;
        }
    },

    charges: async function(userId) {
        try {
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });
            const stripeCustomerId = user.stripeCustomerId;
            const charges = await stripe.charges.list({
                customer: stripeCustomerId,
            });
            return charges.data;
        } catch (error) {
            ErrorService.log('stripeService.charges', error);
            throw error;
        }
    },

    creditCard: {
        create: async function(tok, userId) {
            try {
                const [tokenCard, cards] = await Promise.all([
                    stripe.tokens.retrieve(tok),
                    this.get(userId),
                ]);
                let duplicateCard = false;

                if (
                    cards &&
                    cards.data &&
                    cards.data.length > 0 &&
                    tokenCard &&
                    tokenCard.card
                ) {
                    duplicateCard =
                        cards.data.filter(
                            card =>
                                card.fingerprint === tokenCard.card.fingerprint
                        ).length > 0;
                }

                if (!duplicateCard) {
                    const testChargeValue = 100;
                    const description = 'Verify if card is billable';
                    const user = await UserService.findOneBy({
                        query: { _id: userId },
                        select: 'stripeCustomerId',
                    });
                    const stripeCustomerId = user.stripeCustomerId;
                    const card = await stripe.customers.createSource(
                        stripeCustomerId,
                        { source: tok }
                    );
                    const metadata = {
                        description,
                    };
                    const source = card.id;
                    const paymentIntent = await Services.createInvoice(
                        testChargeValue,
                        stripeCustomerId,
                        description,
                        metadata,
                        source
                    );
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

        update: async function(userId, cardId) {
            try {
                const user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'stripeCustomerId',
                });
                const stripeCustomerId = user.stripeCustomerId;
                const card = await stripe.customers.update(stripeCustomerId, {
                    default_source: cardId,
                });
                return card;
            } catch (error) {
                ErrorService.log('stripeService.creditCard.update', error);
                throw error;
            }
        },

        delete: async function(cardId, userId) {
            try {
                const user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'stripeCustomerId',
                });
                const stripeCustomerId = user.stripeCustomerId;
                const cards = await this.get(userId);
                if (cards.data.length === 1) {
                    const error = new Error('Cannot delete the only card');
                    error.code = 403;
                    throw error;
                }
                const card = await stripe.customers.deleteSource(
                    stripeCustomerId,
                    cardId
                );
                return card;
            } catch (error) {
                ErrorService.log('stripeService.creditCard.delete', error);
                throw error;
            }
        },

        get: async function(userId, cardId) {
            try {
                const user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'stripeCustomerId',
                });
                const stripeCustomerId = user.stripeCustomerId;
                const customer = await stripe.customers.retrieve(
                    stripeCustomerId
                );
                if (cardId) {
                    const card = await stripe.customers.retrieveSource(
                        stripeCustomerId,
                        cardId
                    );
                    return card;
                } else {
                    const cards = await stripe.customers.listSources(
                        stripeCustomerId,
                        {
                            object: 'card',
                        }
                    );
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
        },
    },
    chargeCustomerForBalance: async function(
        userId,
        chargeAmount,
        projectId,
        alertOptions
    ) {
        try {
            const description = 'Recharge balance';
            const stripechargeAmount = chargeAmount * 100;
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });
            const stripeCustomerId = user.stripeCustomerId;
            let metadata;
            if (alertOptions) {
                metadata = {
                    projectId,
                    ...alertOptions,
                };
            } else {
                metadata = {
                    projectId,
                };
            }
            const paymentIntent = await this.createInvoice(
                stripechargeAmount,
                stripeCustomerId,
                description,
                metadata
            );
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.chargeCustomerForBalance', error);
            throw error;
        }
    },

    updateBalance: async function(paymentIntent) {
        try {
            if (paymentIntent.status === 'succeeded') {
                const amountRechargedStripe = Number(
                    paymentIntent.amount_received
                );
                if (amountRechargedStripe) {
                    const projectId = paymentIntent.metadata.projectId,
                        minimumBalance =
                            paymentIntent.metadata.minimumBalance &&
                            Number(paymentIntent.metadata.minimumBalance),
                        rechargeToBalance =
                            paymentIntent.metadata.rechargeToBalance &&
                            Number(paymentIntent.metadata.rechargeToBalance),
                        billingUS =
                            paymentIntent.metadata.billingUS &&
                            JSON.parse(paymentIntent.metadata.billingUS),
                        billingNonUSCountries =
                            paymentIntent.metadata.billingNonUSCountries &&
                            JSON.parse(
                                paymentIntent.metadata.billingNonUSCountries
                            ),
                        billingRiskCountries =
                            paymentIntent.metadata.billingRiskCountries &&
                            JSON.parse(
                                paymentIntent.metadata.billingRiskCountries
                            );

                    const alertOptions = {
                        minimumBalance,
                        rechargeToBalance,
                        billingUS,
                        billingNonUSCountries,
                        billingRiskCountries,
                    };
                    const amountRecharged = amountRechargedStripe / 100;
                    const project = await ProjectModel.findById(
                        projectId
                    ).lean();
                    const currentBalance = project.balance;
                    const newbalance = currentBalance + amountRecharged;
                    let updateObject = {};
                    if (!minimumBalance || !rechargeToBalance) {
                        updateObject = {
                            balance: newbalance,
                            alertEnable: true,
                        };
                    } else {
                        updateObject = {
                            balance: newbalance,
                            alertEnable: true,
                            alertOptions,
                        };
                    }
                    let updatedProject = await ProjectModel.findByIdAndUpdate(
                        projectId,
                        updateObject,
                        { new: true }
                    );
                    updatedProject = await updatedProject
                        .populate('userId', 'name')
                        .populate('parentProjectId', 'name')
                        .execPopulate();
                    if (updatedProject.balance === newbalance) {
                        // return true;
                        return updatedProject;
                    }
                }
            }
            return false;
        } catch (error) {
            ErrorService.log('stripeService.updateBalance', error);
            throw error;
        }
    },
    addBalance: async function(userId, chargeAmount, projectId) {
        try {
            const description = 'Recharge balance';
            const stripechargeAmount = chargeAmount * 100;
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });
            const stripeCustomerId = user.stripeCustomerId;
            const metadata = {
                projectId,
            };
            let paymentIntent = await this.createInvoice(
                stripechargeAmount,
                stripeCustomerId,
                description,
                metadata
            );
            // IMPORTANT: Payment Intent is sent for confirmation instally, not using the Stripe Webhook anymore.
            paymentIntent = await this.confirmPayment(paymentIntent);
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.addBalance', error);
            throw error;
        }
    },
    createInvoice: async function(
        amount,
        stripeCustomerId,
        description,
        metadata,
        source
    ) {
        try {
            let updatedPaymentIntent;
            await stripe.invoiceItems.create({
                amount: amount,
                currency: 'usd',
                customer: stripeCustomerId,
                description,
            });
            const invoice = await stripe.invoices.create({
                customer: stripeCustomerId,
                collection_method: 'charge_automatically',
                description,
            });
            const finalizedInvoice = await stripe.invoices.finalizeInvoice(
                invoice.id
            );
            const paymentIntent = await stripe.paymentIntents.retrieve(
                finalizedInvoice.payment_intent
            );
            if (source) {
                updatedPaymentIntent = await stripe.paymentIntents.update(
                    paymentIntent.id,
                    {
                        description,
                        metadata,
                        source,
                    }
                );
            } else {
                updatedPaymentIntent = await stripe.paymentIntents.update(
                    paymentIntent.id,
                    {
                        description,
                        metadata,
                    }
                );
            }
            return updatedPaymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.createInvoice', error);
            throw error;
        }
    },
    makeTestCharge: async function(tokenId, email, companyName) {
        try {
            const description = 'Verify if card is billable';
            const testChargeValue = 100;
            const stripeCustomerId = await PaymentService.createCustomer(
                email,
                companyName
            );
            const card = await stripe.customers.createSource(stripeCustomerId, {
                source: tokenId,
            });
            const metadata = {
                description,
            };
            const source = card.id;
            const paymentIntent = await this.createInvoice(
                testChargeValue,
                stripeCustomerId,
                description,
                metadata,
                source
            );
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.makeTestCharge', error);
            throw error;
        }
    },
    confirmPayment: async function(paymentIntent) {
        try {
            const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
                paymentIntent.id
            );

            if (confirmedPaymentIntent.status === 'succeeded') {
                await this.updateBalance(confirmedPaymentIntent);
            }
            if (confirmedPaymentIntent.status == 'requires_payment_method') {
                await sendSlackAlert(
                    'Confirm Payment Failed',
                    'stripeService.confirmPayment',
                    'Failed payment intent',
                    400
                );
            }
            return confirmedPaymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.confirmPayment', error);
            throw error;
        }
    },
    retrievePaymentIntent: async function(intentId) {
        try {
            const paymentIntent = await stripe.paymentIntents.retrieve(
                intentId
            );
            return paymentIntent;
        } catch (error) {
            ErrorService.log('stripeService.retrievePaymentIntent', error);
            throw error;
        }
    },

    fetchTrialInformation: async function(subscriptionId) {
        try {
            const subscription = await stripe.subscriptions.retrieve(
                subscriptionId
            );

            if (subscription && subscription.trial_end !== null) {
                const chargeDate = new Date(subscription.trial_end * 1000);
                return chargeDate;
            } else return false;
        } catch (error) {
            ErrorService.log('stripeService.fetchTrialInformation', error);
            throw error;
        }
    },
};

const payment = require('../config/payment');
const UserService = require('../services/userService');
const PaymentService = require('../services/paymentService');
const ProjectService = require('../services/projectService');
const ProjectModel = require('../models/project');
const MailService = require('../services/mailService');
const ErrorService = require('../services/errorService');
const { sendSlackAlert } = require('../utils/stripeHandlers');
const stripe = require('stripe')(payment.paymentPrivateKey, {
    maxNetworkRetries: 3, // Retry a request three times before giving up
});
// removal of 'moment' due to declaration but not used.

module.exports = Services;
