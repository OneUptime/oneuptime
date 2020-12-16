const payment = require('../config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
const ErrorService = require('../services/errorService');
const ProjectService = require('../services/projectService');
const UserService = require('../services/userService');
const AlertService = require('../services/alertService');
const { IS_SAAS_SERVICE } = require('../config/server');

module.exports = {
    /**
     * use stripe sdk to check for unpaid subscriptions (saas mode)
     * send email notification once every 24 hours to project owners about the unpaid subscription
     * deactive the project (soft delete) on the 14th day, if the subscription remains unpaid
     */
    handleUnpaidSubscription: async () => {
        try {
            if (IS_SAAS_SERVICE) {
                const subscriptions = await stripe.subscriptions.list({
                    status: 'unpaid',
                });
                const unpaidSubscriptions = subscriptions.data;
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
            }
        } catch (error) {
            ErrorService.log('serverMonitorCron.checkAllServerMonitor', error);
            throw error;
        }
    },
};
