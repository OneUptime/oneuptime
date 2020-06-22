const ErrorService = require('../utils/errorService');
const ContainerService = require('../utils/containerService');

module.exports = {
    scan: async security => {
        try {
            await ContainerService.scan(security);
        } catch (error) {
            ErrorService.log('containerSecurity.scan', error);
            throw error;
        }
    },
};
