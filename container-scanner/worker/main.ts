import BackendAPI from '../utils/api';

import ContainerSecurity from './containerSecurity';

export default {
    runContainerScan: async function () {
        const securities = await BackendAPI.get(
            'container/containerSecurities'
        );
        if (securities && securities.length > 0) {
            await Promise.all(
                securities.map((security: $TSFixMe) => {
                    return ContainerSecurity.scan(security);
                })
            );
        }

        return;
    },
};
