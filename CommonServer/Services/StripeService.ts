import payment from '../config/payment';
import UserService from './UserService';
import PaymentService from './PaymentService';
import ProjectService from './ProjectService';
import ProjectModel from '../Models/project';
import ObjectID from 'Common/Types/ObjectID';
import MailService from '../../MailService/Services/MailService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { sendSlackAlert } from '../Utils/stripeHandlers';
const stripe: $TSFixMe = require('stripe')(payment.paymentPrivateKey, {
    maxNetworkRetries: 3, // Retry a request three times before giving up
});
// Removal of 'moment' due to declaration but not used.

export default class StripeService {
    public async successEvent(
        customerId: $TSFixMe,
        subscriptionId: $TSFixMe
    ): void {
        const [, project]: $TSFixMe = await Promise.all([
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
    }

    public async failedEvent(
        customerId: $TSFixMe,
        subscriptionId: $TSFixMe,
        chargeAttemptCount: $TSFixMe,
        invoiceUrl: URL
    ): void {
        const [user, project]: $TSFixMe = await Promise.all([
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
            const chargeAttemptStage: $TSFixMe =
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
                400,
                invoiceUrl
            );

            if (chargeAttemptCount === 3) {
                await ProjectService.updateOneBy(
                    { _id: project._id },
                    { paymentFailedDate: Date.now() } // Date to keep track of last failed payment
                );
            }
        }
        return { paymentStatus: 'failed' };
    }

    public async cancelEvent(
        customerId: $TSFixMe,
        subscriptionId: $TSFixMe
    ): void {
        const [user, project]: $TSFixMe = await Promise.all([
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
            let userId: $TSFixMe = user._id;
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
    }

    public async charges(userId: ObjectID): void {
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
        const charges: $TSFixMe = await stripe.charges.list({
            customer: stripeCustomerId,
        });
        return charges.data;
    }

    public async createCreditCard(tok: $TSFixMe, userId: ObjectID): void {
        const [tokenCard, cards]: $TSFixMe = await Promise.all([
            stripe.tokens.retrieve(tok),

            this.get(userId),
        ]);
        let duplicateCard: $TSFixMe = false;

        if (
            cards &&
            cards.data &&
            cards.data.length > 0 &&
            tokenCard &&
            tokenCard.card
        ) {
            duplicateCard =
                cards.data.filter((card: $TSFixMe) => {
                    return card.fingerprint === tokenCard.card.fingerprint;
                }).length > 0;
        }

        if (!duplicateCard) {
            const testChargeValue: $TSFixMe = 100;
            const description: string = 'Verify if card is billable';
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });
            const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
            const card: $TSFixMe = await stripe.customers.createSource(
                stripeCustomerId,
                {
                    source: tok,
                }
            );
            const metadata: $TSFixMe = {
                description,
            };
            const source: $TSFixMe = card.id;
            const paymentIntent: $TSFixMe = await this.createInvoice(
                testChargeValue,
                stripeCustomerId,
                description,
                metadata,
                source
            );
            return paymentIntent;
        }
        throw new BadDataException('Cannot add duplicate card');
    }

    public async update(userId: ObjectID, cardId: $TSFixMe): void {
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
        const card: $TSFixMe = await stripe.customers.update(stripeCustomerId, {
            default_source: cardId,
        });
        return card;
    }

    public async delete(cardId: $TSFixMe, userId: ObjectID): void {
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;

        const cards: $TSFixMe = await this.get(userId);
        if (cards.data.length === 1) {
            const error: $TSFixMe = new Error('Cannot delete the only card');

            error.code = 403;
            throw error;
        }
        const card: $TSFixMe = await stripe.customers.deleteSource(
            stripeCustomerId,
            cardId
        );
        return card;
    }

    public async get(userId: ObjectID, cardId: $TSFixMe): void {
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
        const customer: $TSFixMe = await stripe.customers.retrieve(
            stripeCustomerId
        );
        if (cardId) {
            const card: $TSFixMe = await stripe.customers.retrieveSource(
                stripeCustomerId,
                cardId
            );
            return card;
        }
        const cards: $TSFixMe = await stripe.customers.listSources(
            stripeCustomerId,
            {
                object: 'card',
            }
        );
        cards.data = await cards.data.map((card: $TSFixMe) => {
            if (card.id === customer.default_source) {
                card.default_source = true;
                return card;
            }
            return card;
        });
        return cards;
    }

    public async chargeCustomerForBalance(
        userId: ObjectID,
        chargeAmount: $TSFixMe,
        projectId: ObjectID,
        alertOptions: $TSFixMe
    ): void {
        const description: string = 'Recharge balance';
        const stripechargeAmount: $TSFixMe = chargeAmount * 100;
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
        let metadata: $TSFixMe;
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

        const paymentIntent: $TSFixMe = await this.createInvoice(
            stripechargeAmount,
            stripeCustomerId,
            description,
            metadata
        );
        return paymentIntent;
    }

    public async updateBalance(paymentIntent: $TSFixMe): void {
        if (paymentIntent.status === 'succeeded') {
            const amountRechargedStripe: $TSFixMe = Number(
                paymentIntent.amount_received
            );
            if (amountRechargedStripe) {
                const projectId: $TSFixMe = paymentIntent.metadata.projectId,
                    minimumBalance: $TSFixMe =
                        paymentIntent.metadata.minimumBalance &&
                        Number(paymentIntent.metadata.minimumBalance),
                    rechargeToBalance: $TSFixMe =
                        paymentIntent.metadata.rechargeToBalance &&
                        Number(paymentIntent.metadata.rechargeToBalance),
                    billingUS: $TSFixMe =
                        paymentIntent.metadata.billingUS &&
                        JSON.parse(paymentIntent.metadata.billingUS),
                    billingNonUSCountries: $TSFixMe =
                        paymentIntent.metadata.billingNonUSCountries &&
                        JSON.parse(
                            paymentIntent.metadata.billingNonUSCountries
                        ),
                    billingRiskCountries: $TSFixMe =
                        paymentIntent.metadata.billingRiskCountries &&
                        JSON.parse(paymentIntent.metadata.billingRiskCountries);

                const alertOptions: $TSFixMe = {
                    minimumBalance,
                    rechargeToBalance,
                    billingUS,
                    billingNonUSCountries,
                    billingRiskCountries,
                };
                const amountRecharged: $TSFixMe = amountRechargedStripe / 100;
                const project: $TSFixMe = await ProjectModel.findById(
                    projectId
                ).lean();
                const currentBalance: $TSFixMe = project.balance;
                const newbalance: $TSFixMe = currentBalance + amountRecharged;
                let updateObject: $TSFixMe = {};
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
                let updatedProject: $TSFixMe =
                    await ProjectModel.findByIdAndUpdate(
                        projectId,
                        updateObject,
                        { new: true }
                    );
                updatedProject = await updatedProject
                    .populate('userId', 'name')
                    .populate('parentProjectId', 'name')
                    .execPopulate();
                if (updatedProject.balance === newbalance) {
                    // Return true;
                    return updatedProject;
                }
            }
        }
        return false;
    }

    public async addBalance(
        userId: ObjectID,
        chargeAmount: $TSFixMe,
        projectId: ObjectID
    ): void {
        const description: string = 'Recharge balance';
        const stripechargeAmount: $TSFixMe = chargeAmount * 100;
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'stripeCustomerId',
        });
        const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
        const metadata: $TSFixMe = {
            projectId,
        };

        let paymentIntent: $TSFixMe = await this.createInvoice(
            stripechargeAmount,
            stripeCustomerId,
            description,
            metadata
        );
        // IMPORTANT: Payment Intent is sent for confirmation instally, not using the Stripe Webhook anymore.
        paymentIntent = await this.confirmPayment(paymentIntent);
        return paymentIntent;
    }

    public async createInvoice(
        amount: $TSFixMe,
        stripeCustomerId: $TSFixMe,
        description: $TSFixMe,
        metadata: $TSFixMe,
        source: $TSFixMe
    ): void {
        let updatedPaymentIntent: $TSFixMe;
        await stripe.invoiceItems.create({
            amount: amount,
            currency: 'usd',
            customer: stripeCustomerId,
            description,
        });
        const invoice: $TSFixMe = await stripe.invoices.create({
            customer: stripeCustomerId,
            collection_method: 'charge_automatically',
            description,
        });
        const finalizedInvoice: $TSFixMe =
            await stripe.invoices.finalizeInvoice(invoice.id);
        const paymentIntent: $TSFixMe = await stripe.paymentIntents.retrieve(
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
    }

    public async makeTestCharge(
        tokenId: $TSFixMe,
        email: $TSFixMe,
        companyName: $TSFixMe
    ): void {
        const description: string = 'Verify if card is billable';
        const testChargeValue: $TSFixMe = 100;
        const stripeCustomerId: $TSFixMe = await PaymentService.createCustomer(
            email,
            companyName
        );
        const card: $TSFixMe = await stripe.customers.createSource(
            stripeCustomerId,
            {
                source: tokenId,
            }
        );
        const metadata: $TSFixMe = {
            description,
        };
        const source: $TSFixMe = card.id;
        const paymentIntent: $TSFixMe = await this.createInvoice(
            testChargeValue,
            stripeCustomerId,
            description,
            metadata,
            source
        );
        return paymentIntent;
    }

    public async confirmPayment(paymentIntent: $TSFixMe): void {
        const confirmedPaymentIntent: $TSFixMe =
            await stripe.paymentIntents.confirm(paymentIntent.id);

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
    }

    public async retrievePaymentIntent(intentId: $TSFixMe): void {
        const paymentIntent: $TSFixMe = await stripe.paymentIntents.retrieve(
            intentId
        );
        return paymentIntent;
    }

    public async fetchTrialInformation(subscriptionId: $TSFixMe): void {
        const subscription: $TSFixMe = await stripe.subscriptions.retrieve(
            subscriptionId
        );

        if (subscription && subscription.trial_end !== null) {
            const chargeDate: $TSFixMe = new Date(
                subscription.trial_end * 1000
            );
            return chargeDate;
        }
        return false;
    }
}
