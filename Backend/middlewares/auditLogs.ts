import url from 'url';
import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import _ from 'lodash';
const isValidMongoObjectId: $TSFixMe = require('../config/db').Types.ObjectId.isValid;

import AuditLogsService from '../Services/auditLogsService';
const sendErrorResponse: $TSFixMe = require('./response').sendErrorResponse;

import { getProjectId } from './api';
import GlobalConfigService from '../Services/globalConfigService';

// TODO: This should be stored in a shared cache like redis.
let shouldStoreLogs: $TSFixMe = null;

export default {
    log: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            const blackListedRoutes: $TSFixMe = ['/audit-logs/'];
            const blackListedReqObjectPaths: $TSFixMe = ['body.password'];
            const blackListedResObjectPaths: $TSFixMe = [];
            const blackListedResBodyObjectPaths: $TSFixMe = [
                'gitCredential',
                'dockerCredential',
                'iv',
            ];

            // Audit logging is attached to res 'finish' event, because of below reasons.
            //    - To get 'projectId' value if available. (Mostly passed as route parameter)
            //    - To access 'res.logBody' which is added in 'response' middlewares.
            //    - Also for some resason when run inside docker container only req.end and res.finish get emmited.
            res.on('finish', async () => {
                let userId = req.user && req.user.id ? req.user.id : null;
                userId = isValidMongoObjectId(userId) ? userId : null;

                let projectId = getProjectId(req, res);
                projectId = isValidMongoObjectId(projectId) ? projectId : null;

                if (shouldStoreLogs === null) {
                    const auditLogStatus: $TSFixMe = await GlobalConfigService.findOneBy({
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
                    const parsedUrl: $TSFixMe = url.parse(req.originalUrl);

                    // Avoiding logging any audit data, if its a blacklisted url/route.
                    const isBlackListedRoute: $TSFixMe = blackListedRoutes.some(
                        blackListedRouteName => {
                            const fullApiUrl: $TSFixMe = req.originalUrl || '';
                            const paramsRouteUrl: $TSFixMe =
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
                    const modifiedReq: $TSFixMe = _.omit(
                        { ...req },
                        blackListedReqObjectPaths
                    );
                    const modifiedRes: $TSFixMe = _.omit(res, blackListedResObjectPaths);
                    if (Array.isArray(res.logBody)) {
                        modifiedRes.logBody = res.logBody.map(
                            (element: $TSFixMe) =>
                                _.omit(element, blackListedResBodyObjectPaths)
                        );
                    }

                    const apiRequestDetails: $TSFixMe = {
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

                    const apiResponseDetails: $TSFixMe = {
                        statusCode: modifiedRes.statusCode,
                        statusMessage: modifiedRes.statusMessage,
                        resBody: modifiedRes.logBody || {},
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
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Error while logging the request.')
            );
        }
    },
};
