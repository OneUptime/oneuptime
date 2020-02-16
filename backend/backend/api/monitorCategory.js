/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');

let router = express.Router();

const {
    isAuthorized
} = require('../middlewares/authorization');

let getUser = require('../middlewares/user').getUser;
let isUserAdmin = require('../middlewares/project').isUserAdmin;


let MonitorCategoryService = require('../services/monitorCategoryService');

let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;


// Route
// Description: Creating Monitor Category.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {name} req.params -> {projectId}
// Returns: 200: MonitorCategory, 400: Error; 500: Server Error.
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let monitorCategoryName = req.body.monitorCategoryName;
        let projectId = req.params.projectId;

        let userId = req.user ? req.user.id : null;

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
        let monitorCategory = await MonitorCategoryService.create({ projectId, userId, name: monitorCategoryName });
        return sendItemResponse(req, res, monitorCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:monitorCategoryId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let monitorCategoryId = req.params.monitorCategoryId;
        let projectId = req.params.projectId;

        let userId = req.user ? req.user.id : null;


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
        let deletedMonitorCategory = await MonitorCategoryService.deleteBy(
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
        let monitorCategoryId = req.params.monitorCategoryId;
        let projectId = req.params.projectId;
        let { name } = req.body;

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
        let updatedMonitorCategory = await MonitorCategoryService.updateOneBy(
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
        let projectId = req.params.projectId;
        let query = req.query;

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
        let monitorCategories = await MonitorCategoryService.findBy({ projectId }, query.limit, query.skip);
        let count = await MonitorCategoryService.countBy({ projectId });
        return sendListResponse(req, res, monitorCategories, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
