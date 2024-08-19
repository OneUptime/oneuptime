import GenericObject from "../GenericObject";
import { JSONObject } from "../JSON";
import SerializableObject from "../SerializableObject";

export default class QueryOperator<T extends GenericObject> extends SerializableObject {
    public override fromJSON(json: JSONObject): QueryOperator<T> {
        return SerializableObject.fromJSON(json) as QueryOperator<T>;
    }
}