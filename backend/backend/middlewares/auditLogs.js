/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const url = require('url');
const _ = require('lodash');

var AuditLogsService = require('../services/auditLogsService');
var ErrorService = require('../services/errorService');
var sendErrorResponse = require('./response').sendErrorResponse;
var { getProjectId } = require('./api');

module.exports = {
    log: async function(req, res, next) {
        try {
            const blackListedRoutes = ['/audit-logs/'];
            const blackListedReqObjectPaths = ['body.password'];
            const blackListedResObjectPaths = [];

            // Audit logging is attached to req 'close' event, because of below reasons.
            //    - To get 'projectId' value if available. (Mostly passed as route parameter)
            //    - To access 'res.resBody' which is added in 'response' middlewares.
            req.on('close', async () => {
                const parsedUrl = url.parse(req.originalUrl);
                const userId = req.user && req.user.id ? req.user.id : null;
                const projectId = getProjectId(req, res);

                // Avoiding logging any audit data, if its a blacklisted url/route.
                const isBlackListedRoute = blackListedRoutes.some(
                    blackListedRouteName => {
                        const fullApiUrl = req.originalUrl || '';
                        const paramsRouteUrl = req.route.path || '';   // Ex. "/:projectId/statuspages"
    
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
                const modifiedReq = _.omit(req, blackListedReqObjectPaths);
                const modifiedRes = _.omit(res, blackListedResObjectPaths);

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
                    headers: modifiedReq.headers
                };

                const apiResponseDetails = {
                    statusCode: modifiedRes.statusCode,
                    statusMessage: modifiedRes.statusMessage,
                    resBody: modifiedRes.resBody || {},
                    headers: modifiedRes.getHeaders()
                };

                await AuditLogsService.create({
                    userId: userId,
                    projectId: projectId,
                    request: apiRequestDetails,
                    response: apiResponseDetails
                });
            });

            next();
        } catch (error) {
            ErrorService.log('auditLogs.log', error);
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error while logging the request.'
            });
        }
    }
};
