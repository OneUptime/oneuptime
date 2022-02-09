const getApi = require('../utils/api').getApi;
const ErrorService = require('../utils/errorService');
const ApplicationSecurity = require('./applicationSecurity');

module.exports = {
    runApplicationScan: async function() {
        try {
            const securities = await getApi(
                'application/applicationSecurities'
            );
            if (securities && securities.length > 0) {
                await Promise.all(
                    securities.map(security => {
                        return ApplicationSecurity.scan(security);
                    })
                );
            }

            return;
        } catch (error) {
            ErrorService.log('runApplicationScan.getApi', error);
        }
    },
};
