import ApplicationService from '../utils/applicationService';

export default {
    scan: async (security: $TSFixMe) => {
        await ApplicationService.scan(security);
    },
};
