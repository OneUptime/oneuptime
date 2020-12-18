const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const ErrorService = require('../services/errorService');
const ProjectService = require('../services/projectService');
const UserService = require('../services/userService');
const AlertService = require('../services/alertService');
const { IS_SAAS_SERVICE } = require('../config/server');

const handleFetchingUnpaidSubscriptions = async startAfter => {
    if (startAfter) {
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range from 1 to 100
            starting_after: startAfter,
        });
    } else {
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range from 1 to 100
        });
    }
};

let data = [];
const _this = {
    /**
     * use stripe sdk to check for unpaid subscriptions (saas mode)
     * send email notification once every 24 hours to project owners about the unpaid subscription
     * deactive the project (soft delete) and cancel the subscription on the 14th day, if the subscription remains unpaid
     */
    handleUnpaidSubscription: async startAfter => {
        try {
            if (IS_SAAS_SERVICE) {
                const subscriptions = await handleFetchingUnpaidSubscriptions(
                    startAfter
                );
                // apply recursion here in order to fetch all the unpaid subscriptions and store it in data array
                // since stripe have a limit on the amount of items to return in the subscription list
                // and also because, if we cancel a subscription and the subscription happens to be the last item in the subscription data array
                // there is no way to fetch the next 100 item, so we are using this approach to fetch every thing once before proceeding to the next stage
                data = [...data, ...subscriptions.data];
                if (subscriptions && subscriptions.has_more) {
                    const lastIndex = subscriptions.data.length - 1;
                    await _this.handleUnpaidSubscription(
                        subscriptions.data[lastIndex]
                    );
                }

                const unpaidSubscriptions = [...data];
                for (const unpaidSubscription of unpaidSubscriptions) {
                    const stripeCustomerId = unpaidSubscription.customer;
                    const stripeSubscriptionId = unpaidSubscription.id;

                    const user = await UserService.findOneBy({
                        stripeCustomerId,
                    });

                    const project = await ProjectService.findOneBy({
                        stripeSubscriptionId,
                    });

                    if (project && user) {
                        if (
                            !project.unpaidSubscriptionNotifications ||
                            Number(project.unpaidSubscriptionNotifications) ===
                                0
                        ) {
                            // update unpaidSubscriptionNotifications
                            await ProjectService.updateOneBy(
                                { stripeSubscriptionId },
                                { unpaidSubscriptionNotifications: '1' }
                            );

                            // send email reminder for unpaid subscription
                            // handle email sending in the background
                            AlertService.sendUnpaidSubscriptionEmail(
                                project,
                                user
                            );
                        } else if (
                            project.unpaidSubscriptionNotifications &&
                            Number(project.unpaidSubscriptionNotifications) ===
                                14
                        ) {
                            // cancel subscription
                            await stripe.subscriptions.del(
                                stripeSubscriptionId
                            );

                            // delete project
                            await ProjectService.updateOneBy(
                                { stripeSubscriptionId },
                                {
                                    deleted: true,
                                    deletedAt: Date.now(),
                                    unpaidSubscriptionNotifications: '0',
                                }
                            );

                            // handle sending email to customer (stripeCustomerId)
                            // handle email sending in the background
                            AlertService.sendProjectDeleteEmailForUnpaidSubscription(
                                project,
                                user
                            );
                        } else {
                            // increment unpaidSubscriptionNotifications
                            await ProjectService.updateOneBy(
                                { stripeSubscriptionId },
                                {
                                    unpaidSubscriptionNotifications: `${Number(
                                        project.unpaidSubscriptionNotifications
                                    ) + 1}`,
                                }
                            );

                            //send email remainder for unpaid subscription
                            // handle email sending in the background
                            AlertService.sendUnpaidSubscriptionEmail(
                                project,
                                user
                            );
                        }
                    }
                }

                data = []; // reset to empty array
            }
        } catch (error) {
            ErrorService.log('serverMonitorCron.checkAllServerMonitor', error);
            throw error;
        }
    },
};

module.exports = _this;
