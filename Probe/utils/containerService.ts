import BackendAPI from './api';

export default {
    scan: async function (security: $TSFixMe) {
        return await BackendAPI.post(`probe/scan/docker`, { security });
    },
};
