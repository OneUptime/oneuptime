const getApi = require('../utils/api').getApi;
import ErrorService from '../utils/errorService';
import ContainerSecurity from './containerSecurity';

export default {
    runContainerScan: async function () {
        try {
            const securities = await getApi('container/containerSecurities');
            if (securities && securities.length > 0) {
                await Promise.all(
                    securities.map((security: $TSFixMe) => {
                        return ContainerSecurity.scan(security);
                    })
                );
            }

            return;
        } catch (error) {
            ErrorService.log('runContainerScan.getApi', error);
        }
    },
};
