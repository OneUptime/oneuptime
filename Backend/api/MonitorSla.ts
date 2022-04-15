import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
import MonitorSlaService from '../services/monitorSlaService';

const router: $TSFixMe = express.getRouter();

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { limit, skip }: $TSFixMe = req.query;

            const selectMonSla: $TSFixMe =
                'name projectId isDefault frequency monitorUptime deleted deletedAt';

            const populateMonSla: $TSFixMe = [
                { path: 'projectId', select: 'name slug' },
            ];
            const [monitorSlas, count]: $TSFixMe = await Promise.all([
                MonitorSlaService.findBy({
                    query: {
                        projectId,
                    },
                    limit,
                    skip,
                    select: selectMonSla,
                    populate: populateMonSla,
                }),
                MonitorSlaService.countBy({
                    projectId,
                }),
            ]);

            return sendListResponse(req, res, monitorSlas, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { name, frequency, monitorUptime }: $TSFixMe = req.body;

            if (!name || !name.trim()) {
                const error: $TSFixMe = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!monitorUptime || !monitorUptime.trim()) {
                const error: $TSFixMe = new Error('Monitor uptime is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (frequency && isNaN(frequency)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for frequency'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (frequency && Number(frequency) < 1) {
                const error: $TSFixMe = new Error(
                    'At lease a single day is needed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && isNaN(monitorUptime)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for monitor uptime'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && Number(monitorUptime) < 1) {
                const error: $TSFixMe = new Error(
                    'Monitor Uptime less than 1 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && Number(monitorUptime) > 100) {
                const error: $TSFixMe = new Error(
                    'Monitor Uptime greater than 100 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data: $TSFixMe = { ...req.body };
            data.projectId = projectId;
            const monitorSla: $TSFixMe = await MonitorSlaService.create(data);
            return sendItemResponse(req, res, monitorSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:monitorSlaId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, monitorSlaId }: $TSFixMe = req.params;
            const { name, handleDefault, frequency, monitorUptime }: $TSFixMe =
                req.body;

            if (!handleDefault && (!name || !name.trim())) {
                const error: $TSFixMe = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && (!monitorUptime || !monitorUptime.trim())) {
                const error: $TSFixMe = new Error('Monitor uptime is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && frequency && isNaN(frequency)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for frequency'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && frequency && Number(frequency) < 1) {
                const error: $TSFixMe = new Error(
                    'At lease a single day is needed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && monitorUptime && isNaN(monitorUptime)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for monitor uptime'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && monitorUptime && Number(monitorUptime) < 1) {
                const error: $TSFixMe = new Error(
                    'Monitor Uptime less than 1 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (
                !handleDefault &&
                monitorUptime &&
                Number(monitorUptime) > 100
            ) {
                const error: $TSFixMe = new Error(
                    'Monitor Uptime greater than 100 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data: $TSFixMe = { ...req.body };
            const monitorSla: $TSFixMe = await MonitorSlaService.updateOneBy(
                { projectId, _id: monitorSlaId },
                data
            );
            return sendItemResponse(req, res, monitorSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:monitorSlaId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, monitorSlaId }: $TSFixMe = req.params;

            const deletedMonitorSla: $TSFixMe =
                await MonitorSlaService.deleteBy({
                    _id: monitorSlaId,
                    projectId,
                });
            return sendItemResponse(req, res, deletedMonitorSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/defaultMonitorSla',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const selectMonSla: $TSFixMe =
                'name projectId isDefault frequency monitorUptime deleted deletedAt';

            const populateMonSla: $TSFixMe = [
                { path: 'projectId', select: 'name slug' },
            ];
            const defaultMonitorSla: $TSFixMe =
                await MonitorSlaService.findOneBy({
                    query: { projectId, isDefault: true },
                    select: selectMonSla,
                    populate: populateMonSla,
                });

            return sendItemResponse(req, res, defaultMonitorSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
