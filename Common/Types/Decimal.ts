// This is for Object ID for all the things in our database.
import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';
import { JSONObject, ObjectType } from './JSON';
import BadDataException from './Exception/BadDataException';

export default class Decimal extends DatabaseProperty {
    private _value: number = 0;
    public get value(): number {
        return this._value;
    }
    public set value(v: number) {
        this._value = v;
    }

    public constructor(value: number | Decimal | string) {
        super();

        if (typeof value === 'string') {
            value = parseFloat(value);
        }

        if (value instanceof Decimal) {
            value = value.value;
        }

        this.value = value;
    }

    public equals(other: Decimal): boolean {
        return this.value.toString() === other.value.toString();
    }

    public override toString(): string {
        return this.value.toString();
    }

    protected static override toDatabase(
        value: Decimal | FindOperator<Decimal>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return null;
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.Decimal,
            value: (this as Decimal).toString(),
        };
    }

    public static override fromJSON(json: JSONObject): Decimal {
        if (json['_type'] === ObjectType.Decimal) {
            return new Decimal((json['value'] as number) || 0);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }

    protected static override fromDatabase(_value: number): Decimal | null {
        if (_value) {
            return new Decimal(_value);
        }

        return null;
    }

    public static fromString(value: string): Decimal {
        return new Decimal(value);
    }
}
