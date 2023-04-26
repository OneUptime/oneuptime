import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class LessThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.LessThan,
            value: (this as LessThan).toString(),
        };
    }

    public static override fromJSON(json: JSONObject): LessThan {
        if (json['_type'] === ObjectType.LessThan) {
            return new LessThan(json['value'] as number | Date);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }
}
