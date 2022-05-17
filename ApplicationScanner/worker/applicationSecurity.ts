import ApplicationService from '../Utils/applicationService';

export default {
    scan: async (security: $TSFixMe) => {
        ApplicationService.scan(security);
    },
};
