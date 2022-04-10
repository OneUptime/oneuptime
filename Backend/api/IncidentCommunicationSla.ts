import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/utils/Express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/utils/response';
import IncidentCommunicationSlaService from '../services/incidentCommunicationSlaService';

const router = express.getRouter();

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { limit, skip } = req.query;

            const selectIncidentComSla =
                'name projectId isDefault alertTime alertTime deleted duration';

            const populateIncidentComSla = [
                { path: 'projectId', select: 'name slug' },
            ];
            const [incidentSlas, count] = await Promise.all([
                IncidentCommunicationSlaService.findBy({
                    query: {
                        projectId,
                    },
                    limit,
                    skip,
                    select: selectIncidentComSla,
                    populate: populateIncidentComSla,
                }),
                IncidentCommunicationSlaService.countBy({
                    projectId,
                }),
            ]);

            return sendListResponse(req, res, incidentSlas, count);
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
            const { name, alertTime, duration } = req.body;

            if (!name || !name.trim()) {
                const error = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (duration && isNaN(duration)) {
                const error = new Error(
                    'Please use numeric values for duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!alertTime || !alertTime.trim()) {
                const error = new Error('Please set alert time for this SLA');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (isNaN(alertTime)) {
                const error = new Error(
                    'Please use numeric values for alert time'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (Number(alertTime) >= Number(duration)) {
                const error = new Error(
                    'Alert time should be always less than duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data = { ...req.body };
            data.projectId = projectId;
            const incidentSla = await IncidentCommunicationSlaService.create(
                data
            );
            return sendItemResponse(req, res, incidentSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:incidentSlaId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const { projectId, incidentSlaId } = req.params;
            const { name, handleDefault, alertTime, duration } = req.body;

            if (!handleDefault && (!name || !name.trim())) {
                const error = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && duration && isNaN(duration)) {
                const error = new Error(
                    'Please use numeric values for duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && (!alertTime || !alertTime.trim())) {
                const error = new Error('Please set alert time for this SLA');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && isNaN(alertTime)) {
                const error = new Error(
                    'Please use numeric values for alert time'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && Number(alertTime) >= Number(duration)) {
                const error = new Error(
                    'Alert time should be always less than duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data = { ...req.body };
            const incidentSla =
                await IncidentCommunicationSlaService.updateOneBy(
                    { projectId, _id: incidentSlaId },
                    data
                );
            return sendItemResponse(req, res, incidentSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:incidentSlaId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, incidentSlaId } = req.params;

            const deletedIncidentSla =
                await IncidentCommunicationSlaService.deleteBy({
                    _id: incidentSlaId,
                    projectId,
                });
            return sendItemResponse(req, res, deletedIncidentSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/defaultCommunicationSla',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;

            const selectIncidentComSla =
                'name projectId isDefault alertTime alertTime deleted duration';

            const populateIncidentComSla = [
                { path: 'projectId', select: 'name slug' },
            ];
            const defaultSla = await IncidentCommunicationSlaService.findOneBy({
                query: { projectId, isDefault: true },
                select: selectIncidentComSla,
                populate: populateIncidentComSla,
            });

            return sendItemResponse(req, res, defaultSla);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
