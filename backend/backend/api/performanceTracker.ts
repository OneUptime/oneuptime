import express from 'express';
const router = express.Router();
import NotificationService from '../services/notificationService';
import ErrorService from 'common-server/utils/error';
import PerformanceTrackerService from '../services/performanceTrackerService';
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import { decode } from 'js-base64';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
const isUserAdmin = require('../middlewares/project').isUserAdmin;
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import uuid from 'uuid';

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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
                NotificationService.create(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Doc... Remove this comment to see the full error message
                    performanceTracker.componentId.projectId._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
                    `A New Performance Tracker was Created with name ${performanceTracker.name} by ${performanceTracker.createdById.name}`,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            performanceTrackerData.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showQuickStart' does not exist on type '... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
            startDate = decode(startDate);
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type '{ created... Remove this comment to see the full error message
                time: time.length > 0 ? time[time.length - 1].value : 0,
                throughput:
                    throughput.length > 0
                        ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type '{ created... Remove this comment to see the full error message
                          throughput[throughput.length - 1].value
                        : 0,
                errorRate:
                    errorRate.length > 0
                        ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type '{ created... Remove this comment to see the full error message
                          errorRate[errorRate.length - 1].value
                        : 0,
            };
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
