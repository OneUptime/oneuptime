import express from 'express';

const router = express.Router();
import FeedbackService from '../services/feedbackService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';

router.post('/:projectId', getUser, isAuthorized, async function (
    req: Request,
    res: Response
) {
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

            req.user.id
        );
        return sendItemResponse(req, res, feedback);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
