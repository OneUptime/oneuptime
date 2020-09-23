const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const GitCredentialService = require('../services/gitCredentialService');

const router = express.Router();

router.post(
    '/:projectId/gitCredential',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { gitUsername, gitPassword } = req.body;
            const { projectId } = req.params;

            if (!gitUsername || !gitUsername.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Username is required',
                });
            }

            if (!gitPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please provide a password',
                });
            }

            const response = await GitCredentialService.create({
                gitUsername,
                gitPassword,
                projectId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/gitCredential',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { projectId } = req.params;

            const gitCredentials = await GitCredentialService.findBy({
                projectId,
            });
            return sendItemResponse(req, res, gitCredentials);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/gitCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { credentialId } = req.params;
            const { gitUsername, gitPassword } = req.body;

            const data = {};
            if (gitUsername) {
                data.gitUsername = gitUsername;
            }
            if (gitPassword) {
                data.gitPassword = gitPassword;
            }

            const gitCredential = await GitCredentialService.updateOneBy(
                { _id: credentialId },
                data
            );
            return sendItemResponse(req, res, gitCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/gitCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { credentialId } = req.params;

            const deletedGitCredential = await GitCredentialService.deleteBy({
                _id: credentialId,
            });

            return sendItemResponse(req, res, deletedGitCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
