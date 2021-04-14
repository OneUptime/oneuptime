const express = require('express');
const StripeService = require('../services/stripeService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendEmptyResponse = require('../middlewares/response').sendEmptyResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

const getUser = require('../middlewares/user').getUser;
const { isUserOwner } = require('../middlewares/project');
const { isAuthorized } = require('../middlewares/authorization');
const ProjectService = require('../services/projectService');

const router = express.Router();

// Route
// Description: Getting events from stripe via webhooks.
// Params:
// Param 1: webhookURL
// Returns: 200: Event object with various status.
router.post('/stripe/events', async function(req, res) {
    try {
        const event = req.body;
        const customerId = event.data.object.customer;
        const subscriptionId = event.data.object.subscription;
        const chargeAttemptCount = event.data.object.attempt_count;

        if (!event.data.object.paid) {
            const response = await StripeService.events(
                customerId,
                subscriptionId,
                chargeAttemptCount
            );
            return sendItemResponse(req, res, response);
        } else {
            return sendEmptyResponse(req, res);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:userId/charges', getUser, async function(req, res) {
    try {
        const userId = req.user.id;
        if (userId) {
            const charges = await StripeService.charges(userId);
            return sendListResponse(req, res, charges);
        }
        const error = new Error('User is required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:userId/creditCard/:token/pi', getUser, async function(req, res) {
    try {
        const { token } = req.params;
        const userId = req.user.id;
        if (token && userId) {
            const item = await StripeService.creditCard.create(token, userId);
            return sendItemResponse(req, res, item);
        }
        const error = new Error('Both user and token are required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:userId/creditCard/:cardId', getUser, async function(req, res) {
    try {
        const { cardId } = req.params;
        const userId = req.user.id;
        if (cardId && userId) {
            const card = await StripeService.creditCard.update(userId, cardId);
            return sendItemResponse(req, res, card);
        }
        const error = new Error('Both user and card are required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:userId/creditCard/:cardId', getUser, async function(req, res) {
    try {
        const { cardId } = req.params;
        const userId = req.user.id;
        if (cardId && userId) {
            const card = await StripeService.creditCard.delete(cardId, userId);
            return sendItemResponse(req, res, card);
        }
        const error = new Error('Both user and card are required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:userId/creditCard', getUser, async function(req, res) {
    try {
        const userId = req.user.id;
        if (userId) {
            const cards = await StripeService.creditCard.get(userId);
            return sendItemResponse(req, res, cards);
        }
        const error = new Error('User is required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:userId/creditCard/:cardId', getUser, async function(req, res) {
    try {
        const { cardId } = req.params;
        const userId = req.user.id;
        if (userId && cardId) {
            const card = await StripeService.creditCard.get(userId, cardId);
            return sendItemResponse(req, res, card);
        }
        const error = new Error('Both user and card are required');
        error.code = 400;
        throw error;
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/:projectId/addBalance',
    getUser,
    isAuthorized,
    isUserOwner,
    async function(req, res) {
        try {
            const userId = req.user ? req.user.id : null;
            const { projectId } = req.params;
            let { rechargeBalanceAmount } = req.body;
            rechargeBalanceAmount = Number(rechargeBalanceAmount);
            if (!rechargeBalanceAmount) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Amount should be present and it should be a valid number.',
                });
            }
            const item = await StripeService.addBalance(
                userId,
                rechargeBalanceAmount,
                projectId
            );
            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/checkCard', async function(req, res) {
    try {
        const { tokenId, email, companyName } = req.body;
        const paymentIntent = await StripeService.makeTestCharge(
            tokenId,
            email,
            companyName
        );
        return sendItemResponse(req, res, paymentIntent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/updateBalance/:intentId',
    getUser,
    isAuthorized,
    isUserOwner,
    async function(req, res) {
        try {
            const { intentId } = req.params;

            const paymentIntent = await StripeService.retrievePaymentIntent(
                intentId
            );
            const updatedProject = await StripeService.updateBalance(
                paymentIntent
            );

            if (!updatedProject) {
                const error = new Error('Project was not updated');
                error.code = 400;
                sendErrorResponse(req, res, error);
            }

            return sendItemResponse(req, res, updatedProject);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/getTrial',
    getUser,
    isAuthorized,
    isUserOwner,
    async function(req, res) {
        try {
            const { projectId } = req.params;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId is required.',
                });
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            const trialDetails = await StripeService.fetchTrialInformation(
                project.stripeSubscriptionId
            );

            return sendItemResponse(req, res, trialDetails);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
