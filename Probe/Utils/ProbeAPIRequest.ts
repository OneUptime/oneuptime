import { JSONObject } from 'Common/Types/JSON';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import { PROBE_KEY } from '../Config';

export default class ProbeAPIRequest {
    public static getDefaultRequestBody(): JSONObject {
        return {
            probeKey: PROBE_KEY,
            probeId:
                LocalCache.getString('PROBE', 'PROBE_ID') ||
                process.env['PROBE_ID'],
        };
    }
}
