/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

let express = require('express');

let router = express.Router();
let FeedbackService = require('../services/feedbackService');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

const getUser = require('../middlewares/user').getUser;
const {
    isAuthorized
} = require('../middlewares/authorization');

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        if (!req.body.feedback && !req.body.page) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Cannot submit a feedback with an empty message or page'
            });
        }
        let feedback = await FeedbackService.create(req.params.projectId, req.body.feedback, req.body.page, req.user.id);
        return sendItemResponse(req, res, feedback);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;