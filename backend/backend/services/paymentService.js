module.exports = {
    /**
     * charges a project for an alert
     * @param {(object | string)} userId owner of the project
     * @param {object} project project to cut balance from
     * @param {string} alertType the type of alert to use
     * @param {string} alertPhoneNumber phone number of the recipient
     * @returns { (Promise<{error : (string) }> | Promise< {closingBalance : number, chargeAmount:number}>} an object containing error or closing balance and charge amount
     */
    chargeAlertAndGetProjectBalance: async function(
        userId,
        project,
        alertType,
        alertPhoneNumber,
        segments = 1
    ) {
        let release;
        try {
            const mutex = getProjectMutex(project._id.toString());
            release = await mutex.acquire();

            const countryType = getCountryType(alertPhoneNumber);
            const alertChargeAmount = getAlertChargeAmount(
                alertType,
                countryType
            );
            const chargeAmount =
                alertType === Call
                    ? alertChargeAmount.price
                    : alertChargeAmount.price * segments;

            const updatedProject = await this.chargeAlert(
                userId,
                project._id,
                chargeAmount
            );

            return {
                chargeAmount,
                closingBalance: updatedProject.balance,
            };
        } catch (error) {
            ErrorService.log(
                'PaymentService.chargeAlertAndGetProjectBalance',
                error
            );
            return { error: 'Could not charge alert' };
        } finally {
            if (release) {
                release();
            }
        }
    },
    /**
     *checks whether a project's balance is enough
     *
     * @param {*} projectId ID of project
     * @param {*} alertPhoneNumber alertNumber
     * @param {*} userId ID of user
     * @param {*} alertType type of alert
     * @return {boolean} whether the project has enough balance
     */
    hasEnoughBalance: async (
        projectId,
        alertPhoneNumber,
        userId,
        alertType
    ) => {
        try {
            const project = await ProjectService.findOneBy({ _id: projectId });
            const balance = project.balance;
            const countryType = getCountryType(alertPhoneNumber);
            const alertChargeAmount = getAlertChargeAmount(
                alertType,
                countryType
            );

            const customThresholdAmount = project.alertOptions
                ? project.alertOptions.minimumBalance
                : null;

            const isBalanceMoreThanMinimum =
                balance > alertChargeAmount.minimumBalance;
            if (customThresholdAmount) {
                const isBalanceMoreThanCustomThresholdAmount =
                    balance > customThresholdAmount;
                return (
                    isBalanceMoreThanMinimum &&
                    isBalanceMoreThanCustomThresholdAmount
                );
            }
            return isBalanceMoreThanMinimum;
        } catch (error) {
            ErrorService.log('PaymentService.hasEnoughBalance', error);
            return false;
        }
    },

    /**
     * rechargest the project with the amount set in the project's alert options
     * @param {*} userId current user id
     * @param {*} project project to add blance to
     * @returns {boolean} whether the balance is recharged to the project
     */
    fillProjectBalance: async (userId, project) => {
        try {
            let balanceRecharged;

            const rechargeAmount = project.alertOptions
                ? project.alertOptions.rechargeToBalance
                : null;
            if (rechargeAmount) {
                balanceRecharged = await StripeService.addBalance(
                    userId,
                    rechargeAmount,
                    project._id.toString()
                );

                return balanceRecharged;
            }

            return false;
        } catch (error) {
            ErrorService.log('PaymentService.fillProjectBalance', error);
            return false;
        }
    },
    /**
     * synchronously recharges a project balance if low
     * @param {*} projectId ID of the project to check and recharge balance
     * @param {*} userId ID of user
     * @param {*} alertPhoneNumber alertNumber
     * @param {*} alertType type of alert
     * @returns {{success : boolean, message : string}} whether the balance is recharged successfully
     */
    checkAndRechargeProjectBalance: async function(
        project,
        userId,
        alertPhoneNumber,
        alertType
    ) {
        let release;
        try {
            const status = {};
            const mutex = getProjectMutex(project._id.toString());
            release = await mutex.acquire();
            // check balance
            const isBalanceEnough = await this.hasEnoughBalance(
                project._id,
                alertPhoneNumber,
                userId,
                alertType
            );

            if (!isBalanceEnough) {
                const lowBalanceRecharged = await this.fillProjectBalance(
                    userId,
                    project
                );
                if (lowBalanceRecharged) {
                    status.success = true;
                    status.message = 'Balance recharged successfully';
                } else {
                    status.success = false;
                    status.message = 'Low Balance';
                }
            } else {
                status.success = true;
                status.message = 'Balance is enough';
            }

            return status;
        } catch (error) {
            ErrorService.log(
                'PaymentService.checkAndRechargeProjectBalance',
                error
            );
            throw error;
        } finally {
            if (release) {
                release();
            }
        }
    },

    //Description: Retrieve payment intent.
    //Params:
    //Param 1: paymentIntent: Payment Intent
    //Returns: promise
    checkPaymentIntent: async function(paymentIntent) {
        try {
            const processedPaymentIntent = await stripe.paymentIntents.retrieve(
                paymentIntent.id
            );
            return processedPaymentIntent;
        } catch (error) {
            ErrorService.log('paymentService.checkPaymentIntent', error);
            throw error;
        }
    },

    //Description: Create customer in stripe for  user.
    //Params:
    //Param 1: stripeToken: Token generated from frontend
    //Param 2: user: User details
    //Returns: promise
    createCustomer: async function(email, companyName) {
        try {
            const customer = await stripe.customers.create({
                email: email,
                description: companyName,
            });
            return customer.id;
        } catch (error) {
            ErrorService.log('paymentService.createCustomer', error);
            throw error;
        }
    },

    // eslint-disable-next-line no-unused-vars
    addPayment: async function(customerId, stripeToken) {
        try {
            const card = await stripe.customers.createSource(customerId);
            return card;
        } catch (error) {
            ErrorService.log('paymentService.addPayment', error);
            throw error;
        }
    },

    //Description: Subscribe plan to user.
    //Params:
    //Param 1: stripePlanId: Id generated from frontend.
    //Param 2: stripeCustomerId: Stripe customer id.
    //Returns : promise
    subscribePlan: async function(stripePlanId, stripeCustomerId, coupon) {
        try {
            const items = [];
            items.push({
                plan: stripePlanId,
                quantity: 1,
            });

            let subscriptionObj = {};

            if (coupon) {
                subscriptionObj = {
                    customer: stripeCustomerId,
                    items: items,
                    coupon: coupon,
                    trial_period_days: 14,
                };
            } else {
                subscriptionObj = {
                    customer: stripeCustomerId,
                    items: items,
                    trial_period_days: 14,
                };
            }
            const subscription = await stripe.subscriptions.create(
                subscriptionObj
            );
            return {
                stripeSubscriptionId: subscription.id,
            };
        } catch (error) {
            ErrorService.log('paymentService.subscribePlan', error);
            throw error;
        }
    },

    //Description: Call this fuction when you add and remove a team member from Fyipe. This would add and remove seats based on how many users are in the project.
    //Params:
    //Param 1: stripePlanId: Id generated from frontend.
    //Param 2: stripeCustomerId: Stripe customer id.
    //Returns : promise
    changeSeats: async function(subscriptionId, seats) {
        try {
            let subscription = await stripe.subscriptions.retrieve(
                subscriptionId
            );

            let plan = null;
            const items = [];
            if (
                !subscription ||
                !subscription.items ||
                !subscription.items.data ||
                !subscription.items.data.length > 0
            ) {
                const error = new Error(
                    'Your subscription cannot be retrieved.'
                );
                error.code = 400;
                ErrorService.log('paymentService.changeSeats', error);
                throw error;
            } else {
                for (let i = 0; i < subscription.items.data.length; i++) {
                    plan = await Plans.getPlanById(
                        subscription.items.data[i].plan.id
                    );

                    if (plan) {
                        const item = {
                            plan: plan.planId,
                            id: subscription.items.data[i].id,
                            quantity: seats,
                        };

                        items.push(item);
                    }
                }
                subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    { items: items }
                );

                return subscription.id;
            }
        } catch (error) {
            ErrorService.log('paymentService.changeSeats', error);
            throw error;
        }
    },

    removeSubscription: async function(stripeSubscriptionId) {
        try {
            const confirmations = [];
            confirmations[0] = await stripe.subscriptions.del(
                stripeSubscriptionId
            );
            return confirmations;
        } catch (error) {
            ErrorService.log('paymentService.removeSubscription', error);
            throw error;
        }
    },

    changePlan: async function(subscriptionId, planId, seats, trialLeft) {
        try {
            let subscriptionObj = {};
            const subscription = await stripe.subscriptions.retrieve(
                subscriptionId
            );
            await stripe.subscriptions.del(subscriptionId);

            const items = [];
            items.push({
                plan: planId,
                quantity: seats,
            });
            if (trialLeft && trialLeft < 14) {
                trialLeft = 14 - trialLeft;
                subscriptionObj = {
                    customer: subscription.customer,
                    items: items,
                    trial_period_days: trialLeft,
                };
            } else {
                subscriptionObj = {
                    customer: subscription.customer,
                    items: items,
                };
            }
            const subscriptions = await stripe.subscriptions.create(
                subscriptionObj
            );
            return subscriptions.id;
        } catch (error) {
            ErrorService.log('paymentService.changePlan', error);
            throw error;
        }
    },
    chargeAlert: async function(userId, projectId, chargeAmount) {
        try {
            let project = await ProjectService.findOneBy({
                _id: projectId,
            });
            const { balance } = project;
            const { minimumBalance, rechargeToBalance } = project.alertOptions;
            if (balance < minimumBalance) {
                const paymentIntent = await StripeService.chargeCustomerForBalance(
                    userId,
                    rechargeToBalance,
                    project.id
                );
                if (!paymentIntent.paid) {
                    //create notification
                    const message =
                        'Your balance has fallen below minimum balance set in Alerts option. Click here to authorize payment';
                    const meta = {
                        type: 'action',
                        client_secret: paymentIntent.client_secret,
                    };
                    await NotificationService.create(
                        projectId,
                        message,
                        userId,
                        null,
                        meta
                    );
                }

                // confirm payment intent
                // and update the project balance
                // if further process is required the user will need to manually top up the account
                await StripeService.confirmPayment(paymentIntent);
            }
            project = await ProjectService.findOneBy({
                _id: projectId,
            });
            const balanceAfterAlertSent = parseFloat(
                balanceFormatter.format(project.balance - chargeAmount)
            );
            const updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        balance: balanceAfterAlertSent,
                    },
                },
                { new: true }
            );
            return updatedProject;
        } catch (error) {
            ErrorService.log('paymentService.chargeAlert', error);
            throw error;
        }
    },

    //Description: Call this fuction to bill for extra users added to an account.
    //Params:
    //Param 1: stripeCustomerId: Received during signup process.
    //Returns : promise
    chargeExtraUser: async function(
        stripeCustomerId,
        extraUserPlanId,
        extraUsersToAdd
    ) {
        try {
            const subscription = await stripe.subscriptions.create({
                customer: stripeCustomerId,
                items: [
                    {
                        plan: extraUserPlanId,
                        quantity: extraUsersToAdd,
                    },
                ],
            });
            return subscription;
        } catch (error) {
            ErrorService.log('paymentService.chargeExtraUser', error);
            throw error;
        }
    },
};

const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const Plans = require('../config/plans');
const ErrorService = require('./errorService');
const ProjectService = require('./projectService');
const ProjectModel = require('../models/project');
const StripeService = require('./stripeService');
const NotificationService = require('./notificationService');
const {
    getAlertChargeAmount,
    getCountryType,
    Call,
} = require('../config/alertType');
const getProjectMutex = require('../constants/projectMutexProvider');
const { balanceFormatter } = require('../utils/number');
