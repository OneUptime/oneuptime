import BackendAPI from '../utils/api';

import ApplicationSecurity from './applicationSecurity';

export default {
    runApplicationScan: async function () {
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
    },
};
