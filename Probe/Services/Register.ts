import API from 'Common/Utils/API';
import {
    PROBE_API_URL,
    PROBE_DESCRIPTION,
    PROBE_ID,
    PROBE_KEY,
    PROBE_NAME,
} from '../Config';
import URL from 'Common/Types/API/URL';
import { ClusterKey, hasClusterKey } from 'CommonServer/Config';
import logger from 'CommonServer/Utils/Logger';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { JSONObject } from 'Common/Types/JSON';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';

export default class Register {
    public static async registerProbe(): Promise<void> {
        if (hasClusterKey) {
            const resullt: HTTPResponse<JSONObject> = await API.post(
                URL.fromString(PROBE_API_URL.toString()).addRoute('/register'),
                {
                    probeKey: PROBE_KEY,
                    probeName: PROBE_NAME,
                    probeDescription: PROBE_DESCRIPTION,
                    clusterKey: ClusterKey.toString(),
                }
            );

            if (resullt.isSuccess()) {
                const probeId: string = resullt.data['_id'] as string;
                LocalCache.setString('PROBE', 'PROBE_ID', probeId as string);
            }
        } else {
            // validate probe.
            if (!PROBE_ID) {
                logger.error('PROBE_ID or ONEUPTIME_SECRET should be set');
                return process.exit();
            }

            await API.post(
                URL.fromString(PROBE_API_URL.toString()).addRoute('/alive'),
                {
                    probeKey: PROBE_KEY.toString(),
                    probeId: PROBE_ID.toString(),
                }
            );

            LocalCache.setString(
                'PROBE',
                'PROBE_ID',
                PROBE_ID.toString() as string
            );
        }
    }
}
