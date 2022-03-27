import BackendAPI from '../utils/api';
import ErrorService from '../utils/errorService';
import ApplicationSecurity from './applicationSecurity';

export default {
    runApplicationScan: async function () {
        try {
            const securities = await BackendAPI.get(
                'application/applicationSecurities'
            );
            if (securities && securities.length > 0) {
                await Promise.all(
                    securities.map((security: $TSFixMe) => {
                        return ApplicationSecurity.scan(security);
                    })
                );
            }

            return;
        } catch (error) {
            ErrorService.log('runApplicationScan.get', error);
        }
    },
};
