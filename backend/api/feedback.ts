import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';

const router = express.getRouter();
import FeedbackService from '../Services/feedbackService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';

const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
