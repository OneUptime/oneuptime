import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
import StatusPageCategoryService from '../services/statusPageCategoryService';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.post(
    '/:projectId/:statusPageId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageCategoryName }: $TSFixMe = req.body;
            const { statusPageId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!statusPageCategoryName || !statusPageCategoryName.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'StatusPage category name is required.',
                });
            }

            if (typeof statusPageCategoryName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page category name is not of string type.',
                });
            }

            if (!statusPageId || !statusPageId.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page ID is required.',
                });
            }

            if (typeof statusPageId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page ID  is not of string type.',
                });
            }

            const statusPageCategory: $TSFixMe =
                await StatusPageCategoryService.create({
                    statusPageId,
                    userId,
                    name: statusPageCategoryName,
                });
            return sendItemResponse(req, res, statusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:statusPageCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageCategoryId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!statusPageCategoryId || !statusPageCategoryId.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page category ID is required.',
                });
            }

            if (typeof statusPageCategoryId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page category ID is not of string type.',
                });
            }

            const deletedStatusPageCategory: $TSFixMe =
                await StatusPageCategoryService.deleteBy(
                    {
                        _id: statusPageCategoryId,
                    },
                    userId
                );
            return sendItemResponse(req, res, deletedStatusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route to update a statusPage category's name
router.put(
    '/:projectId/:statusPageCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageCategoryId }: $TSFixMe = req.params;
            const { statusPageCategoryName }: $TSFixMe = req.body;

            if (!statusPageCategoryId || !statusPageCategoryId.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page category ID is required.',
                });
            }

            if (typeof statusPageCategoryId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page category ID is not of string type.',
                });
            }

            if (!statusPageCategoryName || !statusPageCategoryName.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page category name is required.',
                });
            }

            if (typeof statusPageCategoryName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page category name is not of string type.',
                });
            }

            // Call the StatusPageCategoryService
            const updatedStatusPageCategory: $TSFixMe =
                await StatusPageCategoryService.updateOneBy(
                    { _id: statusPageCategoryId },
                    {
                        name: statusPageCategoryName,
                    }
                );
            return sendItemResponse(req, res, updatedStatusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:statusPageId',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const { statusPageId }: $TSFixMe = req.params;
            const { limit, skip }: $TSFixMe = req.query;

            if (!statusPageId || !statusPageId.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page ID is required.',
                });
            }

            if (typeof statusPageId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status page ID is not of string type.',
                });
            }
            // Call the StatusPageCategoryService
            const select: string = 'statusPageId name createdById createdAt';
            const [statusPageCategories, count]: $TSFixMe = await Promise.all([
                StatusPageCategoryService.findBy({
                    query: { statusPageId },
                    limit,
                    skip,
                    select,
                }),
                StatusPageCategoryService.countBy({ statusPageId }),
            ]);
            return sendListResponse(req, res, statusPageCategories, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
