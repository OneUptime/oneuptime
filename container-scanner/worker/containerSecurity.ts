import ContainerService from '../Utils/containerService';

export default {
    scan: async (security: $TSFixMe) => {
        await ContainerService.scan(security);
    },
};
