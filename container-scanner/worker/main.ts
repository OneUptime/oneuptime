import BackendAPI from '../utils/api';
import ErrorService from '../utils/errorService';
import ContainerSecurity from './containerSecurity';

export default {
    runContainerScan: async function () {
        try {
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
        } catch (error) {
            ErrorService.log('runContainerScan.get', error);
        }
    },
};
