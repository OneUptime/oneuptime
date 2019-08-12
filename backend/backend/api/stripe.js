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
router.post('/stripe/events', async function(req, res) {
    const event = req.body;

    try{
        const customerId = event.data.object.customer;
        const subscriptionId = event.data.object.subscription;
        const chargeAttemptCount = event.data.object.attempt_count;

        if (!event.data.object.paid) {
            var response = await StripeService.events(customerId, subscriptionId, chargeAttemptCount);
            return sendItemResponse(req, res, response);
        }else{
            return sendEmptyResponse(req, res);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/charges', getUser, async function (req, res) {
    let userId = req.user ? req.user.id : null;

    try{
        var charges = await StripeService.charges(userId);
        return sendListResponse(req, res, charges);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/creditCard/:projectId/:token/pi', getUser, isAuthorized, isUserOwner, async function (req, res){
    let userId = req.user ? req.user.id : null;
    let { token } = req.params;

    try{ 
        var pi = await StripeService.creditCard.createPaymentIntent(token, userId);
        return sendItemResponse(req, res, pi);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.put('/creditCard/:projectId/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res){
    let userId = req.user ? req.user.id : null;
    let { cardId } = req.params;
    try{ 
        var card = await StripeService.creditCard.update(userId, cardId);
        return sendItemResponse(req, res, card);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/creditCard/:projectId/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res){
    let userId = req.user ? req.user.id : null;
    let { cardId } = req.params;
    try{ 
        var card = await StripeService.creditCard.delete(cardId, userId);
        return sendItemResponse(req, res, card);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});
router.get('/creditCard/:projectId', getUser, isAuthorized, isUserOwner, async function (req, res){
    let userId = req.user ? req.user.id : null;
    try{ 
        var cards = await StripeService.creditCard.get(userId);
        return sendItemResponse(req, res, cards);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});
router.get('/creditCard/:projectId/:cardId', getUser, isAuthorized, isUserOwner, async function (req, res){
    let userId = req.user ? req.user.id : null;
    let { cardId } = req.params;
    try{ 
        var card = await StripeService.creditCard.get(userId, cardId);
        return sendItemResponse(req, res, card);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});
router.post('/webHook/pi', async function (req, res){
    var paymentIntentData = req.body.data.object;
    if(paymentIntentData.description === 'Recharge balance'){
        var status = await StripeService.updateBalance(paymentIntentData);
        return sendItemResponse(req, res, status);
    }
    return sendItemResponse(req, res, false);
});
router.post('/addBalance/:projectId', getUser, isAuthorized, isUserOwner, async function(req ,res){
    let userId = req.user ? req.user.id : null;
    let { projectId } = req.params;
    let { rechargeBalanceAmount } = req.body;
    rechargeBalanceAmount = Number(rechargeBalanceAmount);
    if (!rechargeBalanceAmount) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Amount should be present and be a valid number.'
        });
    }
    try{ 
        var pi = await StripeService.addBalance(userId, rechargeBalanceAmount, projectId);
        return sendItemResponse(req, res, pi);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;