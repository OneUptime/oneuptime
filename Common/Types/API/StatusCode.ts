import PositiveNumber from '../PositiveNumber';

export default class StatusCode {
    private _statusCode: PositiveNumber = new PositiveNumber(200);
    public get statusCode(): PositiveNumber {
        return this._statusCode;
    }
    public set statusCode(v: PositiveNumber) {
        this._statusCode = v;
    }

    public constructor(statusCode: number | string) {
        if (statusCode) {
            this.statusCode = new PositiveNumber(statusCode);
        }
    }

    public toString(): string {
        return this.statusCode.toString();
    }

    public toNumber(): number {
        return this.statusCode.toNumber();
    }

    public static isValidStausCode(statusCode: number | string): boolean {
        try {
            if (typeof statusCode === Typeof.String) {
                statusCode = parseInt(statusCode);
            }

            if (statusCode >= 100 && statusCode <= 599) {
                return true;
            }

            return false;
        } catch (err) {
            return false;
        }
    }
}
