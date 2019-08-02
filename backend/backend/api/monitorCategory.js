/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');

var router = express.Router();

const {
    isAuthorized
} = require('../middlewares/authorization');

var getUser = require('../middlewares/user').getUser;
var isUserAdmin = require('../middlewares/project').isUserAdmin;


var MonitorCategoryService = require('../services/monitorCategoryService');

var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;


// Route
// Description: Creating Monitor Category.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {name} req.params -> {projectId}
// Returns: 200: MonitorCategory, 400: Error; 500: Server Error.
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var monitorCategoryName = req.body.monitorCategoryName;
    var projectId = req.params.projectId;

    var userId = req.user ? req.user.id : null;

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

    try {
        // Call the MonitorCategoryService
        var monitorCategory = await MonitorCategoryService.create(projectId, userId, monitorCategoryName);
        return sendItemResponse(req, res, monitorCategory);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:monitorCategoryId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var monitorCategoryId = req.params.monitorCategoryId;
    var projectId = req.params.projectId;

    var userId = req.user ? req.user.id : null;


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

    try {
        // Call the MonitorCategoryService
        var deletedMonitorCategory = await MonitorCategoryService.deleteBy(
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

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    var projectId = req.params.projectId;
    var query = req.query;

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

    try {
        // Call the MonitorCategoryService
        var monitorCategories = await MonitorCategoryService.findBy({ projectId }, query.limit, query.skip);
        var count = await MonitorCategoryService.countBy({ projectId });
        return sendListResponse(req, res, monitorCategories, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


module.exports = router;