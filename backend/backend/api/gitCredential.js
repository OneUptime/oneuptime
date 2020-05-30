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

            if (!gitUsername.trim()) {
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

module.exports = router;
