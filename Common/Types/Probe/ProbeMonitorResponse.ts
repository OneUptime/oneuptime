import Dictionary from '../Dictionary';
import { JSONObject } from '../JSON';
import CustomCodeMonitorResponse from '../Monitor/CustomCodeMonitor/CustomCodeMonitorResponse';
import SslMonitorResponse from '../Monitor/SSLMonitor/SslMonitorResponse';
import SyntheticMonitorResponse from '../Monitor/SyntheticMonitors/SyntheticMonitorResponse';
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
    failureCause: string;
    sslResponse?: SslMonitorResponse | undefined;
    syntheticMonitorResponse?: Array<SyntheticMonitorResponse> | undefined;
    customCodeMonitorResponse?: CustomCodeMonitorResponse | undefined;
}
