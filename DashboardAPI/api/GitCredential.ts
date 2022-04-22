import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import GitCredentialService from '../services/gitCredentialService';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/:projectId/gitCredential',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const {
                gitUsername,
                gitPassword,
                sshTitle,
                sshPrivateKey,
            }: $TSFixMe = req.body;
            const { projectId }: $TSFixMe = req.params;

            if (gitUsername && gitPassword) {
                const response: $TSFixMe = await GitCredentialService.create({
                    gitUsername,
                    gitPassword,
                    projectId,
                });
                return sendItemResponse(req, res, response);
            } else if (sshTitle && sshPrivateKey) {
                const response: $TSFixMe = await GitCredentialService.create({
                    sshTitle,
                    sshPrivateKey,
                    projectId,
                });
                return sendItemResponse(req, res, response);
            }
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Git Credential or Ssh is required',
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/gitCredential',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;

            const selectGitCredentials: $TSFixMe =
                'sshTitle sshPrivateKey gitUsername gitPassword iv projectId deleted';

            const populateGitCredentials: $TSFixMe = [
                { path: 'projectId', select: 'name slug' },
            ];
            const gitCredentials: $TSFixMe = await GitCredentialService.findBy({
                query: { projectId },
                select: selectGitCredentials,
                populate: populateGitCredentials,
            });
            return sendItemResponse(req, res, gitCredentials);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/gitCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId }: $TSFixMe = req.params;
            const {
                gitUsername,
                gitPassword,
                sshTitle,
                sshPrivateKey,
            }: $TSFixMe = req.body;

            const data: $TSFixMe = {};

            if (gitUsername) {
                data.gitUsername = gitUsername;
            }
            if (gitPassword) {
                data.gitPassword = gitPassword;
            }

            if (sshTitle) {
                data.sshTitle = sshTitle;
            }

            if (sshPrivateKey) {
                data.sshPrivateKey = sshPrivateKey;
            }

            const gitCredential: $TSFixMe =
                await GitCredentialService.updateOneBy(
                    { _id: credentialId },
                    data
                );
            return sendItemResponse(req, res, gitCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/gitCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId }: $TSFixMe = req.params;

            const deletedGitCredential: $TSFixMe =
                await GitCredentialService.deleteBy({
                    _id: credentialId,
                });

            return sendItemResponse(req, res, deletedGitCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
