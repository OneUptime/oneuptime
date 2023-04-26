
import NotImplementedException from './Exception/NotImplementedException';
import { JSONObject } from './JSON';

export default class SerializableObject {
    public constructor() {}

    public toJSON(): JSONObject {
        throw new NotImplementedException();
    }

    public static fromJSON(_json: JSONObject): SerializableObject {
        throw new NotImplementedException();
    }

    public fromJSON(json: JSONObject): SerializableObject {
        return SerializableObject.fromJSON(json);
    }
}