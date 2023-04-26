import OneUptimeDate from '../Date';
import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import SerializableObject from '../SerializableObject';

export default class InBetween extends SerializableObject {
    private _startValue!: number | Date | string;
    public get startValue(): number | Date | string {
        return this._startValue;
    }
    public set startValue(v: number | Date | string) {
        this._startValue = v;
    }

    private _endValue!: number | Date | string;
    public get endValue(): number | Date | string {
        return this._endValue;
    }
    public set endValue(v: number | Date | string) {
        this._endValue = v;
    }

    public constructor(
        startValue: number | Date | string,
        endValue: number | Date | string
    ) {
        super();
        this.endValue = endValue;
        this.startValue = startValue;
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.InBetween,
            startValue: (this as InBetween).startValue,
            endValue: (this as InBetween).endValue,
        }
    }

    public static override fromJSON(json: JSONObject): InBetween {
        if(json['_type'] === ObjectType.InBetween){
            return new InBetween(json['startValue'] as number | Date | string, json['endValue'] as number | Date | string);
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    public override toString(): string {
        let startValue: number | Date | string = this.startValue;
        let endValue: number | Date | string = this.endValue;

        if (startValue instanceof Date) {
            startValue = OneUptimeDate.asDateForDatabaseQuery(startValue);
        }

        if (endValue instanceof Date) {
            endValue = OneUptimeDate.asDateForDatabaseQuery(endValue);
        }

        if (startValue.toString() === endValue.toString()) {
            return this.startValue.toString();
        }

        return this.startValue.toString() + ' - ' + this.endValue.toString();
    }

    public toStartValueString(): string {
        return this.startValue.toString();
    }

    public toEndValueString(): string {
        return this.endValue.toString();
    }
}
