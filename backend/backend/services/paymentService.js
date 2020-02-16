module.exports = {
    //Description: Retrieve payment intent.
    //Params:
    //Param 1: paymentIntent: Payment Intent
    //Returns: promise
    checkPaymentIntent: async function (paymentIntent) {
        try {
            const processedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);
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
    createCustomer: async function (email, companyName) {

        try {
            const customer = await stripe.customers.create({
                email: email,
                description: companyName
            });
            return customer.id;
        } catch (error) {
            ErrorService.log('paymentService.createCustomer', error);
            throw error;
        }
    },

    // eslint-disable-next-line no-unused-vars
    addPayment: async function (customerId, stripeToken) {
        try {
            const card = await stripe.customers.createSource(
                customerId,
            );
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
    subscribePlan: async function (stripePlanId, stripeCustomerId, coupon) {
        try {
            const items = [];
            items.push({
                plan: stripePlanId,
                quantity: 1
            });
    
            let subscriptionObj = {};
    
            if (coupon) {
                subscriptionObj = { customer: stripeCustomerId, items: items, coupon: coupon, trial_period_days: 14 };
            }
    
            else {
                subscriptionObj = { customer: stripeCustomerId, items: items, trial_period_days: 14 };
            }
            const subscription = await stripe.subscriptions.create(subscriptionObj);
            return ({
                stripeSubscriptionId: subscription.id,
            });
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
    changeSeats: async function (subscriptionId, seats) {
        try {
            let subscription = await stripe.subscriptions.retrieve(subscriptionId);

            let plan = null;
            const items = [];
            if (!subscription || !subscription.items || !subscription.items.data || !subscription.items.data.length > 0) {
                const error = new Error('Your subscription cannot be retrieved.');
                error.code = 400;
                ErrorService.log('paymentService.changeSeats', error);
                throw error;
            } else {
                for (let i = 0; i < subscription.items.data.length; i++) {
                    plan = await Plans.getPlanById(subscription.items.data[i].plan.id);

                    if (plan) {
                        const item = {
                            plan: plan.planId,
                            id: subscription.items.data[i].id,
                            quantity: seats
                        };
    
                        items.push(item);
                    }
                }
                subscription = await stripe.subscriptions.update(subscriptionId, { items: items });

                return(subscription.id);
            }
        } catch (error) {
            ErrorService.log('paymentService.changeSeats', error);
            throw error;
        }
    },

    removeSubscription: async function (stripeSubscriptionId) {
        try {
            const confirmations = [];
            confirmations[0] = await stripe.subscriptions.del(stripeSubscriptionId);
            return confirmations;
        } catch (error) {
            ErrorService.log('paymentService.removeSubscription', error);
            throw error;
        }
    },


    changePlan: async function (subscriptionId, planId, seats ,trialLeft) {
        try {
            let subscriptionObj = {};
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await stripe.subscriptions.del(subscriptionId);

            const items = [];
            items.push({
                plan: planId,
                quantity: seats
            });
            if (trialLeft && trialLeft < 14) {
                trialLeft = 14 - trialLeft;
                subscriptionObj = { customer: subscription.customer, items: items,trial_period_days: trialLeft };
            }
            else {
                subscriptionObj = { customer: subscription.customer, items: items,};
            }
            const subscriptions = await stripe.subscriptions.create(subscriptionObj);
            return subscriptions.id;
        } catch (error) {
            ErrorService.log('paymentService.changePlan', error);
            throw error;
        }
    },
    chargeAlert: async function(userId, projectId, chargeAmount){
        try {
            const project = await ProjectService.findOneBy({
                _id: projectId
            });
            const { balance } = project;
            const { minimumBalance, rechargeToBalance } = project.alertOptions;
            if ( balance < minimumBalance ){
                const chargeForBalance = await StripeService.chargeCustomerForBalance(userId, rechargeToBalance, project.id);
                if (!(chargeForBalance.paid)){
                    //create notification
                    const message = 'Your balance has fallen below minimum balance set in Alerts option. Click here to authorize payment';
                    const meta = {
                        type: 'action',
                        client_secret: chargeForBalance.client_secret
                    };
                    await NotificationService.create(projectId, message, userId, null, meta);
                }
            }
            const balanceAfterAlertSent = balance - chargeAmount;
            const updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId, {
                    $set: {
                        balance: balanceAfterAlertSent
                    }
                }, { new: true });
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
    chargeExtraUser: async function (stripeCustomerId, extraUserPlanId, extraUsersToAdd) {
        try {
            const subscription = await stripe.subscriptions.create({
                customer: stripeCustomerId,
                items: [
                    {
                        plan: extraUserPlanId,
                        quantity: extraUsersToAdd
                    },
                ]
            });
            return subscription;
        } catch (error) {
            ErrorService.log('paymentService.chargeExtraUser', error);
            throw error;
        }
    }
};

const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const Plans = require('../config/plans');
const ErrorService = require('./errorService');
const ProjectService = require('./projectService');
const ProjectModel = require('../models/project');
const StripeService = require('./stripeService');
const NotificationService = require('./notificationService');
