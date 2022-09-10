import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';

export default class Domain extends DatabaseProperty {
    private _domain: string = '';
    public get domain(): string {
        return this._domain;
    }
    public set domain(v: string) {
        const re: RegExp =
            /^(((?!\-))(xn\-\-)?[a-z0-9\-_]{0,61}[a-z0-9]{1,1}\.)*(xn\-\-)?([a-z0-9\-]{1,61}|[a-z0-9\-]{1,30})\.[a-z]{2,}$/; // regex for international domain numbers format based on (ITU-T E.123)
        const isValid: boolean = re.test(v);
        if (!isValid) {
            throw new BadDataException(`Domain is not in valid format: ${v}`);
        }
        this._domain = v;
    }

    public constructor(domain: string) {
        super();
        this.domain = domain;
    }

    public override toString(): string {
        return this.domain;
    }

    protected static override toDatabase(
        _value: Domain | FindOperator<Domain>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    protected static override fromDatabase(_value: string): Domain | null {
        if (_value) {
            return new Domain(_value);
        }

        return null;
    }
}
