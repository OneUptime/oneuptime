import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import CompareBase from './CompareBase';

export default class GreaterThan extends CompareBase {
    public constructor(value: number | Date) {
        super(value);
    }

    public override toJSON(): JSONObject {
        let value: number | string;
        if (this.isNumber()) {
            value = (this as GreaterThan).toNumber();
        } else {
            value = (this as GreaterThan).toString();
        }
        return {
            _type: ObjectType.GreaterThan,
            value,
        };
    }

    public static override fromJSON(json: JSONObject): GreaterThan {
        if (json['_type'] === ObjectType.GreaterThan) {
            const numValue: number = Number(json['value']);
            if (isNaN(numValue)) {
                const date: Date = new Date(json['value'] as string);
                if (isNaN(date.getTime())) {
                    throw new BadDataException(
                        'Invalid JSON: ' + JSON.stringify(json)
                    );
                }
                return new GreaterThan(date);
            }
            return new GreaterThan(numValue);
        }
        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }
}
