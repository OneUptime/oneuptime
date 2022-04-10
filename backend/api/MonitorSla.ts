import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/Types/Exception/Exception';

import { sendListResponse } from 'common-server/utils/response';
import MonitorSlaService from '../services/monitorSlaService';

const router = express.getRouter();

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { limit, skip } = req.query;

            const selectMonSla =
                'name projectId isDefault frequency monitorUptime deleted deletedAt';

            const populateMonSla = [{ path: 'projectId', select: 'name slug' }];
            const [monitorSlas, count] = await Promise.all([
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
            const { projectId } = req.params;
            const { name, frequency, monitorUptime } = req.body;

            if (!name || !name.trim()) {
                const error = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!monitorUptime || !monitorUptime.trim()) {
                const error = new Error('Monitor uptime is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (frequency && isNaN(frequency)) {
                const error = new Error(
                    'Please use numeric values for frequency'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (frequency && Number(frequency) < 1) {
                const error = new Error('At lease a single day is needed');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && isNaN(monitorUptime)) {
                const error = new Error(
                    'Please use numeric values for monitor uptime'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && Number(monitorUptime) < 1) {
                const error = new Error(
                    'Monitor Uptime less than 1 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (monitorUptime && Number(monitorUptime) > 100) {
                const error = new Error(
                    'Monitor Uptime greater than 100 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data = { ...req.body };
            data.projectId = projectId;
            const monitorSla = await MonitorSlaService.create(data);
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
    async function (req, res) {
        try {
            const { projectId, monitorSlaId } = req.params;
            const { name, handleDefault, frequency, monitorUptime } = req.body;

            if (!handleDefault && (!name || !name.trim())) {
                const error = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && (!monitorUptime || !monitorUptime.trim())) {
                const error = new Error('Monitor uptime is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && frequency && isNaN(frequency)) {
                const error = new Error(
                    'Please use numeric values for frequency'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && frequency && Number(frequency) < 1) {
                const error = new Error('At lease a single day is needed');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && monitorUptime && isNaN(monitorUptime)) {
                const error = new Error(
                    'Please use numeric values for monitor uptime'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && monitorUptime && Number(monitorUptime) < 1) {
                const error = new Error(
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
                const error = new Error(
                    'Monitor Uptime greater than 100 is not allowed'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data = { ...req.body };
            const monitorSla = await MonitorSlaService.updateOneBy(
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
            const { projectId, monitorSlaId } = req.params;

            const deletedMonitorSla = await MonitorSlaService.deleteBy({
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
            const { projectId } = req.params;
            const selectMonSla =
                'name projectId isDefault frequency monitorUptime deleted deletedAt';

            const populateMonSla = [{ path: 'projectId', select: 'name slug' }];
            const defaultMonitorSla = await MonitorSlaService.findOneBy({
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
