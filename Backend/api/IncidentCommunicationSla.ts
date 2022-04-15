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
import IncidentCommunicationSlaService from '../services/incidentCommunicationSlaService';

const router: $TSFixMe = express.getRouter();

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { limit, skip }: $TSFixMe = req.query;

            const selectIncidentComSla: $TSFixMe =
                'name projectId isDefault alertTime alertTime deleted duration';

            const populateIncidentComSla: $TSFixMe = [
                { path: 'projectId', select: 'name slug' },
            ];
            const [incidentSlas, count]: $TSFixMe = await Promise.all([
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
            const { projectId }: $TSFixMe = req.params;
            const { name, alertTime, duration }: $TSFixMe = req.body;

            if (!name || !name.trim()) {
                const error: $TSFixMe = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (duration && isNaN(duration)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!alertTime || !alertTime.trim()) {
                const error: $TSFixMe = new Error(
                    'Please set alert time for this SLA'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (isNaN(alertTime)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for alert time'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (Number(alertTime) >= Number(duration)) {
                const error: $TSFixMe = new Error(
                    'Alert time should be always less than duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data: $TSFixMe = { ...req.body };
            data.projectId = projectId;
            const incidentSla: $TSFixMe =
                await IncidentCommunicationSlaService.create(data);
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
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, incidentSlaId }: $TSFixMe = req.params;
            const { name, handleDefault, alertTime, duration }: $TSFixMe =
                req.body;

            if (!handleDefault && (!name || !name.trim())) {
                const error: $TSFixMe = new Error('SLA name is required');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && duration && isNaN(duration)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && (!alertTime || !alertTime.trim())) {
                const error: $TSFixMe = new Error(
                    'Please set alert time for this SLA'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && isNaN(alertTime)) {
                const error: $TSFixMe = new Error(
                    'Please use numeric values for alert time'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            if (!handleDefault && Number(alertTime) >= Number(duration)) {
                const error: $TSFixMe = new Error(
                    'Alert time should be always less than duration'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const data: $TSFixMe = { ...req.body };
            const incidentSla: $TSFixMe =
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
            const { projectId, incidentSlaId }: $TSFixMe = req.params;

            const deletedIncidentSla: $TSFixMe =
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
            const { projectId }: $TSFixMe = req.params;

            const selectIncidentComSla: $TSFixMe =
                'name projectId isDefault alertTime alertTime deleted duration';

            const populateIncidentComSla: $TSFixMe = [
                { path: 'projectId', select: 'name slug' },
            ];
            const defaultSla: $TSFixMe =
                await IncidentCommunicationSlaService.findOneBy({
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
