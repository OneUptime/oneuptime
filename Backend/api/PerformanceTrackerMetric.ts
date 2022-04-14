import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router = express.getRouter();
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import moment from 'moment';
import { decode } from 'js-base64';

import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { isValidAPIKey } from '../middlewares/performanceTracker';

// Route
// Description: Receiving Performance metric data from sdk.
// Returns: response status, error message
router.post(
    '/:appId/key/:key',
    isValidAPIKey,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { appId } = req.params;
            const { incoming, outgoing, sentAt } = req.body;

            Promise.all([
                PerformanceTrackerMetricService.createMetricsData(
                    appId,
                    'incoming',
                    incoming,
                    sentAt
                ),
                PerformanceTrackerMetricService.createMetricsData(
                    appId,
                    'outgoing',
                    outgoing,
                    sentAt
                ),
            ]);

            return sendItemResponse(req, res, { message: 'Success' });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch transaction time for performance metrics
router.get(
    '/:appId/key/:key/time',
    isValidAPIKey,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { appId } = req.params;
            let { startDate, endDate } = req.query;

            startDate = decode(startDate);

            endDate = decode(endDate);

            if (!startDate) {
                const error = new Error(
                    'Please specify startDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(startDate).isValid()) {
                const error = new Error(
                    'Please specify startDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }
            if (!endDate) {
                const error = new Error(
                    'Please specify endDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(endDate).isValid()) {
                const error = new Error(
                    'Please specify endDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }

            if (!isNaN(startDate)) {
                startDate = Number(startDate);
            }

            if (!isNaN(endDate)) {
                endDate = Number(endDate);
            }

            const metrics =
                await PerformanceTrackerMetricService.structureMetricsTime(
                    appId,
                    startDate,
                    endDate
                );

            return sendItemResponse(req, res, metrics);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch throughput for performance metrics
router.get(
    '/:appId/key/:key/throughput',
    isValidAPIKey,
    async (req, res): void => {
        try {
            const { appId } = req.params;
            let { startDate, endDate } = req.query;

            startDate = decode(startDate);

            endDate = decode(endDate);

            if (!startDate) {
                const error = new Error(
                    'Please specify startDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(startDate).isValid()) {
                const error = new Error(
                    'Please specify startDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }
            if (!endDate) {
                const error = new Error(
                    'Please specify endDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(endDate).isValid()) {
                const error = new Error(
                    'Please specify endDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }

            if (!isNaN(startDate)) {
                startDate = Number(startDate);
            }

            if (!isNaN(endDate)) {
                endDate = Number(endDate);
            }

            const metrics =
                await PerformanceTrackerMetricService.structureMetricsCount(
                    appId,
                    startDate,
                    endDate
                );

            return sendItemResponse(req, res, metrics);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:appId/key/:key/error',
    isValidAPIKey,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { appId } = req.params;
            let { startDate, endDate } = req.query;

            startDate = decode(startDate);

            endDate = decode(endDate);

            if (!startDate) {
                const error = new Error(
                    'Please specify startDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(startDate).isValid()) {
                const error = new Error(
                    'Please specify startDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }
            if (!endDate) {
                const error = new Error(
                    'Please specify endDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(endDate).isValid()) {
                const error = new Error(
                    'Please specify endDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }

            if (!isNaN(startDate)) {
                startDate = Number(startDate);
            }

            if (!isNaN(endDate)) {
                endDate = Number(endDate);
            }

            const metrics =
                await PerformanceTrackerMetricService.structureMetricsError(
                    appId,
                    startDate,
                    endDate
                );

            return sendItemResponse(req, res, metrics);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Fetch all the Performance metrics for a particular identifier
router.get(
    '/:appId/key/:key',
    isValidAPIKey,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { appId } = req.params;
            const { type, skip, limit } = req.query;
            let { startDate, endDate } = req.query;

            startDate = decode(startDate);

            endDate = decode(endDate);

            if (!type) {
                const error = new Error(
                    'Please specify the type in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!startDate) {
                const error = new Error(
                    'Please specify startDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(startDate).isValid()) {
                const error = new Error(
                    'Please specify startDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }
            if (!endDate) {
                const error = new Error(
                    'Please specify endDate in the query parameter'
                );

                error.code = 400;
                throw error;
            }
            if (!moment(endDate).isValid()) {
                const error = new Error(
                    'Please specify endDate as utc time or millisecond time'
                );

                error.code = 400;
                throw error;
            }

            if (!isNaN(startDate)) {
                startDate = Number(startDate);
            }

            if (!isNaN(endDate)) {
                endDate = Number(endDate);
            }

            const query = {
                performanceTrackerId: appId,
                type,
                createdAt: { $gte: startDate, $lte: endDate },
            };
            const populate = [
                {
                    path: 'performanceTrackerId',
                    select: 'componentId name slug key',
                    populate: { path: 'componentId', select: 'name slug _id' },
                },
            ];
            const select =
                '_id type metrics callIdentifier method performanceTrackerId createdAt updatedAt';
            const performanceTrackerMetrics =
                await PerformanceTrackerMetricService.mergeMetrics({
                    query,
                    limit,
                    skip,
                    sortCriteria: 'metrics.avgTime',
                    populate,
                    select,
                });

            return sendItemResponse(req, res, performanceTrackerMetrics);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Delete a performance metric
router.delete(
    '/:appId/key/:key/:metricId',
    isValidAPIKey,
    async (req, res): void => {
        try {
            const { metricId } = req.params;
            const deletedMetric =
                await PerformanceTrackerMetricService.deleteBy({
                    _id: metricId,
                });
            return sendItemResponse(req, res, deletedMetric);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
