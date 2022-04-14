import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import ReportService from '../services/reportService';

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const getSubProjects: $TSFixMe =
    require('../middlewares/subProject').getSubProjects;
import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
const router: $TSFixMe = express.getRouter();

/**
 * @Routes
 * @description get names of most active members to resolve incidents
 * @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
 * @returns { Array } an array of members ordered by number of incidents resolved
 */
router.get(
    '/:projectId/active-members',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate, skip, limit }: $TSFixMe = req.query;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Call ReportService
            const members: $TSFixMe = await ReportService.getMostActiveMembers(
                subProjectIds,
                startDate,
                endDate,
                skip,
                limit
            );

            const count: $TSFixMe = members.count;

            return sendListResponse(req, res, members.members, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/**
 * @Route
 * @description route to fetch most active monitors
 * @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
 * @returns { Array } an array of monitors orderedby number of incidents
 */
router.get(
    '/:projectId/active-monitors',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate, skip, limit }: $TSFixMe = req.query;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Call Reports Service
            const monitors: $TSFixMe =
                await ReportService.getMostActiveMonitors(
                    subProjectIds,
                    startDate,
                    endDate,
                    skip,
                    limit
                );

            const count: $TSFixMe = monitors.count;

            return sendListResponse(req, res, monitors.monitors, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/**
 * @Route
 * @description route to fetch average time to resolve incidents by filter
 * @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
 * @returns { Array } an array of monitors orderedby number of incidents
 */
router.get(
    '/:projectId/average-resolved',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate, filter }: $TSFixMe = req.query;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Reports Service
            const resolveTime: $TSFixMe = await ReportService.getAverageTimeBy(
                subProjectIds,
                startDate,
                endDate,
                filter
            );
            return sendListResponse(req, res, resolveTime);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/**
 * @Route
 * @description route to fetch incidents count by filter
 * @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
 * @returns { Array } an array of incidents count
 */
router.get(
    '/:projectId/incidents',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate, filter }: $TSFixMe = req.query;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Reports Service
            const incidents: $TSFixMe = await ReportService.getIncidentCountBy(
                subProjectIds,
                startDate,
                endDate,
                filter
            );
            return sendListResponse(req, res, incidents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
