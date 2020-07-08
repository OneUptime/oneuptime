const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const ContainerSecurityService = require('../services/containerSecurityService');
const ProbeService = require('../services/probeService');

const router = express.Router();

//Route: POST
//Description: creates a new container security
//Param: req.params -> {projectId, componentId}
//Param: req.body -> {name, dockerCredential, imagePath, imageTags}
//returns: response -> {containerSecurity, error}
router.post(
    '/:projectId/:componentId/container',
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

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Container Security Name is required',
                });
            }

            if (!data.imagePath || !data.imagePath.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Image Path is required',
                });
            }

            if (!data.dockerCredential || !data.dockerCredential.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Docker Credential is required',
                });
            }

            const containerSecurity = await ContainerSecurityService.create(
                data
            );
            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: PUT
//Description: updates a container security
//Param: req.params -> {projectId, componentId, containerSecurityId}
//Param: req.body -> {name?, dockerCredential?, imagePath?, imageTags?}
//returns: response -> {containerSecurity, error}
router.put(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId, containerSecurityId } = req.params;
            const { name, dockerCredential, imagePath, imageTags } = req.body;
            const data = {};

            if (name) {
                data.name = name;
            }

            if (dockerCredential) {
                data.dockerCredential = dockerCredential;
            }

            if (imagePath) {
                data.imagePath = imagePath;
            }

            if (imageTags) {
                data.imageTags = imageTags;
            }

            const containerSecurity = await ContainerSecurityService.updateOneBy(
                { _id: containerSecurityId, componentId },
                data
            );
            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: gets all the container security in a particular component
//Param: req.params -> {projectId, componentId}
//returns: response -> {containerSecurities, error}
router.get(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;
            const containerSecurities = await ContainerSecurityService.findBy({
                componentId,
            });

            return sendItemResponse(req, res, containerSecurities);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get a particular container security in a component
//Param: req.params -> {projectId, componentId, containerSecurityId}
//returns: response -> {containerSecurity, error}
router.get(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { containerSecurityId } = req.params;
            const containerSecurity = await ContainerSecurityService.findOneBy({
                _id: containerSecurityId,
            });

            if (!containerSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Container security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: DELETE
//Description: delete a particular container security in a component
//Param: req.params -> {projectId, componentId, containerSecurityId}
//returns: response -> {deletedContainerSecurity, error}
router.delete(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { containerSecurityId } = req.params;

            const deletedContainerSecurity = await ContainerSecurityService.deleteBy(
                { _id: containerSecurityId }
            );
            return sendItemResponse(req, res, deletedContainerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: DELETE
//Description: delete all container security in a component
//Param: req.params -> {projectId, componentId, containerSecurityId}
//returns: response -> {response, error}
router.delete(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { componentId } = req.params;

            const response = await ContainerSecurityService.hardDelete({
                componentId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get a particular security with a particular credential
//Param: req.params -> {projectId, credentialId} credentialId -> docker credential Id
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/container/:credentialId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { credentialId } = req.params;
            const response = await ContainerSecurityService.findBy({
                dockerCredential: credentialId,
            });

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: POST
//Description: scan a particular container
//Params: req.params -> {projectId, containerSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.post(
    '/:projectId/container/scan/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { containerSecurityId } = req.params;
            let containerSecurity = await ContainerSecurityService.findOneBy({
                _id: containerSecurityId,
            });

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                return sendErrorResponse(req, res, error);
            }

            // decrypt password
            containerSecurity = await ContainerSecurityService.decryptPassword(
                containerSecurity
            );

            const securityLog = await ProbeService.scanContainerSecurity(
                containerSecurity
            );

            global.io.emit(`securityLog_${containerSecurity._id}`, securityLog);
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
