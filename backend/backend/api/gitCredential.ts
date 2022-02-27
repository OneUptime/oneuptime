import express from 'express';
const getUser = require('../middlewares/user').getUser;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
import GitCredentialService from '../services/gitCredentialService';

const router = express.Router();

router.post(
    '/:projectId/gitCredential',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const {
                gitUsername,
                gitPassword,
                sshTitle,
                sshPrivateKey,
            } = req.body;
            const { projectId } = req.params;

            if (gitUsername && gitPassword) {
                const response = await GitCredentialService.create({
                    gitUsername,
                    gitPassword,
                    projectId,
                });
                return sendItemResponse(req, res, response);
            } else if (sshTitle && sshPrivateKey) {
                const response = await GitCredentialService.create({
                    sshTitle,
                    sshPrivateKey,
                    projectId,
                });
                return sendItemResponse(req, res, response);
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Credential or Ssh is required',
                });
            }
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

            const selectGitCredentials =
                'sshTitle sshPrivateKey gitUsername gitPassword iv projectId deleted';

            const populateGitCredentials = [
                { path: 'projectId', select: 'name slug' },
            ];
            const gitCredentials = await GitCredentialService.findBy({
                query: { projectId },
                select: selectGitCredentials,
                populate: populateGitCredentials,
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
            const {
                gitUsername,
                gitPassword,
                sshTitle,
                sshPrivateKey,
            } = req.body;

            const data = {};

            if (gitUsername) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'gitUsername' does not exist on type '{}'... Remove this comment to see the full error message
                data.gitUsername = gitUsername;
            }
            if (gitPassword) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'gitPassword' does not exist on type '{}'... Remove this comment to see the full error message
                data.gitPassword = gitPassword;
            }

            if (sshTitle) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'sshTitle' does not exist on type '{}'.
                data.sshTitle = sshTitle;
            }

            if (sshPrivateKey) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'sshPrivateKey' does not exist on type '{... Remove this comment to see the full error message
                data.sshPrivateKey = sshPrivateKey;
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

export default router;
