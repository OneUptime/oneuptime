import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class LessThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        let value: number | string;
        if (this.isNumber()) {
            value = (this as LessThan).toNumber();
        } else {
            value = (this as LessThan).toString();
        }
        return {
            _type: ObjectType.LessThan,
            value,
        };
    }

    public static override fromJSON(json: JSONObject): LessThan {
        if (json['_type'] === ObjectType.LessThan) {
            const numValue: number = Number(json['value']);
            if (isNaN(numValue)) {
                const date: Date = new Date(json['value'] as string);
                if (isNaN(date.getTime())) {
                    throw new BadDataException(
                        'Invalid JSON: ' + JSON.stringify(json)
                    );
                }
                return new LessThan(date);
            }
            return new LessThan(numValue);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }
}
