import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import ContainerSecurityLogService from '../services/containerSecurityLogService';

const router: $TSFixMe = express.getRouter();

//Route: GET
//Description: get a particular container security log
//Params: req.params -> {projectId, componentId, containerSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/container/logs/:containerSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecurityId, componentId }: $TSFixMe = req.params;

            const selectContainerLog: $TSFixMe =
                'securityId componentId data deleted deleteAt';

            const populateContainerLog: $TSFixMe = [
                { path: 'securityId', select: 'name slug' },
                { path: 'componentId', select: 'name slug' },
            ];
            const securityLog: $TSFixMe =
                await ContainerSecurityLogService.findOneBy({
                    query: { securityId: containerSecurityId, componentId },
                    select: selectContainerLog,
                    populate: populateContainerLog,
                });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get a particular container security log by slug
//Params: req.params -> {projectId, componentId, containerSecuritySlug}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/containerSecuritySlug/logs/:containerSecuritySlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { containerSecuritySlug, componentId }: $TSFixMe = req.params;

            const selectContainerLog: $TSFixMe =
                'securityId componentId data deleted deleteAt';

            const populateContainerLog: $TSFixMe = [
                { path: 'securityId', select: 'name slug' },
                { path: 'componentId', select: 'name slug' },
            ];
            const securityLog: $TSFixMe =
                await ContainerSecurityLogService.findOneBy({
                    query: { slug: containerSecuritySlug, componentId },
                    select: selectContainerLog,
                    populate: populateContainerLog,
                });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get container security logs in a component
//Params: req.params -> {projectId, componentId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/container/logs',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId }: $TSFixMe = req.params;
            const selectContainerLog: $TSFixMe =
                'securityId componentId data deleted deleteAt';

            const populateContainerLog: $TSFixMe = [
                { path: 'securityId', select: 'name slug' },
                { path: 'componentId', select: 'name slug' },
            ];
            const securityLogs: $TSFixMe =
                await ContainerSecurityLogService.findBy({
                    componentId,
                    select: selectContainerLog,
                    populate: populateContainerLog,
                });
            return sendItemResponse(req, res, securityLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
