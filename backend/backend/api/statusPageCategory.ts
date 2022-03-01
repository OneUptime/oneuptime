import express from 'express';
const router = express.Router();

import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
import StatusPageCategoryService from '../services/statusPageCategoryService';
import { sendErrorResponse, sendListResponse, sendItemResponse } from 'common-server/utils/response';

router.post(
    '/:projectId/:statusPageId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const { statusPageCategoryName } = req.body;
            const { statusPageId } = req.params;

            const userId = req.user ? req.user.id : null;

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

            const statusPageCategory = await StatusPageCategoryService.create({
                statusPageId,
                userId,
                name: statusPageCategoryName,
            });
            return sendItemResponse(req, res, statusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:statusPageCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const { statusPageCategoryId } = req.params;

            const userId = req.user ? req.user.id : null;

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

            const deletedStatusPageCategory = await StatusPageCategoryService.deleteBy(
                {
                    _id: statusPageCategoryId,
                },
                userId
            );
            return sendItemResponse(req, res, deletedStatusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route to update a statusPage category's name
router.put(
    '/:projectId/:statusPageCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const { statusPageCategoryId } = req.params;
            const { statusPageCategoryName } = req.body;

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
            const updatedStatusPageCategory = await StatusPageCategoryService.updateOneBy(
                { _id: statusPageCategoryId },
                {
                    name: statusPageCategoryName,
                }
            );
            return sendItemResponse(req, res, updatedStatusPageCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId/:statusPageId', getUser, isAuthorized, async function (
    req,
    res
) {
    try {
        const { statusPageId } = req.params;
        const { limit, skip } = req.query;

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
        const select = 'statusPageId name createdById createdAt';
        const [statusPageCategories, count] = await Promise.all([
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
        return sendErrorResponse(req, res, error);
    }
});

export default router;
