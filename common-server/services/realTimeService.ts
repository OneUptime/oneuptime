import BackendAPI from '../utils/api';

import { REALTIME_URL } from '../config/realtime';
import { JSONObjectOrArray } from 'common/types/JSON';
const realtimeBaseUrl = `${REALTIME_URL}/realtime`;

export default {
    send: async (
        projectId: string,
        eventType: string,
        data: JSONObjectOrArray
    ) => {
        BackendAPI.post(`${realtimeBaseUrl}/send-created-incident`, {
            projectId,
            eventType,
            data,
        });
    },
};
