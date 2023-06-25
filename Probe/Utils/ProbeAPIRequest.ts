import { JSONObject } from 'Common/Types/JSON';
import ProbeUtil from './Probe';
import { PROBE_KEY } from '../Config';

export default class ProbeAPIRequest {
    public static getDefaultRequestBody(): JSONObject {
        return {
            probeKey: PROBE_KEY,
            probeId: ProbeUtil.getProbeId().toString(),
        };
    }
}
