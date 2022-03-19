import express, { Request, Response } from 'common-server/utils/express';
const router = express.getRouter();
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import moment from 'moment';
import { decode } from 'js-base64';

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import { isValidAPIKey } from '../middlewares/performanceTracker';

// Route
// Description: Receiving Performance metric data from sdk.
// Returns: response status, error message
router.post(
    '/:appId/key/:key',
    isValidAPIKey,
    async function (req: Request, res: Response) {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetch transaction time for performance metrics
router.get(
    '/:appId/key/:key/time',
    isValidAPIKey,
    async function (req: Request, res: Response) {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetch throughput for performance metrics
router.get(
    '/:appId/key/:key/throughput',
    isValidAPIKey,
    async function (req, res) {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:appId/key/:key/error',
    isValidAPIKey,
    async function (req: Request, res: Response) {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Fetch all the Performance metrics for a particular identifier
router.get(
    '/:appId/key/:key',
    isValidAPIKey,
    async function (req: Request, res: Response) {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// Delete a performance metric
router.delete(
    '/:appId/key/:key/:metricId',
    isValidAPIKey,
    async function (req, res) {
        try {
            const { metricId } = req.params;
            const deletedMetric =
                await PerformanceTrackerMetricService.deleteBy({
                    _id: metricId,
                });
            return sendItemResponse(req, res, deletedMetric);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
