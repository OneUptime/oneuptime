import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import SerializableObject from '../SerializableObject';

export default class IsNull extends SerializableObject {
    public constructor() {
        super();
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.IsNull,
            value: null,
        };
    }

    public static override fromJSON(json: JSONObject): IsNull {
        if (json['_type'] === ObjectType.IsNull) {
            return new IsNull();
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }

    public override toString(): string {
        return '';
    }
}
