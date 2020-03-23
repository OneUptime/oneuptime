/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const UserService = require('../services/userService');
const ComponentService = require('../services/componentService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');

const router = express.Router();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

// Route
// Description: Adding / Updating a new component to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check ComponentMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const projectId = req.params.projectId;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        data.createdById = req.user ? req.user.id : null;

        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Component Name is required.',
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Component Name is not of type string.',
            });
        }

        data.projectId = projectId;

        const component = await ComponentService.create(data);
        const user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(
            component.projectId._id,
            `A New Component was Created with name ${component.name} by ${user.name}`,
            user._id,
            'componentaddremove'
        );
        await RealTimeService.sendComponentCreated(component);
        return sendItemResponse(req, res, component);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const data = req.body;
            let unsetData;
            if (!data.componentCategoryId || data.componentCategoryId === '') {
                unsetData = { componentCategoryId: '' };
            }
            const component = await ComponentService.updateOneBy(
                { _id: req.params.componentId },
                data,
                unsetData
            );
            if (component) {
                return sendItemResponse(req, res, component);
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component not found.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Components by projectId.
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        // Call the ComponentService.
        const components = await ComponentService.getComponentsBySubprojects(
            subProjectIds,
            req.query.limit || 0,
            req.query.skip || 0
        );
        return sendItemResponse(req, res, components);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/component',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const components = await ComponentService.findBy(
                query,
                req.query.limit || 10,
                req.query.skip || 0
            );
            const count = await ComponentService.countBy({
                projectId: { $in: subProjectIds },
            });
            return sendListResponse(req, res, components, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/component/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const componentId = req.params.componentId;
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { _id: componentId, projectId: { $in: subProjectIds }, type }
                : { _id: componentId, projectId: { $in: subProjectIds } };

            const component = await ComponentService.findOneBy(query);
            return sendItemResponse(req, res, component);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            await ComponentService.deleteBy(
                {
                    componentId: req.params.componentId,
                    projectId: req.params.projectId,
                },
                req.user.id
            );
            const component = await ComponentService.deleteBy(
                {
                    _id: req.params.componentId,
                    projectId: req.params.projectId,
                },
                req.user.id
            );
            if (component) {
                return sendItemResponse(req, res, component);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Component not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// router.post('/:projectId/addseat', getUser, isAuthorized, async function(
//     req,
//     res
// ) {
//     try {
//         const seatresponse = await ComponentService.addSeat({
//             _id: req.params.projectId,
//         });
//         return sendItemResponse(req, res, seatresponse);
//     } catch (error) {
//         return sendErrorResponse(req, res, error);
//     }
// });

module.exports = router;
