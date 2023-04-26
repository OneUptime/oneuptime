import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import SerializableObject from "../SerializableObject";

export default class Search extends SerializableObject {
    private _searchValue!: string;
    
    public get value(): string {
        return this._searchValue;
    }
    
    public set value(v: string) {
        this._searchValue = v;
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
            _type: ObjectType.Search,
            value: (this as Search).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): Search {
        if(json['_type'] === ObjectType.Search){
            return new Search(json['value'] as string || '');
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }
}
