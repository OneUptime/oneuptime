import ContainerService from '../utils/containerService';

export default {
    scan: async (security: $TSFixMe) => {
        await ContainerService.scan(security);
    },
};
