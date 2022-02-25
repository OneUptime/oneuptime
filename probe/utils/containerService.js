import { postApi } from './api'

export default {
    scan: async function(security) {
        return await postApi(`probe/scan/docker`, { security });
    },
};
