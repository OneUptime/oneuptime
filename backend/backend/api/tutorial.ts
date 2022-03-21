import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
const router = express.getRouter();

import UserService from '../services/userService';

const getUser = require('../middlewares/user').getUser;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.get('/', getUser, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const userId = req.user ? req.user.id : null;
        const user = await UserService.findOneBy({
            query: { _id: userId },
            select: '_id tutorial',
        });
        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial },
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/', getUser, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const userId = req.user ? req.user.id : null;
        let user = await UserService.findOneBy({
            query: { _id: userId },
            select: 'tutorial _id',
        });
        // validate that project ID is passed
        const projectId = req.body.projectId;
        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Project ID can't be null",
            });
        }
        user = await UserService.closeTutorialBy(
            { _id: userId },
            req.body.type,
            user.tutorial,
            projectId // project ID is always needed
        );

        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial },
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
