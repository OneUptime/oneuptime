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
        userId,

        project,

        alertType,

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
        projectId,

        alertPhoneNumber,

        userId,

        alertType
    ) => {
        try {
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
    },

    //Description: Retrieve payment intent.
    //Params:
    //Param 1: paymentIntent: Payment Intent
    //Returns: promise

    checkPaymentIntent: async function(paymentIntent) {
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

    createCustomer: async function(email, companyName) {
        const customer = await stripe.customers.create({
            email: email,
            description: companyName,
        });
        return customer.id;
    },

    // eslint-disable-next-line no-unused-vars
    addPayment: async function(customerId, stripeToken) {
        const card = await stripe.customers.createSource(customerId);
        return card;
    },

    //Description: Subscribe plan to user.
    //Params:
    //Param 1: stripePlanId: Id generated from frontend.
    //Param 2: stripeCustomerId: Stripe customer id.
    //Returns : promise

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

    changeSeats: async function(subscriptionId, seats) {
        if (subscriptionId === null) return;

        let subscription = await stripe.subscriptions.retrieve(subscriptionId);

        let plan = null;
        const items = [];
        if (
            !subscription ||
            !subscription.items ||
            !subscription.items.data ||
            !subscription.items.data.length > 0
        ) {
            const error = new Error('Your subscription cannot be retrieved.');

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
                subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    { items: items, trial_end: trial_end_date }
                );
            } else {
                subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    { items: items }
                );
            }

            return subscription.id;
        }
    },

    createSubscription: async function(stripeCustomerId, amount) {
        const productId = Plans.getReserveNumberProductId();

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

    removeSubscription: async function(stripeSubscriptionId) {
        const confirmations = [];

        confirmations[0] = await stripe.subscriptions.del(stripeSubscriptionId);
        return confirmations;
    },

    changePlan: async function(subscriptionId, planId, seats) {
        let subscriptionObj = {};

        const subscription = await stripe.subscriptions.retrieve(
            subscriptionId
        );
        const trial_end = subscription.trial_end;

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

        const subscriptions = await stripe.subscriptions.create(
            subscriptionObj
        );

        return subscriptions.id;
    },

    chargeAlert: async function(userId, projectId, chargeAmount) {
        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'balance alertOptions _id',
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
        stripeCustomerId,

        extraUserPlanId,

        extraUsersToAdd
    ) {
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

import payment from '../config/payment';
import Stripe from 'stripe';
const stripe = Stripe(payment.paymentPrivateKey);
import Plans from '../config/plans';
import ErrorService from 'common-server/utils/error';
import ProjectService from './projectService';
import ProjectModel from '../models/project';
import StripeService from './stripeService';
import NotificationService from './notificationService';
import {
    getAlertChargeAmount,
    getCountryType,
    Call,
} from '../config/alertType';
// import getMutex from '../constants/mutexProvider'

import { formatBalance } from '../utils/number';
// import MUTEX_RESOURCES from '../constants/MUTEX_RESOURCES'
