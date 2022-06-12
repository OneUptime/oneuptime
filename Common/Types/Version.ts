import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';

export default class Version extends DatabaseProperty {
    private _version: string = '';
    public get version(): string {
        return this._version;
    }
    public set version(v: string) {
        const re: RegExp =
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z\d][-a-zA-Z.\d]*)?(\+[a-zA-Z\d][-a-zA-Z.\d]*)?$/i;
        const isValid: boolean = re.test(v);
        if (!isValid) {
            throw new BadDataException('Version is not in valid format.');
        }
        this._version = v;
    }

    public constructor(version: string) {
        super();
        this.version = version;
    }

    public override toString(): string {
        return this.version;
    }

    protected static override toDatabase(
        value: Version | FindOperator<Version>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return null;
    }

    protected static override fromDatabase(_value: string): Version | null {
        if (_value) {
            return new Version(_value);
        }

        return null;
    }
}
