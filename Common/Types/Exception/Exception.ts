import ExceptionCode from './ExceptionCode';

export default class Exception extends Error {
    private _code: ExceptionCode = ExceptionCode.GeneralException;

    public get code(): ExceptionCode {
        return this._code;
    }

    public set code(value: ExceptionCode) {
        if (Exception.isValidCode(value)) {
            this._code = value;
        } else {
            throw new Exception(400, 'Invalid error code');
        }
    }

    public constructor(code: ExceptionCode, message: string) {
        super(message);
        this.code = code;
    }

    private static isValidCode(code: number): boolean {
        const exceptionCode: Array<number> = [0, 1, 2, 3, 5, 400];
        return exceptionCode.includes(code);
    }
}
