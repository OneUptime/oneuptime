import express from 'express'

const router = express.Router();
import FeedbackService from '../services/feedbackService'
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const getUser = require('../middlewares/user').getUser;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization'

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        if (!req.body.feedback && !req.body.page) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Cannot submit a feedback with an empty message or page',
            });
        }
        const feedback = await FeedbackService.create(
            req.params.projectId,
            req.body.feedback,
            req.body.page,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            req.user.id
        );
        return sendItemResponse(req, res, feedback);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
