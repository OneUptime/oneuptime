import BackendAPI from './api';

export default {
    scan: async function (security: $TSFixMe): void {
        return await BackendAPI.post(`probe/scan/docker`, { security });
    },
};
