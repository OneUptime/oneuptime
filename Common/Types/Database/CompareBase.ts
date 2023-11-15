import BadDataException from '../Exception/BadDataException';
import SerializableObject from '../SerializableObject';
import Typeof from '../Typeof';

export default class CompareBase extends SerializableObject {
    private _value!: number | Date;
    public get value(): number | Date {
        return this._value;
    }
    public set value(v: number | Date) {
        this._value = v;
    }

    public constructor(value: number | Date) {
        super();
        this.value = value;
    }

    public isNumber(): boolean {
        return Typeof.Number === typeof this.value;
    }

    public isDate(): boolean {
        return this.value instanceof Date;
    }

    public override toString(): string {
        if (this.isDate()) {
            return this.toDate().toJSON();
        }
        return this.value.toString();
    }

    public toNumber(): number {
        if (this.isNumber()) {
            return this.value as number;
        }

        throw new BadDataException('Value is not a number');
    }

    public toDate(): Date {
        if (this.isDate()) {
            return this.value as Date;
        }

        throw new BadDataException('Value is not a date object');
    }
}
