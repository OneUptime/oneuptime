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

import ApplicationSecurityLogService from '../services/applicationSecurityLogService';

const router: $TSFixMe = express.getRouter();

//Route: GET
//Description: get an application security log
//Params: req.params -> {projectId, componentId, applicationSecurityId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/application/logs/:applicationSecurityId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecurityId, componentId }: $TSFixMe = req.params;

            const populateApplicationSecurityLog: $TSFixMe = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog: $TSFixMe =
                '_id securityId componentId data';

            const securityLog: $TSFixMe = await ApplicationSecurityLogService.findOneBy({
                query: { securityId: applicationSecurityId, componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get an application security log by slug
//Params: req.params -> {projectId, componentId, applicationSecuritySlug}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/applicationSecuritySlug/logs/:applicationSecuritySlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { applicationSecuritySlug, componentId }: $TSFixMe = req.params;

            const populateApplicationSecurityLog: $TSFixMe = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog: $TSFixMe =
                '_id securityId componentId data';

            const securityLog: $TSFixMe = await ApplicationSecurityLogService.findOneBy({
                query: { slug: applicationSecuritySlug, componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Route: GET
//Description: get application security logs in a component
//Params: req.params -> {projectId, componentId}
//returns: response -> {sendItemResponse, sendErrorResponse}
router.get(
    '/:projectId/:componentId/application/logs',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId }: $TSFixMe = req.params;
            const populateApplicationSecurityLog: $TSFixMe = [
                { path: 'componentId', select: '_id slug name slug' },
                {
                    path: 'securityId',
                    select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog: $TSFixMe =
                '_id securityId componentId data';
            const securityLogs: $TSFixMe = await ApplicationSecurityLogService.findBy({
                query: { componentId },
                select: selectApplicationSecurityLog,
                populate: populateApplicationSecurityLog,
            });
            return sendItemResponse(req, res, securityLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
