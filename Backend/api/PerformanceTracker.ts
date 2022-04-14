import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();
import NotificationService from '../services/notificationService';
import PerformanceTrackerService from '../services/performanceTrackerService';
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import RealTimeService from '../services/realTimeService';
import { decode } from 'js-base64';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;

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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const { componentId }: $TSFixMe = req.params;
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

            const performanceTracker: $TSFixMe =
                await PerformanceTrackerService.create(data);

            NotificationService.create(
                performanceTracker.componentId.projectId._id,

                `A New Performance Tracker was Created with name ${performanceTracker.name} by ${performanceTracker.createdById.name}`,

                performanceTracker.createdById._id,
                'performanceTrackeraddremove'
            );

            RealTimeService.sendPerformanceTrackerCreated(performanceTracker);
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Get all Performance tracker by componentId.
router.get(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const { componentId }: $TSFixMe = req.params;
            const { limit, skip }: $TSFixMe = req.query;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Component ID can't be null",
                });
            }
            const [performanceTracker, count]: $TSFixMe = await Promise.all([
                PerformanceTrackerService.getPerformanceTrackerByComponentId(
                    componentId,
                    limit || 0,
                    skip || 0
                ),
                PerformanceTrackerService.countBy({ componentId }),
            ]);
            return sendListResponse(req, res, performanceTracker, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// GET a particular performance tracker by the id/slug
router.get(
    '/:projectId/tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { performanceTrackerId }: $TSFixMe = req.params;
        const { slug }: $TSFixMe = req.query;
        try {
            let performanceTracker: $TSFixMe = null;
            const select: $TSFixMe =
                'componentId name slug key showQuickStart createdById';
            const populate: $TSFixMe = [
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
                const error: $TSFixMe = new Error(
                    'Please specify the performance tracker ID or attach the slug as a query parameter'
                );

                error.code = 400;
                throw error;
            }

            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Delete a performance tracker by the it's id and componentId.
router.delete(
    '/:projectId/tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { performanceTrackerId }: $TSFixMe = req.params;
        try {
            const performanceTracker: $TSFixMe =
                await PerformanceTrackerService.deleteBy(
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Reset Performance Tracker Key.
router.put(
    '/:projectId/reset-key/:performanceTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { performanceTrackerId }: $TSFixMe = req.params;

        const select: string =
            'componentId name slug key showQuickStart createdById';
        const populate: $TSFixMe = [
            { path: 'createdById', select: 'name email' },
            {
                path: 'componentId',
                select: 'name slug',
                populate: { path: 'projectId', select: 'name slug' },
            },
        ];
        const currentPerformanceTracker: $TSFixMe =
            await PerformanceTrackerService.findOneBy({
                query: { _id: performanceTrackerId },
                select,
                populate,
            });
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        const data: $TSFixMe = {
            key: uuid.v4(), // set new app log key
        };

        try {
            const performanceTracker: $TSFixMe =
                await PerformanceTrackerService.updateOneBy(
                    { _id: currentPerformanceTracker._id },
                    data
                );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: remove quick starter quide
router.put(
    '/:projectId/remove-quickstart/:performanceTrackerId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { performanceTrackerId }: $TSFixMe = req.params;

        const currentPerformanceTracker: $TSFixMe =
            await PerformanceTrackerService.findOneBy({
                query: { _id: performanceTrackerId },
                select: '_id',
            });
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        const data: $TSFixMe = {
            showQuickStart: false,
        };

        try {
            const performanceTracker: $TSFixMe =
                await PerformanceTrackerService.updateOneBy(
                    { _id: currentPerformanceTracker._id },
                    data
                );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Update Performance Tracker by performanceTrackerId.
router.put(
    '/:projectId/:componentId/update-tracker/:performanceTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { performanceTrackerId, componentId }: $TSFixMe = req.params;
        const data: $TSFixMe = req.body;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }

        if (!data.name && data.showQuickStart === undefined) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Performance Tracker Name is required.')
            );
        }

        const currentPerformanceTracker: $TSFixMe =
            await PerformanceTrackerService.findOneBy({
                query: { _id: performanceTrackerId },
                select: '_id',
            });
        if (!currentPerformanceTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Performance Tracker not found',
            });
        }

        // try to find in the performance tracker if the name already exist for that component
        const existingPerformanceTracker: $TSFixMe =
            await PerformanceTrackerService.findBy({
                query: { name: data.name, componentId: { $ne: componentId } },
                select: '_id',
            });

        if (
            existingPerformanceTracker &&
            existingPerformanceTracker.length > 0 &&
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Performance Tracker with that name already exists.'
                )
            );
        }

        const performanceTrackerData: $TSFixMe = {};
        if (data.name) {
            performanceTrackerData.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            performanceTrackerData.showQuickStart = data.showQuickStart;
        }

        try {
            const performanceTracker: $TSFixMe =
                await PerformanceTrackerService.updateOneBy(
                    { _id: currentPerformanceTracker._id },
                    performanceTrackerData
                );
            return sendItemResponse(req, res, performanceTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch last metric result for web transaction, throughput and error rate
// to be displayed on the performance tracker list
router.get(
    '/:projectId/last-metrics/:performanceTrackerId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { performanceTrackerId }: $TSFixMe = req.params;
            let {startDate, endDate}: $TSFixMe = req.query;

            startDate = decode(startDate);

            endDate = decode(endDate);

            // get each of the individual metrics
            // for web transaction, throughput and error rate
            const [time, throughput, errorRate]: $TSFixMe = await Promise.all([
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

            const result: $TSFixMe = {
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
