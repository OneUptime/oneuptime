import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';

export default class Phone extends DatabaseProperty {
    private _phone = '';
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
        this._phone = v;
    }

    public constructor(phone: string) {
        super();
        this.phone = phone;
    }

    public override toString(): string {
        return this.phone;
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
