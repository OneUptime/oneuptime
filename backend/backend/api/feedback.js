/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var express = require('express');

var router = express.Router();
var FeedbackService = require('../services/feedbackService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

const getUser = require('../middlewares/user').getUser;
const {
    isAuthorized
} = require('../middlewares/authorization');

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    if(!req.body.feedback){
        return sendErrorResponse( req, res, {
            code: 400, 
            message: 'Cannot submit a feedback with an empty message'
        });
    }
    
    try{
        var feedback = await FeedbackService.create(req.params.projectId, req.body.feedback, req.user.id);
        return sendItemResponse(req, res, feedback);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;