import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import SerializableObject from "../SerializableObject";

export default class EqualToOrNull extends SerializableObject {
    private _value!: string;
    public get value(): string {
        return this._value;
    }
    public set value(v: string) {
        this._value = v;
    }

    public constructor(value: string) {
        super();
        this.value = value;
    }

    public override toString(): string {
        return this.value;
    }


    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.EqualToOrNull,
            value: (this as EqualToOrNull).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): EqualToOrNull {
        if(json['_type'] === ObjectType.EqualToOrNull){
            return new EqualToOrNull(json['value'] as string);
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }
}
