import express from 'express';
import ReportService from '../services/reportService';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const router = express.Router();

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
    async (req, res) => {
        try {
            const { startDate, endDate, skip, limit } = req.query;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Call ReportService
            const members = await ReportService.getMostActiveMembers(
                subProjectIds,
                startDate,
                endDate,
                skip,
                limit
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{}'.
            const count = members.count;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'members' does not exist on type '{}'.
            return sendListResponse(req, res, members.members, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
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
    async (req, res) => {
        try {
            const { startDate, endDate, skip, limit } = req.query;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Call Reports Service
            const monitors = await ReportService.getMostActiveMonitors(
                subProjectIds,
                startDate,
                endDate,
                skip,
                limit
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{}'.
            const count = monitors.count;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            return sendListResponse(req, res, monitors.monitors, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
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
    async (req, res) => {
        try {
            const { startDate, endDate, filter } = req.query;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Reports Service
            const resolveTime = await ReportService.getAverageTimeBy(
                subProjectIds,
                startDate,
                endDate,
                filter
            );
            return sendListResponse(req, res, resolveTime);
        } catch (error) {
            return sendErrorResponse(req, res, error);
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
    async (req, res) => {
        try {
            const { startDate, endDate, filter } = req.query;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Reports Service
            const incidents = await ReportService.getIncidentCountBy(
                subProjectIds,
                startDate,
                endDate,
                filter
            );
            return sendListResponse(req, res, incidents);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
