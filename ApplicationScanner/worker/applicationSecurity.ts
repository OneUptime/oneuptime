import ApplicationService from '../Utils/applicationService';

export default {
    scan: async (security: $TSFixMe) => {
        await ApplicationService.scan(security);
    },
};
