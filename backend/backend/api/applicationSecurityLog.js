const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const ApplicationSecurityLogService = require('../services/applicationSecurityLogService');

const router = express.Router();

//Route: GET
//Description: get an application security log
//Params: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/application/logs/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { applicationSecurityId, componentId } = req.params;

            const populateApplicationSecurityLog = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select:
                        '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog =
                '_id securityId componentId data';

            const securityLog = await ApplicationSecurityLogService.findOneBy({
                query: { securityId: applicationSecurityId, componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get an application security log by slug
//Params: req.params -> {projectId, componentId, applicationSecuritySlug}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/applicationSecuritySlug/logs/:applicationSecuritySlug',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { applicationSecuritySlug, componentId } = req.params;

            const populateApplicationSecurityLog = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select:
                        '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog =
                '_id securityId componentId data';

            const securityLog = await ApplicationSecurityLogService.findOneBy({
                query: { slug: applicationSecuritySlug, componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get application security logs in a component
//Params: req.params -> {projectId, componentId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/application/logs',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;
            const populateApplicationSecurityLog = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select:
                        '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog =
                '_id securityId componentId data';
            const securityLogs = await ApplicationSecurityLogService.findBy({
                query: { componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
