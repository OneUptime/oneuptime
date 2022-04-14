import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';

const router: $TSFixMe = express.getRouter();
import FeedbackService from '../services/feedbackService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

const getUser: $TSFixMe = require('../middlewares/user').getUser;

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
            const feedback: $TSFixMe = await FeedbackService.create(
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
