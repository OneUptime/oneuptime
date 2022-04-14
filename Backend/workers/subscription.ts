import moment from 'moment';
import payment from '../config/payment';
import Stripe from 'stripe';
const stripe: $TSFixMe = Stripe(payment.paymentPrivateKey);
import ProjectService from '../Services/projectService';
import UserService from '../Services/userService';
import AlertService from '../Services/alertService';

import { IS_SAAS_SERVICE } from '../config/server';

const handleFetchingUnpaidSubscriptions: Function = async (startAfter): void => {
    if (startAfter) {
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range between 1 to 100
            starting_after: startAfter,
        });
    } else {
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range between 1 to 100
        });
    }
};

let data = [];
const _this: $TSFixMe = {
    /**
     * use stripe sdk to check for unpaid subscriptions (saas mode)
     * send email notification once every 24th hour to project owners about the unpaid subscription
     * deactive the project (soft delete) and cancel the subscription on the 14th day of the notification, if the subscription remains unpaid
     *
     * THE SERVICE TO UPDATE A PROJECT WILL RUN IN THE BACKGROUND, SO WE DON'T DELAY THE SYSTEM UNNECESSARILY
     * THE SERVICE TO ALERT PROJECT OWNERS BY MAIL WILL ALSO RUN IN THE BACKGROUND
     */

    handleUnpaidSubscription: async startAfter => {
        if (IS_SAAS_SERVICE) {
            const subscriptions: $TSFixMe =
                await handleFetchingUnpaidSubscriptions(startAfter);
            // apply recursion here in order to fetch all the unpaid subscriptions and store it in data array
            // since stripe have a limit on the amount of items to return in the subscription list
            // and also because, if we cancel a subscription and the subscription happens to be the last item in the subscription data array
            // there is no way to fetch the next 100 item, so we are using this approach to fetch every thing once before proceeding to the next stage

            data = [...data, ...subscriptions.data];
            if (subscriptions && subscriptions.has_more) {
                const lastIndex: $TSFixMe = subscriptions.data.length - 1;
                const subscriptionId: $TSFixMe =
                    subscriptions.data[lastIndex].id;
                await this.handleUnpaidSubscription(subscriptionId);
            }

            const unpaidSubscriptions: $TSFixMe = [...data];
            for (const unpaidSubscription of unpaidSubscriptions) {
                const stripeCustomerId: $TSFixMe = unpaidSubscription.customer;
                const stripeSubscriptionId: $TSFixMe = unpaidSubscription.id;
                let subscriptionEndDate = unpaidSubscription.ended_at; // unix timestamp
                subscriptionEndDate = moment(subscriptionEndDate * 1000);
                const timeDiff: $TSFixMe = moment().diff(
                    subscriptionEndDate,
                    'days'
                );

                const [user, project]: $TSFixMe = await Promise.all([
                    UserService.findOneBy({
                        query: { stripeCustomerId },
                        select: 'name email',
                    }),

                    ProjectService.findOneBy({
                        query: { stripeSubscriptionId },
                        select: 'unpaidSubscriptionNotifications stripePlanId name slug',
                    }),
                ]);

                // ignore if there is no project or user
                // also ignore if the unpaid subscription is not up to 5 or more days
                if (project && user && timeDiff >= 5) {
                    if (
                        !project.unpaidSubscriptionNotifications ||
                        Number(project.unpaidSubscriptionNotifications) === 0
                    ) {
                        // update unpaidSubscriptionNotifications
                        ProjectService.updateOneBy(
                            { stripeSubscriptionId },
                            { unpaidSubscriptionNotifications: '1' }
                        );

                        // send email reminder for unpaid subscription
                        AlertService.sendUnpaidSubscriptionEmail(project, user);
                    } else if (
                        project.unpaidSubscriptionNotifications &&
                        Number(project.unpaidSubscriptionNotifications) === 14
                    ) {
                        // cancel subscription

                        stripe.subscriptions.del(stripeSubscriptionId);

                        // delete project
                        ProjectService.updateOneBy(
                            { stripeSubscriptionId },
                            {
                                deleted: true,
                                deletedAt: Date.now(),
                                unpaidSubscriptionNotifications: '0',
                            }
                        );

                        // handle sending email to customer (stripeCustomerId)
                        AlertService.sendProjectDeleteEmailForUnpaidSubscription(
                            project,
                            user
                        );
                    } else {
                        // increment unpaidSubscriptionNotifications
                        ProjectService.updateOneBy(
                            { stripeSubscriptionId },
                            {
                                unpaidSubscriptionNotifications: `${
                                    Number(
                                        project.unpaidSubscriptionNotifications
                                    ) + 1
                                }`,
                            }
                        );

                        //send email remainder for unpaid subscription
                        AlertService.sendUnpaidSubscriptionEmail(project, user);
                    }
                }
            }

            data = []; // reset to empty array
        }
    },
};

export default _this;
