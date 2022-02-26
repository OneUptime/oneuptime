import ErrorService from '../utils/errorService'
import ContainerService from '../utils/containerService'

export default {
    scan: async (security: $TSFixMe) => {
        try {
            await ContainerService.scan(security);
        } catch (error) {
            ErrorService.log('containerSecurity.scan', error);
            throw error;
        }
    },
};
