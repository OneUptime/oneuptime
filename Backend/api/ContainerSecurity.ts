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
    sendListResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import ContainerSecurityService from '../services/containerSecurityService';
import RealTimeService from '../services/realTimeService';
import ResourceCategoryService from '../services/resourceCategoryService';
import ErrorService from 'CommonServer/Utils/error';

const router: ExpressRouter = Express.getRouter();

/*
 * Route: POST
 * Description: creates a new container security
 * Param: req.params -> {projectId, componentId}
 * Param: req.body -> {name, dockerCredential, imagePath, imageTags}
 * Returns: response -> {containerSecurity, error}
 */
router.post(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
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

            if (
                data.resourceCategory &&
                typeof data.resourceCategory !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource Category ID is not of string type.',
                });
            }

            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.create(data);
            try {
                RealTimeService.sendContainerSecurityCreated(containerSecurity);
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendContainerSecurityCreated',
                    error
                );
            }
            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: PUT
 * Description: updates a container security
 * Param: req.params -> {projectId, componentId, containerSecurityId}
 * Param: req.body -> {name?, dockerCredential?, imagePath?, imageTags?}
 * Returns: response -> {containerSecurity, error}
 */
router.put(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId, containerSecurityId }: $TSFixMe = req.params;
            const {
                name,
                dockerCredential,
                imagePath,
                imageTags,
                resourceCategory,
            } = req.body;
            const data: $TSFixMe = {};

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
            let unsetData: $TSFixMe;
            if (!resourceCategory || resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            } else {
                const resourceCategoryCount: $TSFixMe =
                    await ResourceCategoryService.countBy({
                        _id: resourceCategory,
                    });
                if (resourceCategoryCount && resourceCategoryCount > 0) {
                    data.resourceCategory = resourceCategory;
                } else {
                    unsetData = { resourceCategory: '' };
                }
            }

            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.updateOneBy(
                    { _id: containerSecurityId, componentId },
                    data,

                    unsetData
                );
            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: GET
 * Description: gets all the container security in a particular component
 * Param: req.params -> {projectId, componentId}
 * Returns: response -> {containerSecurities, error}
 */
router.get(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId }: $TSFixMe = req.params;
            const { skip, limit }: $TSFixMe = req.query;
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select: $TSFixMe =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';

            const [containerSecurities, count]: $TSFixMe = await Promise.all([
                ContainerSecurityService.findBy({
                    query: { componentId },
                    skip,
                    limit,
                    select,
                    populate,
                }),
                ContainerSecurityService.countBy({ componentId }),
            ]);

            return sendListResponse(req, res, containerSecurities, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: GET
 * Description: get a particular container security in a component
 * Param: req.params -> {projectId, componentId, containerSecurityId}
 * Returns: response -> {containerSecurity, error}
 */
router.get(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecurityId }: $TSFixMe = req.params;
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select: $TSFixMe =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.findOneBy({
                    query: { _id: containerSecurityId },
                    select,
                    populate,
                });

            if (!containerSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Container security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: GET
 * Description: get a particular container security in a component using containerSecuritySlug
 * Param: req.params -> {projectId, componentId, containerSecuritySlug}
 * Returns: response -> {containerSecurity, error}
 */
router.get(
    '/:projectId/:componentId/containerSecuritySlug/:containerSecuritySlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecuritySlug }: $TSFixMe = req.params;
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select: $TSFixMe =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.findOneBy({
                    query: { slug: containerSecuritySlug },
                    select,
                    populate,
                });

            if (!containerSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Container security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: DELETE
 * Description: delete a particular container security in a component
 * Param: req.params -> {projectId, componentId, containerSecurityId}
 * Returns: response -> {deletedContainerSecurity, error}
 */
router.delete(
    '/:projectId/:componentId/container/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecurityId }: $TSFixMe = req.params;

            const deletedContainerSecurity: $TSFixMe =
                await ContainerSecurityService.deleteBy({
                    _id: containerSecurityId,
                });
            return sendItemResponse(req, res, deletedContainerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: DELETE
 * Description: delete all container security in a component
 * Param: req.params -> {projectId, componentId, containerSecurityId}
 * Returns: response -> {response, error}
 */
router.delete(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId }: $TSFixMe = req.params;

            const response: $TSFixMe =
                await ContainerSecurityService.hardDelete({
                    componentId,
                });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: GET
 * Description: get a particular security with a particular credential
 * Param: req.params -> {projectId, credentialId} credentialId -> docker credential Id
 * Returns: response -> {sendItemResponse, sendErrorResponse}
 */
router.get(
    '/:projectId/container/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId }: $TSFixMe = req.params;
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select: $TSFixMe =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const response: $TSFixMe = await ContainerSecurityService.findBy({
                query: { dockerCredential: credentialId },
                select,
                populate,
            });

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route: POST
 * Description: scan a particular container
 * Params: req.params -> {projectId, containerSecurityId}
 * Returns: response -> {sendItemResponse, sendErrorResponse}
 */
router.post(
    '/:projectId/container/scan/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecurityId }: $TSFixMe = req.params;
            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.findOneBy({
                    query: { _id: containerSecurityId },
                    select: '_id',
                });

            if (!containerSecurity) {
                const error: $TSFixMe = new Error(
                    'Container Security not found or does not exist'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }

            const updatedContainerSecurity: $TSFixMe =
                await ContainerSecurityService.updateOneBy(
                    { _id: containerSecurityId },
                    { scanned: false }
                ); //This helps the container scanner to pull the container

            RealTimeService.handleScanning({
                security: updatedContainerSecurity,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
