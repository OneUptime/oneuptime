import { PROBE_KEY } from '../Config';
import ProbeUtil from './Probe';
import { JSONObject } from 'Common/Types/JSON';

export default class ProbeAPIRequest {
    public static getDefaultRequestBody(): JSONObject {
        return {
            probeKey: PROBE_KEY,
            probeId: ProbeUtil.getProbeId().toString(),
        };
    }
}
