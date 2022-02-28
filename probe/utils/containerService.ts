import { postApi } from './api';

export default {
    scan: async function(security: $TSFixMe) {
        return await postApi(`probe/scan/docker`, { security });
    },
};
