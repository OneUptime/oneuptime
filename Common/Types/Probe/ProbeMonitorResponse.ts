import Dictionary from '../Dictionary';
import { JSONObject } from '../JSON';
import ObjectID from '../ObjectID';



export default interface ProbeMonitorResponse {
    isOnline?: boolean | undefined;
    responseTimeInMs?: number | undefined;
    responseCode?: number | undefined;
    responseHeaders?: Dictionary<string> | undefined;
    responseBody?: string | JSONObject | undefined;
    monitorStepId: ObjectID;
    monitorId: ObjectID;
    probeId: ObjectID;
}
