const getApi = require('../utils/api').getApi;
import ErrorService from '../utils/errorService'
import ApplicationSecurity from './applicationSecurity'

export default {
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
