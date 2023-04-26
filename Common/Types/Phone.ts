import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';
import { JSONObject, ObjectType } from './JSON';

export default class Phone extends DatabaseProperty {
    private _phone: string = '';
    public get phone(): string {
        return this._phone;
    }
    public set phone(v: string) {
        /*
         * TODO: Have a valid regex for phone.
         * const re: RegExp =
         *     /^(([^<>()[\].,;:\s@"]+(.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+.)+[^<>()[\].,;:\s@"]{2,})$/i;
         * const isValid: boolean = re.test(v);
         * if (!isValid) {
         *     throw new BadDataException('Phone is not in valid format.');
         * }
         */
        const re: RegExp =
            /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/; // regex for international phone numbers format based on (ITU-T E.123)
        const isValid: boolean = re.test(v);
        if (!isValid) {
            throw new BadDataException(`Phone is not in valid format: ${v}`);
        }
        this._phone = v;
    }

    public constructor(phone: string) {
        super();
        this.phone = phone;
    }

    public override toString(): string {
        return this.phone;
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.Phone,
            value: (this as Phone).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): Phone {
        if(json['_type'] === ObjectType.Phone){
            return new Phone(json['value'] as string || '');
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    protected static override toDatabase(
        _value: Phone | FindOperator<Phone>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    protected static override fromDatabase(_value: string): Phone | null {
        if (_value) {
            return new Phone(_value);
        }

        return null;
    }
}
