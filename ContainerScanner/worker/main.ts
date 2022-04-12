import BackendAPI from '../Utils/api';

import ContainerSecurity from './containerSecurity';

export default {
    runContainerScan: async function (): void {
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
