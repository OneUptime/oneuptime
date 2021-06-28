/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const ServiceAuthorizationService = require('../services/serviceAuthorizationService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ErrorService = require('../services/errorService');

module.exports = {
    isAuthorizedService: async function(req, res, next) {
        try {
            let serviceKey, serviceName;

            if (req.params.serviceKey) {
                serviceKey = req.params.serviceKey;
            } else if (req.query.serviceKey) {
                serviceKey = req.query.serviceKey;
            } else if (req.headers['serviceKey']) {
                serviceKey = req.headers['serviceKey'];
            } else if (req.headers['servicekey']) {
                serviceKey = req.headers['servicekey'];
            } else if (req.body.serviceKey) {
                serviceKey = req.body.serviceKey;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Service Key not found.',
                });
            }

            if (req.params.serviceName) {
                serviceName = req.params.serviceName;
            } else if (req.query.serviceName) {
                serviceName = req.query.serviceName;
            } else if (req.headers['serviceName']) {
                serviceName = req.headers['serviceName'];
            } else if (req.headers['servicename']) {
                serviceName = req.headers['servicename'];
            } else if (req.body.serviceName) {
                serviceName = req.body.serviceName;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Service Name not found.',
                });
            }

            let service = null;

            service = await ServiceAuthorizationService.findByServiceKeyAndName(
                {
                    serviceKey,
                    serviceName,
                }
            );

            if (!service) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Invalid service key and or service name',
                });
            }

            next();
        } catch (error) {
            ErrorService.log('serviceAuthorization.isAuthorizedService', error);
            throw error;
        }
    },
};
