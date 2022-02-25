import express from 'express'

const router = express.Router();

import { isAuthorized } from '../middlewares/authorization'

const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;

import ResourceCategoryService from '../services/resourceCategoryService'

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: Creating Resource Category.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {name} req.params -> {projectId}
// Returns: 200: ResourceCategory, 400: Error; 500: Server Error.
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const resourceCategoryName = req.body.resourceCategoryName;
        const projectId = req.params.projectId;

        const userId = req.user ? req.user.id : null;

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
        const resourceCategory = await ResourceCategoryService.create({
            projectId,
            userId,
            name: resourceCategoryName,
        });
        return sendItemResponse(req, res, resourceCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:resourceCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const resourceCategoryId = req.params.resourceCategoryId;
            const projectId = req.params.projectId;

            const userId = req.user ? req.user.id : null;

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
            const deletedResourceCategory = await ResourceCategoryService.deleteBy(
                {
                    projectId,
                    _id: resourceCategoryId,
                },
                userId
            );
            return sendItemResponse(req, res, deletedResourceCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route to update a resource category's name
router.put(
    '/:projectId/:resourceCategoryId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const resourceCategoryId = req.params.resourceCategoryId;
            const projectId = req.params.projectId;
            const { name } = req.body;

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
            const updatedResourceCategory = await ResourceCategoryService.updateOneBy(
                { projectId, _id: resourceCategoryId },
                { name, projectId, _id: resourceCategoryId }
            );
            return sendItemResponse(req, res, updatedResourceCategory);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const { limit, skip } = req.query;

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
        const selectResourceCat = 'projectId name createdById createdAt';
        const [resourceCategories, count] = await Promise.all([
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
        return sendErrorResponse(req, res, error);
    }
});

export default router;
