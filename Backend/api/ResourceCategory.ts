import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';

const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';

const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;

import ResourceCategoryService from '../services/resourceCategoryService';

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

// Route
// Description: Creating Resource Category.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {name} req.params -> {projectId}
// Returns: 200: ResourceCategory, 400: Error; 500: Server Error.
router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const resourceCategoryName: $TSFixMe =
                req.body.resourceCategoryName;
            const projectId: $TSFixMe = req.params.projectId;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!resourceCategoryName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category name is required.',
                });
            }

            if (typeof resourceCategoryName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category name is not of string type.',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID  is not of string type.',
                });
            }

            // Call the ResourceCategoryService
            const resourceCategory: $TSFixMe =
                await ResourceCategoryService.create({
                    projectId,
                    userId,
                    name: resourceCategoryName,
                });
            return sendItemResponse(req, res, resourceCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:resourceCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const resourceCategoryId: $TSFixMe = req.params.resourceCategoryId;
            const projectId: $TSFixMe = req.params.projectId;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!resourceCategoryId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category ID is required.',
                });
            }

            if (typeof resourceCategoryId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category ID is not of string type.',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is not of string type.',
                });
            }
            // Call the ResourceCategoryService
            const deletedResourceCategory: $TSFixMe =
                await ResourceCategoryService.deleteBy(
                    {
                        projectId,
                        _id: resourceCategoryId,
                    },
                    userId
                );
            return sendItemResponse(req, res, deletedResourceCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route to update a resource category's name
router.put(
    '/:projectId/:resourceCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const resourceCategoryId: $TSFixMe = req.params.resourceCategoryId;
            const projectId: $TSFixMe = req.params.projectId;
            const { name }: $TSFixMe = req.body;

            if (!resourceCategoryId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category ID is required.',
                });
            }

            if (typeof resourceCategoryId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource category ID is not of string type.',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is not of string type.',
                });
            }

            // Call the ResourceCategoryService
            const updatedResourceCategory: $TSFixMe =
                await ResourceCategoryService.updateOneBy(
                    { projectId, _id: resourceCategoryId },
                    { name, projectId, _id: resourceCategoryId }
                );
            return sendItemResponse(req, res, updatedResourceCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const { limit, skip }: $TSFixMe = req.query;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is not of string type.',
                });
            }
            // Call the ResourceCategoryService
            const selectResourceCat: string =
                'projectId name createdById createdAt';
            const [resourceCategories, count]: $TSFixMe = await Promise.all([
                ResourceCategoryService.findBy({
                    query: { projectId },
                    limit,
                    skip,
                    select: selectResourceCat,
                }),
                ResourceCategoryService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, resourceCategories, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
