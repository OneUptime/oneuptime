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

            const securityLog = await ApplicationSecurityLogService.findOneBy({
                securityId: applicationSecurityId,
                componentId,
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
            const securityLogs = await ApplicationSecurityLogService.findBy({
                componentId,
            });
            return sendItemResponse(req, res, securityLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
