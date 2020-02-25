/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();

const {
    isAuthorized
} = require('../middlewares/authorization');

const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;


const MonitorCategoryService = require('../services/monitorCategoryService');

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;


// Route
// Description: Creating Monitor Category.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {name} req.params -> {projectId}
// Returns: 200: MonitorCategory, 400: Error; 500: Server Error.
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        const monitorCategoryName = req.body.monitorCategoryName;
        const projectId = req.params.projectId;

        const userId = req.user ? req.user.id : null;

        if (!monitorCategoryName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category name is required.'
            });
        }

        if (typeof monitorCategoryName !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category name is not of string type.'
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID  is not of string type.'
            });
        }

        // Call the MonitorCategoryService
        const monitorCategory = await MonitorCategoryService.create({ projectId, userId, name: monitorCategoryName });
        return sendItemResponse(req, res, monitorCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:monitorCategoryId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        const monitorCategoryId = req.params.monitorCategoryId;
        const projectId = req.params.projectId;

        const userId = req.user ? req.user.id : null;


        if (!monitorCategoryId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category ID is required.'
            });
        }

        if (typeof monitorCategoryId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category ID is not of string type.'
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.'
            });
        }
        // Call the MonitorCategoryService
        const deletedMonitorCategory = await MonitorCategoryService.deleteBy(
            {
                projectId,
                _id: monitorCategoryId
            },
            userId
        );
        return sendItemResponse(req, res, deletedMonitorCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route to update a monitor category's name
router.put('/:projectId/:monitorCategoryId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        const monitorCategoryId = req.params.monitorCategoryId;
        const projectId = req.params.projectId;
        const { name } = req.body;

        if (!monitorCategoryId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category ID is required.'
            });
        }

        if (typeof monitorCategoryId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor category ID is not of string type.'
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.'
            });
        }

        // Call the MonitorCategoryService
        const updatedMonitorCategory = await MonitorCategoryService.updateOneBy(
            { projectId, _id: monitorCategoryId },
            { name, projectId, _id: monitorCategoryId }
        );
        return sendItemResponse(req, res, updatedMonitorCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const query = req.query;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.'
            });
        }
        // Call the MonitorCategoryService
        const monitorCategories = await MonitorCategoryService.findBy({ projectId }, query.limit, query.skip);
        const count = await MonitorCategoryService.countBy({ projectId });
        return sendListResponse(req, res, monitorCategories, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
