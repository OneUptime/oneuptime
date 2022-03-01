import express from 'express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import DockerCredentialService from '../services/dockerCredentialService';

const router = express.Router();

router.post(
    '/:projectId/dockerCredential',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
        try {
            const {
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            } = req.body;
            const { projectId } = req.params;

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
    async (req: Request, res: Response) => {
        try {
            const { projectId } = req.params;

            const populate = [{ path: 'projectId', select: 'name slug _id' }];
            const select =
                'dockerRegistryUrl dockerUsername dockerPassword iv projectId';
            const dockerCredentials = await DockerCredentialService.findBy({
                query: { projectId },
                select,
                populate,
            });
            return sendItemResponse(req, res, dockerCredentials);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/dockerCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
        try {
            const { credentialId } = req.params;
            const {
                dockerRegistryUrl,
                dockerUsername,
                dockerPassword,
            } = req.body;

            const data = {};
            if (dockerRegistryUrl) {
                data.dockerRegistryUrl = dockerRegistryUrl;
            }
            if (dockerUsername) {
                data.dockerUsername = dockerUsername;
            }
            if (dockerPassword) {
                data.dockerPassword = dockerPassword;
            }

            const dockerCredential = await DockerCredentialService.updateOneBy(
                { _id: credentialId },
                data
            );
            return sendItemResponse(req, res, dockerCredential);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/dockerCredential/:credentialId',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
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

export default router;
