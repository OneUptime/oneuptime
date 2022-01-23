const getApi = require('../utils/api').getApi;
const ErrorService = require('../utils/errorService');
const ContainerSecurity = require('./containerSecurity');

module.exports = {
    runContainerScan: async function() {
        try {
            const securities = await getApi('container/containerSecurities');
            if (securities && securities.length > 0) {
                await Promise.all(
                    securities.map(security => {
                        return ContainerSecurity.scan(security);
                    })
                );
            }

            return;
        } catch (error) {
            ErrorService.log('runContainerScan.getApi', error);
            global.Sentry.captureException(error);
        }
    },
};
