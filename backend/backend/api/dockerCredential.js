const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const DockerCredentialService = require('../services/dockerCredentialService');

const router = express.Router();

router.post(
    '/:projectId/dockerCredential',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const {
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            } = req.body;
            const { projectId } = req.params;

            if (!dockerRegistryUrl.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Docker Registry URL is required',
                });
            }

            if (!dockerUsername.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Docker Username is required',
                });
            }

            if (!dockerPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Docker Password is required',
                });
            }

            const response = await DockerCredentialService.create({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
                projectId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/dockerCredential',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { projectId } = req.params;

            const dockerCredentials = await DockerCredentialService.findBy({
                projectId,
            });
            return sendItemResponse(req, res, dockerCredentials);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/dockerCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { credentialId } = req.params;

            const deletedDockerCredential = await DockerCredentialService.deleteBy(
                { _id: credentialId }
            );

            return sendItemResponse(req, res, deletedDockerCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
