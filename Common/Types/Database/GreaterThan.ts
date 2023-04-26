import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class GreaterThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.GreaterThan,
            value: (this as GreaterThan).toString(),
        };
    }

    public static override fromJSON(json: JSONObject): GreaterThan {
        if (json['_type'] === ObjectType.GreaterThan) {
            return new GreaterThan(json['value'] as number | Date);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }
}
