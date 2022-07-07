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

import DockerCredentialService from '../services/dockerCredentialService';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/:projectId/dockerCredential',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const {
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            }: $TSFixMe = req.body;
            const { projectId }: $TSFixMe = req.params;

            if (!dockerRegistryUrl || !dockerRegistryUrl.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Docker Registry URL is required',
                });
            }

            if (!dockerUsername || !dockerUsername.trim()) {
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

            await DockerCredentialService.validateDockerCredential({
                username: dockerUsername,
                password: dockerPassword,
            });

            const response: $TSFixMe = await DockerCredentialService.create({
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
                projectId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/dockerCredential',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;

            const populate: $TSFixMe = [
                { path: 'projectId', select: 'name slug _id' },
            ];
            const select: $TSFixMe =
                'dockerRegistryUrl dockerUsername dockerPassword iv projectId';
            const dockerCredentials: $TSFixMe =
                await DockerCredentialService.findBy({
                    query: { projectId },
                    select,
                    populate,
                });
            return sendItemResponse(req, res, dockerCredentials);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/dockerCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId }: $TSFixMe = req.params;
            const {
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            }: $TSFixMe = req.body;

            const data: $TSFixMe = {};
            if (dockerRegistryUrl) {
                data.dockerRegistryUrl = dockerRegistryUrl;
            }
            if (dockerUsername) {
                data.dockerUsername = dockerUsername;
            }
            if (dockerPassword) {
                data.dockerPassword = dockerPassword;
            }

            const dockerCredential: $TSFixMe =
                await DockerCredentialService.updateOneBy(
                    { _id: credentialId },
                    data
                );
            return sendItemResponse(req, res, dockerCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/dockerCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId }: $TSFixMe = req.params;

            const deletedDockerCredential: $TSFixMe =
                await DockerCredentialService.deleteBy({ _id: credentialId });

            return sendItemResponse(req, res, deletedDockerCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
