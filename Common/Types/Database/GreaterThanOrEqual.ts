import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class GreaterThanOrEqual extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.GreaterThanOrEqual,
            value: (this as GreaterThanOrEqual).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): GreaterThanOrEqual {
        if(json['_type'] === ObjectType.GreaterThanOrEqual){
            return new GreaterThanOrEqual(json['value'] as number | Date);
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }
}
