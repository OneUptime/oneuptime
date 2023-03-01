import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';

export interface RunProps {
    arguments: JSONObject;
    workflowId: ObjectID;
    workflowLogId: ObjectID | null;
    timeout: number;
}
