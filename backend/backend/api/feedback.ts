import express, { Request, Response, NextFunction } from 'common-server/utils/express';

const router = express.getRouter();
import FeedbackService from '../services/feedbackService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

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
