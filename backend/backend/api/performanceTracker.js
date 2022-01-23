

const express = require('express');
const router = express.Router();
const NotificationService = require('../services/notificationService');
const ErrorService = require('../services/errorService');
const PerformanceTrackerService = require('../services/performanceTrackerService');
const PerformanceTrackerMetricService = require('../services/performanceTrackerMetricService');
const { decode } = require('js-base64');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const uuid = require('uuid');

// Route
// Description: Adding a new performance tracker to a component.
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
                    message: 'Performance tracker name is required.',
                });
            }

            data.componentId = componentId;

            const performanceTracker = await PerformanceTrackerService.create(
                data
            );

            try {
                NotificationService.create(
                    performanceTracker.componentId.projectId._id,
                    `A New Performance Tracker was Created with name ${performanceTracker.name} by ${performanceTracker.createdById.name}`,
                    performanceTracker.createdById._id,
                    'performanceTrackeraddremove'
                );
            } catch (error) {
                ErrorService.log('notificationService.create', error);
            }
            // await RealTimeService.sendPerformanceTrackerCreated(
            //     performanceTracker
            // );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Get all Performance tracker by componentId.
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
        const [performanceTracker, count] = await Promise.all([
            PerformanceTrackerService.getPerformanceTrackerByComponentId(
                componentId,
                limit || 0,
                skip || 0
            ),
            PerformanceTrackerService.countBy({ componentId }),
        ]);
        return sendListResponse(req, res, performanceTracker, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// GET a particular performance tracker by the id/slug
router.get(
    '/:projectId/tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { performanceTrackerId } = req.params;
        const { slug } = req.query;
        try {
            let performanceTracker = null;
            const select =
                'componentId name slug key showQuickStart createdById';
            const populate = [
                { path: 'createdById', select: 'name email' },
                {
                    path: 'componentId',
                    select: 'name slug',
                    populate: { path: 'projectId', select: 'name slug' },
                },
            ];
            if (performanceTrackerId && performanceTrackerId !== 'undefined') {
                performanceTracker = await PerformanceTrackerService.findOneBy({
                    query: { _id: performanceTrackerId },
                    select,
                    populate,
                });
            } else if (slug && slug !== 'undefined') {
                performanceTracker = await PerformanceTrackerService.findOneBy({
                    query: { slug },
                    select,
                    populate,
                });
            } else {
                const error = new Error(
                    'Please specify the performance tracker ID or attach the slug as a query parameter'
                );
                error.code = 400;
                throw error;
            }

            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Delete a performance tracker by the it's id and componentId.
router.delete(
    '/:projectId/tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { performanceTrackerId } = req.params;
        try {
            const performanceTracker = await PerformanceTrackerService.deleteBy(
                {
                    _id: performanceTrackerId,
                },
                req.user.id
            );
            if (performanceTracker) {
                return sendItemResponse(req, res, performanceTracker);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Performance tracker not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Reset Performance Tracker Key.
router.put(
    '/:projectId/reset-key/:performanceTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { performanceTrackerId } = req.params;

        const select = 'componentId name slug key showQuickStart createdById';
        const populate = [
            { path: 'createdById', select: 'name email' },
            {
                path: 'componentId',
                select: 'name slug',
                populate: { path: 'projectId', select: 'name slug' },
            },
        ];
        const currentPerformanceTracker = await PerformanceTrackerService.findOneBy(
            {
                query: { _id: performanceTrackerId },
                select,
                populate,
            }
        );
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        const data = {
            key: uuid.v4(), // set new app log key
        };

        try {
            const performanceTracker = await PerformanceTrackerService.updateOneBy(
                { _id: currentPerformanceTracker._id },
                data
            );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: remove quick starter quide
router.put(
    '/:projectId/remove-quickstart/:performanceTrackerId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { performanceTrackerId } = req.params;

        const currentPerformanceTracker = await PerformanceTrackerService.findOneBy(
            {
                query: { _id: performanceTrackerId },
                select: '_id',
            }
        );
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        const data = {
            showQuickStart: false,
        };

        try {
            const performanceTracker = await PerformanceTrackerService.updateOneBy(
                { _id: currentPerformanceTracker._id },
                data
            );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Update Performance Tracker by performanceTrackerId.
router.put(
    '/:projectId/:componentId/update-tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { performanceTrackerId, componentId } = req.params;
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
                message: 'Performance Tracker Name is required.',
            });
        }

        const currentPerformanceTracker = await PerformanceTrackerService.findOneBy(
            {
                query: { _id: performanceTrackerId },
                select: '_id',
            }
        );
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        // try to find in the performance tracker if the name already exist for that component
        const existingPerformanceTracker = await PerformanceTrackerService.findBy(
            {
                query: { name: data.name, componentId: { $ne: componentId } },
                select: '_id',
            }
        );

        if (
            existingPerformanceTracker &&
            existingPerformanceTracker.length > 0 &&
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Performance Tracker with that name already exists.',
            });
        }

        const performanceTrackerData = {};
        if (data.name) {
            performanceTrackerData.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            performanceTrackerData.showQuickStart = data.showQuickStart;
        }

        try {
            const performanceTracker = await PerformanceTrackerService.updateOneBy(
                { _id: currentPerformanceTracker._id },
                performanceTrackerData
            );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetch last metric result for web transaction, throughput and error rate
// to be displayed on the performance tracker list
router.get(
    '/:projectId/last-metrics/:performanceTrackerId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { performanceTrackerId } = req.params;
            let { startDate, endDate } = req.query;
            startDate = decode(startDate);
            endDate = decode(endDate);

            // get each of the individual metrics
            // for web transaction, throughput and error rate
            const [time, throughput, errorRate] = await Promise.all([
                PerformanceTrackerMetricService.structureMetricsTime(
                    performanceTrackerId,
                    startDate,
                    endDate
                ),
                PerformanceTrackerMetricService.structureMetricsCount(
                    performanceTrackerId,
                    startDate,
                    endDate
                ),
                PerformanceTrackerMetricService.structureMetricsError(
                    performanceTrackerId,
                    startDate,
                    endDate
                ),
            ]);

            const result = {
                performanceTrackerId,
                time: time.length > 0 ? time[time.length - 1].value : 0,
                throughput:
                    throughput.length > 0
                        ? throughput[throughput.length - 1].value
                        : 0,
                errorRate:
                    errorRate.length > 0
                        ? errorRate[errorRate.length - 1].value
                        : 0,
            };
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
