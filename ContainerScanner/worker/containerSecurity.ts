import ContainerService from '../Utils/containerService';

export default {
    scan: async (security: $TSFixMe) => {
        ContainerService.scan(security);
    },
};
