const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const ContainerSecurityLogService = require('../services/containerSecurityLogService');

const router = express.Router();

//Route: GET
//Description: get a particular container security log
//Params: req.params -> {projectId, componentId, containerSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/container/logs/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { containerSecurityId, componentId } = req.params;

            const securityLog = await ContainerSecurityLogService.findOneBy({
                securityId: containerSecurityId,
                componentId,
            });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get container security logs in a component
//Params: req.params -> {projectId, componentId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/container/logs',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;
            const securityLogs = await ContainerSecurityLogService.findBy({
                componentId,
            });
            return sendItemResponse(req, res, securityLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
