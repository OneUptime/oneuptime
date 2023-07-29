import Dictionary from '../../Dictionary';
import { JSONObject } from '../../JSON';
import ObjectID from '../../ObjectID';

export default  interface IncomingMonitorRequest {
    monitorId: ObjectID;
    requestHeaders: Dictionary<string>;
    requestBody: string | JSONObject;
}