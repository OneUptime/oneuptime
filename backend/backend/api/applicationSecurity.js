const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const ApplicationSecurityService = require('../services/applicationSecurityService');

const router = express.Router();

//Route: POST
//Description: creates a new application security
//Param: req.params -> {projectId, componentId}
//Param: req.body -> {name, gitRepositoryUrl, gitUsername, gitPassword}
//returns: response -> {applicationSecurity, error}
router.post(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const data = req.body;
            data.componentId = req.params.componentId;

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Values should not be null',
                });
            }

            if (!data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application Security Name is required',
                });
            }

            if (!data.gitRepositoryUrl.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Repository URL is required',
                });
            }

            if (!data.gitCredential.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Credential is required',
                });
            }

            const applicationSecurity = await ApplicationSecurityService.create(
                data
            );
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get a particular application security in a component
//Param: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {applicationSecurity, error}
router.get(
    '/:projectId/:componentId/application/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { applicationSecurityId } = req.params;
            const applicationSecurity = await ApplicationSecurityService.findOneBy(
                {
                    _id: applicationSecurityId,
                }
            );

            if (!applicationSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get all application security in a component
//Param: req.params -> {projectId, componentId}
//returns: response -> {applicationSecurities, error}
router.get(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;
            const applicationSecurities = await ApplicationSecurityService.findBy(
                {
                    componentId,
                }
            );

            return sendItemResponse(req, res, applicationSecurities);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: DELETE
//Description: delete a particular application security in a component
//Param: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {deletedApplicationSecurity, error}
router.delete(
    '/:projectId/:componentId/application/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { applicationSecurityId } = req.params;

            const deletedApplicationSecurity = await ApplicationSecurityService.deleteBy(
                { _id: applicationSecurityId }
            );
            return sendItemResponse(req, res, deletedApplicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: DELETE
//Description: delete all application security in a component
//Param: req.params -> {projectId, componentId}
//returns: response -> {response, error}
router.delete(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;

            const response = await ApplicationSecurityService.hardDelete({
                componentId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
