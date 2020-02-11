/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const url = require('url');

var AuditLogsService = require('../services/auditLogsService');
var ErrorService = require('../services/errorService');
var sendErrorResponse = require('./response').sendErrorResponse;
var { getProjectId } = require('./api');

module.exports = {
    logRequest: async function(req, res, next) {
        try {
            // Avoiding logging req/res on '/auditLogs' routes for now. Since it exponentially increace the size of auditLogs db data.
            const isAuditLogRoute = req.originalUrl.includes('/auditLogs');

            if (!isAuditLogRoute) {
                // Audit logging is attached to req 'close' event, because of below reasons.
                //    - To get 'projectId' value if available. (Mostly passed as route parameter)
                //    - To access 'res.resBody' which is added in 'response' middlewares.
                req.on('close', async () => {
                    const parsedUrl = url.parse(req.originalUrl);
                    const userId = req.user && req.user.id ? req.user.id : null;
                    const projectId = getProjectId(req, res);

                    const apiRequestDetails = {
                        apiSection: parsedUrl.pathname, // url path without any query strings.
                        apiUrl: req.originalUrl,
                        protocol: req.protocol,
                        hostname: req.hostname,
                        port: req.socket.address().port,
                        method: req.method,
                        params: req.params,
                        queries: req.query,
                        body: req.body || {},
                        headers: req.headers
                    };

                    const apiResponseDetails = {
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        resBody: res.resBody || {},
                        headers: res.getHeaders()
                    };

                    await AuditLogsService.createAuditLog({
                        userId: userId,
                        projectId: projectId,
                        reqLog: apiRequestDetails,
                        resLog: apiResponseDetails
                    });
                });
            }

            next();
        } catch (error) {
            ErrorService.log('auditLogs.logRequest', error);
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error while logging the request.'
            });
        }
    }
};
