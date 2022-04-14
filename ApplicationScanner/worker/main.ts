import BackendAPI from '../Utils/api';

import ApplicationSecurity from './applicationSecurity';

export default {
    runApplicationScan: async function (): void {
        const securities: $TSFixMe = await BackendAPI.get(
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
