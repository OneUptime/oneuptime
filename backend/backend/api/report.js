/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

const express = require('express');
const ReportService = require('../services/reportService');
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
const router = express.Router();


/**
 * @Routes
 * @description get names of most active members to resolve incidents
 * @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
 * @returns { Array } an array of members ordered by number of incidents resolved
 */
router.get('/:projectId/active-members', getUser, isAuthorized, getSubProjects, async (req, res) => {
    const { startDate, endDate, skip, limit } = req.query;
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        // Call ReportService
        var members = await ReportService.getMostActiveMembers(subProjectIds, startDate, endDate, skip, limit);
        var count = members.count;
        return sendListResponse(req, res, members.members, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

/**
* @Route
* @description route to fetch most active monitors
* @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
* @returns { Array } an array of monitors orderedby number of incidents
*/
router.get('/:projectId/active-monitors', getUser, isAuthorized, getSubProjects, async (req, res) => {
    const { startDate, endDate, skip, limit } = req.query;
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        // Call Reports Service
        let monitors = await ReportService.getMostActiveMonitors(subProjectIds, startDate, endDate, skip, limit);
        let count = monitors.count;
        return sendListResponse(req, res, monitors.monitors, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

/**
* @Route
* @description route to fetch monthly average time to resolve incidents
* @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
* @returns { Array } an array of monitors orderedby number of incidents
*/
router.get('/:projectId/average-resolved', getUser, isAuthorized, getSubProjects, async (req, res) => {
    var userId = req.user ? req.user.id : null;
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        // Call Reports Service
        var months = await ReportService.getAverageTimeMonth(subProjectIds, userId);
        return sendListResponse(req, res, months);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

/**
* @Route
* @description route to fetch monthly average time to resolve incidents
* @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
* @returns { Array } an array of monitors orderedby number of incidents
*/
router.get('/:projectId/monthly-incidents', getUser, isAuthorized, getSubProjects, async (req, res) => {
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        // Call Reports Service
        var months = await ReportService.getMonthlyIncidentCount(subProjectIds);
        return sendListResponse(req, res, months);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

/**
* @Route
* @description route to fetch incidents count by filter
* @param Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {projectId}
* @returns { Array } an array of incidents count
*/
router.get('/:projectId/incidents', getUser, isAuthorized, getSubProjects, async (req, res) => {
    const { startDate, endDate, filter } = req.query;
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        // Reports Service
        var incidents = await ReportService.getIncidentCountBy(subProjectIds, startDate, endDate, filter);
        return sendListResponse(req, res, incidents);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
