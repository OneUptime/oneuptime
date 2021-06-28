module.exports = {
    findByServiceKeyAndName: async ({ serviceKey, serviceName }) => {
        try {
            const serviceAuthorization = ServiceAuthorizationModel.find({
                serviceKey,
                serviceName,
            });

            return serviceAuthorization;
        } catch (error) {
            ErrorService.log(
                'ServiceAuthorizationService.findByServiceKeyAndName',
                error
            );
            throw error;
        }
    },
};

const ServiceAuthorizationModel = require('../models/serviceAuthorization');
const ErrorService = require('./errorService');
