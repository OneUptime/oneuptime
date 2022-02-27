// @ts-expect-error ts-migrate(2614) FIXME: Module '"./api"' has no exported member 'postApi'.... Remove this comment to see the full error message
import { postApi } from './api';

export default {
    scan: async function(security: $TSFixMe) {
        return await postApi(`probe/scan/docker`, { security });
    },
};
