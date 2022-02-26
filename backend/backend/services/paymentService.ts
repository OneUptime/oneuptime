export default {
    /**
     * charges a project for an alert
     * @param {(object | string)} userId owner of the project
     * @param {object} project project to cut balance from
     * @param {string} alertType the type of alert to use
     * @param {string} alertPhoneNumber phone number of the recipient
     * @returns { (Promise<{error : (string) }> | Promise< {closingBalance : number, chargeAmount:number}>} an object containing error or closing balance and charge amount
     */
    chargeAlertAndGetProjectBalance: async function(
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
        userId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
        project,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertType' implicitly has an 'any' type... Remove this comment to see the full error message
        alertType,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertPhoneNumber' implicitly has an 'an... Remove this comment to see the full error message
        alertPhoneNumber,
        segments = 1
    ) {
        // let release;
        try {
            // const mutex = getMutex(
            //     MUTEX_RESOURCES.PROJECT,
            //     project._id.toString()
            // );
            // release = await mutex.acquire();

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
            // if (release) {
            //     release();
            // }
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
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
        projectId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertPhoneNumber' implicitly has an 'an... Remove this comment to see the full error message
        alertPhoneNumber,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
        userId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertType' implicitly has an 'any' type... Remove this comment to see the full error message
        alertType
    ) => {
        try {
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'balance alertOptions',
            });
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
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
        project,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
        userId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertPhoneNumber' implicitly has an 'an... Remove this comment to see the full error message
        alertPhoneNumber,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'alertType' implicitly has an 'any' type... Remove this comment to see the full error message
        alertType
    ) {
        // let release;
        const status = {};
        // const mutex = getMutex(
        //     MUTEX_RESOURCES.PROJECT,
        //     project._id.toString()
        // );
        // release = await mutex.acquire();
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'success' does not exist on type '{}'.
                status.success = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type '{}'.
                status.message = 'Balance recharged successfully';
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'success' does not exist on type '{}'.
                status.success = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type '{}'.
                status.message = 'Low Balance';
            }
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'success' does not exist on type '{}'.
            status.success = true;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type '{}'.
            status.message = 'Balance is enough';
        }

        return status;
    },

    //Description: Retrieve payment intent.
    //Params:
    //Param 1: paymentIntent: Payment Intent
    //Returns: promise
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'paymentIntent' implicitly has an 'any' ... Remove this comment to see the full error message
    checkPaymentIntent: async function(paymentIntent) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
        const processedPaymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntent.id
        );
        return processedPaymentIntent;
    },

    //Description: Create customer in stripe for  user.
    //Params:
    //Param 1: stripeToken: Token generated from frontend
    //Param 2: user: User details
    //Returns: promise
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'email' implicitly has an 'any' type.
    createCustomer: async function(email, companyName) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'customers' does not exist on type 'typeo... Remove this comment to see the full error message
        const customer = await stripe.customers.create({
            email: email,
            description: companyName,
        });
        return customer.id;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'customerId' implicitly has an 'any' typ... Remove this comment to see the full error message
    // eslint-disable-next-line no-unused-vars
    addPayment: async function(customerId, stripeToken) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'customers' does not exist on type 'typeo... Remove this comment to see the full error message
        const card = await stripe.customers.createSource(customerId);
        return card;
    },

    //Description: Subscribe plan to user.
    //Params:
    //Param 1: stripePlanId: Id generated from frontend.
    //Param 2: stripeCustomerId: Stripe customer id.
    //Returns : promise
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'stripePlanId' implicitly has an 'any' t... Remove this comment to see the full error message
    subscribePlan: async function(stripePlanId, stripeCustomerId, coupon) {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        const subscription = await stripe.subscriptions.create(subscriptionObj);
        return {
            stripeSubscriptionId: subscription.id,
        };
    },

    //Description: Call this fuction when you add and remove a team member from OneUptime. This would add and remove seats based on how many users are in the project.
    //Params:
    //Param 1: stripePlanId: Id generated from frontend.
    //Param 2: stripeCustomerId: Stripe customer id.
    //Returns : promise
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'subscriptionId' implicitly has an 'any'... Remove this comment to see the full error message
    changeSeats: async function(subscriptionId, seats) {
        if (subscriptionId === null) return;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        let subscription = await stripe.subscriptions.retrieve(subscriptionId);

        let plan = null;
        const items = [];
        if (
            !subscription ||
            !subscription.items ||
            !subscription.items.data ||
            // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'boolean' ... Remove this comment to see the full error message
            !subscription.items.data.length > 0
        ) {
            const error = new Error('Your subscription cannot be retrieved.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        } else {
            let trial_end_date;
            if (
                subscription.trial_end !== null &&
                subscription.trial_end * 1000 > Date.now() //ensure the trial end date is in the future
            ) {
                trial_end_date = subscription.trial_end;
            }

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

            if (trial_end_date) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
                subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    { items: items, trial_end: trial_end_date }
                );
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
                subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    { items: items }
                );
            }

            return subscription.id;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'stripeCustomerId' implicitly has an 'an... Remove this comment to see the full error message
    createSubscription: async function(stripeCustomerId, amount) {
        const productId = Plans.getReserveNumberProductId();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        const subscriptions = await stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [
                {
                    price_data: {
                        currency: 'usd',
                        product: productId,
                        unit_amount: amount * 100,
                        recurring: {
                            interval: 'month',
                        },
                    },
                },
            ],
        });
        return subscriptions;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'stripeSubscriptionId' implicitly has an... Remove this comment to see the full error message
    removeSubscription: async function(stripeSubscriptionId) {
        const confirmations = [];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        confirmations[0] = await stripe.subscriptions.del(stripeSubscriptionId);
        return confirmations;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'subscriptionId' implicitly has an 'any'... Remove this comment to see the full error message
    changePlan: async function(subscriptionId, planId, seats) {
        let subscriptionObj = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        const subscription = await stripe.subscriptions.retrieve(
            subscriptionId
        );
        const trial_end = subscription.trial_end;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        await stripe.subscriptions.del(subscriptionId);

        const items = [];
        items.push({
            plan: planId,
            quantity: seats,
        });

        // ensure trial end date is in the future
        if (trial_end !== null && trial_end * 1000 > Date.now()) {
            subscriptionObj = {
                customer: subscription.customer,
                items: items,
                trial_end,
            };
        } else {
            subscriptionObj = {
                customer: subscription.customer,
                items: items,
            };
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        const subscriptions = await stripe.subscriptions.create(
            subscriptionObj
        );

        return subscriptions.id;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
    chargeAlert: async function(userId, projectId, chargeAmount) {
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'balance alertOptions _id',
        });
        const { balance } = project;
        const { minimumBalance, rechargeToBalance } = project.alertOptions;
        if (balance < minimumBalance) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
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
                try {
                    NotificationService.create(
                        projectId,
                        message,
                        userId,
                        null,
                        meta
                    );
                } catch (error) {
                    ErrorService.log('paymentService.chargeAlert', error);
                }
            }

            // confirm payment intent
            // and update the project balance
            // if further process is required the user will need to manually top up the account
            await StripeService.confirmPayment(paymentIntent);
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'balance',
        });
        const balanceAfterAlertSent = formatBalance(
            project.balance - chargeAmount
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
    },

    //Description: Call this fuction to bill for extra users added to an account.
    //Params:
    //Param 1: stripeCustomerId: Received during signup process.
    //Returns : promise
    chargeExtraUser: async function(
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'stripeCustomerId' implicitly has an 'an... Remove this comment to see the full error message
        stripeCustomerId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'extraUserPlanId' implicitly has an 'any... Remove this comment to see the full error message
        extraUserPlanId,
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'extraUsersToAdd' implicitly has an 'any... Remove this comment to see the full error message
        extraUsersToAdd
    ) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
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
    },
};

import payment from '../config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey
import Plans from '../config/plans'
import ErrorService from 'common-server/utils/error'
import ProjectService from './projectService'
import ProjectModel from '../models/project'
import StripeService from './stripeService'
import NotificationService from './notificationService'
const {
    getAlertChargeAmount,
    getCountryType,
    Call,
} = require('../config/alertType');
// import getMutex from '../constants/mutexProvider'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/number"' has no exported member ... Remove this comment to see the full error message
import { formatBalance } from '../utils/number'
// import MUTEX_RESOURCES from '../constants/MUTEX_RESOURCES'
