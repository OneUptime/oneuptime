import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class LessThanOrEqual extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.LessThanOrEqual,
            value: (this as LessThanOrEqual).toString(),
        };
    }

    public static override fromJSON(json: JSONObject): LessThanOrEqual {
        if (json['_type'] === ObjectType.LessThanOrEqual) {
            return new LessThanOrEqual(json['value'] as number | Date);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }
}
