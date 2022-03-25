import ExceptionCode from "./exceptionCode";

export default class Exception extends Error {

    private _code: ExceptionCode = ExceptionCode.GeneralException;

    public get code(): ExceptionCode {
        return this._code;
    }

    public set code(v: ExceptionCode) {
        this._code = v;
    }

    constructor(code: ExceptionCode, message: string) {
        super(message);
        this.code = code;
    }

}


