var express = require('express');
var StripeService = require('../services/stripeService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;
var sendEmptyResponse = require('../middlewares/response').sendEmptyResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;

let getUser = require('../middlewares/user').getUser;
let { isUserOwner } = require('../middlewares/project');
let { isAuthorized } = require('../middlewares/authorization');

var router = express.Router();

// Route
// Description: Getting events from stripe via webhooks.
// Params:
// Param 1: webhookURL
// Returns: 200: Event object with various status.
router.post('/stripe/events', async function (req, res) {
    try {
        const event = req.body;
        const customerId = event.data.object.customer;
        const subscriptionId = event.data.object.subscription;
        const chargeAttemptCount = event.data.object.attempt_count;

        if (!event.data.object.paid) {
            var response = await StripeService.events(customerId, subscriptionId, chargeAttemptCount);
            return sendItemResponse(req, res, response);
        } else {
            return sendEmptyResponse(req, res);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/charges', getUser, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        var charges = await StripeService.charges(userId);
        return sendListResponse(req, res, charges);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/creditCard/:token/pi', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try { 
        let userId = req.user ? req.user.id : null;
        let { token } = req.params;
        var item = await StripeService.creditCard.create(token, userId);
        return sendItemResponse(req, res, item);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/creditCard/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let { cardId } = req.params;
        var card = await StripeService.creditCard.update(userId, cardId);
        return sendItemResponse(req, res, card);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/creditCard/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let { cardId } = req.params;
        var card = await StripeService.creditCard.delete(cardId, userId);
        return sendItemResponse(req, res, card);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/creditCard', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        var cards = await StripeService.creditCard.get(userId);
        return sendItemResponse(req, res, cards);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/creditCard/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let { cardId } = req.params;
        var card = await StripeService.creditCard.get(userId, cardId);
        return sendItemResponse(req, res, card);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/webHook/pi', async function (req, res) {
    try {
        var paymentIntentData, status;
        if (process.env.NODE_ENV === 'production') {
            const stripe = require('stripe')(process.env.STRIPE_PRIVATE_KEY);
            const endpointSecret = process.env.WEBHOOK_SECRET;
            const signatureHeader = req.headers['stripe-signature'];
            let event = stripe.webhooks.constructEvent(req.body, signatureHeader, endpointSecret);
            switch (event.type) {
            case 'payment_intent.succeeded':
                paymentIntentData = event.data.object;
                if (paymentIntentData.description === 'Recharge balance') {
                    status = await StripeService.updateBalance(paymentIntentData);
                    return sendItemResponse(req, res, status);
                }
                return sendItemResponse(req, res, false);
            default: return sendErrorResponse(req, res, {
                message: 'Invalid event',
                code: 400
            });
            }
        } else {
            paymentIntentData = req.body.data.object;
            if (paymentIntentData.description === 'Recharge balance') {
                status = await StripeService.updateBalance(paymentIntentData);
                return sendItemResponse(req, res, status);
            }
            return sendItemResponse(req, res, false);
        }
    } catch (error) {
        return sendErrorResponse(req, res, {
            message: error.message,
            code: 400
        });
    }
});

router.post('/:projectId/addBalance', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let { projectId } = req.params;
        let { rechargeBalanceAmount } = req.body;
        rechargeBalanceAmount = Number(rechargeBalanceAmount);
        if (!rechargeBalanceAmount) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Amount should be present and it should be a valid number.'
            });
        }
        var item = await StripeService.addBalance(userId, rechargeBalanceAmount, projectId);
        return sendItemResponse(req, res, item);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/checkCard', async function (req, res) {
    try {
        var { tokenId, email, companyName } = req.body;
        var paymentIntent = await StripeService.makeTestCharge(tokenId, email, companyName);
        return sendItemResponse(req, res, paymentIntent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;