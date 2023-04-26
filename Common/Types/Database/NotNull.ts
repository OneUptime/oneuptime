import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import SerializableObject from "../SerializableObject";

export default class NotNull extends SerializableObject {
    public constructor() {
        super();
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.NotNull,
            value: null,
        }
    }

    public static override fromJSON(json: JSONObject): NotNull {
        if(json['_type'] === ObjectType.LessThan){
            return new NotNull();
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    public override toString(): string {
        return '';
    }
}
