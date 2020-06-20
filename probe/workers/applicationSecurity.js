const ErrorService = require('../utils/errorService');
const ApplicationService = require('../utils/applicationService');

module.exports = {
    scan: async security => {
        try {
            await ApplicationService.scan(security);
        } catch (error) {
            ErrorService.log('applicationSecurity.scan', error);
            throw error;
        }
    },
};
