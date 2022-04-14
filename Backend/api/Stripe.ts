import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import StripeService from '../services/stripeService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendEmptyResponse } from 'CommonServer/Utils/response';

import { sendListResponse } from 'CommonServer/Utils/response';

const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isUserOwner } from '../middlewares/project';

import { isAuthorized } from '../middlewares/authorization';
import ProjectService from '../services/projectService';

const router: $TSFixMe = express.getRouter();

// Route
// Description: Getting events from stripe via webhooks.
// Params:
// Param 1: webhookURL
// Returns: 200: Event object with various status.
router.post('/events', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const event: $TSFixMe = req.body;
        const customerId: $TSFixMe = event.data.object.customer;
        let subscriptionId: $TSFixMe = event.data.object.subscription;
        const chargeAttemptCount: $TSFixMe = event.data.object.attempt_count;
        const invoiceUrl: $TSFixMe = event.data.object.hosted_invoice_url;
        const webhookType: $TSFixMe = event.type;

        if (webhookType === 'customer.subscription.deleted') {
            subscriptionId = event.data.object.id;
            const response: $TSFixMe = await StripeService.cancelEvent(
                customerId,
                subscriptionId
            );
            return sendItemResponse(req, res, response);
        }

        if (webhookType === 'invoice.payment_failed') {
            const response: $TSFixMe = await StripeService.failedEvent(
                customerId,
                subscriptionId,
                chargeAttemptCount,
                invoiceUrl
            );
            return sendItemResponse(req, res, response);
        }

        if (webhookType === 'invoice.paid') {
            const response: $TSFixMe = await StripeService.successEvent(
                customerId,
                subscriptionId
            );
            return sendItemResponse(req, res, response);
        }

        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

router.get(
    '/:userId/charges',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user.id;
            if (userId) {
                const charges: $TSFixMe = await StripeService.charges(userId);
                return sendListResponse(req, res, charges);
            }
            throw new BadDataException('User is required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:userId/creditCard/:token/pi',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;
            if (token && userId) {
                const item: $TSFixMe = await StripeService.creditCard.create(
                    token,
                    userId
                );
                return sendItemResponse(req, res, item);
            }
            throw new BadDataException('Both user and token are required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:userId/creditCard/:cardId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { cardId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;
            if (cardId && userId) {
                const card: $TSFixMe = await StripeService.creditCard.update(
                    userId,
                    cardId
                );
                return sendItemResponse(req, res, card);
            }
            throw new BadDataException('Both user and card are required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:userId/creditCard/:cardId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { cardId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;
            if (cardId && userId) {
                const card: $TSFixMe = await StripeService.creditCard.delete(
                    cardId,
                    userId
                );
                return sendItemResponse(req, res, card);
            }
            throw new BadDataException('Both user and card are required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:userId/creditCard',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user.id;
            if (userId) {
                const cards: $TSFixMe = await StripeService.creditCard.get(
                    userId
                );
                return sendItemResponse(req, res, cards);
            }
            throw new BadDataException('User is required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:userId/creditCard/:cardId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { cardId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;
            if (userId && cardId) {
                const card: $TSFixMe = await StripeService.creditCard.get(
                    userId,
                    cardId
                );
                return sendItemResponse(req, res, card);
            }
            throw new BadDataException('Both user and card are required');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/addBalance',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;
            const { projectId }: $TSFixMe = req.params;
            let { rechargeBalanceAmount }: $TSFixMe = req.body;
            rechargeBalanceAmount = Number(rechargeBalanceAmount);
            if (!rechargeBalanceAmount) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Amount should be present and it should be a valid number.',
                });
            }
            const item: $TSFixMe = await StripeService.addBalance(
                userId,
                rechargeBalanceAmount,
                projectId
            );
            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post('/checkCard', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { tokenId, email, companyName }: $TSFixMe = req.body;
        const paymentIntent: $TSFixMe = await StripeService.makeTestCharge(
            tokenId,
            email,
            companyName
        );
        return sendItemResponse(req, res, paymentIntent);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

router.get(
    '/:projectId/updateBalance/:intentId',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { intentId }: $TSFixMe = req.params;

            const paymentIntent: $TSFixMe =
                await StripeService.retrievePaymentIntent(intentId);
            const updatedProject: $TSFixMe = await StripeService.updateBalance(
                paymentIntent
            );

            if (!updatedProject) {
                const error: $TSFixMe = new Error('Project was not updated');

                error.code = 400;
                sendErrorResponse(req, res, error);
            }

            return sendItemResponse(req, res, updatedProject);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/getTrial',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId is required.',
                });
            }

            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'stripeSubscriptionId',
            });

            const trialDetails: $TSFixMe =
                await StripeService.fetchTrialInformation(
                    project.stripeSubscriptionId
                );

            return sendItemResponse(req, res, trialDetails);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
