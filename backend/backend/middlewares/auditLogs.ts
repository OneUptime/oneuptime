import url from 'url';
import Express from 'common-server/utils/express';
const express = Express.getLibrary();
import _ from 'lodash';
const isValidMongoObjectId = require('../config/db').Types.ObjectId.isValid;

import AuditLogsService from '../services/auditLogsService';
import ErrorService from 'common-server/utils/error';
const sendErrorResponse = require('./response').sendErrorResponse;

import { getProjectId } from './api';
import GlobalConfigService from '../services/globalConfigService';

// TODO: This should be stored in a shared cache like redis.
let shouldStoreLogs: $TSFixMe = null;

export default {
    log: async function(
        req: express.Request,
        res: express.Response,
        next: $TSFixMe
    ) {
        try {
            const blackListedRoutes = ['/audit-logs/'];
            const blackListedReqObjectPaths = ['body.password'];
            const blackListedResObjectPaths: $TSFixMe = [];
            const blackListedResBodyObjectPaths = [
                'gitCredential',
                'dockerCredential',
                'iv',
            ];

            // Audit logging is attached to res 'finish' event, because of below reasons.
            //    - To get 'projectId' value if available. (Mostly passed as route parameter)
            //    - To access 'res.resBody' which is added in 'response' middlewares.
            //    - Also for some resason when run inside docker container only req.end and res.finish get emmited.
            res.on('finish', async () => {
                let userId = req.user && req.user.id ? req.user.id : null;
                userId = isValidMongoObjectId(userId) ? userId : null;

                let projectId = getProjectId(req, res);
                projectId = isValidMongoObjectId(projectId) ? projectId : null;

                if (shouldStoreLogs === null) {
                    const auditLogStatus = await GlobalConfigService.findOneBy({
                        query: { name: 'auditLogMonitoringStatus' },
                        select: 'value',
                    });

                    // check if the global config has auditLog flag and is storing logs before trying to store logs
                    shouldStoreLogs = !(
                        auditLogStatus && !auditLogStatus.value
                    );
                }

                //  skip storing if audit log config exist and it is not storing
                if (shouldStoreLogs) {
                    // store logs if storing
                    const parsedUrl = url.parse(req.originalUrl);

                    // Avoiding logging any audit data, if its a blacklisted url/route.
                    const isBlackListedRoute = blackListedRoutes.some(
                        blackListedRouteName => {
                            const fullApiUrl = req.originalUrl || '';
                            const paramsRouteUrl =
                                (req.route && req.route.path) || ''; // Ex. "/:projectId/statuspages"

                            return (
                                fullApiUrl.includes(blackListedRouteName) ||
                                paramsRouteUrl.includes(blackListedRouteName)
                            );
                        }
                    );

                    if (isBlackListedRoute) {
                        return;
                    }

                    // Removing specified blacklisted object paths for security and other reasons.
                    const modifiedReq = _.omit(
                        { ...req },
                        blackListedReqObjectPaths
                    );
                    const modifiedRes = _.omit(res, blackListedResObjectPaths);
                    if (Array.isArray(res.resBody)) {
                        modifiedRes.resBody = res.resBody.map(
                            (element: $TSFixMe) =>
                                _.omit(element, blackListedResBodyObjectPaths)
                        );
                    }

                    const apiRequestDetails = {
                        apiSection: parsedUrl.pathname, // url path without any query strings.
                        apiUrl: modifiedReq.originalUrl,
                        protocol: modifiedReq.protocol,
                        hostname: modifiedReq.hostname,
                        port: modifiedReq.socket.address().port,
                        method: modifiedReq.method,
                        params: modifiedReq.params,
                        queries: modifiedReq.query,
                        body: modifiedReq.body || {},
                        headers: modifiedReq.headers,
                    };

                    const apiResponseDetails = {
                        statusCode: modifiedRes.statusCode,
                        statusMessage: modifiedRes.statusMessage,
                        resBody: modifiedRes.resBody || {},
                        headers: modifiedRes.getHeaders(),
                    };

                    await AuditLogsService.create({
                        userId: userId,
                        projectId: projectId,
                        request: apiRequestDetails,
                        response: apiResponseDetails,
                    });
                }
            });

            return next();
        } catch (error) {
            ErrorService.log('auditLogs.log', error);
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error while logging the request.',
            });
        }
    },
};
