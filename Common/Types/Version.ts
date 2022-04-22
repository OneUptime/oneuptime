import BadDataException from './Exception/BadDataException';

export default class Version {
    private _version: string = '';
    public get version(): string {
        return this._version;
    }
    public set version(v: string) {
        this._version = v;
    }

    public constructor(version: string) {
        const re: RegExp =
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z\d][-a-zA-Z.\d]*)?(\+[a-zA-Z\d][-a-zA-Z.\d]*)?$/i;
        const isValid: boolean = re.test(version);
        if (!isValid) {
            throw new BadDataException('Version is not in valid format.');
        }
        this.version = version;
    }

    public toString(): string {
        return this.version;
    }
}
