import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';
import ContainerSecurityService from '../services/containerSecurityService';
import RealTimeService from '../services/realTimeService';
import ResourceCategoryService from '../services/resourceCategoryService';
import ErrorService from 'common-server/utils/error';

const router = express.getRouter();

//Route: POST
//Description: creates a new container security
//Param: req.params -> {projectId, componentId}
//Param: req.body -> {name, dockerCredential, imagePath, imageTags}
//returns: response -> {containerSecurity, error}
router.post(
    '/:projectId/:componentId/container',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
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

            if (
                data.resourceCategory &&
                typeof data.resourceCategory !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource Category ID is not of string type.',
                });
            }

            const containerSecurity = await ContainerSecurityService.create(
                data
            );
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
    async (req: Request, res: Response) => {
        try {
            const { componentId, containerSecurityId } = req.params;
            const {
                name,
                dockerCredential,
                imagePath,
                imageTags,
                resourceCategory,
            } = req.body;
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
            let unsetData;
            if (!resourceCategory || resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            } else {
                const resourceCategoryCount = await ResourceCategoryService.countBy(
                    {
                        _id: resourceCategory,
                    }
                );
                if (resourceCategoryCount && resourceCategoryCount > 0) {
                    data.resourceCategory = resourceCategory;
                } else {
                    unsetData = { resourceCategory: '' };
                }
            }

            const containerSecurity = await ContainerSecurityService.updateOneBy(
                { _id: containerSecurityId, componentId },
                data,

                unsetData
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
    async (req: Request, res: Response) => {
        try {
            const { componentId } = req.params;
            const { skip, limit } = req.query;
            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';

            const [containerSecurities, count] = await Promise.all([
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
    async (req: Request, res: Response) => {
        try {
            const { containerSecurityId } = req.params;
            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const containerSecurity = await ContainerSecurityService.findOneBy({
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
            return sendErrorResponse(req, res, error);
        }
    }
);

//Route: GET
//Description: get a particular container security in a component using containerSecuritySlug
//Param: req.params -> {projectId, componentId, containerSecuritySlug}
//returns: response -> {containerSecurity, error}
router.get(
    '/:projectId/:componentId/containerSecuritySlug/:containerSecuritySlug',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
        try {
            const { containerSecuritySlug } = req.params;
            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const containerSecurity = await ContainerSecurityService.findOneBy({
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
    async (req: Request, res: Response) => {
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
    async (req: Request, res: Response) => {
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
    async (req: Request, res: Response) => {
        try {
            const { credentialId } = req.params;
            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const response = await ContainerSecurityService.findBy({
                query: { dockerCredential: credentialId },
                select,
                populate,
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
    async (req: Request, res: Response) => {
        try {
            const { containerSecurityId } = req.params;
            const containerSecurity = await ContainerSecurityService.findOneBy({
                query: { _id: containerSecurityId },
                select: '_id',
            });

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error);
            }

            const updatedContainerSecurity = await ContainerSecurityService.updateOneBy(
                { _id: containerSecurityId },
                { scanned: false }
            ); //This helps the container scanner to pull the container

            try {
                RealTimeService.handleScanning({
                    security: updatedContainerSecurity,
                });
            } catch (error) {
                ErrorService.log('realtimeService.handleScanning', error);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
