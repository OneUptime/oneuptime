/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();
const NotificationService = require('../services/notificationService');
const PerformanceMonitorService = require('../services/performanceMonitorService');
// const RealTimeService = require('../services/realTimeService');

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const uuid = require('uuid');

// Route
// Description: Receiving Data from sdk.
// Returns: response status, error message
router.post('/sdk/:appId', async function(req, res) {
    try {
        const data = req.body;
        /* eslint-disable no-console */
        console.log(data);
        return sendItemResponse(req, res, data);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Adding a new performance monitor to a component.
// Params:
// Param 1: req.params-> {componentId}; req.body -> {[_id], name}
// Returns: response status, error message
router.post(
    '/:projectId/:componentId/create',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const data = req.body;
            const { componentId } = req.params;
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
                    message: 'Performance monitor name is required.',
                });
            }

            data.componentId = componentId;

            const performanceMonitor = await PerformanceMonitorService.create(
                data
            );

            await NotificationService.create(
                performanceMonitor.componentId.projectId._id,
                `A New Performance Monitor was Created with name ${performanceMonitor.name} by ${performanceMonitor.createdById.name}`,
                performanceMonitor.createdById._id,
                'performanceMonitoraddremove'
            );
            // await RealTimeService.sendPerformanceMonitorCreated(
            //     performanceMonitor
            // );
            return sendItemResponse(req, res, performanceMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Get all Performance monitor by componentId.
router.get('/:projectId/:componentId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { componentId } = req.params;
        const { limit, skip } = req.query;
        if (!componentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Component ID can't be null",
            });
        }
        const performanceMonitor = await PerformanceMonitorService.getPerformanceMonitorByComponentId(
            componentId,
            limit || 0,
            skip || 0
        );
        const count = await PerformanceMonitorService.countBy({ componentId });
        return sendListResponse(req, res, performanceMonitor, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// GET a particular performance monitor by the id/slug
router.get(
    '/:projectId/monitor/:performanceMonitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { performanceMonitorId } = req.params;
        const { slug } = req.query;
        try {
            let performanceMonitor = null;
            if (performanceMonitorId && performanceMonitorId !== 'undefined') {
                performanceMonitor = await PerformanceMonitorService.findOneBy({
                    _id: performanceMonitorId,
                });
            } else if (slug && slug !== 'undefined') {
                performanceMonitor = await PerformanceMonitorService.findOneBy({
                    slug,
                });
            } else {
                const error = new Error(
                    'Please specify the performance monitor ID or attach the slug as a query parameter'
                );
                error.code = 400;
                throw error;
            }

            return sendItemResponse(req, res, performanceMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Delete a performance monitor by the it's id and componentId.
router.delete(
    '/:projectId/monitor/:performanceMonitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { performanceMonitorId } = req.params;
        try {
            const performanceMonitor = await PerformanceMonitorService.deleteBy(
                {
                    _id: performanceMonitorId,
                },
                req.user.id
            );
            if (performanceMonitor) {
                return sendItemResponse(req, res, performanceMonitor);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Performance monitor not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Reset Performance Monitor Key.
router.put(
    '/:projectId/reset-key/:performanceMonitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { performanceMonitorId } = req.params;

        const currentPerformanceMonitor = await PerformanceMonitorService.findOneBy(
            {
                _id: performanceMonitorId,
            }
        );
        if (!currentPerformanceMonitor) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Monitor not found',
            });
        }

        const data = {
            key: uuid.v4(), // set new app log key
        };

        try {
            const performanceMonitor = await PerformanceMonitorService.updateOneBy(
                { _id: currentPerformanceMonitor._id },
                data
            );
            return sendItemResponse(req, res, performanceMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Update Performance Monitor by performanceMonitorId.
router.put(
    '/:projectId/:componentId/:performanceMonitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { performanceMonitorId, componentId } = req.params;
        const data = req.body;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }

        if (!data.name && data.showQuickStart === undefined) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Performance Monitor Name is required.',
            });
        }

        const currentPerformanceMonitor = await PerformanceMonitorService.findOneBy(
            {
                _id: performanceMonitorId,
            }
        );
        if (!currentPerformanceMonitor) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Monitor not found',
            });
        }

        // try to find in the performance monitor if the name already exist for that component
        const existingPerformanceMonitor = await PerformanceMonitorService.findBy(
            {
                name: data.name,
                componentId: { $ne: componentId },
            }
        );

        if (
            existingPerformanceMonitor &&
            existingPerformanceMonitor.length > 0 &&
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Performance Monitor with that name already exists.',
            });
        }

        const performanceMonitorData = {};
        if (data.name) {
            performanceMonitorData.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            performanceMonitorData.showQuickStart = data.showQuickStart;
        }

        try {
            const performanceMonitor = await PerformanceMonitorService.updateOneBy(
                { _id: currentPerformanceMonitor._id },
                performanceMonitorData
            );
            return sendItemResponse(req, res, performanceMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
