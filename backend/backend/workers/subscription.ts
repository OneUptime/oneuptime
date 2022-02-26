import moment from 'moment'
import payment from '../config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey
import ErrorService from 'common-server/utils/error'
import ProjectService from '../services/projectService'
import UserService from '../services/userService'
import AlertService from '../services/alertService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/server"' has no exported member... Remove this comment to see the full error message
import { IS_SAAS_SERVICE } from '../config/server'

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'startAfter' implicitly has an 'any' typ... Remove this comment to see the full error message
const handleFetchingUnpaidSubscriptions = async startAfter => {
    if (startAfter) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range between 1 to 100
            starting_after: startAfter,
        });
    } else {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
        return await stripe.subscriptions.list({
            status: 'unpaid',
            limit: 100, // default limit is 10 and limit can range between 1 to 100
        });
    }
};

// @ts-expect-error ts-migrate(7034) FIXME: Variable 'data' implicitly has type 'any[]' in som... Remove this comment to see the full error message
let data = [];
const _this = {
    /**
     * use stripe sdk to check for unpaid subscriptions (saas mode)
     * send email notification once every 24th hour to project owners about the unpaid subscription
     * deactive the project (soft delete) and cancel the subscription on the 14th day of the notification, if the subscription remains unpaid
     *
     * THE SERVICE TO UPDATE A PROJECT WILL RUN IN THE BACKGROUND, SO WE DON'T DELAY THE SYSTEM UNNECESSARILY
     * THE SERVICE TO ALERT PROJECT OWNERS BY MAIL WILL ALSO RUN IN THE BACKGROUND
     */
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'startAfter' implicitly has an 'any' typ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'data' implicitly has an 'any[]' type.
                data = [...data, ...subscriptions.data];
                if (subscriptions && subscriptions.has_more) {
                    const lastIndex = subscriptions.data.length - 1;
                    const subscriptionId = subscriptions.data[lastIndex].id;
                    await _this.handleUnpaidSubscription(subscriptionId);
                }

                const unpaidSubscriptions = [...data];
                for (const unpaidSubscription of unpaidSubscriptions) {
                    const stripeCustomerId = unpaidSubscription.customer;
                    const stripeSubscriptionId = unpaidSubscription.id;
                    let subscriptionEndDate = unpaidSubscription.ended_at; // unix timestamp
                    subscriptionEndDate = moment(subscriptionEndDate * 1000);
                    const timeDiff = moment().diff(subscriptionEndDate, 'days');

                    const [user, project] = await Promise.all([
                        UserService.findOneBy({
                            query: { stripeCustomerId },
                            select: 'name email',
                        }),
                        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { stripeSubscriptionId:... Remove this comment to see the full error message
                        ProjectService.findOneBy({
                            query: { stripeSubscriptionId },
                            select:
                                'unpaidSubscriptionNotifications stripePlanId name slug',
                        }),
                    ]);

                    // ignore if there is no project or user
                    // also ignore if the unpaid subscription is not up to 5 or more days
                    if (project && user && timeDiff >= 5) {
                        if (
                            !project.unpaidSubscriptionNotifications ||
                            Number(project.unpaidSubscriptionNotifications) ===
                                0
                        ) {
                            // update unpaidSubscriptionNotifications
                            ProjectService.updateOneBy(
                                { stripeSubscriptionId },
                                { unpaidSubscriptionNotifications: '1' }
                            );

                            // send email reminder for unpaid subscription
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriptions' does not exist on type 't... Remove this comment to see the full error message
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
                                    unpaidSubscriptionNotifications: `${Number(
                                        project.unpaidSubscriptionNotifications
                                    ) + 1}`,
                                }
                            );

                            //send email remainder for unpaid subscription
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
            ErrorService.log('subscription.handleUnpaidSubscription', error);
        }
    },
};

export default _this;
