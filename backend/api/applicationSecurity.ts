import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

import { sendListResponse } from 'common-server/utils/response';
import ApplicationSecurityService from '../services/applicationSecurityService';
import RealTimeService from '../services/realTimeService';
import ResourceCategoryService from '../services/resourceCategoryService';
import ErrorService from 'common-server/utils/error';

const router = express.getRouter();

//Route: POST
//Description: creates a new application security
//Param: req.params -> {projectId, componentId}
//Param: req.body -> {name, gitRepositoryUrl, gitCredential}
//returns: response -> {applicationSecurity, error}
router.post(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
                    message: 'Application Security Name is required',
                });
            }

            if (!data.gitRepositoryUrl || !data.gitRepositoryUrl.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Repository URL is required',
                });
            }

            if (!data.gitCredential || !data.gitCredential.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Git Credential is required',
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

            const applicationSecurity = await ApplicationSecurityService.create(
                data
            );
            try {
                RealTimeService.sendApplicationSecurityCreated(
                    applicationSecurity
                );
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendApplicationSecurityCreated',
                    error
                );
            }
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: PUT
//Description: updates a particular application security
//Param: req.params -> {projectId, componentId, applicationSecurityId}
//Param: req.body -> {name?, gitRepositoryUrl?, gitCredential?}
//returns: response -> {applicationSecurity, error}
router.put(
    '/:projectId/:componentId/application/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId, applicationSecurityId } = req.params;
            const { name, gitRepositoryUrl, gitCredential, resourceCategory } =
                req.body;
            const data = {};

            if (name) {
                data.name = name;
            }

            if (gitRepositoryUrl) {
                data.gitRepositoryUrl = gitRepositoryUrl;
            }

            if (gitCredential) {
                data.gitCredential = gitCredential;
            }
            let unsetData;
            if (!resourceCategory || resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            } else {
                const resourceCategoryCount =
                    await ResourceCategoryService.countBy({
                        _id: resourceCategory,
                    });
                if (resourceCategoryCount && resourceCategoryCount) {
                    data.resourceCategory = resourceCategory;
                } else {
                    unsetData = { resourceCategory: '' };
                }
            }

            const applicationSecurity =
                await ApplicationSecurityService.updateOneBy(
                    { _id: applicationSecurityId, componentId },
                    data,

                    unsetData
                );
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get a particular application security in a component
//Param: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {applicationSecurity, error}
router.get(
    '/:projectId/:componentId/application/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecurityId } = req.params;

            const populateApplicationSecurity = [
                { path: 'componentId', select: '_id slug name slug' },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const applicationSecurity =
                await ApplicationSecurityService.findOneBy({
                    query: {
                        _id: applicationSecurityId,
                    },
                    select: selectApplicationSecurity,
                    populate: populateApplicationSecurity,
                });

            if (!applicationSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get a particular application security in a component by ApplicationSecuritySlug
//Param: req.params -> {projectId, componentId, applicationSecuritySlug}
//returns: response -> {applicationSecurity, error}
router.get(
    '/:projectId/:componentId/applicationSecuritySlug/:applicationSecuritySlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecuritySlug } = req.params;

            const populateApplicationSecurity = [
                { path: 'componentId', select: '_id slug name slug' },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const applicationSecurity =
                await ApplicationSecurityService.findOneBy({
                    query: {
                        slug: applicationSecuritySlug,
                    },
                    select: selectApplicationSecurity,
                    populate: populateApplicationSecurity,
                });

            if (!applicationSecurity) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application security not found or does not exist',
                });
            }

            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get all application security in a component
//Param: req.params -> {projectId, componentId}
//returns: response -> {applicationSecurities, error}
router.get(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId } = req.params;
            const { skip, limit } = req.query;
            const populateApplicationSecurity = [
                { path: 'componentId', select: '_id slug name slug' },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const [applicationSecurities, count] = await Promise.all([
                ApplicationSecurityService.findBy({
                    query: {
                        componentId,
                    },
                    skip,
                    limit,
                    select: selectApplicationSecurity,
                    populate: populateApplicationSecurity,
                }),
                ApplicationSecurityService.countBy({ componentId }),
            ]);

            return sendListResponse(req, res, applicationSecurities, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: DELETE
//Description: delete a particular application security in a component
//Param: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {deletedApplicationSecurity, error}
router.delete(
    '/:projectId/:componentId/application/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecurityId } = req.params;

            const deletedApplicationSecurity =
                await ApplicationSecurityService.deleteBy({
                    _id: applicationSecurityId,
                });
            return sendItemResponse(req, res, deletedApplicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: DELETE
//Description: delete all application security in a component
//Param: req.params -> {projectId, componentId}
//returns: response -> {response, error}
router.delete(
    '/:projectId/:componentId/application',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId } = req.params;

            const response = await ApplicationSecurityService.hardDelete({
                componentId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get a particular security with a particular credential
//Param: req.params -> {projectId, credentialId} credentialId -> git credential Id
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/application/:credentialId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { credentialId } = req.params;
            const populateApplicationSecurity = [
                {
                    path: 'componentId',
                    select: '_id slug name slug',
                },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const response = await ApplicationSecurityService.findBy({
                query: { gitCredential: credentialId },
                select: selectApplicationSecurity,
                populate: populateApplicationSecurity,
            });

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: POST
//Description: scan a particular application
//Params: req.params -> {projectId, applicationSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.post(
    '/:projectId/application/scan/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecurityId } = req.params;
            const applicationSecurity =
                await ApplicationSecurityService.findOneBy({
                    query: { _id: applicationSecurityId },
                    select: '_id',
                });
            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }
            const updatedApplicationSecurity =
                await ApplicationSecurityService.updateOneBy(
                    { _id: applicationSecurityId },
                    { scanned: false }
                ); //This helps the application scanner to pull the application

            RealTimeService.handleScanning({
                security: updatedApplicationSecurity,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
